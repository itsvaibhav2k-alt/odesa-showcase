/**
 * Hybrid recall tests — `recall_facts` should surface synonyms via
 * cosine similarity, fall back to substring when no embedding is
 * available, and degrade cleanly to substring-only when
 * OPENAI_API_KEY is missing.
 *
 * The OpenAI client is replaced via the embed module's
 * `__setEmbeddingClient` injector. The supabase client is a structural
 * stub — `from(...)` chains drive substring (via getActiveFacts) and
 * `rpc(...)` drives the cosine path. Together they exercise the merge.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMBEDDING_DIMENSIONS,
  __setEmbeddingClient,
} from '@/lib/agent/memory/embed';
import { createMemoryMcp, mergeHybridResults } from '../memory';
import type { MemoryFact } from '@/lib/agent/memory/types';
import type { MemoryFactRow } from '@/lib/agent/memory/row';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    content: {
      description: 'boiler kicks off below 10F',
      season: 'winter',
      recurring: true,
      severity: 0.6,
    },
    ...overrides,
  } as MemoryFact;
}

function factRow(overrides: Partial<MemoryFactRow> & { id: string }): MemoryFactRow {
  return {
    id: overrides.id,
    organization_id: overrides.organization_id ?? 'org-1',
    property_id: overrides.property_id ?? 'prop-1',
    fact_type: overrides.fact_type ?? 'building_quirk',
    subject_id: overrides.subject_id ?? null,
    content: overrides.content ?? {
      description: 'heating system fails below 50F',
      season: 'winter',
      recurring: true,
      severity: 0.4,
    },
    confidence: overrides.confidence ?? 0.7,
    source: overrides.source ?? 'observed',
    evidence_proposal_ids: overrides.evidence_proposal_ids ?? [],
    created_at: overrides.created_at ?? '2026-04-15T00:00:00Z',
    superseded_at: overrides.superseded_at ?? null,
    superseded_by: overrides.superseded_by ?? null,
  };
}

function makeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed + i / 1e6);
}

/**
 * Build an admin stub. `rpcRows` is what the cosine RPC returns;
 * `factsByProperty` is what `getActiveFacts` returns per property
 * (substring path).
 */
interface AdminStubOptions {
  rpcRows?: MemoryFactRow[];
  rpcError?: { message: string };
  factsByProperty?: Record<string, MemoryFact[]>;
  rpcSpy?: ReturnType<typeof vi.fn>;
}

function adminStub(opts: AdminStubOptions = {}): SupabaseClient<Database> {
  const factsByProperty = opts.factsByProperty ?? {};
  const rpc = opts.rpcSpy ?? vi.fn();
  rpc.mockImplementation(async () => {
    if (opts.rpcError) return { data: null, error: opts.rpcError };
    return { data: opts.rpcRows ?? [], error: null };
  });

  const from = vi.fn((table: string) => {
    // Mirror the chain getActiveFacts uses: from().select().eq().is().order()
    let propertyFilter: string | null = null;

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: string) => {
      if (col === 'property_id') propertyFilter = val;
      return builder;
    };
    builder.is = () => builder;
    builder.order = () => builder;
    builder.then = (fulfilled: (v: unknown) => unknown) => {
      if (table !== 'memory_facts') {
        return Promise.resolve(fulfilled({ data: [], error: null }));
      }
      const facts = propertyFilter ? factsByProperty[propertyFilter] ?? [] : [];
      // getActiveFacts goes through rowToFact, but since we're returning a
      // pre-shaped MemoryFact, we need to give it a row that hydrates back.
      const rows = facts.map((f) => ({
        id: f.id,
        organization_id: f.organizationId,
        property_id: f.propertyId,
        fact_type: f.factType,
        subject_id: f.subjectId,
        content: f.content,
        confidence: f.confidence,
        source: f.source,
        evidence_proposal_ids: [...f.evidenceProposalIds],
        created_at: f.createdAt,
        superseded_at: f.supersededAt,
        superseded_by: f.supersededBy,
      }));
      return Promise.resolve(fulfilled({ data: rows, error: null }));
    };
    return builder;
  });

  return { from, rpc } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// mergeHybridResults — pure unit
// ---------------------------------------------------------------------------

