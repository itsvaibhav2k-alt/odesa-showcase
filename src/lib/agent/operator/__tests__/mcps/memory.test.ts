/**
 * Unit tests for the memory MCP. We mock @/lib/agent/memory/query so
 * the wrapper's behavior (filter/rank/property-scoped/org-wide recall/error path)
 * is the only thing under test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryMcp, filterAndRank } from '../../mcps/memory';
import type { MemoryFact } from '@/lib/agent/memory/types';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/agent/memory/query', () => ({
  getActiveFacts: vi.fn(),
}));

import { getActiveFacts } from '@/lib/agent/memory/query';
const mockGetActiveFacts = vi.mocked(getActiveFacts);

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  const s = server as McpServerShape;
  return (
    s.instance?._registeredTools?.[name]?.handler ??
    s.tools?.find((t) => t.name === name)?.handler ??
    (() => {
      throw new Error(`${name} handler not found`);
    })()
  );
}

function adminStub(): SupabaseClient<Database> {
  return { from: vi.fn() } as unknown as SupabaseClient<Database>;
}

function makeOrgContext(): OrganizationContext {
  return {
    organization: { id: 'org-1', name: 'Galaxy Estates', assistantName: 'Odesa' },
    properties: [
      {
        id: 'prop-1',
        name: 'Oakwood Commons',
        address: '100 Oak St',
        timezone: 'America/New_York',
        autonomyLevel: 0.5,
        privacyMode: 'hosted',
      },
      {
        id: 'prop-2',
        name: 'Galaxy Lofts',
        address: '200 Loft Ave',
        timezone: 'America/New_York',
        autonomyLevel: 0.4,
        privacyMode: 'anonymous',
      },
    ],
    loadedAt: '2026-05-04T00:00:00Z',
  };
}

function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const base = {
    id: 'fact-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    subjectId: null,
    confidence: 0.5,
    source: 'observed' as const,
    evidenceProposalIds: [],
    createdAt: '2026-04-01T00:00:00Z',
    supersededAt: null,
    supersededBy: null,
  };
  return {
    ...base,
    factType: 'building_quirk',
    content: { description: 'boiler kicks off below 10F', season: 'winter', recurring: true, severity: 0.6 },
    ...overrides,
  } as MemoryFact;
}

describe('filterAndRank', () => {
  it('should return matches sorted by confidence DESC', () => {
    const facts: MemoryFact[] = [
      fact({ id: 'a', confidence: 0.4, content: { description: 'plumbing leak in apt 4', season: null, recurring: false, severity: 0.5 } }),
      fact({ id: 'b', confidence: 0.9, content: { description: 'plumbing slow drain', season: null, recurring: true, severity: 0.3 } }),
      fact({ id: 'c', confidence: 0.7, content: { description: 'hvac noise', season: 'summer', recurring: false, severity: 0.4 } }),
    ];
    const out = filterAndRank(facts, 'plumb', 5);
    expect(out.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('should match against factType as well as content', () => {
    const facts: MemoryFact[] = [
      fact({ id: 'a', factType: 'vendor_relationship', subjectId: 'v1', content: { acceptance_rate: 0.8, last_used_at: null, owner_preferred: true, performance_notes: 'great' } }),
      fact({ id: 'b', factType: 'building_quirk', content: { description: 'noisy', season: null, recurring: false, severity: 0.4 } }),
    ];
    const out = filterAndRank(facts, 'vendor', 5);
    expect(out.map((f) => f.id)).toEqual(['a']);
  });

  it('should respect the limit', () => {
    const facts: MemoryFact[] = Array.from({ length: 5 }, (_, i) =>
      fact({ id: `f${i}`, confidence: 0.9 - i * 0.1, content: { description: 'leak', season: null, recurring: false, severity: 0.4 } }),
    );
    const out = filterAndRank(facts, 'leak', 2);
    expect(out).toHaveLength(2);
    expect(out[0]?.id).toBe('f0');
  });
});

describe('createMemoryMcp recall_facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return matched facts as JSON when propertyName is given and query hits', async () => {
    mockGetActiveFacts.mockResolvedValue([
      fact({ id: 'm1', confidence: 0.8, content: { description: 'boiler stops below 10F', season: 'winter', recurring: true, severity: 0.7 } }),
      fact({ id: 'm2', confidence: 0.5, content: { description: 'elevator slow', season: null, recurring: false, severity: 0.3 } }),
    ]);
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ propertyName: 'Oakwood', query: 'boiler' }, {});
    const text = res.content[0]?.text ?? '';
    expect(text).not.toContain('No matching');
    const parsed = JSON.parse(text) as Array<{ confidence: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.confidence).toBe(0.8);
    // Scoped to prop-1 (Oakwood Commons resolved).
    expect(mockGetActiveFacts).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: 'prop-1' }),
    );
  });

  it('should return "No matching facts." when query misses', async () => {
    mockGetActiveFacts.mockResolvedValue([
      fact({ id: 'm1', content: { description: 'elevator slow', season: null, recurring: false, severity: 0.3 } }),
    ]);
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ propertyName: 'Oakwood', query: 'plumbing' }, {});
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as unknown[];
    expect(parsed).toEqual([]);
  });

  it('should fan out across all org properties when propertyName is omitted (org-wide recall)', async () => {
    // Two properties in orgContext → expect 2 getActiveFacts calls.
    mockGetActiveFacts
      .mockResolvedValueOnce([
        fact({ id: 'p1-fact', propertyId: 'prop-1', content: { description: 'leak in unit 4', season: null, recurring: false, severity: 0.5 } }),
      ])
      .mockResolvedValueOnce([
        fact({ id: 'p2-fact', propertyId: 'prop-2', content: { description: 'slow drain', season: null, recurring: false, severity: 0.4 } }),
      ]);

    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ query: 'leak' }, {});
    // Both properties' facts were fetched.
    expect(mockGetActiveFacts).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{ confidence: number }>;
    // Only p1-fact matches 'leak'; p2-fact matches 'drain' not 'leak'.
    expect(parsed).toHaveLength(1);
  });

  it('should surface DB errors as a recall_facts-failed message when propertyName is given', async () => {
    mockGetActiveFacts.mockRejectedValue(new Error('rls denied'));
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ propertyName: 'Oakwood', query: 'x' }, {});
    expect(res.content[0]?.text).toContain('recall_facts failed');
    expect(res.content[0]?.text).toContain('rls denied');
  });

  it('should return clarification string when propertyName matches none', async () => {
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ propertyName: 'nowhere', query: 'anything' }, {});
    expect(res.content[0]?.text).toMatch(/No property/i);
    expect(mockGetActiveFacts).not.toHaveBeenCalled();
  });

  it('should default limit to 10 when omitted', async () => {
    mockGetActiveFacts.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        fact({
          id: `f${i}`,
          confidence: 1 - i * 0.01,
          content: { description: 'leak', season: null, recurring: false, severity: 0.4 },
        }),
      ),
    );
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ propertyName: 'Oakwood', query: 'leak' }, {});
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as unknown[];
    expect(parsed).toHaveLength(10);
  });
});
