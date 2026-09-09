/**
 * Unit tests for `updateLeaseTermsAction` (the /rent inline lease-terms
 * editor server action).
 *
 * The action crosses one boundary: the RLS-scoped SSR Supabase client
 * (auth gate, lease read, lease UPDATE, optional conditional rent_events
 * UPDATE). The load-bearing assertions here are the WHERE guard on the
 * current-cycle touch (status='pending' AND amount_paid=0 — the CAS) and
 * that the cycle UPDATE payload NEVER carries status / amount_paid.
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

import {
  updateLeaseTermsAction,
  waiveRentAction,
  type UpdateLeaseTermsResult,
} from '../actions';

const mockCreateServerClient = vi.mocked(createServerClient);
const mockRevalidatePath = vi.mocked(revalidatePath);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
// Deliberately a seed-style UUID (variant nibble NOT RFC-4122) — zod4's
// .uuid() would reject this; the uuidLike regex must accept it.
const LEASE_ID = '44444444-4444-4444-4444-444444444444';

// Frozen clock: 2026-06-10T12:00:00Z → current UTC cycle is 2026-06-01.
const FROZEN_NOW = new Date('2026-06-10T12:00:00Z');
const CYCLE_MONTH = '2026-06-01';

interface StubTables {
  users: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  rent_events: Array<Record<string, unknown>>;
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
  /** Per-table forced UPDATE error message. */
  updateErrors?: Partial<Record<keyof StubTables, string>>;
  /** Force the lease pre-read to see this row (simulates a read/write race). */
  leaseReadOverride?: Record<string, unknown>;
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
  };
  const updates: UpdateCall[] = [];

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
        return { data: matched.map((r) => ({ id: r.id })), error: null };
      };

      const chain: Record<string, unknown> = {
        select() {
          if (updatePayload !== null) {
            const result = finishUpdate();
            return {
              single: async () =>
                result.error
                  ? { data: null, error: result.error }
                  : {
                      data: (result.data as Array<{ id: unknown }>)[0] ?? null,
                      error:
                        (result.data as unknown[]).length === 0
                          ? { message: 'JSON object requested, 0 rows' }
                          : null,
                    },
              maybeSingle: async () =>
                result.error
                  ? { data: null, error: result.error }
                  : {
                      data: (result.data as Array<{ id: unknown }>)[0] ?? null,
                      error: null,
                    },
              // Awaitable directly: `.update().eq()….select('id')`.
              then(
                resolve: (v: typeof result) => void,
              ) {
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
        maybeSingle: async () => {
          if (table === 'leases' && opts.leaseReadOverride) {
            return { data: opts.leaseReadOverride, error: null };
          }
          return { data: matchAll()[0] ?? null, error: null };
        },
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

function activeLease(overrides: Record<string, unknown> = {}) {
  return {
    id: LEASE_ID,
    status: 'active',
    rent_amount: 1450,
    rent_due_day: 1,
    end_date: null,
    ...overrides,
  };
}

function pendingCycleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 're-1',
    lease_id: LEASE_ID,
    cycle_month: CYCLE_MONTH,
    status: 'pending',
    amount_due: 1450,
    amount_paid: 0,
    due_date: '2026-06-01',
    ...overrides,
  };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    leaseId: LEASE_ID,
    rentAmount: 1525,
    rentDueDay: 5,
    endDate: null as string | null,
    ...overrides,
  };
}

function expectError(
  result: Awaited<ReturnType<typeof updateLeaseTermsAction>>,
): string {
  expect(result.success).toBe(false);
  return (result as { success: false; error: string }).error;
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

  describe('updateLeaseTermsAction', () => {
    it('should fail when no signed-in user', async () => {
      const stub = buildServerStub({ userId: null });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(validPayload());

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(stub.updates).toHaveLength(0);
    });

    it.each(['manager', 'va', null])(
      'should return Forbidden with zero writes for role %s (owner-only)',
      async (role) => {
        const stub = buildServerStub({ leases: [activeLease()], role });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await updateLeaseTermsAction(validPayload());

        expect(result).toEqual({ success: false, error: 'Forbidden' });
        expect(stub.updates).toHaveLength(0);
        expect(mockRevalidatePath).not.toHaveBeenCalled();
      },
    );

    it('should reject a non-UUID leaseId via zod', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ leaseId: 'not-a-uuid' }),
      );

      expect(expectError(result)).toContain('leaseId');
      expect(stub.updates).toHaveLength(0);
    });

    it('should accept a seed-style UUID that zod4 .uuid() would reject', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(validPayload());

      expect(result.success).toBe(true);
    });

    it('should reject a non-positive rentAmount via zod', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ rentAmount: 0 }),
      );

      expect(expectError(result)).toContain('rentAmount');
      expect(stub.updates).toHaveLength(0);
    });

    it('should reject a fractional rentAmount via zod (matches the agent path)', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ rentAmount: 1850.55 }),
      );

      expect(expectError(result)).toContain('rentAmount');
      expect(stub.updates).toHaveLength(0);
    });

    it('should reject rentDueDay outside 1-28 via zod', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const low = await updateLeaseTermsAction(validPayload({ rentDueDay: 0 }));
      const high = await updateLeaseTermsAction(validPayload({ rentDueDay: 29 }));

      expect(expectError(low)).toContain('rentDueDay');
      expect(expectError(high)).toContain('rentDueDay');
      expect(stub.updates).toHaveLength(0);
    });

    it('should reject a malformed endDate via zod', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ endDate: '06/30/2026' }),
      );

      expect(expectError(result)).toContain('endDate');
      expect(stub.updates).toHaveLength(0);
    });

    it('should reject any status other than terminated via zod', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ status: 'active' }),
      );

      expect(expectError(result)).toContain('status');
      expect(stub.updates).toHaveLength(0);
    });

    it('should reject the current-cycle touch when terminating', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ status: 'terminated', alsoUpdateCurrentCycle: true }),
      );

      expect(expectError(result)).toContain('alsoUpdateCurrentCycle');
      expect(stub.updates).toHaveLength(0);
    });

    it('should fail with "Lease not found" when RLS hides the lease (org scoping)', async () => {
      // The lease table the SSR client can see is empty — exactly what a
      // cross-org caller gets under RLS.
      const stub = buildServerStub({ leases: [] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(validPayload());

      expect(result).toEqual({ success: false, error: 'Lease not found' });
      expect(stub.updates).toHaveLength(0);
    });

    it('should fail closed on a terminated lease', async () => {
      const stub = buildServerStub({
        leases: [activeLease({ status: 'terminated' })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(validPayload());

      expect(expectError(result)).toContain('terminated');
      expect(stub.updates).toHaveLength(0);
    });

    it('should fail closed on an expired lease', async () => {
      const stub = buildServerStub({
        leases: [activeLease({ status: 'expired' })],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(validPayload());

      expect(expectError(result)).toContain('expired');
      expect(stub.updates).toHaveLength(0);
    });

    it('should fail when the lease is terminated between the read and the write (race)', async () => {
      // Pre-read sees an active lease; by write time the agent terminated it.
      const stub = buildServerStub({
        leases: [activeLease({ status: 'terminated' })],
        leaseReadOverride: activeLease(),
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(validPayload());

      expect(expectError(result)).toContain('terminated or expired');
      // The guarded UPDATE matched 0 rows — the terminated lease kept its terms.
      expect(stub.tables.leases[0].rent_amount).toBe(1450);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it('should update the lease terms and revalidate /rent on the happy path', async () => {
      const stub = buildServerStub({ leases: [activeLease()] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ endDate: '2026-12-31' }),
      );

      expect(result.success).toBe(true);
      const leaseUpdate = stub.updates.find((u) => u.table === 'leases');
      expect(leaseUpdate).toBeDefined();
      expect(leaseUpdate!.payload).toEqual({
        rent_amount: 1525,
        rent_due_day: 5,
        end_date: '2026-12-31',
      });
      // The write itself guards against a concurrent terminate/expire.
      expect(leaseUpdate!.predicates).toEqual([
        { col: 'id', value: LEASE_ID, op: 'eq' },
        { col: 'status', value: 'terminated', op: 'neq' },
        { col: 'status', value: 'expired', op: 'neq' },
      ]);
      // No checkbox → rent_events never touched.
      expect(stub.updates.filter((u) => u.table === 'rent_events')).toHaveLength(0);
      expect(mockRevalidatePath).toHaveBeenCalledWith('/rent');

      const data = (result as { success: true; data: UpdateLeaseTermsResult }).data;
      expect(data.currentCycleRequested).toBe(false);
      expect(data.currentCycleUpdated).toBe(0);
    });

    it('should write status=terminated and never touch rent_events when terminating', async () => {
      const stub = buildServerStub({
        leases: [activeLease()],
        rentEvents: [pendingCycleRow()],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ status: 'terminated', endDate: '2026-06-30' }),
      );

      expect(result.success).toBe(true);
      const leaseUpdate = stub.updates.find((u) => u.table === 'leases');
      expect(leaseUpdate!.payload.status).toBe('terminated');
      // The open rent_event stays collectible — no cancel path exists.
      expect(stub.updates.filter((u) => u.table === 'rent_events')).toHaveLength(0);
      expect(stub.tables.rent_events[0].status).toBe('pending');
      expect(stub.tables.rent_events[0].amount_due).toBe(1450);
    });

    describe('current-cycle checkbox path', () => {
      it('should issue ONE conditional UPDATE guarded by status=pending AND amount_paid=0', async () => {
        const stub = buildServerStub({
          leases: [activeLease()],
          rentEvents: [pendingCycleRow()],
        });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await updateLeaseTermsAction(
          validPayload({ alsoUpdateCurrentCycle: true }),
        );

        expect(result.success).toBe(true);
        const cycleUpdates = stub.updates.filter((u) => u.table === 'rent_events');
        expect(cycleUpdates).toHaveLength(1);

        // Payload writes ONLY amount_due + due_date — never status/amount_paid.
        expect(Object.keys(cycleUpdates[0].payload).sort()).toEqual([
          'amount_due',
          'due_date',
        ]);
        expect(cycleUpdates[0].payload.amount_due).toBe(1525);
        // dueDateFor clamp: June 2026, due day 5 → 2026-06-05.
        expect(cycleUpdates[0].payload.due_date).toBe('2026-06-05');

        // The WHERE guard is the CAS — assert every clause.
        expect(cycleUpdates[0].predicates).toEqual([
          { col: 'lease_id', value: LEASE_ID, op: 'eq' },
          { col: 'cycle_month', value: CYCLE_MONTH, op: 'eq' },
          { col: 'status', value: 'pending', op: 'eq' },
          { col: 'amount_paid', value: 0, op: 'eq' },
        ]);

        const data = (result as { success: true; data: UpdateLeaseTermsResult }).data;
        expect(data.currentCycleRequested).toBe(true);
        expect(data.currentCycleUpdated).toBe(1);
        expect(data.currentCycleDueDate).toBe('2026-06-05');
      });

      it('should report a 0-row no-op when the cycle has already advanced past pending', async () => {
        const stub = buildServerStub({
          leases: [activeLease()],
          rentEvents: [pendingCycleRow({ status: 'reminder_sent' })],
        });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await updateLeaseTermsAction(
          validPayload({ alsoUpdateCurrentCycle: true }),
        );

        expect(result.success).toBe(true);
        const data = (result as { success: true; data: UpdateLeaseTermsResult }).data;
        expect(data.currentCycleRequested).toBe(true);
        expect(data.currentCycleUpdated).toBe(0);
        // The advanced row keeps its original amount.
        expect(stub.tables.rent_events[0].amount_due).toBe(1450);
      });

      it('should not touch a partially paid cycle row (amount_paid > 0)', async () => {
        const stub = buildServerStub({
          leases: [activeLease()],
          rentEvents: [pendingCycleRow({ amount_paid: 500 })],
        });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await updateLeaseTermsAction(
          validPayload({ alsoUpdateCurrentCycle: true }),
        );

        expect(result.success).toBe(true);
        const data = (result as { success: true; data: UpdateLeaseTermsResult }).data;
        expect(data.currentCycleUpdated).toBe(0);
        expect(stub.tables.rent_events[0].amount_due).toBe(1450);
        expect(stub.tables.rent_events[0].amount_paid).toBe(500);
      });

      it('should not touch a Stripe-paid row (status=paid, amount_paid still 0)', async () => {
        // The Stripe webhook sets status='paid' WITHOUT amount_paid — the
        // status clause (not amount_paid) is what excludes these rows.
        const stub = buildServerStub({
          leases: [activeLease()],
          rentEvents: [pendingCycleRow({ status: 'paid', amount_paid: 0 })],
        });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await updateLeaseTermsAction(
          validPayload({ alsoUpdateCurrentCycle: true }),
        );

        expect(result.success).toBe(true);
        const data = (result as { success: true; data: UpdateLeaseTermsResult }).data;
        expect(data.currentCycleUpdated).toBe(0);
        expect(stub.tables.rent_events[0].amount_due).toBe(1450);
      });

      it('should report (not fail) a cycle-touch error after the lease saved', async () => {
        const stub = buildServerStub({
          leases: [activeLease()],
          rentEvents: [pendingCycleRow()],
          updateErrors: { rent_events: 'connection reset' },
        });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await updateLeaseTermsAction(
          validPayload({ alsoUpdateCurrentCycle: true }),
        );

        // Lease-success/cycle-fail split is benign (future-only) but reported.
        expect(result.success).toBe(true);
        const data = (result as { success: true; data: UpdateLeaseTermsResult }).data;
        expect(data.currentCycleError).toBe('connection reset');
        expect(data.currentCycleUpdated).toBe(0);
        expect(stub.tables.leases[0].rent_amount).toBe(1525);
        expect(mockRevalidatePath).toHaveBeenCalledWith('/rent');
      });
    });

    describe('waiveRentAction role gate (owner-only)', () => {
      const waivePayload = {
        rentEventId: '88888888-8888-8888-8888-888888888888',
        leaseId: LEASE_ID,
        reason: 'Goodwill credit',
      };

      it.each(['manager', 'va', null])(
        'should return Forbidden with zero writes for role %s',
        async (role) => {
          const stub = buildServerStub({ leases: [activeLease()], role });
          mockCreateServerClient.mockResolvedValue(stub.client);

          const result = await waiveRentAction(waivePayload);

          expect(result).toEqual({ ok: false, error: 'Forbidden' });
          expect(stub.updates).toHaveLength(0);
        },
      );

      it('should let an owner past the role gate (reaches the lease read)', async () => {
        const stub = buildServerStub({ leases: [] });
        mockCreateServerClient.mockResolvedValue(stub.client);

        const result = await waiveRentAction(waivePayload);

        // Not Forbidden — the owner reached the RLS-scoped lease read.
        expect(result).toEqual({ ok: false, error: 'Lease not found' });
      });
    });

    it('should propagate a lease UPDATE failure and skip the cycle touch', async () => {
      const stub = buildServerStub({
        leases: [activeLease()],
        rentEvents: [pendingCycleRow()],
        updateErrors: { leases: 'permission denied' },
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await updateLeaseTermsAction(
        validPayload({ alsoUpdateCurrentCycle: true }),
      );

      expect(result).toEqual({ success: false, error: 'permission denied' });
      expect(stub.updates.filter((u) => u.table === 'rent_events')).toHaveLength(0);
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });
});
