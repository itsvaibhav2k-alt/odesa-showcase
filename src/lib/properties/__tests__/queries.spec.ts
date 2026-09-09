/**
 * Unit tests for the Wave 8 additions to `src/lib/properties/queries.ts`:
 *   - listMaintenanceTicketsForProperty
 *   - listRentPaymentsForProperty
 *
 * We mock the `@/lib/supabase/server` module with a chainable stub that
 * mirrors the subset of supabase-js the queries use (select / eq / in /
 * order). The shape follows the pattern in
 * `src/lib/inbox/__tests__/conversation-queries.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import {
  getProperty,
  listProperties,
  listMaintenanceTicketsForProperty,
  listRentPaymentsForProperty,
  listUnitsForProperty,
  listUnitsTableRowsForProperty,
} from '@/lib/properties/queries';
import { getPropertyBrief } from '@/lib/properties/brief-queries';
import { getUnitBrief } from '@/lib/properties/unit-detail-queries';
import { getProperties } from '@/lib/properties/portfolio-queries';

// ---------------------------------------------------------------------------
// Stub builder — chainable supabase mock
// ---------------------------------------------------------------------------

interface Tables {
  maintenance_tickets?: ReadonlyArray<Record<string, unknown>>;
  properties?: ReadonlyArray<Record<string, unknown>>;
  units?: ReadonlyArray<Record<string, unknown>>;
  leases?: ReadonlyArray<Record<string, unknown>>;
  rent_payments?: ReadonlyArray<Record<string, unknown>>;
  tenants?: ReadonlyArray<Record<string, unknown>>;
  rent_events?: ReadonlyArray<Record<string, unknown>>;
  work_orders?: ReadonlyArray<Record<string, unknown>>;
}

interface Predicate {
  kind: 'eq' | 'in' | 'lte';
  column: string;
  value: unknown;
}

function buildSupabaseStub(tables: Tables): unknown {
  return { from: (t: keyof Tables) => buildQuery(t, tables) };
}

function buildQuery(tableName: keyof Tables, tables: Tables): unknown {
  const predicates: Predicate[] = [];
  let orderColumn: string | null = null;
  let orderAscending = true;

  function apply(): Record<string, unknown>[] {
    let rows = [...(tables[tableName] ?? [])];
    for (const p of predicates) {
      if (p.kind === 'eq') {
        rows = rows.filter((r) => r[p.column] === p.value);
      } else if (p.kind === 'lte') {
        rows = rows.filter((r) => (r[p.column] as string) <= (p.value as string));
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
    return rows;
  }

  let limitCount: number | null = null;
  let requestedRange: [number, number] | null = null;

  const chain = {
    select() { return chain; },
    eq(col: string, value: unknown) {
      predicates.push({ kind: 'eq', column: col, value });
      return chain;
    },
    in(col: string, value: unknown[]) {
      predicates.push({ kind: 'in', column: col, value });
      return chain;
    },
    lte(col: string, value: unknown) {
      predicates.push({ kind: 'lte', column: col, value });
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderColumn = col;
      orderAscending = opts?.ascending !== false;
      return chain;
    },
    limit(n: number) {
      limitCount = n;
      return chain;
    },
    range(from: number, to: number) {
      requestedRange = [from, to];
      return chain;
    },
    maybeSingle(): Promise<unknown> {
      const rows = apply();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    },
    then(onFulfilled?: (value: unknown) => unknown): Promise<unknown> {
      let rows = apply();
      if (limitCount != null) rows = rows.slice(0, limitCount);
      if (requestedRange) rows = rows.slice(requestedRange[0], requestedRange[1] + 1);
      return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
    },
  };
  return chain;
}

function mockClient(tables: Tables): void {
  const supabase = buildSupabaseStub(tables);
  vi.mocked(createServerClient).mockResolvedValueOnce(
    supabase as Awaited<ReturnType<typeof createServerClient>>,
  );
}

const ORG = 'org-1';
const PROP = 'prop-1';

/** Mirrors the query modules' cycle key: `YYYY-MM-01` for this month (UTC). */
function currentCycleMonth(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-01`;
}

/** work_orders-shaped row — the canonical maintenance table the room now reads. */
function makeWorkOrder(o: {
  id: string;
  status: 'open' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
  organization_id?: string;
  unit_id?: string;
  urgency?: 'emergency' | 'urgent' | 'routine';
  source?: string;
}): Record<string, unknown> {
  return {
    id: o.id,
    organization_id: o.organization_id ?? ORG,
    unit_id: o.unit_id ?? 'unit-1',
    description: `desc ${o.id}`,
    category: 'plumbing',
    urgency: o.urgency ?? 'routine',
    status: o.status,
    created_at: o.created_at,
    status_timeline: o.source ? [{ source: o.source }] : [],
  };
}

function makePayment(o: {
  id: string;
  lease_id: string;
  amount_cents: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'canceled';
  created_at: string;
  paid_at?: string | null;
}): Record<string, unknown> {
  return {
    id: o.id,
    organization_id: ORG,
    lease_id: o.lease_id,
    amount_cents: o.amount_cents,
    status: o.status,
    created_at: o.created_at,
    paid_at: o.paid_at ?? null,
    receipt_url: null,
    payment_link_url: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listMaintenanceTicketsForProperty
// ---------------------------------------------------------------------------

describe('listMaintenanceTicketsForProperty', () => {
  it('returns an empty array when the property has no units', async () => {
    mockClient({ units: [] });
    expect(await listMaintenanceTicketsForProperty(ORG, PROP)).toEqual([]);
  });

  it('reads work_orders via the property units and maps them to ticket rows', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      work_orders: [
        makeWorkOrder({
          id: 'wo1',
          status: 'open',
          urgency: 'emergency',
          source: 'retell_voice',
          created_at: '2026-05-01T10:00:00.000Z',
        }),
      ],
    });

    const result = await listMaintenanceTicketsForProperty(ORG, PROP);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'wo1',
      unitId: 'unit-1',
      unitLabel: 'Apt 1A',
      status: 'open',
      severity: 'urgent', // emergency → urgent
      reportedBy: 'Voice call', // status_timeline source
    });
  });

  it('orders by status priority (open > in_progress > resolved) then newest-first', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      work_orders: [
        makeWorkOrder({ id: 'resolved-new', status: 'completed', created_at: '2026-05-05T10:00:00.000Z' }),
        makeWorkOrder({ id: 'open-old', status: 'open', created_at: '2026-05-01T10:00:00.000Z' }),
        makeWorkOrder({ id: 'in-progress-mid', status: 'in_progress', created_at: '2026-05-03T10:00:00.000Z' }),
        makeWorkOrder({ id: 'open-new', status: 'open', created_at: '2026-05-04T10:00:00.000Z' }),
      ],
    });

    const result = await listMaintenanceTicketsForProperty(ORG, PROP);
    expect(result.map((r) => r.id)).toEqual([
      'open-new',
      'open-old',
      'in-progress-mid',
      'resolved-new', // completed → resolved
    ]);
  });

  it('scopes by organization_id and to units of the property', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      work_orders: [
        makeWorkOrder({ id: 'mine', status: 'open', created_at: '2026-05-04T10:00:00.000Z' }),
        makeWorkOrder({
          id: 'other-org',
          status: 'open',
          created_at: '2026-05-04T10:00:00.000Z',
          organization_id: 'org-2',
        }),
        makeWorkOrder({
          id: 'other-unit', // unit not belonging to this property → excluded
          status: 'open',
          created_at: '2026-05-04T10:00:00.000Z',
          unit_id: 'unit-99',
        }),
      ],
    });

    const result = await listMaintenanceTicketsForProperty(ORG, PROP);
    expect(result.map((r) => r.id)).toEqual(['mine']);
  });
});

// ---------------------------------------------------------------------------
// listRentPaymentsForProperty
// ---------------------------------------------------------------------------

describe('listRentPaymentsForProperty', () => {
  it('returns empty rows and empty totals when the property has no units', async () => {
    mockClient({ units: [] });
    const result = await listRentPaymentsForProperty(ORG, PROP);
    expect(result.rows).toEqual([]);
    expect(result.totalsByMonth).toEqual({});
  });

  it('returns empty rows when no leases exist for the property units', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'A', property_id: PROP }],
      leases: [],
    });
    const result = await listRentPaymentsForProperty(ORG, PROP);
    expect(result.rows).toEqual([]);
    expect(result.totalsByMonth).toEqual({});
  });

  it('joins lease -> unit + tenant and orders payments newest-first', async () => {
    mockClient({
      units: [
        { id: 'unit-1', label: 'Apt 1A', property_id: PROP },
        { id: 'unit-2', label: 'Apt 2B', property_id: PROP },
      ],
      leases: [
        { id: 'lease-1', unit_id: 'unit-1', tenant_id: 'tenant-1' },
        { id: 'lease-2', unit_id: 'unit-2', tenant_id: 'tenant-2' },
      ],
      tenants: [
        { id: 'tenant-1', full_name: 'Marcus Lee' },
        { id: 'tenant-2', full_name: 'Elena Park' },
      ],
      rent_payments: [
        makePayment({
          id: 'p-old',
          lease_id: 'lease-1',
          amount_cents: 240000,
          status: 'succeeded',
          created_at: '2026-04-05T10:00:00.000Z',
          paid_at: '2026-04-05T10:00:00.000Z',
        }),
        makePayment({
          id: 'p-new',
          lease_id: 'lease-2',
          amount_cents: 180000,
          status: 'succeeded',
          created_at: '2026-05-03T10:00:00.000Z',
          paid_at: '2026-05-03T10:00:00.000Z',
        }),
      ],
    });

    const result = await listRentPaymentsForProperty(ORG, PROP);
    expect(result.rows.map((r) => r.id)).toEqual(['p-new', 'p-old']);
    expect(result.rows[0]).toMatchObject({
      id: 'p-new',
      tenantName: 'Elena Park',
      unitLabel: 'Apt 2B',
      amountCents: 180000,
    });
    expect(result.rows[1]).toMatchObject({
      id: 'p-old',
      tenantName: 'Marcus Lee',
      unitLabel: 'Apt 1A',
    });
  });

  it('totals succeeded payments by paid-at month and excludes other statuses', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'A', property_id: PROP }],
      leases: [{ id: 'lease-1', unit_id: 'unit-1', tenant_id: 'tenant-1' }],
      tenants: [{ id: 'tenant-1', full_name: 'Tenant One' }],
      rent_payments: [
        makePayment({
          id: 'apr-1',
          lease_id: 'lease-1',
          amount_cents: 200000,
          status: 'succeeded',
          created_at: '2026-04-05T10:00:00.000Z',
          paid_at: '2026-04-06T10:00:00.000Z',
        }),
        makePayment({
          id: 'may-1',
          lease_id: 'lease-1',
          amount_cents: 210000,
          status: 'succeeded',
          created_at: '2026-05-01T10:00:00.000Z',
          paid_at: '2026-05-01T10:00:00.000Z',
        }),
        makePayment({
          id: 'may-pending',
          lease_id: 'lease-1',
          amount_cents: 50000,
          status: 'pending',
          created_at: '2026-05-02T10:00:00.000Z',
        }),
        makePayment({
          id: 'apr-2',
          lease_id: 'lease-1',
          amount_cents: 5000,
          status: 'succeeded',
          created_at: '2026-04-20T10:00:00.000Z',
          paid_at: '2026-04-20T10:00:00.000Z',
        }),
      ],
    });

    const result = await listRentPaymentsForProperty(ORG, PROP);
    expect(result.totalsByMonth).toEqual({
      '2026-04': 205000,
      '2026-05': 210000,
    });
    expect(result.rows.map((r) => r.id)).toContain('may-pending');
  });
});

// ---------------------------------------------------------------------------
// listUnitsTableRowsForProperty
// ---------------------------------------------------------------------------

describe('listUnitsTableRowsForProperty', () => {
  it('returns an empty array when the property has no units', async () => {
    mockClient({ units: [] });
    expect(await listUnitsTableRowsForProperty(PROP)).toEqual([]);
  });

  it('marks unleased units as vacant and reports zero open maint', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [],
      maintenance_tickets: [],
      rent_payments: [],
      tenants: [],
      rent_events: [],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'unit-1',
      label: 'Apt 1A',
      tenantName: null,
      rentAmountCents: null,
      status: 'vacant',
      lastPaymentDate: null,
      openMaintCount: 0,
    });
  });

  it('joins active lease tenant + rent and last succeeded payment date', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [
        {
          id: 'lease-1',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 2400,
          end_date: '2099-01-01',
          status: 'active',
        },
      ],
      tenants: [{ id: 'tenant-1', full_name: 'Marcus Lee' }],
      maintenance_tickets: [],
      rent_payments: [
        {
          lease_id: 'lease-1',
          paid_at: '2026-04-05T10:00:00.000Z',
          status: 'succeeded',
        },
        {
          lease_id: 'lease-1',
          paid_at: '2026-05-03T10:00:00.000Z',
          status: 'succeeded',
        },
        {
          lease_id: 'lease-1',
          paid_at: '2026-05-04T10:00:00.000Z',
          status: 'pending',
        },
      ],
      rent_events: [],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);
    expect(rows[0]).toMatchObject({
      id: 'unit-1',
      tenantName: 'Marcus Lee',
      rentAmountCents: 240000,
      status: 'occupied',
      // newest succeeded paid_at — pending ignored.
      lastPaymentDate: '2026-05-03T10:00:00.000Z',
      openMaintCount: 0,
    });
  });

  it('counts open + in_progress tickets per unit and ignores resolved', async () => {
    mockClient({
      units: [
        { id: 'unit-1', label: 'Apt 1A', property_id: PROP },
        { id: 'unit-2', label: 'Apt 2B', property_id: PROP },
      ],
      leases: [],
      maintenance_tickets: [
        { id: 't1', unit_id: 'unit-1', status: 'open' },
        { id: 't2', unit_id: 'unit-1', status: 'in_progress' },
        { id: 't3', unit_id: 'unit-1', status: 'resolved' },
        { id: 't4', unit_id: 'unit-2', status: 'open' },
      ],
      rent_payments: [],
      tenants: [],
      rent_events: [],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('unit-1')?.openMaintCount).toBe(2);
    expect(byId.get('unit-2')?.openMaintCount).toBe(1);
  });

  it('flags `notice` when the current cycle is date-late — even with a stale `pending` enum', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [
        {
          id: 'lease-late',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 2000,
          end_date: '2099-01-01',
          status: 'active',
        },
      ],
      tenants: [{ id: 'tenant-1', full_name: 'Tenant One' }],
      maintenance_tickets: [],
      rent_payments: [],
      rent_events: [
        {
          lease_id: 'lease-late',
          status: 'pending',
          cycle_month: currentCycleMonth(),
          due_date: '2020-01-01',
          amount_due: 2000,
          amount_paid: 0,
        },
      ],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);
    expect(rows[0].status).toBe('notice');
  });

  it('never flags `plan_agreed` as notice — a payment plan is not late', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [
        {
          id: 'lease-plan',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 2000,
          end_date: '2099-01-01',
          status: 'active',
        },
      ],
      tenants: [{ id: 'tenant-1', full_name: 'Tenant One' }],
      maintenance_tickets: [],
      rent_payments: [],
      rent_events: [
        {
          lease_id: 'lease-plan',
          status: 'plan_agreed',
          cycle_month: currentCycleMonth(),
          due_date: '2020-01-01',
          amount_due: 2000,
          amount_paid: 500,
        },
      ],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);
    expect(rows[0].status).toBe('occupied');
  });

  it('marks a pending-lease unit `pending` with its tenant — never vacant', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [
        {
          id: 'lease-pending',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 1800,
          end_date: null,
          status: 'pending',
        },
      ],
      tenants: [{ id: 'tenant-1', full_name: 'Nora Patel' }],
      maintenance_tickets: [],
      rent_payments: [],
      rent_events: [],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      tenantName: 'Nora Patel',
      rentAmountCents: 180000,
    });
  });
});

// ---------------------------------------------------------------------------
// listUnitsForProperty (unit grid)
// ---------------------------------------------------------------------------

describe('listUnitsForProperty', () => {
  it('marks a pending-lease unit `pending`, not vacant', async () => {
    mockClient({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [
        {
          id: 'lease-pending',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 1800,
          end_date: null,
          status: 'pending',
        },
      ],
      tenants: [{ id: 'tenant-1', full_name: 'Nora Patel' }],
      rent_events: [],
    });

    const cards = await listUnitsForProperty(PROP);
    expect(cards[0]).toMatchObject({
      status: 'pending',
      tenantName: 'Nora Patel',
    });
  });

  it('marks a unit with no leases vacant and a date-late active lease late', async () => {
    mockClient({
      units: [
        { id: 'unit-1', label: 'Apt 1A', property_id: PROP },
        { id: 'unit-2', label: 'Apt 2B', property_id: PROP },
      ],
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
      tenants: [{ id: 'tenant-1', full_name: 'Tenant One' }],
      rent_events: [
        {
          lease_id: 'lease-1',
          status: 'reminder_sent',
          cycle_month: currentCycleMonth(),
          due_date: '2020-01-01',
          amount_due: 2000,
          amount_paid: 0,
        },
      ],
    });

    const cards = await listUnitsForProperty(PROP);
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.get('unit-1')?.status).toBe('late');
    expect(byId.get('unit-2')?.status).toBe('vacant');
  });
});

// ---------------------------------------------------------------------------
// getProperties — canonical date-aware rent signals (portfolio cards)
// ---------------------------------------------------------------------------

describe('getProperties (date-aware rent signals)', () => {
  const portfolioTables = (rentEvent: Record<string, unknown>) => ({
    properties: [
      { id: PROP, name: 'Vaba', address_city: 'Reston', address_state: 'VA' },
    ],
    units: [{ id: 'unit-1', label: '1A', property_id: PROP }],
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
    work_orders: [],
    rent_events: [rentEvent],
  });

  it('treats a stale `pending` cycle past its due date as late', async () => {
    mockClient(portfolioTables({
      lease_id: 'lease-1',
      cycle_month: currentCycleMonth(),
      amount_due: 2000,
      amount_paid: 0,
      status: 'pending',
      due_date: '2020-01-01',
    }));

    const cards = await getProperties();
    expect(cards[0].status).toBe('watching');
    expect(cards[0].summaryLead).toBe('Rent late');
    const rentIssue = cards[0].issues.find((i) => i.text.includes('rent late'));
    expect(rentIssue?.meta).toMatch(/\d+ days? late/);
  });

  it('never treats `plan_agreed` as late — payment plans are not a rent issue', async () => {
    mockClient(portfolioTables({
      lease_id: 'lease-1',
      cycle_month: currentCycleMonth(),
      amount_due: 2000,
      amount_paid: 500,
      status: 'plan_agreed',
      due_date: '2020-01-01',
    }));

    const cards = await getProperties();
    expect(cards[0].status).toBe('calm');
    expect(cards[0].issues).toEqual([
      { tone: 'allclear', glyph: '✓', text: 'All clear' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getUnitBrief — occupancy + on-plan rendering
// ---------------------------------------------------------------------------

describe('getUnitBrief (occupancy + payment plan)', () => {
  it('renders a pending-lease unit as "Lease pending", never vacant', async () => {
    mockClient({
      units: [
        {
          id: 'unit-1',
          label: '1A',
          bedrooms: 1,
          bathrooms: 1,
          square_feet: 600,
          property_id: PROP,
        },
      ],
      properties: [
        { id: PROP, name: 'Vaba', address_city: 'Reston', address_state: 'VA' },
      ],
      leases: [
        {
          id: 'lease-pending',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 1800,
          start_date: '2026-07-01',
          end_date: null,
          status: 'pending',
          late_fee_policy: null,
        },
      ],
      tenants: [],
      rent_events: [],
    });

    const brief = await getUnitBrief('unit-1');
    expect(brief).not.toBeNull();
    expect(brief?.badge).toEqual({ variant: 'leasing', label: 'Lease pending' });
    expect(brief?.meta).toContain('lease pending');
    expect(brief?.attention[0]?.detail).toBe('Lease pending — move-in being set up');
    expect(brief?.metrics[0]).toMatchObject({ label: 'Occupancy', value: 'Lease pending' });
    expect(JSON.stringify(brief).toLowerCase()).not.toContain('"vacant"');
  });

  it('shows an on-plan balance with a Payment plan pill, not "Rent late"', async () => {
    mockClient({
      units: [
        {
          id: 'unit-1',
          label: '1A',
          bedrooms: 1,
          bathrooms: 1,
          square_feet: 600,
          property_id: PROP,
        },
      ],
      properties: [
        { id: PROP, name: 'Vaba', address_city: 'Reston', address_state: 'VA' },
      ],
      leases: [
        {
          id: 'lease-1',
          unit_id: 'unit-1',
          tenant_id: 'tenant-1',
          rent_amount: 2000,
          start_date: '2025-01-01',
          end_date: '2099-01-01',
          status: 'active',
          late_fee_policy: null,
        },
      ],
      tenants: [
        { id: 'tenant-1', full_name: 'Nora Patel', phone_e164: '+15555550100' },
      ],
      rent_events: [
        {
          lease_id: 'lease-1',
          cycle_month: currentCycleMonth(),
          amount_due: 2000,
          amount_paid: 500,
          status: 'plan_agreed',
          due_date: '2020-01-01',
        },
      ],
    });

    const brief = await getUnitBrief('unit-1');
    expect(brief?.tenant.pill).toEqual({ variant: 'plan', label: 'Payment plan' });
    expect(brief?.badge.label).toBe('Payment plan');
    const kinds = (brief?.attention ?? []).map((a) => a.kind);
    expect(kinds).toContain('Payment plan');
    expect(kinds).not.toContain('Rent late');
    // Balance still shown honestly.
    expect(brief?.metrics[2]).toMatchObject({ label: 'Balance', value: '$1,500', tone: 'warn' });
  });
});

// ---------------------------------------------------------------------------
// Primary-query failure surfacing
//
// Each entry fetcher's PRIMARY query (the row the page depends on) must reject
// on a real DB error so the route's error boundary becomes reachable, while a
// genuinely missing row (data null, error null via maybeSingle) keeps the prior
// not-found behavior (resolves null / empty).
// ---------------------------------------------------------------------------

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

const BOOM: TableResult = { data: null, error: { message: 'boom' } };
const MISSING: TableResult = { data: null, error: null };

/**
 * Mocks `createServerClient` so every query against `targetTable` settles with
 * `result`, while any other table settles empty. Drives the entry fetchers'
 * primary query down the error vs. missing-row branch. Uses `mockResolvedValue`
 * (not `...Once`) so transitive fetchers that open more than one client (e.g.
 * `getPropertyBrief` → `getProperty`) all observe the same stub.
 */
function mockPrimaryResult(targetTable: string, result: TableResult): void {
  function makeChain(table: string) {
    const settled: TableResult =
      table === targetTable ? result : { data: [], error: null };
    const single: TableResult =
      table === targetTable ? result : { data: null, error: null };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      range: () => chain,
      limit: () => chain,
      maybeSingle: async () => single,
      then: (onFulfilled: (value: TableResult) => unknown) =>
        Promise.resolve(settled).then(onFulfilled),
    };
    return chain;
  }

  vi.mocked(createServerClient).mockResolvedValue({
    from: (table: string) => makeChain(table),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

describe('primary-query failure surfacing', () => {
  describe('getProperty', () => {
    it('rejects when the properties query returns an error', async () => {
      mockPrimaryResult('properties', BOOM);
      await expect(getProperty('prop-1')).rejects.toThrow(
        'Failed to load property: boom',
      );
    });

    it('resolves null when the property row is genuinely missing', async () => {
      mockPrimaryResult('properties', MISSING);
      expect(await getProperty('missing')).toBeNull();
    });
  });

  describe('listProperties', () => {
    it('rejects when the properties query returns an error', async () => {
      mockPrimaryResult('properties', BOOM);
      await expect(listProperties()).rejects.toThrow(
        'Failed to load properties: boom',
      );
    });

    it('resolves an empty list when no properties exist', async () => {
      mockPrimaryResult('properties', MISSING);
      expect(await listProperties()).toEqual([]);
    });
  });

  describe('getProperties (portfolio cards)', () => {
    it('rejects when the properties query returns an error', async () => {
      mockPrimaryResult('properties', BOOM);
      await expect(getProperties()).rejects.toThrow(
        'Failed to load portfolio properties: boom',
      );
    });

    it('resolves an empty list when no properties exist', async () => {
      // PostgREST collection reads return [], not null, for a genuine zero-row result.
      mockPrimaryResult('properties', { data: [], error: null });
      expect(await getProperties()).toEqual([]);
    });
  });

  describe('getUnitBrief', () => {
    it('rejects when the units query returns an error', async () => {
      mockPrimaryResult('units', BOOM);
      await expect(getUnitBrief('unit-1')).rejects.toThrow(
        'Failed to load unit: boom',
      );
    });

    it('resolves null when the unit row is genuinely missing', async () => {
      mockPrimaryResult('units', MISSING);
      expect(await getUnitBrief('missing')).toBeNull();
    });
  });

  describe('getPropertyBrief', () => {
    it('rejects when its primary gate (getProperty) errors', async () => {
      mockPrimaryResult('properties', BOOM);
      await expect(getPropertyBrief('prop-1')).rejects.toThrow(
        'Failed to load property: boom',
      );
    });

    it('resolves null when the property row is genuinely missing', async () => {
      mockPrimaryResult('properties', MISSING);
      expect(await getPropertyBrief('missing')).toBeNull();
    });
  });
});
