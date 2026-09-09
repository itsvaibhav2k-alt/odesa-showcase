/**
 * Unit tests for the canonical operator count scopes.
 *
 * These prove the arithmetic every surface now shares: the owner-decision
 * split, the today-urgent passthrough (same cap the queue renders), and the
 * drafts-awaiting-review active-thread filter. The DB queries are stubbed —
 * we're testing the reconciliation math, not PostgREST.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/owner-queue/queries', () => ({ getDecisions: vi.fn() }));
vi.mock('@/lib/today/queries', () => ({ getUrgentItems: vi.fn() }));

import { getDecisions } from '@/lib/owner-queue/queries';
import { getUrgentItems } from '@/lib/today/queries';
import {
  getDraftsAwaitingReviewCount,
  getOwnerDecisionCounts,
  getTodayUrgentReviewCount,
} from '@/lib/operator/counts';

const mockGetDecisions = vi.mocked(getDecisions);
const mockGetUrgentItems = vi.mocked(getUrgentItems);

/** Minimal thenable Supabase chain: ignores filters, resolves to `{ data }`. */
function tableStub(data: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data }),
  };
  return chain;
}

function supabaseStub(tables: Record<string, unknown[]>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => tableStub(tables[t] ?? []) } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOwnerDecisionCounts', () => {
  it('splits the single getDecisions list into owner/judgment/routine', async () => {
    mockGetDecisions.mockResolvedValue([
      { recommendation: 'approve' },
      { recommendation: 'approve' },
      { recommendation: 'hold' },
      { recommendation: 'decline' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const counts = await getOwnerDecisionCounts();

    expect(counts.ownerDecisions).toBe(4);
    expect(counts.routineBatchItems).toBe(2); // approve
    expect(counts.judgmentDecisions).toBe(2); // hold + decline
    // Invariant the surfaces rely on: the two subsets partition the whole.
    expect(counts.judgmentDecisions + counts.routineBatchItems).toBe(
      counts.ownerDecisions,
    );
  });

  it('is zeroed for an empty queue', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetDecisions.mockResolvedValue([] as any);
    const counts = await getOwnerDecisionCounts();
    expect(counts).toEqual({
      ownerDecisions: 0,
      judgmentDecisions: 0,
      routineBatchItems: 0,
    });
  });
});

describe('getTodayUrgentReviewCount', () => {
  it('counts exactly the list getUrgentItems returns (same cap as the queue)', async () => {
    mockGetUrgentItems.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    expect(await getTodayUrgentReviewCount()).toBe(3);
    // No arg passed → the queue's default cap is used, so badge == queue.
    expect(mockGetUrgentItems).toHaveBeenCalledWith();
  });
});

describe('getDraftsAwaitingReviewCount', () => {
  it('counts pending drafts, excluding muted/snoozed threads and null convs', async () => {
    const supabase = supabaseStub({
      messages: [
        { conversation_id: 'c1' },
        { conversation_id: 'c2' }, // inactive → excluded
        { conversation_id: null }, // no thread → excluded
        { conversation_id: 'c3' },
      ],
      conversations: [{ id: 'c2' }], // muted or snoozed
    });

    expect(await getDraftsAwaitingReviewCount(supabase)).toBe(2); // c1, c3
  });

  it('returns 0 when there are no pending drafts', async () => {
    const supabase = supabaseStub({ messages: [], conversations: [] });
    expect(await getDraftsAwaitingReviewCount(supabase)).toBe(0);
  });
});
