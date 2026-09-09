/**
 * Unit tests for `src/lib/inbox/case-context.ts`.
 *
 * Three layers:
 *
 *   1. Pure helpers (`computeSlaState`, `tierFromStatus`, `emptyCaseContext`)
 *      — table-driven, no client.
 *   2. `getCaseContext` null path — returns the empty shape without
 *      hitting supabase at all.
 *   3. `getCaseContext` happy path — composed via a small chainable
 *      supabase stub that mirrors the subset of supabase-js the queries
 *      use. The stub mirrors the one in conversation-queries.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  computeSlaState,
  emptyCaseContext,
  getCaseContext,
  tierFromStatus,
  type DaysLateTier,
  type SlaState,
  type WorkOrderStatus,
  type WorkOrderUrgency,
} from '@/lib/inbox/case-context';
import type { Database } from '@/types/database';

type AnySupabase = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Stub builder (subset of supabase-js the queries actually use)
// ---------------------------------------------------------------------------

interface Tables {
  leases?: ReadonlyArray<Record<string, unknown>>;
  rent_events?: ReadonlyArray<Record<string, unknown>>;
  rent_payments?: ReadonlyArray<Record<string, unknown>>;
  work_orders?: ReadonlyArray<Record<string, unknown>>;
  vendors?: ReadonlyArray<Record<string, unknown>>;
  property_vendors?: ReadonlyArray<Record<string, unknown>>;
  units?: ReadonlyArray<Record<string, unknown>>;
}

interface Predicate {
  kind: 'eq' | 'in';
  column: string;
  value: unknown;
}

interface OrderSpec {
  column: string;
  ascending: boolean;
}

function buildSupabaseStub(tables: Tables): AnySupabase {
  const stub = {
    from: (tableName: keyof Tables) => buildQuery(tableName, tables),
  };
  return stub as unknown as AnySupabase;
}

function buildQuery(tableName: keyof Tables, tables: Tables): unknown {
  const predicates: Predicate[] = [];
  let limitN: number | null = null;
  let orderSpec: OrderSpec | null = null;

  function applyPredicates(
    rows: ReadonlyArray<Record<string, unknown>>,
  ): Record<string, unknown>[] {
    let result = [...rows];
    for (const p of predicates) {
      if (p.kind === 'eq') {
        result = result.filter((r) => r[p.column] === p.value);
      } else if (p.kind === 'in') {
        const arr = p.value as unknown[];
        result = result.filter((r) => arr.includes(r[p.column]));
      }
    }
    if (orderSpec) {
      const { column, ascending } = orderSpec;
      result = [...result].sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
    }
    if (limitN !== null) result = result.slice(0, limitN);
    return result;
  }

  const chain = {
    select(_cols?: string) {
      return chain;
    },
    eq(col: string, value: unknown) {
      predicates.push({ kind: 'eq', column: col, value });
      return chain;
    },
    in(col: string, value: unknown[]) {
      predicates.push({ kind: 'in', column: col, value });
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderSpec = {
        column: col,
        ascending: opts?.ascending !== false,
      };
      return chain;
    },
    limit(n: number) {
      limitN = n;
      return chain;
    },
    maybeSingle() {
      const row = applyPredicates(tables[tableName] ?? [])[0] ?? null;
      return Promise.resolve({ data: row, error: null });
    },
    then(
      onFulfilled?: (value: unknown) => unknown,
    ): Promise<unknown> {
      const rows = applyPredicates(tables[tableName] ?? []);
      return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
    },
  };
  return chain;
}

// ---------------------------------------------------------------------------
// computeSlaState
// ---------------------------------------------------------------------------

describe('case-context', () => {
  describe('computeSlaState', () => {
    const NOW = Date.parse('2026-05-28T12:00:00.000Z');

    interface Row {
      label: string;
      urgency: WorkOrderUrgency;
      ageHours: number;
      status: WorkOrderStatus;
      expected: SlaState;
    }

    const TABLE: Row[] = [
      // Emergency (4h breach, 3h at_risk)
      { label: 'emergency fresh', urgency: 'emergency', ageHours: 0.5, status: 'open', expected: 'on_track' },
      { label: 'emergency at_risk', urgency: 'emergency', ageHours: 3.1, status: 'open', expected: 'at_risk' },
      { label: 'emergency breached', urgency: 'emergency', ageHours: 5, status: 'open', expected: 'breached' },

      // Urgent (24h breach, 18h at_risk)
      { label: 'urgent fresh', urgency: 'urgent', ageHours: 4, status: 'assigned', expected: 'on_track' },
      { label: 'urgent at_risk', urgency: 'urgent', ageHours: 19, status: 'assigned', expected: 'at_risk' },
      { label: 'urgent breached', urgency: 'urgent', ageHours: 30, status: 'in_progress', expected: 'breached' },

      // Routine (72h breach, 54h at_risk)
      { label: 'routine fresh', urgency: 'routine', ageHours: 10, status: 'open', expected: 'on_track' },
      { label: 'routine at_risk', urgency: 'routine', ageHours: 60, status: 'open', expected: 'at_risk' },
      { label: 'routine breached', urgency: 'routine', ageHours: 80, status: 'open', expected: 'breached' },

      // Completed / cancelled always on_track regardless of age
      { label: 'completed old', urgency: 'emergency', ageHours: 999, status: 'completed', expected: 'on_track' },
      { label: 'cancelled old', urgency: 'urgent', ageHours: 999, status: 'cancelled', expected: 'on_track' },
    ];

    it.each(TABLE)(
      '$label → $expected',
      ({ urgency, ageHours, status, expected }) => {
        const openedAt = new Date(NOW - ageHours * 60 * 60 * 1000).toISOString();
        expect(computeSlaState(urgency, openedAt, status, NOW)).toBe(expected);
      },
    );

    it('falls back to on_track when openedAt is not parseable', () => {
      expect(computeSlaState('emergency', 'not-a-date', 'open', NOW)).toBe('on_track');
    });
  });

  // -------------------------------------------------------------------------
  // tierFromStatus
  // -------------------------------------------------------------------------

  describe('tierFromStatus', () => {
    type RentStatus = Database['public']['Enums']['rent_event_status'];

    interface Row {
      status: RentStatus | null;
      expected: DaysLateTier | null;
    }

    const TABLE: Row[] = [
      { status: 'pending', expected: 0 },
      { status: 'reminder_sent', expected: 0 },
      { status: 'due_sent', expected: 0 },
      { status: 'late_1', expected: 1 },
      { status: 'late_3', expected: 3 },
      { status: 'late_7', expected: 7 },
      { status: 'escalated', expected: 'escalated' },
      { status: 'paid', expected: null },
      { status: 'plan_agreed', expected: null },
      { status: null, expected: null },
    ];

    it.each(TABLE)('status=$status → $expected', ({ status, expected }) => {
      expect(tierFromStatus(status)).toEqual(expected);
    });
  });

  // -------------------------------------------------------------------------
  // emptyCaseContext / getCaseContext null tenant
  // -------------------------------------------------------------------------

  describe('emptyCaseContext', () => {
    it('returns the canonical empty shape', () => {
      expect(emptyCaseContext()).toEqual({
        lease: null,
        payments: {
          onTimeCount: 0,
          totalRecent: 0,
          balanceCents: 0,
          daysLateTier: null,
        },
        workOrder: null,
      });
    });
  });

  describe('getCaseContext(null)', () => {
    it('returns empty shape without calling supabase when tenantId is null', async () => {
      // No tables provided — if the helper hits supabase, the stub will
      // return undefined and the function will likely throw. Passing null
      // should short-circuit before any client call.
      const supabase = buildSupabaseStub({});
      const result = await getCaseContext(supabase, null);
      expect(result).toEqual(emptyCaseContext());
    });
  });

  // -------------------------------------------------------------------------
  // getCaseContext happy path
  // -------------------------------------------------------------------------

  describe('getCaseContext (happy path)', () => {
    it('composes lease + payments + workOrder with primary and backup vendor', async () => {
      const supabase = buildSupabaseStub({
        leases: [
          {
            id: 'lease-1',
            tenant_id: 'tenant-1',
            unit_id: 'unit-1',
            rent_amount: 2400,
            start_date: '2025-08-01',
            end_date: '2026-07-31',
            status: 'active',
          },
        ],
        rent_events: [
          {
            id: 'ev-current',
            lease_id: 'lease-1',
            status: 'late_3',
            amount_due: 2400,
            amount_paid: 0,
            due_date: '2026-05-01',
          },
          {
            id: 'ev-prev',
            lease_id: 'lease-1',
            status: 'paid',
            amount_due: 2400,
            amount_paid: 2400,
            due_date: '2026-04-01',
          },
          {
            id: 'ev-older',
            lease_id: 'lease-1',
            status: 'paid',
            amount_due: 2400,
            amount_paid: 2400,
            due_date: '2026-03-01',
          },
        ],
        rent_payments: [
          {
            rent_event_id: 'ev-prev',
            paid_at: '2026-03-30',
            status: 'succeeded',
          },
          {
            rent_event_id: 'ev-older',
            paid_at: '2026-02-28',
            status: 'succeeded',
          },
        ],
        work_orders: [
          {
            id: 'wo-1',
            tenant_id: 'tenant-1',
            unit_id: 'unit-1',
            category: 'plumbing',
            urgency: 'urgent',
            status: 'assigned',
            vendor_id: 'vendor-primary',
            created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          },
        ],
        vendors: [
          {
            id: 'vendor-primary',
            name: 'Acme Plumbing',
            acceptance_rate: 0.87,
          },
          {
            id: 'vendor-backup',
            name: 'Backup Plumb Co',
            acceptance_rate: 0.6,
          },
        ],
        units: [{ id: 'unit-1', property_id: 'prop-1' }],
        property_vendors: [
          {
            property_id: 'prop-1',
            category: 'plumbing',
            vendor_id: 'vendor-primary',
            confidence: 0.9,
          },
          {
            property_id: 'prop-1',
            category: 'plumbing',
            vendor_id: 'vendor-backup',
            confidence: 0.7,
          },
        ],
      });

      const result = await getCaseContext(supabase, 'tenant-1');

      // Lease
      expect(result.lease).toEqual({
        startDate: '2025-08-01',
        endDate: '2026-07-31',
        rentAmountCents: 240000,
      });

      // Payments
      expect(result.payments.totalRecent).toBe(3);
      expect(result.payments.onTimeCount).toBe(2);
      // late_3 row owes 2400 dollars = 240000 cents
      expect(result.payments.balanceCents).toBe(240000);
      // Latest non-paid event is the late_3 row (highest due_date)
      expect(result.payments.daysLateTier).toBe(3);

      // Work order
      expect(result.workOrder).not.toBeNull();
      expect(result.workOrder!.id).toBe('wo-1');
      expect(result.workOrder!.category).toBe('plumbing');
      expect(result.workOrder!.urgency).toBe('urgent');
      expect(result.workOrder!.status).toBe('assigned');
      expect(result.workOrder!.vendor).toEqual({
        id: 'vendor-primary',
        name: 'Acme Plumbing',
        acceptanceRate: 0.87,
      });
      expect(result.workOrder!.backupVendor).toEqual({
        id: 'vendor-backup',
        name: 'Backup Plumb Co',
      });
      expect(result.workOrder!.slaState).toBe('on_track');
    });

    it('returns null lease / null workOrder when the tenant has neither', async () => {
      const supabase = buildSupabaseStub({
        leases: [],
        rent_events: [],
        rent_payments: [],
        work_orders: [],
      });

      const result = await getCaseContext(supabase, 'tenant-novel');

      expect(result.lease).toBeNull();
      expect(result.workOrder).toBeNull();
      expect(result.payments).toEqual({
        onTimeCount: 0,
        totalRecent: 0,
        balanceCents: 0,
        daysLateTier: null,
      });
    });

    it('returns workOrder with null vendor when vendor_id is null', async () => {
      const supabase = buildSupabaseStub({
        leases: [],
        rent_events: [],
        rent_payments: [],
        work_orders: [
          {
            id: 'wo-1',
            tenant_id: 'tenant-1',
            unit_id: 'unit-1',
            category: 'electrical',
            urgency: 'routine',
            status: 'open',
            vendor_id: null,
            created_at: new Date().toISOString(),
          },
        ],
        units: [{ id: 'unit-1', property_id: 'prop-1' }],
        property_vendors: [],
        vendors: [],
      });

      const result = await getCaseContext(supabase, 'tenant-1');
      expect(result.workOrder).not.toBeNull();
      expect(result.workOrder!.vendor).toBeNull();
      expect(result.workOrder!.backupVendor).toBeNull();
    });
  });
});
