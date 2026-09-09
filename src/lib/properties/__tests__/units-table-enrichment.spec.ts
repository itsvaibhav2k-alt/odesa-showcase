/**
 * Unit tests for the Pass 5 operator-row enrichment on
 * `listUnitsTableRowsForProperty` (`src/lib/properties/queries.ts`).
 *
 * Covers the fields the property UnitsPanel needs to render a balance line and
 * target the existing RecordPaymentModal:
 *   - `outstandingDollars` (canonical balance in DOLLARS),
 *   - `daysLate` (date-aware, 0 when not late),
 *   - `currentRentEventId` (the rent_events row id — the record-payment target).
 *
 * The chainable supabase stub mirrors `./queries.spec.ts`; the existing spec
 * already covers vacant/pending/notice status, so these tests focus purely on
 * the new numeric/id enrichment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { listUnitsTableRowsForProperty } from '@/lib/properties/queries';

// ---------------------------------------------------------------------------
// Chainable supabase stub (select / eq / in / order / await)
// ---------------------------------------------------------------------------

interface StubTables {
  units?: ReadonlyArray<Record<string, unknown>>;
  leases?: ReadonlyArray<Record<string, unknown>>;
  tenants?: ReadonlyArray<Record<string, unknown>>;
  rent_events?: ReadonlyArray<Record<string, unknown>>;
  rent_payments?: ReadonlyArray<Record<string, unknown>>;
  maintenance_tickets?: ReadonlyArray<Record<string, unknown>>;
}

interface Predicate {
  kind: 'eq' | 'in' | 'lte';
  column: string;
  value: unknown;
}

function buildQuery(tableName: keyof StubTables, tables: StubTables): unknown {
  const predicates: Predicate[] = [];
  let orderColumn: string | null = null;
  let orderAscending = true;

  function apply(): Record<string, unknown>[] {
    let rows = [...(tables[tableName] ?? [])] as Record<string, unknown>[];
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
    lte(col: string, value: unknown) {
      predicates.push({ kind: 'lte', column: col, value });
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderColumn = col;
      orderAscending = opts?.ascending !== false;
      return chain;
    },
    then(onFulfilled?: (value: unknown) => unknown): Promise<unknown> {
      return Promise.resolve({ data: apply(), error: null }).then(onFulfilled);
    },
  };
  return chain;
}

function mockSupabase(tables: StubTables): void {
  const client = { from: (t: keyof StubTables) => buildQuery(t, tables) };
  vi.mocked(createServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createServerClient>>,
  );
}

/** Mirrors the query module's cycle key: `YYYY-MM-01` for this month (UTC). */
function currentCycleMonth(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-01`;
}

const PROP = 'prop-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listUnitsTableRowsForProperty (Pass 5 enrichment)', () => {
  it('carries outstanding balance, days-late and the rent_event id for a late active lease', async () => {
    mockSupabase({
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
      rent_payments: [],
      rent_events: [
        {
          id: 're-1',
          lease_id: 'lease-1',
          status: 'reminder_sent',
          cycle_month: currentCycleMonth(),
          due_date: '2020-01-01',
          amount_due: 2400,
          amount_paid: 0,
        },
      ],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'unit-1',
      status: 'notice',
      tenantId: 'tenant-1',
      leaseId: 'lease-1',
      outstandingDollars: 2400,
      currentRentEventId: 're-1',
    });
    // Past-due since 2020 — the date-derived lateness is a large positive count.
    expect(rows[0].daysLate).toBeGreaterThan(0);
  });

  it('exposes a partial outstanding balance without lateness when the cycle is not yet due', async () => {
    mockSupabase({
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
      rent_payments: [],
      rent_events: [
        {
          id: 're-2',
          lease_id: 'lease-1',
          status: 'pending',
          cycle_month: currentCycleMonth(),
          // Due far in the future — partial balance owed, but NOT late.
          due_date: '2099-01-01',
          amount_due: 2400,
          amount_paid: 1000,
        },
      ],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);

    expect(rows[0]).toMatchObject({
      status: 'occupied',
      // $2,400 due - $1,000 paid = $1,400 outstanding.
      outstandingDollars: 1400,
      daysLate: 0,
      currentRentEventId: 're-2',
    });
  });

  it('zeroes the enrichment fields for a vacant unit', async () => {
    mockSupabase({
      units: [{ id: 'unit-1', label: 'Apt 1A', property_id: PROP }],
      leases: [],
      tenants: [],
      maintenance_tickets: [],
      rent_payments: [],
      rent_events: [],
    });

    const rows = await listUnitsTableRowsForProperty(PROP);

    expect(rows[0]).toMatchObject({
      status: 'vacant',
      tenantId: null,
      leaseId: null,
      outstandingDollars: 0,
      daysLate: 0,
      currentRentEventId: null,
    });
  });
});
