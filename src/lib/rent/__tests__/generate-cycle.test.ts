/**
 * Unit tests for the monthly rent-cycle generator core.
 *
 * Drives `generateRentCycle` against a recording supabase stub (mirrors
 * the agent-run-watchdog test surface). Cases:
 *   1. active in-term lease → one 'pending' rent_event shaped exactly
 *      like the seed's rows (cycle_month = first of month, amount_paid 0).
 *   2. pre-existing (lease_id, cycle_month) pair → skipped, no insert.
 *   3. 23505 unique-violation race on insert → counted as skipped.
 *   4. null rent_amount → skippedNoAmount, no insert.
 *   5. rent_due_day 31 in a 30-day month → due_date clamped to the 30th.
 *   6. lease whose end_date precedes the period → excluded entirely.
 *   7. invalid period string → throws before touching the db.
 *   8. organizationId option scopes the lease query.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { generateRentCycle } from '../generate-cycle';

const GALAXY = '11111111-1111-1111-1111-111111111101';
const LEASE_1 = '66666666-6666-6666-6666-666666666601';
const LEASE_2 = '66666666-6666-6666-6666-666666666602';

// ---------------------------------------------------------------------------
// db stub — records every terminated query; a responder supplies results
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert';
  rows: Array<Record<string, unknown>> | null;
  /** Filter calls in order: ['eq'|'in', col, val]. */
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
      const q: RecordedQuery = { table, op: 'select', rows: null, filters: [] };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.insert = (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        q.op = 'insert';
        q.rows = Array.isArray(rows) ? rows : [rows];
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        q.filters.push(['eq', col, val]);
        return builder;
      };
      builder.in = (col: string, val: unknown) => {
        q.filters.push(['in', col, val]);
        return builder;
      };
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

interface LeaseFixture {
  id?: string;
  organization_id?: string;
  rent_amount?: number | null;
  rent_due_day?: number;
  start_date?: string | null;
  end_date?: string | null;
}

function lease(overrides: LeaseFixture = {}): Required<LeaseFixture> {
  return {
    id: LEASE_1,
    organization_id: GALAXY,
    rent_amount: 1450,
    rent_due_day: 1,
    start_date: '2025-10-01',
    end_date: '2026-09-30',
    ...overrides,
  };
}

/** Responder: leases select → fixtures; rent_events select → existing pairs. */
function respondWith(options: {
  leases: LeaseFixture[];
  existing?: Array<{ lease_id: string }>;
  insertError?: { message: string; code?: string };
}): Responder {
  return (q) => {
    if (q.table === 'leases' && q.op === 'select') {
      return { data: options.leases, error: null };
    }
    if (q.table === 'rent_events' && q.op === 'select') {
      return { data: options.existing ?? [], error: null };
    }
    if (q.table === 'rent_events' && q.op === 'insert') {
      return { data: null, error: options.insertError ?? null };
    }
    return { data: [], error: null };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateRentCycle', () => {
  it('should insert a pending rent_event shaped like the seed rows when a lease is active and in term', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ leases: [lease()] }));

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result).toEqual({
      period: '2026-06',
      cycleMonth: '2026-06-01',
      leases: 1,
      created: 1,
      skipped: 0,
      skippedNoAmount: 0,
      skippedOutOfTerm: 0,
    });

    const insert = recorded.find((r) => r.op === 'insert');
    expect(insert?.table).toBe('rent_events');
    expect(insert?.rows).toEqual([
      {
        organization_id: GALAXY,
        lease_id: LEASE_1,
        cycle_month: '2026-06-01',
        amount_due: 1450,
        amount_paid: 0,
        status: 'pending',
        due_date: '2026-06-01',
      },
    ]);

    const leaseSelect = recorded.find((r) => r.table === 'leases');
    expect(leaseSelect?.filters).toContainEqual(['eq', 'status', 'active']);
  });

  it('should skip without inserting when the (lease_id, cycle_month) pair already exists', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({ leases: [lease()], existing: [{ lease_id: LEASE_1 }] }),
    );

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(recorded.some((r) => r.op === 'insert')).toBe(false);
  });

  it('should count a 23505 unique-violation as skipped when a concurrent run won the insert', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        leases: [lease()],
        insertError: { message: 'duplicate key value', code: '23505' },
      }),
    );

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should throw when the insert fails with a non-23505 error', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        leases: [lease()],
        insertError: { message: 'permission denied', code: '42501' },
      }),
    );

    await expect(generateRentCycle(db, { period: '2026-06' })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('should count skippedNoAmount without inserting when rent_amount is null', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({ leases: [lease({ rent_amount: null })] }),
    );

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result.created).toBe(0);
    expect(result.skippedNoAmount).toBe(1);
    expect(result.leases).toBe(1);
    expect(recorded.some((r) => r.op === 'insert')).toBe(false);
  });

  it('should clamp due_date to the last day of the month when rent_due_day overflows it', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({ leases: [lease({ rent_due_day: 31 })] }),
    );

    await generateRentCycle(db, { period: '2026-06' });

    const insert = recorded.find((r) => r.op === 'insert');
    expect(insert?.rows?.[0]?.due_date).toBe('2026-06-30');
  });

  it('should exclude a lease whose end_date precedes the period even if status is active', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        leases: [lease({ end_date: '2026-04-30' })],
      }),
    );

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result).toEqual({
      period: '2026-06',
      cycleMonth: '2026-06-01',
      leases: 0,
      created: 0,
      skipped: 0,
      skippedNoAmount: 0,
      skippedOutOfTerm: 1,
    });
    expect(recorded.some((r) => r.op === 'insert')).toBe(false);
  });

  it('should exclude a lease whose start_date is after the period', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({ leases: [lease({ start_date: '2026-07-01' })] }),
    );

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result.skippedOutOfTerm).toBe(1);
    expect(result.created).toBe(0);
  });

  it('should include a lease ending mid-period (no proration in v1)', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        leases: [lease({ id: LEASE_2, rent_amount: 2250, end_date: '2026-06-14' })],
      }),
    );

    const result = await generateRentCycle(db, { period: '2026-06' });

    expect(result.created).toBe(1);
    const insert = recorded.find((r) => r.op === 'insert');
    expect(insert?.rows?.[0]?.amount_due).toBe(2250);
  });

  it('should scope the lease query when organizationId is provided', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ leases: [lease()] }));

    await generateRentCycle(db, { period: '2026-06', organizationId: GALAXY });

    const leaseSelect = recorded.find((r) => r.table === 'leases');
    expect(leaseSelect?.filters).toContainEqual(['eq', 'organization_id', GALAXY]);
  });

  it('should throw on a malformed period before querying the db', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ leases: [] }));

    await expect(generateRentCycle(db, { period: '2026-6' })).rejects.toThrow(
      /period/i,
    );
    await expect(generateRentCycle(db, { period: '2026-13' })).rejects.toThrow(
      /period/i,
    );
    expect(recorded.length).toBe(0);
  });
});
