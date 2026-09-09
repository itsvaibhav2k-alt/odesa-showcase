/**
 * Unit tests for the data-backed `badgeReasons` field added to the property
 * brief in `src/lib/properties/brief-queries.ts`.
 *
 * Contract under test:
 *   - calm property  → `badge.variant === 'calm'` and `badgeReasons === []`,
 *   - at-risk property (late rent) → non-empty reasons, ordered most-severe
 *     first (outstanding rent before unit follow-up), every string backed by a
 *     real number already computed in the assembler.
 *
 * `getPropertyBrief` opens its own client and ALSO calls `getProperty`, which
 * opens a second client — so the stub is installed with `mockResolvedValue`
 * (persistent), and `.from()` mints a fresh chain per call. The chainable
 * stub mirrors `./queries.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { getPropertyBrief } from '@/lib/properties/brief-queries';

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

function buildQuery(tableName: keyof StubTables, tables: StubTables): unknown {
  const predicates: Predicate[] = [];
  let orderColumn: string | null = null;
  let orderAscending = true;

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
    order(col: string, opts?: { ascending?: boolean }) {
      orderColumn = col;
      orderAscending = opts?.ascending !== false;
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve({ data: apply()[0] ?? null, error: null }),
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

function baseTables(rentEvent: Record<string, unknown>): StubTables {
  return {
    properties: [
      {
        id: PROP,
        name: 'Oakhaven',
        address_city: 'Reston',
        address_state: 'VA',
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
    vendors: [],
    rent_events: [rentEvent],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPropertyBrief badgeReasons', () => {
  it('returns an empty array for an operationally calm property', async () => {
    mockSupabase(
      baseTables({
        lease_id: 'lease-1',
        cycle_month: currentCycleMonth(),
        amount_due: 2000,
        amount_paid: 2000,
        status: 'paid',
        due_date: '2020-01-01',
      }),
    );

    const brief = await getPropertyBrief(PROP);

    expect(brief).not.toBeNull();
    expect(brief?.badge.variant).toBe('calm');
    expect(brief?.badgeReasons).toEqual([]);
  });

  it('returns ordered, data-backed reasons for an at-risk property', async () => {
    mockSupabase(
      baseTables({
        lease_id: 'lease-1',
        cycle_month: currentCycleMonth(),
        amount_due: 2000,
        amount_paid: 0,
        // Stale enum + past due — canonical derivation reads it late → at risk.
        status: 'reminder_sent',
        due_date: '2020-01-01',
      }),
    );

    const brief = await getPropertyBrief(PROP);

    expect(brief?.badge.variant).toBe('atrisk');
    expect(brief?.badgeReasons.length).toBeGreaterThan(0);
    // Most-severe first: the outstanding dollar figure leads.
    expect(brief?.badgeReasons[0]).toBe('$2,000 rent outstanding');
    expect(brief?.badgeReasons).toContain('1 unit needs rent follow-up');
  });
});
