/**
 * Unit tests for `recordOfflinePaymentAction` (the offline-payment recorder
 * behind the RecordPaymentModal).
 *
 * The action crosses one boundary: the RLS-scoped SSR Supabase client (auth
 * gate, lease read, then a conflict-safe compare-and-swap on the EXACT
 * rent_events row targeted by id + lease_id, plus a unit read for
 * revalidation). The load-bearing assertions are:
 *   - amount_paid increments in DOLLARS, clamped at amount_due;
 *   - the row is targeted by id (the displayed cycle), NEVER a recomputed
 *     current cycle_month;
 *   - the UPDATE is a CAS on the just-read amount_paid — a concurrent change
 *     makes it match zero rows, so the action retries and ultimately fails
 *     honestly rather than silently losing a payment (no lost writes);
 *   - the UPDATE payload NEVER carries the `status` enum (deriveRentCycleStatus
 *     is the single source of truth — balance->0 yields `paid` on its own);
 *   - outstanding is derived ONLY from the persisted returned row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import { deriveRentCycleStatus } from '@/lib/domain';

import { recordOfflinePaymentAction } from '../actions';

const mockCreateServerClient = vi.mocked(createServerClient);
const mockRevalidatePath = vi.mocked(revalidatePath);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
const LEASE_ID = '44444444-4444-4444-4444-444444444444';
const TENANT_ID = '55555555-5555-5555-5555-555555555555';
const UNIT_ID = '66666666-6666-6666-6666-666666666666';
const PROPERTY_ID = '77777777-7777-7777-7777-777777777777';
// The displayed rent_events row id. Must be UUID-shaped because the action now
// zod-validates `rentEventId` (uuidLike) — this value IS cycleRow().id, so the
// `.eq('id', rentEventId)` target lands on the seeded row.
const RENT_EVENT_ID = '88888888-8888-8888-8888-888888888888';

// Frozen clock: 2026-06-10T12:00:00Z → current UTC cycle is 2026-06-01.
const FROZEN_NOW = new Date('2026-06-10T12:00:00Z');
const CYCLE_MONTH = '2026-06-01';
const TODAY_ISO = '2026-06-10';

interface StubTables {
  users: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rent_events: Array<Record<string, unknown>>;
  units: Array<Record<string, unknown>>;
}

interface Predicate {
  col: string;
  value: unknown;
  op: 'eq' | 'neq';
}

interface UpdateCall {
  table: string;
  payload: Record<string, unknown>;
  predicates: Predicate[];
}

interface StubOptions {
  userId?: string | null;
  /** users.role served to the auth lookup; defaults to 'owner'. */
  role?: string | null;
  leases?: Array<Record<string, unknown>>;
  rentEvents?: Array<Record<string, unknown>>;
  units?: Array<Record<string, unknown>>;
  updateErrors?: Partial<Record<keyof StubTables, string>>;
  /**
   * Simulate a concurrent writer mutating `rent_events.amount_paid` between the
   * action's read and its CAS UPDATE. One value is consumed per rent_events
   * UPDATE attempt (a single number applies to the first attempt only); the
   * stored row is set to that value just before the UPDATE's predicates are
   * matched, forcing the `.eq('amount_paid', <just-read>)` CAS clause to miss.
   */
  mutateRentPaidBeforeUpdate?: number | number[];
}

interface ServerStub {
  client: Awaited<ReturnType<typeof createServerClient>>;
  tables: StubTables;
  updates: UpdateCall[];
}

