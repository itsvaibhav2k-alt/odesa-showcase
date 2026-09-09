/**
 * Unit tests for `waiveRemainingBalance` — the shared money-path core behind
 * both the /rent WaiveRentModal action and the agent's `waive_rent` handler.
 *
 * Load-bearing assertions:
 *   - amount_due drops to amount_paid (collected is NEVER inflated) and the
 *     forgiven amount + who/when/why land on the waive audit columns;
 *   - the UPDATE payload NEVER carries `status` or `amount_paid`;
 *   - the UPDATE is a CAS pinning BOTH amount_due and amount_paid to the
 *     just-read values — a concurrent write makes it match zero rows, the
 *     core retries, and ultimately fails honestly (no lost writes);
 *   - re-waiving an already-waived row is an ok no-op (`alreadyWaived`);
 *   - a settled row (balance 0) cannot be waived.
 */
import { describe, expect, it } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { waiveRemainingBalance, type WaiveRentParams } from '../waive';

const RENT_EVENT_ID = '99999999-9999-9999-9999-999999999901';
const LEASE_ID = '66666666-6666-6666-6666-666666666601';
const ORG_ID = '11111111-1111-1111-1111-111111111101';
const USER_ID = '22222222-2222-2222-2222-222222222201';

interface Predicate {
  col: string;
  value: unknown;
}

interface UpdateCall {
  payload: Record<string, unknown>;
  predicates: Predicate[];
}

interface StubOptions {
  row?: Record<string, unknown> | null;
  /** Mutate the stored row before each UPDATE's predicates match (per attempt). */
  mutatePaidBeforeUpdate?: number[];
}

/** Minimal chainable stub for the rent_events read/CAS-update the core runs. */
function buildClientStub(opts: StubOptions = {}) {
  let row = opts.row === undefined
    ? {
        id: RENT_EVENT_ID,
        amount_due: 2250,
        amount_paid: 500,
        waived_at: null,
        waived_amount: null,
      }
    : opts.row;
  const mutations = [...(opts.mutatePaidBeforeUpdate ?? [])];
  const updates: UpdateCall[] = [];

  function matches(predicates: Predicate[]): boolean {
    if (!row) return false;
    return predicates.every((p) => {
      const current = (row as Record<string, unknown>)[p.col];
      return p.col in (row as Record<string, unknown>)
        ? current === p.value
        : true;
    });
  }

  const client = {
    from: (table: string) => {
      if (table !== 'rent_events') throw new Error(`unexpected table ${table}`);
      return {
        select: () => {
          const predicates: Predicate[] = [];
          const chain = {
            eq(col: string, value: unknown) {
              predicates.push({ col, value });
              return chain;
            },
            async maybeSingle() {
              return { data: matches(predicates) ? { ...row } : null, error: null };
            },
          };
          return chain;
        },
        update: (payload: Record<string, unknown>) => {
          const predicates: Predicate[] = [];
          const chain = {
            eq(col: string, value: unknown) {
              predicates.push({ col, value });
              return chain;
            },
            async select() {
              const mutation = mutations.shift();
              if (mutation !== undefined && row) {
                row = { ...row, amount_paid: mutation };
              }
              updates.push({ payload, predicates });
              if (!matches(predicates)) return { data: [], error: null };
              row = { ...row, ...payload };
              return { data: [{ ...row }], error: null };
            },
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, updates, current: () => row };
}

function params(overrides: Partial<WaiveRentParams> = {}): WaiveRentParams {
  return {
    rentEventId: RENT_EVENT_ID,
    leaseId: LEASE_ID,
    organizationId: ORG_ID,
    actorUserId: USER_ID,
    reason: 'Unit uninhabitable during repairs',
    ...overrides,
  };
}

describe('waiveRemainingBalance', () => {
  it('should forgive the remaining balance without inflating collected', async () => {
    const stub = buildClientStub();

    const result = await waiveRemainingBalance(stub.client, params());

    expect(result).toEqual({ ok: true, waivedDollars: 1750, alreadyWaived: false });

    const update = stub.updates[0]!;
    // amount_due drops to amount_paid; forgiven amount + audit fields land.
    expect(update.payload.amount_due).toBe(500);
    expect(update.payload.waived_amount).toBe(1750);
    expect(update.payload.waived_by).toBe(USER_ID);
    expect(update.payload.waived_reason).toBe('Unit uninhabitable during repairs');
    expect(typeof update.payload.waived_at).toBe('string');
    // NEVER writes status or amount_paid.
    expect('status' in update.payload).toBe(false);
    expect('amount_paid' in update.payload).toBe(false);
    // CAS pins BOTH money columns to the just-read values + full row identity.
    const cols = update.predicates.map((p) => p.col);
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'lease_id', 'organization_id', 'amount_due', 'amount_paid']),
    );
    expect(update.predicates.find((p) => p.col === 'amount_paid')?.value).toBe(500);
  });

  it('should report alreadyWaived without writing when the row is waived', async () => {
    const stub = buildClientStub({
      row: {
        id: RENT_EVENT_ID,
        amount_due: 500,
        amount_paid: 500,
        waived_at: '2026-07-01T00:00:00Z',
        waived_amount: 1750,
      },
    });

    const result = await waiveRemainingBalance(stub.client, params());

    expect(result).toEqual({ ok: true, waivedDollars: 1750, alreadyWaived: true });
    expect(stub.updates).toHaveLength(0);
  });

  it('should refuse to waive a settled cycle', async () => {
    const stub = buildClientStub({
      row: {
        id: RENT_EVENT_ID,
        amount_due: 2250,
        amount_paid: 2250,
        waived_at: null,
        waived_amount: null,
      },
    });

    const result = await waiveRemainingBalance(stub.client, params());

    expect(result).toEqual({
      ok: false,
      error: 'Nothing outstanding to waive on this cycle',
    });
    expect(stub.updates).toHaveLength(0);
  });

  it('should return not-found when the row is outside the org scope', async () => {
    const stub = buildClientStub({ row: null });

    const result = await waiveRemainingBalance(stub.client, params());

    expect(result).toEqual({ ok: false, error: 'Rent cycle not found' });
  });

  it('should fail honestly when a concurrent writer keeps moving the balance', async () => {
    // Every CAS attempt sees amount_paid mutated after its read — the
    // predicate misses each time and retries exhaust.
    const stub = buildClientStub({
      mutatePaidBeforeUpdate: [600, 700, 800],
    });

    const result = await waiveRemainingBalance(stub.client, params());

    expect(result).toEqual({
      ok: false,
      error: 'Balance changed while waiving. Refresh and try again.',
    });
    expect(stub.updates).toHaveLength(3);
    // The stored row was never waived.
    expect((stub.current() as Record<string, unknown>).waived_at).toBeNull();
  });
});