describe('mergeHybridResults', () => {
  it('preserves cosine order then appends substring hits', () => {
    const cosine = [
      fact({ id: 'a', confidence: 0.4 }),
      fact({ id: 'b', confidence: 0.9 }),
    ];
    const substring = [
      fact({ id: 'b', confidence: 0.9 }), // duplicate — drops out
      fact({ id: 'c', confidence: 0.7 }),
    ];
    const out = mergeHybridResults(cosine, substring, 5);
    expect(out.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('respects the limit', () => {
    const cosine = Array.from({ length: 12 }, (_, i) => fact({ id: `c${i}` }));
    const out = mergeHybridResults(cosine, [], 5);
    expect(out).toHaveLength(5);
    expect(out.map((f) => f.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });

  it('handles empty cosine + non-empty substring (degraded mode)', () => {
    const substring = [fact({ id: 's1' }), fact({ id: 's2' })];
    const out = mergeHybridResults([], substring, 5);
    expect(out.map((f) => f.id)).toEqual(['s1', 's2']);
  });

  it('handles both empty', () => {
    expect(mergeHybridResults([], [], 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// recall_facts handler — hybrid synonym + fallback flows
// ---------------------------------------------------------------------------

describe('recall_facts hybrid recall', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    __setEmbeddingClient(null);
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    }
    __setEmbeddingClient(null);
    vi.restoreAllMocks();
  });

  it('matches synonyms via cosine — query "boiler" hits "heating system" fact', async () => {
    // Embed call returns a deterministic vector; RPC returns the heating-
    // system fact even though substring would have missed it.
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.1) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const heatingRow = factRow({
      id: 'heat-1',
      content: {
        description: 'heating system fails below 50F',
        season: 'winter',
        recurring: true,
        severity: 0.4,
      },
    });

    const admin = adminStub({
      rpcRows: [heatingRow],
      // Substring path returns no matches for "boiler" against
      // "heating system" — proving the cosine path is what surfaced the result.
      factsByProperty: {
        'prop-1': [
          fact({
            id: 'heat-1',
            content: {
              description: 'heating system fails below 50F',
              season: 'winter',
              recurring: true,
              severity: 0.4,
            },
          }),
        ],
      },
    });

    const server = createMemoryMcp({
      admin,
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler(
      { propertyName: 'Oakwood', query: 'boiler' },
      {},
    );
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{
      content: { description?: string };
    }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]?.content?.description).toMatch(/heating system/);
    expect(create).toHaveBeenCalled();
  });

  it('degrades to substring-only when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    __setEmbeddingClient(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const matchingFact = fact({
      id: 'plumb-1',
      confidence: 0.8,
      content: {
        description: 'plumbing leak in apt 4',
        season: null,
        recurring: false,
        severity: 0.5,
      },
    });
    const otherFact = fact({
      id: 'hvac-1',
      content: {
        description: 'hvac noise',
        season: 'summer',
        recurring: false,
        severity: 0.4,
      },
    });

    const rpcSpy = vi.fn();
    const admin = adminStub({
      factsByProperty: { 'prop-1': [matchingFact, otherFact] },
      rpcSpy,
    });

    const server = createMemoryMcp({
      admin,
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler(
      { propertyName: 'Oakwood', query: 'plumb' },
      {},
    );
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{
      content: { description?: string };
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.content?.description).toMatch(/plumbing/);
    // RPC should not be called when embedding is null.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('merges cosine + substring results with dedupe', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.5) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const sharedFact = fact({
      id: 'shared',
      confidence: 0.9,
      content: {
        description: 'boiler issue',
        season: 'winter',
        recurring: true,
        severity: 0.5,
      },
    });
    const substringOnly = fact({
      id: 'substring-only',
      confidence: 0.6,
      content: {
        description: 'boiler in unit 4',
        season: 'winter',
        recurring: false,
        severity: 0.5,
      },
    });

    const sharedRow = factRow({
      id: 'shared',
      content: sharedFact.content as MemoryFactRow['content'],
      confidence: 0.9,
    });
    // Cosine finds an extra fact substring would have missed.
    const cosineOnly = factRow({
      id: 'cosine-only',
      content: {
        description: 'thermal regulation flaky in cold snaps',
        season: 'winter',
        recurring: true,
        severity: 0.6,
      },
      confidence: 0.55,
    });

    const admin = adminStub({
      rpcRows: [sharedRow, cosineOnly],
      factsByProperty: { 'prop-1': [sharedFact, substringOnly] },
    });

    const server = createMemoryMcp({
      admin,
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler(
      { propertyName: 'Oakwood', query: 'boiler' },
      {},
    );
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{
      content: { description?: string };
    }>;
    // Dedupe by id: shared appears once, cosineOnly + substringOnly both surface.
    expect(parsed).toHaveLength(3);
    const descs = parsed.map((p) => p.content?.description);
    expect(descs).toContain('thermal regulation flaky in cold snaps');
    expect(descs).toContain('boiler issue');
    expect(descs).toContain('boiler in unit 4');
  });

  it('keeps substring path alive when cosine RPC errors', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.7) }] });
    __setEmbeddingClient({ embeddings: { create } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const matchingFact = fact({
      id: 'leak-1',
      confidence: 0.7,
      content: {
        description: 'leak in basement',
        season: null,
        recurring: false,
        severity: 0.5,
      },
    });

    const admin = adminStub({
      rpcError: { message: 'pgvector index unavailable' },
      factsByProperty: { 'prop-1': [matchingFact] },
    });

    const server = createMemoryMcp({
      admin,
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler(
      { propertyName: 'Oakwood', query: 'leak' },
      {},
    );
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{
      content: { description?: string };
    }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.content?.description).toMatch(/leak/);
  });

  it('hits org-scoped RPC when propertyName is omitted', async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.3) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const orgRow = factRow({
      id: 'org-fact',
      property_id: 'prop-2',
      content: {
        description: 'thermostat malfunction',
        season: 'winter',
        recurring: false,
        severity: 0.5,
      },
    });

    const rpcSpy = vi.fn();
    const admin = adminStub({
      rpcRows: [orgRow],
      factsByProperty: {},
      rpcSpy,
    });

    const server = createMemoryMcp({
      admin,
      organizationId: 'org-1',
      orgContext: makeOrgContext(),
      commitActor: { kind: 'user', role: 'owner' },
    });
    const handler = getHandler(server, 'recall_facts');

    const res = await handler({ query: 'heating' }, {});
    expect(rpcSpy).toHaveBeenCalledWith(
      'match_memory_facts_org',
      expect.objectContaining({ organization_id_arg: 'org-1' }),
    );
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{
      content: { description?: string };
    }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });
});