function buildServerStub(opts: StubOptions = {}): ServerStub {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  const tables: StubTables = {
    users: [
      {
        id: TEST_USER_ID,
        organization_id: TEST_ORG_ID,
        role: opts.role === undefined ? 'owner' : opts.role,
      },
    ],
    leases: opts.leases ?? [],
    rent_events: opts.rentEvents ?? [],
    units: opts.units ?? [{ id: UNIT_ID, property_id: PROPERTY_ID }],
  };
  const updates: UpdateCall[] = [];

  // Queue of concurrent amount_paid mutations, one per rent_events UPDATE.
  const rentPaidMutations =
    opts.mutateRentPaidBeforeUpdate == null
      ? []
      : Array.isArray(opts.mutateRentPaidBeforeUpdate)
        ? [...opts.mutateRentPaidBeforeUpdate]
        : [opts.mutateRentPaidBeforeUpdate];
  let rentPaidMutationIndex = 0;

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId, email: 'op@test.test' } : null },
        error: null,
      })),
    },
    from: (table: keyof StubTables) => {
      const rows = tables[table] ?? [];
      const predicates: Predicate[] = [];
      let updatePayload: Record<string, unknown> | null = null;
      const matchAll = () =>
        rows.filter((r) =>
          predicates.every((p) =>
            p.op === 'neq' ? r[p.col] !== p.value : r[p.col] === p.value,
          ),
        );

      const finishUpdate = () => {
        // Simulate a concurrent writer that changed rent_events.amount_paid
        // AFTER the action read the row but BEFORE this CAS UPDATE is
        // evaluated. Setting a different value makes the
        // `.eq('amount_paid', <just-read>)` predicate match zero rows — the
        // precise race the compare-and-swap is built to survive.
        if (
          table === 'rent_events' &&
          rentPaidMutationIndex < rentPaidMutations.length
        ) {
          const concurrentPaid = rentPaidMutations[rentPaidMutationIndex];
          rentPaidMutationIndex += 1;
          for (const r of rows) r.amount_paid = concurrentPaid;
        }

        updates.push({
          table: table as string,
          payload: updatePayload as Record<string, unknown>,
          predicates: [...predicates],
        });
        const forced = opts.updateErrors?.[table];
        if (forced) {
          return { data: null, error: { message: forced } };
        }
        const matched = matchAll();
        for (const r of matched) Object.assign(r, updatePayload);
        // The action now selects 'id, amount_due, amount_paid' on the UPDATE
        // and derives outstanding from this persisted row — return all three.
        return {
          data: matched.map((r) => ({
            id: r.id,
            amount_due: r.amount_due,
            amount_paid: r.amount_paid,
          })),
          error: null,
        };
      };

      const chain: Record<string, unknown> = {
        select() {
          if (updatePayload !== null) {
            const result = finishUpdate();
            return {
              // Awaitable directly: `.update().eq()….select('id')`.
              then(resolve: (v: typeof result) => void) {
                resolve(result);
              },
            };
          }
          return chain;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return chain;
        },
        eq(col: string, value: unknown) {
          predicates.push({ col, value, op: 'eq' });
          return chain;
        },
        neq(col: string, value: unknown) {
          predicates.push({ col, value, op: 'neq' });
          return chain;
        },
        maybeSingle: async () => ({ data: matchAll()[0] ?? null, error: null }),
        single: async () => {
          const found = matchAll()[0] ?? null;
          return { data: found, error: found ? null : { message: 'not found' } };
        },
      };
      return chain;
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>;

  return { client, tables, updates };
}

function lease(overrides: Record<string, unknown> = {}) {
  return { id: LEASE_ID, tenant_id: TENANT_ID, unit_id: UNIT_ID, ...overrides };
}

function cycleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RENT_EVENT_ID,
    lease_id: LEASE_ID,
    cycle_month: CYCLE_MONTH,
    status: 'late_3',
    amount_due: 1450,
    amount_paid: 0,
    due_date: '2026-06-01',
    ...overrides,
  };
}

function expectError(
  result: Awaited<ReturnType<typeof recordOfflinePaymentAction>>,
): string {
  expect(result.ok).toBe(false);
  return (result as { ok: false; error: string }).error;
}

