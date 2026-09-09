/**
 * Unit tests for the portfolio operator signals added to
 * `src/lib/properties/portfolio-queries.ts` (`getProperties` +
 * `getPortfolioSummary`).
 *
 * Focus is the data-backed enrichment the `/properties` command center reads:
 *   - `signals` (rentLate / maintenanceOpen / vacant / needsAttention),
 *   - `outstandingCents` + `rentIssueCount` (canonical balance, never the enum),
 *   - `searchText` (name + location + unit labels + tenant names),
 *   - the cross-portfolio `attention` breakdown.
 *
 * Lateness is intentionally exercised through a STALE `pending` cycle whose
 * due_date is in the past so the test proves the canonical date-aware
 * derivation (`rentCycleFromRow`), not a raw enum read. The chainable supabase
 * stub mirrors the pattern in `./queries.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import {
  getProperties,
  getPortfolioSummary,
  getTabs,
} from '@/lib/properties/portfolio-queries';

// ---------------------------------------------------------------------------
// Chainable supabase stub (select / eq / in / order / maybeSingle / await)
// ---------------------------------------------------------------------------

interface StubTables {
  properties?: ReadonlyArray<Record<string, unknown>>;
  units?: ReadonlyArray<Record<string, unknown>>;
  leases?: ReadonlyArray<Record<string, unknown>>;
  tenants?: ReadonlyArray<Record<string, unknown>>;
  rent_events?: ReadonlyArray<Record<string, unknown>>;
  work_orders?: ReadonlyArray<Record<string, unknown>>;
  vendors?: ReadonlyArray<Record<string, unknown>>;
}

interface Predicate {
  kind: 'eq' | 'in';
  column: string;
  value: unknown;
}

interface StubOptions {
  maxRows?: number;
  errors?: Partial<Record<keyof StubTables, string>>;
}

function buildQuery(
  tableName: keyof StubTables,
  tables: StubTables,
  options: StubOptions,
): unknown {
  const predicates: Predicate[] = [];
  let orderColumn: string | null = null;
  let orderAscending = true;
  let requestedRange: [number, number] | null = null;

  function apply(): Record<string, unknown>[] {
    let rows = [...(tables[tableName] ?? [])] as Record<string, unknown>[];
    for (const p of predicates) {
      if (p.kind === 'eq') {
        rows = rows.filter((r) => r[p.column] === p.value);
      } else {
        const arr = p.value as unknown[];
        rows = rows.filter((r) => arr.includes(r[p.column]));
      }
    }
    if (orderColumn) {
      const col = orderColumn;
      const asc = orderAscending;
      rows = [...rows].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return asc ? -1 : 1;
        if (av > bv) return asc ? 1 : -1;
        return 0;
      });
    }
    const [from, to] = requestedRange ?? [0, (options.maxRows ?? 1000) - 1];
    return rows.slice(from, to + 1);
  }

  const chain: Record<string, unknown> = {
    select() {
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
      orderColumn = col;
      orderAscending = opts?.ascending !== false;
      return chain;
    },
    range(from: number, to: number) {
      requestedRange = [from, to];
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve({ data: apply()[0] ?? null, error: null }),
    then(onFulfilled?: (value: unknown) => unknown): Promise<unknown> {
      const message = options.errors?.[tableName];
      return Promise.resolve({
        data: message ? null : apply(),
        error: message ? { message } : null,
      }).then(onFulfilled);
    },
  };
  return chain;
}

function mockSupabase(tables: StubTables, options: StubOptions = {}): void {
  const client = {
    from: (t: keyof StubTables) => buildQuery(t, tables, options),
  };
  vi.mocked(createServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createServerClient>>,
  );
}

function scaledTables(rowCount: number, propertyCount = 1): StubTables {
  const properties = Array.from({ length: propertyCount }, (_, index) => ({
    id: `prop-${String(index).padStart(4, '0')}`,
    name: `Scale Property ${String(index).padStart(4, '0')}`,
    address_city: 'Test City',
    address_state: 'VA',
  }));
  const units = Array.from({ length: rowCount }, (_, index) => ({
    id: `unit-${String(index).padStart(5, '0')}`,
    property_id: properties[Math.floor(index / Math.max(rowCount / propertyCount, 1))]?.id
      ?? properties.at(-1)!.id,
    label: index === rowCount - 1 ? 'LAST-UNIT-SENTINEL' : `Unit ${index}`,
  }));
  const leases = units.map((unit, index) => ({
    id: `lease-${String(index).padStart(5, '0')}`,
    unit_id: unit.id,
    tenant_id: `tenant-${String(index).padStart(5, '0')}`,
    rent_amount: 1000,
    end_date: '2099-01-01',
    status: 'active',
  }));
  const tenants = leases.map((lease, index) => ({
    id: lease.tenant_id,
    full_name: index === rowCount - 1 ? 'LAST-TENANT-SENTINEL' : `Tenant ${index}`,
  }));
  const rent_events = leases.map((lease) => ({
    lease_id: lease.id,
    cycle_month: currentCycleMonth(),
    amount_due: 1000,
    amount_paid: 1000,
    status: 'paid',
    due_date: '2020-01-01',
  }));
  const work_orders = units.map((unit, index) => ({
    id: `wo-${String(index).padStart(5, '0')}`,
    unit_id: unit.id,
    category: 'general',
    urgency: 'routine',
    status: 'open',
  }));
  return { properties, units, leases, tenants, rent_events, work_orders };
}

/** Mirrors the query module's cycle key: `YYYY-MM-01` for this month (UTC). */
function currentCycleMonth(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-01`;
}

const PROP = 'prop-1';

/**
 * A single-property portfolio whose only active lease carries the given
 * current-cycle rent event. Keeps work orders empty so rent is the sole signal.
 */
function singlePropertyTables(
  rentEvent: Record<string, unknown>,
): StubTables {
  return {
    properties: [
      {
        id: PROP,
        name: 'Maple Court',
        address_street: '12 Maple Court',
        address_city: 'Reston',
        address_state: 'VA',
        address_zip: '20190',
      },
    ],
    units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
    leases: [
      {
        id: 'lease-1',
        unit_id: 'unit-1',
        tenant_id: 'tenant-1',
        rent_amount: 2000,
        end_date: '2099-01-01',
        status: 'active',
      },
    ],
    tenants: [{ id: 'tenant-1', full_name: 'Marcus Lee' }],
    work_orders: [],
    rent_events: [rentEvent],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getProperties (operator signals)', () => {
  it('flags rentLate + outstanding balance for a stale past-due cycle', async () => {
    mockSupabase(
      singlePropertyTables({
        lease_id: 'lease-1',
        cycle_month: currentCycleMonth(),
        amount_due: 2000,
        amount_paid: 0,
        // Stale enum + past due_date — canonical derivation must read it late.
        status: 'pending',
        due_date: '2020-01-01',
      }),
    );

    const card = (await getProperties())[0];

    expect(card.signals.rentLate).toBe(true);
    expect(card.signals.maintenanceOpen).toBe(false);
    expect(card.signals.vacant).toBe(false);
    expect(card.signals.needsAttention).toBe(true);
    // $2,000 owed → 200,000 cents; exactly one cycle is outstanding.
    expect(card.outstandingCents).toBe(200000);
    expect(card.rentIssueCount).toBe(1);
  });

  it('builds searchText from name + location + unit label + tenant name', async () => {
    mockSupabase(
      singlePropertyTables({
        lease_id: 'lease-1',
        cycle_month: currentCycleMonth(),
        amount_due: 2000,
        amount_paid: 0,
        status: 'pending',
        due_date: '2020-01-01',
      }),
    );

    const card = (await getProperties())[0];

    // Lowercased corpus — each part the panel search needs to match on.
    expect(card.searchText).toContain('maple court');
    expect(card.searchText).toContain('reston');
    expect(card.searchText).toContain('apt 1a');
    expect(card.searchText).toContain('marcus lee');
  });

  it('maps the recorded address and unit-level lease, rent, and open-work evidence', async () => {
    const tables = singlePropertyTables({
      lease_id: 'lease-1',
      cycle_month: currentCycleMonth(),
      amount_due: 2000,
      amount_paid: 2000,
      status: 'paid',
      due_date: '2020-01-01',
    });
    tables.work_orders = [
      {
        id: 'wo-1',
        unit_id: 'unit-1',
        category: 'plumbing',
        urgency: 'routine',
        status: 'open',
      },
    ];
    mockSupabase(tables);

    const card = (await getProperties())[0];

    expect(card.address).toBe('12 Maple Court · Reston, VA 20190');
    expect(card.unitCount).toBe(1);
    expect(card.occupiedUnitCount).toBe(1);
    expect(card.units).toEqual([
      {
        id: 'unit-1',
        label: 'Apt 1A',
        tenantName: 'Marcus Lee',
        occupancy: 'occupied',
        leaseEnd: '2099-01-01',
        rentState: 'current',
        openWorkCount: 1,
        openIssue: 'Plumbing',
      },
    ]);
  });

  it('reports a calm property with no rent signal and zero outstanding', async () => {
    mockSupabase(
      singlePropertyTables({
        lease_id: 'lease-1',
        cycle_month: currentCycleMonth(),
        amount_due: 2000,
        amount_paid: 2000,
        status: 'paid',
        due_date: '2020-01-01',
      }),
    );

    const card = (await getProperties())[0];

    expect(card.status).toBe('calm');
    expect(card.signals.rentLate).toBe(false);
    expect(card.signals.needsAttention).toBe(false);
    expect(card.outstandingCents).toBe(0);
    expect(card.rentIssueCount).toBe(0);
  });
});

describe('getPortfolioSummary (attention breakdown)', () => {
  it('sums the rent attention bucket from the same aggregate', async () => {
    mockSupabase(
      singlePropertyTables({
        lease_id: 'lease-1',
        cycle_month: currentCycleMonth(),
        amount_due: 2000,
        amount_paid: 0,
        status: 'pending',
        due_date: '2020-01-01',
      }),
    );

    const summary = await getPortfolioSummary();

    expect(summary.attention.rent).toBe(1);
    expect(summary.attention.maintenance).toBe(0);
    expect(summary.attention.total).toBeGreaterThanOrEqual(1);
  });

  it.each([999, 1000, 1001, 1210, 2001])(
    'reconciles every related row at the %i boundary despite a 1,000-row response cap',
    async (rowCount) => {
      mockSupabase(scaledTables(rowCount), { maxRows: 1000 });

      const [summary, cards, tabs] = await Promise.all([
        getPortfolioSummary(),
        getProperties(),
        getTabs(),
      ]);

      expect(summary.units).toBe(rowCount);
      expect(summary.occupancy).toBe('100%');
      expect(summary.mrr).toBe(`$${(rowCount * 1000).toLocaleString('en-US')}`);
      expect(summary.attention.maintenance).toBe(rowCount);
      expect(tabs.find((tab) => tab.id === 'tenants')?.count).toBe(rowCount);
      expect(cards.some((card) => card.searchText.includes('last-unit-sentinel'))).toBe(true);
      expect(cards.some((card) => card.searchText.includes('last-tenant-sentinel'))).toBe(true);
    },
  );

  it('reconciles a 200-property / 1,200-row fixture at exactly 6/6 occupied per property', async () => {
    mockSupabase(scaledTables(1200, 200), { maxRows: 1000 });

    const [summary, cards] = await Promise.all([
      getPortfolioSummary(),
      getProperties(),
    ]);

    expect(summary).toMatchObject({
      properties: 200,
      units: 1200,
      occupancy: '100%',
      mrr: '$1,200,000',
    });
    expect(cards).toHaveLength(200);
    expect(cards.every((card) => card.stats[0]?.value === '6/6')).toBe(true);
    expect(cards.some((card) => card.searchText.includes('last-tenant-sentinel'))).toBe(true);
  });

  it.each(['units', 'leases', 'work_orders', 'rent_events', 'tenants', 'vendors'] as const)(
    'surfaces a %s child-query failure instead of returning plausible totals',
    async (table) => {
      mockSupabase(scaledTables(2), {
        errors: { [table]: `forced ${table} failure` },
      });

      const operation = table === 'vendors' ? getTabs() : getPortfolioSummary();
      await expect(operation).rejects.toThrow(
        `Failed to load portfolio ${table}`,
      );
    },
  );
});
