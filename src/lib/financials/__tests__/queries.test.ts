/**
 * Unit tests for `src/lib/financials/queries.ts`.
 *
 * `getPortfolioFinancialSummary()` reads through `createServerClient()`,
 * so we mock the server module with a small chainable stub mirroring the
 * subset of supabase-js the query uses (select / eq / lte / in / order). RLS is
 * implicit. The clock is frozen at 2026-06-12 local time so the canonical
 * date-aware `rentCycleFromRow` derivation is deterministic — an unpaid
 * `pending` cycle past its Jun 1 due date counts as late.
 *
 * Honest-data invariant under test: maintenance / vendor / NOI / margin
 * stay `null` (expense imports not connected) and open work-order COUNT
 * flows through only as a risk signal — never as a dollar figure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getFinancialsConsole,
  getPortfolioFinancialSummary,
  getPropertyFinancialSnapshot,
} from '@/lib/financials/queries';

// ---------------------------------------------------------------------------
// Supabase stub
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Tables {
  properties?: readonly Row[];
  units?: readonly Row[];
  rent_events?: readonly Row[];
  leases?: readonly Row[];
  work_orders?: readonly Row[];
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
    lte(col: string, value: unknown) {
      result = result.filter((r) => String(r[col] ?? '') <= String(value ?? ''));
      return chain;
    },
    in(col: string, values: readonly unknown[]) {
      result = result.filter((r) => values.includes(r[col]));
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts?.ascending !== false;
      result = [...result].sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        const cmp = av.localeCompare(bv);
        return ascending ? cmp : -cmp;
      });
      return chain;
    },
    then(
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ): Promise<unknown> {
      return Promise.resolve({ data: result, error: null }).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures — frozen "today" is 2026-06-12; current cycle is 2026-06-01
// ---------------------------------------------------------------------------

const CYCLE = '2026-06-01';

function event(
  leaseId: string,
  status: string,
  amountDue: number,
  amountPaid: number,
  dueDate: string | null,
  cycleMonth = CYCLE,
): Row {
  return {
    lease_id: leaseId,
    cycle_month: cycleMonth,
    amount_due: amountDue,
    amount_paid: amountPaid,
    status,
    due_date: dueDate,
  };
}

/**
 * Two-property portfolio.
 *   p1 "Ranson Apartments": 3 units, all occupied (active leases l1–l3),
 *     3 open work orders.
 *     rent: l1 paid 2000/2000; l2 pending 2000/0 due Jun 1 (LATE Jun 12);
 *           l3 plan_agreed 1500/500 (on-plan, $1000 outstanding).
 *   p2 "Bridgeview": 2 units, 1 occupied (l4 active, l5 terminated), 0 WOs.
 *     rent: l4 pending 1800/0 due Jun 15 (DUE, not late); u5 vacant (no event).
 */