describe('rent/actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('recordOfflinePaymentAction', () => {
    it('should fail when no signed-in user', async () => {
      const stub = buildServerStub({ userId: null });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(result).toEqual({ ok: false, error: 'Not authenticated' });
      expect(stub.updates).toHaveLength(0);
    });

    it.each(['manager', 'va', null])(
      'should return Forbidden with zero writes for role %s (owner-only)',
      async (role) => {
        const stub = buildServerStub({
          role,
          leases: [lease()],
          rentEvents: [cycleRow()],
        });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await recordOfflinePaymentAction({
          rentEventId: RENT_EVENT_ID,
          leaseId: LEASE_ID,
          amountDollars: 500,
        });

        expect(result).toEqual({ ok: false, error: 'Forbidden' });
        expect(stub.updates).toHaveLength(0);
        // The cycle row is untouched.
        expect(stub.tables.rent_events[0].amount_paid).toBe(0);
      },
    );

    it('should reject a non-UUID leaseId via zod', async () => {
      const stub = buildServerStub({ leases: [lease()], rentEvents: [cycleRow()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: 'not-a-uuid',
        amountDollars: 500,
      });

      expect(expectError(result)).toContain('leaseId');
      expect(stub.updates).toHaveLength(0);
    });

    it('should reject a non-positive amount via zod', async () => {
      const stub = buildServerStub({ leases: [lease()], rentEvents: [cycleRow()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const zero = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 0,
      });
      const neg = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: -50,
      });

      expect(expectError(zero)).toContain('amountDollars');
      expect(expectError(neg)).toContain('amountDollars');
      expect(stub.updates).toHaveLength(0);
    });

    it('should fail with "Lease not found" when RLS hides the lease', async () => {
      const stub = buildServerStub({ leases: [], rentEvents: [cycleRow()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(result).toEqual({ ok: false, error: 'Lease not found' });
      expect(stub.updates).toHaveLength(0);
    });

    it('should fail with "Rent cycle not found" when the target row is missing', async () => {
      const stub = buildServerStub({ leases: [lease()], rentEvents: [] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(expectError(result)).toContain('Rent cycle not found');
      expect(stub.updates).toHaveLength(0);
    });

    it('should lower outstanding on a partial payment without writing status', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 0 })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(result).toEqual({ ok: true, newOutstandingDollars: 950 });

      // EXACTLY one rent_events UPDATE — amount_paid only, NEVER status.
      const cycleUpdates = stub.updates.filter((u) => u.table === 'rent_events');
      expect(cycleUpdates).toHaveLength(1);
      expect(Object.keys(cycleUpdates[0].payload)).toEqual(['amount_paid']);
      expect(cycleUpdates[0].payload.amount_paid).toBe(500);
      // The WHERE is the id + lease_id + amount_paid compare-and-swap — it
      // targets the exact displayed row and guards the just-read paid total,
      // NOT a recomputed lease + cycle_month.
      expect(cycleUpdates[0].predicates).toEqual([
        { col: 'id', value: RENT_EVENT_ID, op: 'eq' },
        { col: 'lease_id', value: LEASE_ID, op: 'eq' },
        { col: 'amount_paid', value: 0, op: 'eq' },
      ]);

      // The persisted row reflects the new paid total; status is untouched.
      expect(stub.tables.rent_events[0].amount_paid).toBe(500);
      expect(stub.tables.rent_events[0].status).toBe('late_3');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/rent');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/financials');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/today');
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/tenants/${TENANT_ID}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/properties/${PROPERTY_ID}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        `/properties/${PROPERTY_ID}/units/${UNIT_ID}`,
      );
    });

    it('should target the supplied rentEventId, never a recomputed cycle_month', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 0 })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(result.ok).toBe(true);

      const cycleUpdate = stub.updates.find((u) => u.table === 'rent_events');
      expect(cycleUpdate).toBeDefined();
      // The WHERE targets the EXACT displayed row by id…
      expect(cycleUpdate!.predicates).toContainEqual({
        col: 'id',
        value: RENT_EVENT_ID,
        op: 'eq',
      });
      // …and NEVER by a recomputed current UTC cycle (no cycle_month clause).
      expect(cycleUpdate!.predicates.some((p) => p.col === 'cycle_month')).toBe(false);
    });

    it('should handle cents precisely on a partial payment', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450.5, amount_paid: 100.25 })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 50.5,
      });

      // 100.25 + 50.50 = 150.75 paid; 1450.50 - 150.75 = 1299.75 outstanding.
      expect(result).toEqual({ ok: true, newOutstandingDollars: 1299.75 });
      expect(stub.tables.rent_events[0].amount_paid).toBe(150.75);
    });

    it('should derive outstanding from the persisted returned row', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 200 })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 300,
      });

      // Persisted paid = 200 + 300 = 500; outstanding = 1450 - 500 = 950,
      // read back from the row the UPDATE returned (not a pre-write estimate).
      expect(result).toEqual({ ok: true, newOutstandingDollars: 950 });
      expect(stub.tables.rent_events[0].amount_paid).toBe(500);
    });

    it('should drive the DERIVED status to paid on a full payment (balance->0)', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 0, status: 'escalated' })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 1450,
      });

      expect(result).toEqual({ ok: true, newOutstandingDollars: 0 });

      // The status enum is NOT written by the action — it stays 'escalated'…
      const row = stub.tables.rent_events[0];
      expect(row.status).toBe('escalated');
      expect(row.amount_paid).toBe(1450);

      // …yet the canonical derivation reads it as `paid` because balance is 0.
      const derived = deriveRentCycleStatus({
        status: row.status as 'escalated',
        dueDate: row.due_date as string,
        amountDueCents: Math.round(Number(row.amount_due) * 100),
        amountPaidCents: Math.round(Number(row.amount_paid) * 100),
        todayIso: TODAY_ISO,
      });
      expect(derived.kind).toBe('paid');
      expect(derived.isOutstanding).toBe(false);
    });

    it('should clamp an overpayment at amount_due', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 0 })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 5000,
      });

      expect(result).toEqual({ ok: true, newOutstandingDollars: 0 });
      // amount_paid is clamped to amount_due — never over-collected.
      expect(stub.tables.rent_events[0].amount_paid).toBe(1450);
    });

    it('should report an UPDATE failure', async () => {
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow()],
        updateErrors: { rent_events: 'connection reset' },
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(result).toEqual({ ok: false, error: 'connection reset' });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('should NOT report success when the CAS conflicts on every attempt', async () => {
      // amount_paid is bumped to a fresh, different value before EACH of the
      // three CAS attempts, so the `.eq('amount_paid', <just-read>)` predicate
      // never matches — the action must exhaust retries and fail, NOT silently
      // overwrite the concurrent writes (no lost payment).
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 0 })],
        mutateRentPaidBeforeUpdate: [7, 8, 9],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      expect(result).toEqual({
        ok: false,
        error: 'Balance changed while recording payment. Refresh and try again.',
      });

      // It retried up to the bound (3 attempts), and every CAS missed.
      const cycleUpdates = stub.updates.filter((u) => u.table === 'rent_events');
      expect(cycleUpdates).toHaveLength(3);

      // Only the concurrent writes landed — the action's computed value (which
      // would have been ~500) was NEVER persisted.
      expect(stub.tables.rent_events[0].amount_paid).toBe(9);
      expect(stub.tables.rent_events[0].amount_paid).not.toBe(500);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('should retry and succeed when amount_paid changes once mid-flight', async () => {
      // A single concurrent write lands before the first CAS (misses); the
      // second attempt re-reads the NEW base and its CAS succeeds — proving the
      // concurrent payment is preserved (the recorded amount is added on top,
      // not lost).
      const stub = buildServerStub({
        leases: [lease()],
        rentEvents: [cycleRow({ amount_due: 1450, amount_paid: 0 })],
        mutateRentPaidBeforeUpdate: 300,
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await recordOfflinePaymentAction({
        rentEventId: RENT_EVENT_ID,
        leaseId: LEASE_ID,
        amountDollars: 500,
      });

      // Persisted = concurrent 300 + recorded 500 = 800 (clamped at 1450);
      // outstanding = 1450 - 800 = 650.
      expect(result).toEqual({ ok: true, newOutstandingDollars: 650 });

      const cycleUpdates = stub.updates.filter((u) => u.table === 'rent_events');
      expect(cycleUpdates).toHaveLength(2);

      // No lost payment: had the recorded value clobbered the row it would read
      // 500, not 800.
      expect(stub.tables.rent_events[0].amount_paid).toBe(800);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/rent');
    });
  });
});
