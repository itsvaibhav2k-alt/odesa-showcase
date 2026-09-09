/**
 * Unit tests for `src/lib/rent/queries.ts`.
 *
 * `listRentLedger()` reads through `createServerClient()`, so we mock
 * the server module with a small chainable stub mirroring the subset of
 * supabase-js the query uses (select / eq / in). RLS is implicit.
 *
 * The clock is frozen at 2026-06-12 local time so the canonical
 * date-aware derivation (`@/lib/domain`) is deterministic. The headline
 * fix under test: an unpaid `pending` cycle past its due date counts in
 * the "Late" metric and reads "Due Jun 1 · 11 days late" — lateness is
 * no longer enum-only, while the `RentStatusPill` union and facet ids
 * stay stable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listRecentRentPayments, listRentLedger } from '@/lib/rent/queries';

// ---------------------------------------------------------------------------
// Supabase stub
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Tables {
  rent_events?: readonly Row[];
  leases?: readonly Row[];
  tenants?: readonly Row[];
  units?: readonly Row[];
  properties?: readonly Row[];
  rent_payments?: readonly Row[];
}

let supabaseStub: unknown;

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => supabaseStub,
}));

function buildSupabaseStub(tables: Tables): unknown {
  return {
    from: (table: keyof Tables) => buildQuery(tables[table] ?? []),
  };
}

function buildQuery(rows: readonly Row[]): unknown {
  let result = [...rows];
  const chain = {
    select() {
      return chain;
    },
    eq(col: string, value: unknown) {
      result = result.filter((r) => r[col] === value);
      return chain;
    },
    in(col: string, values: readonly unknown[]) {
      result = result.filter((r) => values.includes(r[col]));
      return chain;
    },
    not(col: string, operator: string, value: unknown) {
      if (operator === 'is' && value === null) {
        result = result.filter((r) => r[col] !== null && r[col] !== undefined);
      }
      return chain;
    },
    order(col: string, options?: { ascending?: boolean }) {
      const direction = options?.ascending === false ? -1 : 1;
      result.sort((a, b) =>
        String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * direction,
      );
      return chain;
    },
    limit(count: number) {
      result = result.slice(0, count);
      return chain;
    },
    then(
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): Promise<unknown> {
      return Promise.resolve({ data: result, error: null }).then(
        onFulfilled,
        onRejected,
      );
    },
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures — frozen "today" is 2026-06-12; current cycle is 2026-06-01
// ---------------------------------------------------------------------------

const CYCLE = '2026-06-01';

function lease(id: string, unitId: string, tenantId: string, rent: number): Row {
  return {
    id,
    unit_id: unitId,
    tenant_id: tenantId,
    rent_amount: rent,
    rent_due_day: 1,
    end_date: '2027-06-30',
    status: 'active',
  };
}

function event(
  leaseId: string,
  status: string,
  amountDue: number,
  amountPaid: number,
  dueDate: string | null,
): Row {
  return {
    lease_id: leaseId,
    cycle_month: CYCLE,
    amount_due: amountDue,
    amount_paid: amountPaid,
    status,
    due_date: dueDate,
  };
}

/** Four-cycle ledger: paid / stale-pending overdue / on-plan / not yet due. */
function stubLedgerTables(events: readonly Row[]): void {
  supabaseStub = buildSupabaseStub({
    rent_events: events,
    leases: [
      lease('l1', 'u1', 't1', 2000),
      lease('l2', 'u2', 't2', 2000),
      lease('l3', 'u3', 't3', 1500),
      lease('l4', 'u4', 't4', 1800),
    ],
    tenants: [
      { id: 't1', full_name: 'Ana Paid' },
      { id: 't2', full_name: 'Vaibhav Maddhi' },
      { id: 't3', full_name: 'Pat Plan' },
      { id: 't4', full_name: 'Dee Due' },
    ],
    units: [
      { id: 'u1', label: '1', property_id: 'p1' },
      { id: 'u2', label: '2', property_id: 'p1' },
      { id: 'u3', label: '3', property_id: 'p1' },
      { id: 'u4', label: '4', property_id: 'p1' },
    ],
    properties: [{ id: 'p1', name: 'Ranson Apartments' }],
  });
}

const FOUR_EVENTS: readonly Row[] = [
  event('l1', 'paid', 2000, 2000, '2026-06-01'),
  event('l2', 'pending', 2000, 0, '2026-06-01'),
  event('l3', 'plan_agreed', 1500, 500, '2026-06-01'),
  event('l4', 'pending', 1800, 0, '2026-06-15'),
];

