/**
 * Unit tests for the daily health-check sweep (Feature 5).
 *
 * Drives `runHealthChecks` against a recording supabase stub (mirrors
 * src/lib/digest/__tests__/generate.test.ts) with an injected
 * recordProposal impl. Cases:
 *   1. finding → recordProposal called with the bound proposal shape
 *      (action_type 'health_flag', sentinel worker_model, routing null,
 *      reasoning === payload.summary).
 *   2. gate is ALWAYS review: the real commit-gate policy yields
 *      'review' even at max autonomy + confidence.
 *   3. dedupe pre-read: an open (kind, subject) flag suppresses the
 *      insert.
 *   4. 23505 backstop (ProposalRecordError race) → counted skippedRace,
 *      sweep continues.
 *   5. non-dedupe record error → throws.
 *   6. healthy org → no open-flags query, no record calls.
 *   7. organizationId option scopes the org query.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { gateProposal } from '@/lib/agent/worker/commit-gate';
import {
  recordProposal,
  ProposalRecordError,
  type RecordProposalInput,
} from '@/lib/agent/proposals/record';
import { runHealthChecks, HEALTH_CHECK_WORKER_MODEL } from '../generate';

const NOW = new Date('2026-06-11T10:00:00.000Z');
const GALAXY = '11111111-1111-1111-1111-111111111101';
const PROPERTY_A = '33333333-3333-3333-3333-333333333333';
const UNIT_1 = '44444444-4444-4444-4444-444444444401';
const WO_1 = '66666666-6666-6666-6666-666666666601';

// ---------------------------------------------------------------------------
// db stub — records every terminated query; a responder supplies results
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert';
  columns: string | null;
  /** Filter calls in order: ['eq'|'in'|'gte'|'lt'|'lte', col, val]. */
  filters: Array<[string, ...unknown[]]>;
}

type Responder = (q: RecordedQuery) => {
  data: unknown;
  error: { message: string; code?: string } | null;
};

function makeDb(
  recorded: RecordedQuery[],
  respond: Responder,
): SupabaseClient<Database> {
  return {
    from: vi.fn((table: string) => {
      const q: RecordedQuery = { table, op: 'select', columns: null, filters: [] };
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        q.columns = columns;
        return builder;
      };
      for (const filter of ['eq', 'in', 'gte', 'lt', 'lte'] as const) {
        builder[filter] = (col: string, val: unknown) => {
          q.filters.push([filter, col, val]);
          return builder;
        };
      }
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.then = (
        fulfilled?: (v: ReturnType<Responder>) => unknown,
      ): Promise<unknown> => {
        recorded.push(q);
        const result = respond(q);
        return Promise.resolve(fulfilled ? fulfilled(result) : result);
      };
      return builder;
    }),
  } as unknown as SupabaseClient<Database>;
}

/** One stale open work order; every other source healthy/empty. */
function respondWith(options: {
  orgs?: Array<{ id: string }>;
  openFlags?: Array<{ id: string; payload: unknown }>;
  staleWorkOrder?: boolean;
}): Responder {
  return (q) => {
    if (q.table === 'organizations') {
      return { data: options.orgs ?? [{ id: GALAXY }], error: null };
    }
    if (q.table === 'units') {
      return {
        data: [{ id: UNIT_1, property_id: PROPERTY_A, label: '2B' }],
        error: null,
      };
    }
    if (q.table === 'leases') {
      return {
        data: [
          {
            id: '55555555-5555-5555-5555-555555555501',
            unit_id: UNIT_1,
            status: 'active',
            start_date: '2025-08-01',
            end_date: null,
          },
        ],
        error: null,
      };
    }
    if (q.table === 'work_orders') {
      if (!options.staleWorkOrder) return { data: [], error: null };
      return {
        data: [
          {
            id: WO_1,
            unit_id: UNIT_1,
            status: 'open',
            urgency: 'routine',
            description: 'Leaky faucet',
            created_at: '2026-06-01T10:00:00.000Z',
          },
        ],
        error: null,
      };
    }
    if (q.table === 'rent_events') {
      return { data: [], error: null };
    }
    if (q.table === 'action_proposals') {
      return { data: options.openFlags ?? [], error: null };
    }
    return { data: [], error: null };
  };
}

