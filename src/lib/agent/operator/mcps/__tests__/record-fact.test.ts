/**
 * Unit tests for the `record_fact` tool inside the memory MCP.
 *
 * `recordFact` (the underlying memory layer write) is mocked here so we
 * can exercise the MCP wrapper boundaries: property name resolution,
 * Zod input validation, and DB error pass-through. The memory layer's
 * own behavior is covered in `src/lib/agent/memory/__tests__/record.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryMcp } from '../memory';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryFact } from '@/lib/agent/memory/types';

vi.mock('@/lib/agent/memory/record', () => ({
  recordFact: vi.fn(),
}));

import { recordFact } from '@/lib/agent/memory/record';

const mockRecordFact = vi.mocked(recordFact);

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
  inputSchema?: { safeParse: (input: unknown) => { success: boolean } };
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getTool(server: unknown, name: string): ToolDefShape {
  const s = server as McpServerShape;
  const t =
    s.instance?._registeredTools?.[name] ??
    s.tools?.find((tool) => tool.name === name);
  if (!t) throw new Error(`${name} tool not found`);
  return t;
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  return getTool(server, name).handler;
}

function adminStub(): SupabaseClient<Database> {
  return { from: vi.fn() } as unknown as SupabaseClient<Database>;
}

function makeOrgContext(): OrganizationContext {
  return {
    organization: {
      id: 'org-1',
      name: 'Galaxy Estates',
      assistantName: 'Odesa',
    },
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

function persistedFact(id: string): MemoryFact {
  return {
    id,
    organizationId: 'org-1',
    propertyId: 'prop-1',
    factType: 'owner_rule',
    subjectId: null,
    content: { rule_text: 'never waive late fees', source_text: null },
    confidence: 1.0,
    source: 'owner_stated',
    evidenceProposalIds: [],
    createdAt: '2026-05-06T10:00:00Z',
    supersededAt: null,
    supersededBy: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('record_fact', () => {
  it('should insert an owner_rule fact and return the new id', async () => {
    mockRecordFact.mockResolvedValue(persistedFact('fact-42'));
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'record_fact');

    const res = await handler(
      {
        propertyName: 'Oakwood',
        factText: 'never waive late fees',
      },
      {},
    );

    expect(mockRecordFact).toHaveBeenCalledTimes(1);
    const callArgs = mockRecordFact.mock.calls[0]![0];
    expect(callArgs.propertyId).toBe('prop-1');
    expect(callArgs.fact).toMatchObject({
      factType: 'owner_rule',
      source: 'owner_stated',
      subjectId: null,
      content: { rule_text: 'never waive late fees', source_text: null },
      confidence: 1.0,
    });
    const txt = res.content[0]!.text;
    expect(txt).toContain('Saved as memory_fact fact-42');
    expect(txt).toContain('Oakwood Commons');
  });

  it('should route a VA memory write to owner approval without persisting', async () => {
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'va' },
    });
    const handler = getHandler(server, 'record_fact');

    const res = await handler(
      {
        propertyName: 'Oakwood',
        factText: 'always use the north entrance',
      },
      {},
    );

    expect(res.content[0]?.text).toMatch(/Owner approval is required/i);
    expect(res.content[0]?.text).toMatch(/owner handoff/i);
    expect(mockRecordFact).not.toHaveBeenCalled();
  });

  it('should return clarification when propertyName matches none, without DB write', async () => {
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'record_fact');

    const res = await handler(
      { propertyName: 'nowhere', factText: 'remember this' },
      {},
    );
    expect(res.content[0]!.text).toMatch(/No property matches/i);
    expect(mockRecordFact).not.toHaveBeenCalled();
  });

  it('should return clarification when propertyName matches multiple, without DB write', async () => {
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'record_fact');

    // Both 'Oakwood Commons' and 'Galaxy Lofts' contain a lower-case 'o'.
    const res = await handler(
      { propertyName: 'o', factText: 'remember this' },
      {},
    );
    expect(res.content[0]!.text).toMatch(/Multiple properties match/i);
    expect(mockRecordFact).not.toHaveBeenCalled();
  });

  it('should surface DB errors as a record_fact-failed message instead of throwing', async () => {
    mockRecordFact.mockRejectedValue(new Error('rls denied'));
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'record_fact');

    const res = await handler(
      {
        propertyName: 'Oakwood',
        factText: 'never waive late fees',
      },
      {},
    );
    expect(res.content[0]!.text).toContain('record_fact failed');
    expect(res.content[0]!.text).toContain('rls denied');
  });

  it('should reject factText shorter than 3 chars via the input schema', () => {
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const tool = getTool(server, 'record_fact');
    const schema = tool.inputSchema;
    expect(schema?.safeParse({ propertyName: 'Oakwood', factText: 'no' }).success).toBe(false);
    // The valid case round-trips.
    expect(
      schema?.safeParse({ propertyName: 'Oakwood', factText: 'never waive late fees' })
        .success,
    ).toBe(true);
  });

  it('should reject factText longer than 500 chars via the input schema', () => {
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const tool = getTool(server, 'record_fact');
    const schema = tool.inputSchema;
    const tooLong = 'a'.repeat(501);
    expect(schema?.safeParse({ propertyName: 'Oakwood', factText: tooLong }).success).toBe(
      false,
    );
  });

  it('should pass the resolved propertyId to recordFact (UUID stays server-side)', async () => {
    mockRecordFact.mockResolvedValue(persistedFact('fact-1'));
    const server = createMemoryMcp({
      admin: adminStub(),
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'record_fact');

    const res = await handler(
      // 'Galaxy' uniquely matches 'Galaxy Lofts' (prop-2) -> resolver picks prop-2.
      { propertyName: 'Galaxy', factText: 'note for Galaxy: dumpster moves Tuesdays' },
      {},
    );

    const callArgs = mockRecordFact.mock.calls[0]![0];
    expect(callArgs.propertyId).toBe('prop-2');
    // Output mentions the property's display name, never its UUID.
    expect(res.content[0]!.text).toContain('Galaxy Lofts');
    expect(res.content[0]!.text).not.toContain('prop-2');
  });
});