function metricValue(
  metrics: ReadonlyArray<{ label: string; value: string }>,
  label: string,
): string | undefined {
  return metrics.find((m) => m.label === label)?.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 12, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// listRentLedger
// ---------------------------------------------------------------------------

describe('queries', () => {
  describe('listRentLedger', () => {
    it('should count a date-overdue pending cycle in the Late metric', async () => {
      // Arrange — l2 is unpaid, due Jun 1, today Jun 12: enum says
      // `pending`, the calendar says late. The old enum-only check
      // rendered Late = 0 here.
      stubLedgerTables(FOUR_EVENTS);

      // Act
      const ledger = await listRentLedger();

      // Assert
      expect(metricValue(ledger.summary.metrics, 'Late')).toBe('1');
      expect(metricValue(ledger.summary.metrics, 'On a plan')).toBe('1');
    });

    it('should keep the billed/collected/outstanding math unchanged', async () => {
      stubLedgerTables(FOUR_EVENTS);

      const ledger = await listRentLedger();

      // Billed 7300; collected 2500 → 34%; outstanding 4800.
      expect(metricValue(ledger.summary.metrics, 'Billed')).toBe('$7,300');
      expect(metricValue(ledger.summary.metrics, 'Collected')).toBe('34%');
      expect(metricValue(ledger.summary.metrics, 'Outstanding')).toBe('$4,800');
      expect(ledger.summary.period).toBe('Jun 2026');
    });

    it('should label an overdue row "Due Jun 1 · 11 days late" while its pill stays outstanding', async () => {
      stubLedgerTables(FOUR_EVENTS);

      const ledger = await listRentLedger();

      const overdue = ledger.rows.find((r) => r.tenantName === 'Vaibhav Maddhi');
      expect(overdue?.when).toBe('Due Jun 1 · 11 days late');
      expect(overdue?.statusPill).toEqual({
        status: 'outstanding',
        label: 'Overdue',
      });
    });

    it('should label paid, on-plan, and not-yet-due rows from the derived status', async () => {
      stubLedgerTables(FOUR_EVENTS);

      const ledger = await listRentLedger();

      const paid = ledger.rows.find((r) => r.tenantName === 'Ana Paid');
      expect(paid?.statusPill).toEqual({ status: 'paid', label: 'Paid' });
      expect(paid?.when).toBe('Jun 1');

      const plan = ledger.rows.find((r) => r.tenantName === 'Pat Plan');
      expect(plan?.statusPill).toEqual({ status: 'on-plan', label: 'On plan' });
      expect(plan?.when).toBe('Due Jun 1');

      const due = ledger.rows.find((r) => r.tenantName === 'Dee Due');
      expect(due?.statusPill).toEqual({ status: 'outstanding', label: 'Due' });
      expect(due?.when).toBe('Due Jun 15');
    });

    it('should keep the facet ids stable with outstanding covering due and overdue rows', async () => {
      stubLedgerTables(FOUR_EVENTS);

      const ledger = await listRentLedger();

      expect(ledger.facets.map((f) => f.id)).toEqual([
        'all',
        'paid',
        'outstanding',
        'on-plan',
      ]);
      expect(ledger.facets.map((f) => f.count)).toEqual([4, 1, 2, 1]);
    });

    it('should pill an escalated cycle as Escalated and count it late even without a due date', async () => {
      stubLedgerTables([event('l2', 'escalated', 2000, 0, null)]);

      const ledger = await listRentLedger();

      expect(ledger.rows[0].statusPill).toEqual({
        status: 'outstanding',
        label: 'Escalated',
      });
      expect(metricValue(ledger.summary.metrics, 'Late')).toBe('1');
    });

    it('should treat a fully paid cycle as Paid despite a stale plan_agreed enum', async () => {
      stubLedgerTables([event('l3', 'plan_agreed', 1500, 1500, '2026-06-01')]);

      const ledger = await listRentLedger();

      expect(ledger.rows[0].statusPill).toEqual({ status: 'paid', label: 'Paid' });
      expect(metricValue(ledger.summary.metrics, 'On a plan')).toBe('0');
    });

    it('should return a well-formed empty ledger when the month has no rent events', async () => {
      stubLedgerTables([]);

      const ledger = await listRentLedger();

      expect(ledger.rows).toEqual([]);
      expect(metricValue(ledger.summary.metrics, 'Billed')).toBe('$0');
      expect(metricValue(ledger.summary.metrics, 'Late')).toBe('0');
      expect(ledger.facets.map((f) => f.count)).toEqual([0, 0, 0, 0]);
    });
  });

  describe('listRecentRentPayments', () => {
    it('returns only confirmed paid_at rows in newest-first order', async () => {
      supabaseStub = buildSupabaseStub({
        rent_payments: [
          {
            id: 'rp-old',
            rent_event_id: 'e1',
            tenant_id: 't1',
            amount_cents: 145000,
            status: 'succeeded',
            paid_at: '2026-06-01T09:14:00Z',
            payment_method_type: 'card',
            receipt_url: 'https://example.test/receipt/old',
          },
          {
            id: 'rp-new',
            rent_event_id: 'e2',
            tenant_id: 't2',
            amount_cents: 230000,
            status: 'succeeded',
            paid_at: '2026-06-03T10:00:00Z',
            payment_method_type: 'us_bank_account',
            receipt_url: null,
          },
          {
            id: 'rp-pending',
            rent_event_id: 'e3',
            tenant_id: 't3',
            amount_cents: 180000,
            status: 'pending',
            paid_at: null,
            payment_method_type: null,
            receipt_url: null,
          },
        ],
        tenants: [
          { id: 't1', full_name: 'Ana Paid' },
          { id: 't2', full_name: 'Ivan Jankowski' },
          { id: 't3', full_name: 'Dee Pending' },
        ],
      });

      const payments = await listRecentRentPayments(2);

      expect(payments.map((payment) => payment.id)).toEqual(['rp-new', 'rp-old']);
      expect(payments[0]).toMatchObject({
        tenantName: 'Ivan Jankowski',
        amountCents: 230000,
        paidAt: '2026-06-03T10:00:00Z',
        paymentMethodType: 'us_bank_account',
      });
    });

    it('never substitutes updated_at when paid_at is missing', async () => {
      supabaseStub = buildSupabaseStub({
        rent_payments: [
          {
            id: 'rp-no-paid-at',
            rent_event_id: 'e1',
            tenant_id: 't1',
            amount_cents: 145000,
            status: 'succeeded',
            paid_at: null,
            updated_at: '2026-06-03T10:00:00Z',
            payment_method_type: 'card',
            receipt_url: null,
          },
        ],
      });

      await expect(listRecentRentPayments()).resolves.toEqual([]);
    });
  });
});