function makeRecordMock(): {
  impl: typeof recordProposal;
  calls: RecordProposalInput[];
} {
  const calls: RecordProposalInput[] = [];
  const impl = (async (_db, input) => {
    calls.push(input);
    return {} as Awaited<ReturnType<typeof recordProposal>>;
  }) as typeof recordProposal;
  return { impl, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runHealthChecks', () => {
  it('should record one health_flag proposal per finding with the bound shape', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ staleWorkOrder: true }));
    const { impl, calls } = makeRecordMock();

    const result = await runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl });

    expect(result).toEqual({
      orgs: 1,
      candidates: 1,
      created: 1,
      skippedOpen: 0,
      skippedRace: 0,
    });
    expect(calls).toHaveLength(1);
    const input = calls[0];
    expect(input.actionType).toBe('health_flag');
    expect(input.organizationId).toBe(GALAXY);
    expect(input.propertyId).toBe(PROPERTY_A);
    expect(input.workerModel).toBe(HEALTH_CHECK_WORKER_MODEL);
    expect(input.routing).toBeNull();
    expect(input.contextFactIds).toEqual([]);
    // The owner-queue card renders odesaLine/whyFacts from `reasoning`,
    // so the producer must mirror the summary into it.
    const payload = input.payload as { kind: string; subject: string; summary: string };
    expect(input.reasoning).toBe(payload.summary);
    expect(payload.kind).toBe('work_order_stale');
    expect(payload.subject).toBe(WO_1);
  });

  it('should always gate health_flag as review — even at max autonomy and confidence', () => {
    const decision = gateProposal(
      { action_type: 'health_flag', confidence: 1 },
      1, // max autonomy
      'hosted',
    );

    expect(decision.outcome).toBe('review');
  });

  it('should scope the stale-source queries to the org with status + staleness filters', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ staleWorkOrder: true }));
    const { impl } = makeRecordMock();

    await runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl });

    const wo = recorded.find((q) => q.table === 'work_orders');
    expect(wo?.filters).toContainEqual(['eq', 'organization_id', GALAXY]);
    expect(wo?.filters).toContainEqual([
      'in',
      'status',
      ['open', 'assigned', 'in_progress'],
    ]);
    expect(wo?.filters).toContainEqual(['lt', 'created_at', '2026-06-04T10:00:00.000Z']);

    const re = recorded.find((q) => q.table === 'rent_events');
    expect(re?.filters).toContainEqual(['eq', 'status', 'escalated']);
    expect(re?.filters).toContainEqual(['lt', 'updated_at', '2026-06-08T10:00:00.000Z']);
  });

  it('should skip a finding whose (kind, subject) already has an open proposal', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        staleWorkOrder: true,
        openFlags: [
          { id: 'x', payload: { kind: 'work_order_stale', subject: WO_1 } },
        ],
      }),
    );
    const { impl, calls } = makeRecordMock();

    const result = await runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl });

    expect(result.created).toBe(0);
    expect(result.skippedOpen).toBe(1);
    expect(calls).toHaveLength(0);

    // The pre-read mirrors the partial unique index predicate.
    const preRead = recorded.find((q) => q.table === 'action_proposals');
    expect(preRead?.filters).toContainEqual(['eq', 'action_type', 'health_flag']);
    expect(preRead?.filters).toContainEqual(['eq', 'status', 'proposed']);
  });

  it('should NOT skip when the open flag is for a different subject', async () => {
    const db = makeDb(
      [],
      respondWith({
        staleWorkOrder: true,
        openFlags: [
          { id: 'x', payload: { kind: 'work_order_stale', subject: 'other-id' } },
        ],
      }),
    );
    const { impl, calls } = makeRecordMock();

    const result = await runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl });

    expect(result.created).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it('should count a 23505 unique-violation race as skippedRace and continue', async () => {
    const db = makeDb([], respondWith({ staleWorkOrder: true }));
    const impl = (async () => {
      throw new ProposalRecordError('failed to insert action_proposal: duplicate', {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      });
    }) as unknown as typeof recordProposal;

    const result = await runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl });

    expect(result.created).toBe(0);
    expect(result.skippedRace).toBe(1);
  });

  it('should rethrow non-dedupe record errors', async () => {
    const db = makeDb([], respondWith({ staleWorkOrder: true }));
    const impl = (async () => {
      throw new ProposalRecordError('failed to insert action_proposal: denied', {
        code: '42501',
        message: 'permission denied',
      });
    }) as unknown as typeof recordProposal;

    await expect(
      runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl }),
    ).rejects.toThrow(/denied/);
  });

  it('should not query open flags nor record anything for a healthy org', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ staleWorkOrder: false }));
    const { impl, calls } = makeRecordMock();

    const result = await runHealthChecks(db, { now: NOW }, { recordProposalImpl: impl });

    expect(result).toEqual({
      orgs: 1,
      candidates: 0,
      created: 0,
      skippedOpen: 0,
      skippedRace: 0,
    });
    expect(calls).toHaveLength(0);
    expect(recorded.some((q) => q.table === 'action_proposals')).toBe(false);
  });

  it('should scope the org query when organizationId is provided', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({}));
    const { impl } = makeRecordMock();

    await runHealthChecks(
      db,
      { now: NOW, organizationId: GALAXY },
      { recordProposalImpl: impl },
    );

    const orgSelect = recorded.find((q) => q.table === 'organizations');
    expect(orgSelect?.filters).toContainEqual(['eq', 'id', GALAXY]);
  });
});