function stubPortfolio(): void {
  supabaseStub = buildSupabaseStub({
    properties: [
      { id: 'p2', name: 'Bridgeview' },
      { id: 'p1', name: 'Ranson Apartments' },
    ],
    units: [
      { id: 'u1', property_id: 'p1' },
      { id: 'u2', property_id: 'p1' },
      { id: 'u3', property_id: 'p1' },
      { id: 'u4', property_id: 'p2' },
      { id: 'u5', property_id: 'p2' },
    ],
    leases: [
      { id: 'l1', unit_id: 'u1', status: 'active' },
      { id: 'l2', unit_id: 'u2', status: 'active' },
      { id: 'l3', unit_id: 'u3', status: 'active' },
      { id: 'l4', unit_id: 'u4', status: 'active' },
      { id: 'l5', unit_id: 'u5', status: 'terminated' },
    ],
    rent_events: [
      event('l1', 'paid', 2000, 2000, '2026-06-01'),
      event('l2', 'pending', 2000, 0, '2026-06-01'),
      event('l3', 'plan_agreed', 1500, 500, '2026-06-01'),
      event('l4', 'pending', 1800, 0, '2026-06-15'),
    ],
    work_orders: [
      { id: 'w1', unit_id: 'u1', status: 'open' },
      { id: 'w2', unit_id: 'u2', status: 'assigned' },
      { id: 'w3', unit_id: 'u3', status: 'in_progress' },
      { id: 'w4', unit_id: 'u4', status: 'completed' },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 12, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getPortfolioFinancialSummary
// ---------------------------------------------------------------------------

describe('queries', () => {
  describe('getPortfolioFinancialSummary', () => {
    it('should build the current-month period window from the frozen clock', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      expect(summary.period).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        label: 'June 2026',
      });
    });

    it('should roll up billed / collected / outstanding from derived rent rows', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      // Billed 7300; collected 2500; outstanding = balances 2000+1000+1800.
      expect(summary.rentBilledCents).toBe(730_000);
      expect(summary.rentCollectedCents).toBe(250_000);
      expect(summary.rentOutstandingCents).toBe(480_000);
      // Only the date-overdue l2 cycle is late (its $2000 balance).
      expect(summary.rentLateCents).toBe(200_000);
      expect(summary.collectionRatePct).toBe(34.2);
    });

    it('should derive occupancy from active leases, not from rent events', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      expect(summary.propertyCount).toBe(2);
      expect(summary.unitCount).toBe(5);
      // p1 3/3 occupied + p2 1/2 (l5 terminated) = 4 of 5.
      expect(summary.occupiedUnitCount).toBe(4);
      expect(summary.occupancyRatePct).toBe(80);
    });

    it('should keep spend / NOI / margin null — expense imports not connected', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      expect(summary.maintenanceSpendCents).toBeNull();
      expect(summary.vendorSpendCents).toBeNull();
      expect(summary.operatingExpenseCents).toBeNull();
      expect(summary.noiCents).toBeNull();
      expect(summary.marginPct).toBeNull();
    });

    it('should pass open work-order COUNT through as a risk signal only', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      // 3 open WOs at p1, none counted as a dollar amount anywhere.
      expect(summary.openWorkOrderCount).toBe(3);
      const p1 = summary.properties.find((p) => p.propertyId === 'p1');
      expect(p1?.openWorkOrderCount).toBe(3);
      expect(p1?.maintenanceSpendCents).toBeNull();
    });

    it('should attribute each rent row to its property via lease → unit → property', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      const p1 = summary.properties.find((p) => p.propertyId === 'p1');
      const p2 = summary.properties.find((p) => p.propertyId === 'p2');

      // p1: billed 5500, collected 2500, late 2000; risk critical (collection < 50%).
      expect(p1?.rentBilledCents).toBe(550_000);
      expect(p1?.rentCollectedCents).toBe(250_000);
      expect(p1?.rentLateCents).toBe(200_000);
      expect(p1?.units).toBe(3);
      expect(p1?.occupiedUnits).toBe(3);
      expect(p1?.riskLevel).toBe('critical');

      // p2: billed 1800, nothing collected, due (not late).
      expect(p2?.rentBilledCents).toBe(180_000);
      expect(p2?.rentCollectedCents).toBe(0);
      expect(p2?.rentLateCents).toBe(0);
      expect(p2?.units).toBe(2);
      expect(p2?.occupiedUnits).toBe(1);
    });

    it('should emit a deterministic exception queue incl. the honest expense note', async () => {
      stubPortfolio();

      const summary = await getPortfolioFinancialSummary();

      const ids = summary.exceptions.map((e) => e.id);
      expect(ids).toContain('late:p1');
      expect(ids).toContain('collections:p2');
      expect(ids).toContain('expense-imports');

      const late = summary.exceptions.find((e) => e.id === 'late:p1');
      expect(late?.amountCents).toBe(200_000);
      expect(late?.source).toBe('rent');
    });

    it('should return a well-formed zeroed summary for an org with no properties', async () => {
      supabaseStub = buildSupabaseStub({ properties: [] });

      const summary = await getPortfolioFinancialSummary();

      expect(summary.propertyCount).toBe(0);
      expect(summary.unitCount).toBe(0);
      expect(summary.rentBilledCents).toBe(0);
      expect(summary.rentCollectedCents).toBe(0);
      expect(summary.collectionRatePct).toBeNull();
      expect(summary.occupancyRatePct).toBeNull();
      expect(summary.properties).toEqual([]);
      expect(summary.period.label).toBe('June 2026');
    });
  });

  describe('getFinancialsConsole', () => {
    /**
     * One property, three leases, three months of history (frozen today
     * is 2026-06-12, current cycle 2026-06-01):
     *   Apr: l3 pending 1500/0 due Apr 1  → 72 days late (prior to 'last').
     *   May: l1 paid 2000/2000; l2 pending 2000/0 due May 1 → 42 days late.
     *   Jun: l1 paid 2000/2000; l2 pending 2000/0 due Jun 1 → 11 days late.
     */
    function stubMultiMonth(): void {
      supabaseStub = buildSupabaseStub({
        properties: [{ id: 'p1', name: 'Ranson Apartments' }],
        units: [
          { id: 'u1', property_id: 'p1' },
          { id: 'u2', property_id: 'p1' },
          { id: 'u3', property_id: 'p1' },
        ],
        leases: [
          { id: 'l1', unit_id: 'u1', status: 'active' },
          { id: 'l2', unit_id: 'u2', status: 'active' },
          { id: 'l3', unit_id: 'u3', status: 'active' },
        ],
        rent_events: [
          event('l3', 'pending', 1500, 0, '2026-04-01', '2026-04-01'),
          event('l1', 'paid', 2000, 2000, '2026-05-01', '2026-05-01'),
          event('l2', 'pending', 2000, 0, '2026-05-01', '2026-05-01'),
          event('l1', 'paid', 2000, 2000, '2026-06-01'),
          event('l2', 'pending', 2000, 0, '2026-06-01'),
        ],
        work_orders: [],
      });
    }

    it('should fold the last-month summary excluding current-month rows', async () => {
      stubMultiMonth();

      const result = await getFinancialsConsole('last');

      expect(result.periodKey).toBe('last');
      expect(result.summary.period).toEqual({
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        label: 'May 2026',
      });
      // May rows only: billed 4000, collected 2000. June rows excluded.
      expect(result.summary.rentBilledCents).toBe(400_000);
      expect(result.summary.rentCollectedCents).toBe(200_000);
      // Outstanding/late include the still-late April balance (aged
      // receivable), never the June rows after the period end.
      expect(result.summary.rentOutstandingCents).toBe(350_000);
      expect(result.summary.rentLateCents).toBe(350_000);
    });

    it('should keep the trend series and aging buckets period-independent', async () => {
      stubMultiMonth();

      const result = await getFinancialsConsole('last');

      // Series still ends at the CURRENT cycle even when viewing 'last'.
      expect(result.series.map((p) => p.cycleMonth)).toEqual([
        '2026-04-01',
        '2026-05-01',
        '2026-06-01',
      ]);
      expect(result.series.map((p) => p.billedCents)).toEqual([150_000, 400_000, 400_000]);
      expect(result.series[2].collectedCents).toBe(200_000);

      // Aging is as-of-today: Jun l2 = 11 days (8–30); May l2 42 days +
      // Apr l3 72 days both land in 31+.
      const byId = new Map(result.aging.map((b) => [b.id, b]));
      expect(byId.get('d8_30')).toMatchObject({ cents: 200_000, count: 1 });
      expect(byId.get('d31_plus')).toMatchObject({ cents: 350_000, count: 2 });
      expect(byId.get('current')).toMatchObject({ cents: 0, count: 0 });
      expect(byId.get('d1_7')).toMatchObject({ cents: 0, count: 0 });
    });

    it('should compute period totals and the comparable prior totals', async () => {
      stubMultiMonth();

      const result = await getFinancialsConsole('last');

      // Selected window (May): l2 late in period + l3 late from before.
      expect(result.totals).toEqual({
        billedCents: 400_000,
        collectedCents: 200_000,
        outstandingCents: 200_000,
        lateCents: 350_000,
        lateLeaseCount: 2,
      });
      // Comparable prior window (April): only l3.
      expect(result.priorTotals).toEqual({
        billedCents: 150_000,
        collectedCents: 0,
        outstandingCents: 150_000,
        lateCents: 150_000,
        lateLeaseCount: 1,
      });
    });

    it('should keep the mtd summary identical to getPortfolioFinancialSummary', async () => {
      stubPortfolio();
      const result = await getFinancialsConsole('mtd');
      const wrapped = await getPortfolioFinancialSummary();

      expect(result.summary).toEqual(wrapped);
      expect(result.periodKey).toBe('mtd');
    });

    it('should return a well-formed zeroed console for an org with no properties', async () => {
      supabaseStub = buildSupabaseStub({ properties: [] });

      const result = await getFinancialsConsole('last');

      expect(result.summary.propertyCount).toBe(0);
      expect(result.series).toEqual([]);
      expect(result.aging.map((b) => b.cents)).toEqual([0, 0, 0, 0]);
      expect(result.totals.billedCents).toBe(0);
      expect(result.priorTotals.billedCents).toBe(0);
    });
  });

  describe('getPropertyFinancialSnapshot', () => {
    it('should scope billed / collected / late to the single property', async () => {
      stubPortfolio();

      const briefing = await getPropertyFinancialSnapshot('p1');

      expect(briefing).not.toBeNull();
      const snapshot = briefing!.snapshot;
      expect(snapshot.propertyId).toBe('p1');
      expect(snapshot.propertyName).toBe('Ranson Apartments');
      // p1 leases l1–l3: billed 5500, collected 2500, late l2 2000,
      // outstanding = l2 2000 + l3 1000 = 3000.
      expect(snapshot.rentBilledCents).toBe(550_000);
      expect(snapshot.rentCollectedCents).toBe(250_000);
      expect(snapshot.rentLateCents).toBe(200_000);
      expect(snapshot.rentOutstandingCents).toBe(300_000);
      expect(snapshot.units).toBe(3);
      expect(snapshot.occupiedUnits).toBe(3);
      expect(snapshot.riskLevel).toBe('critical');
    });

    it('should keep spend / NOI null and pass the work-order count as a risk signal', async () => {
      stubPortfolio();

      const briefing = await getPropertyFinancialSnapshot('p1');

      const snapshot = briefing!.snapshot;
      expect(snapshot.maintenanceSpendCents).toBeNull();
      expect(snapshot.vendorSpendCents).toBeNull();
      expect(snapshot.noiCents).toBeNull();
      expect(snapshot.marginPct).toBeNull();
      // 3 open WOs at p1 — a risk signal, never a dollar figure.
      expect(snapshot.openWorkOrderCount).toBe(3);
    });

    it('should build a deterministic, property-scoped exception queue', async () => {
      stubPortfolio();

      const briefing = await getPropertyFinancialSnapshot('p1');

      const ids = briefing!.exceptions.map((e) => e.id);
      expect(ids).toContain('late:p1');
      // No other property's exceptions leak in.
      expect(ids).not.toContain('collections:p2');
      const late = briefing!.exceptions.find((e) => e.id === 'late:p1');
      expect(late?.amountCents).toBe(200_000);
    });

    it('should expose the current-month period window', async () => {
      stubPortfolio();

      const briefing = await getPropertyFinancialSnapshot('p1');

      expect(briefing!.period).toEqual({
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        label: 'June 2026',
      });
    });

    it('should return null when the property is not visible', async () => {
      stubPortfolio();

      const briefing = await getPropertyFinancialSnapshot('does-not-exist');

      expect(briefing).toBeNull();
    });
  });
});
