/**
 * Unit tests for `src/lib/tenants/queries.ts`.
 *
 * The queries read through `createServerClient()`, so we mock the
 * server module with a small chainable stub that mirrors the subset of
 * supabase-js the queries use (select / eq / in / order / limit /
 * maybeSingle). RLS is implicit — we don't simulate it.
 *
 * The clock is frozen at 2026-06-12 local time so the canonical
 * date-aware lateness derivation (`@/lib/domain`) is deterministic.
 * The headline scenario is the dogfood-audit "Vaibhav case": an unpaid
 * `pending` cycle due Jun 1 must read as BEHIND everywhere — never
 * "good standing" / "rent is current".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTenantDetail, listTenantsDirectory } from '@/lib/tenants/queries';

// ---------------------------------------------------------------------------
// Supabase stub
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface Tables {
  tenants?: readonly Row[];
  leases?: readonly Row[];
  units?: readonly Row[];
  properties?: readonly Row[];
  rent_events?: readonly Row[];
  conversations?: readonly Row[];
  messages?: readonly Row[];
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
    order(col: string, opts?: { ascending?: boolean }) {
      const ascending = opts?.ascending !== false;
      result = [...result].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if ((av as string) < (bv as string)) return ascending ? -1 : 1;
        if ((av as string) > (bv as string)) return ascending ? 1 : -1;
        return 0;
      });
      return chain;
    },
    limit(n: number) {
      result = result.slice(0, n);
      return chain;
    },
    maybeSingle() {
      return Promise.resolve({ data: result[0] ?? null, error: null });
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
// Fixtures — frozen "today" is 2026-06-12
// ---------------------------------------------------------------------------

const TENANT: Row = {
  id: 't1',
  full_name: 'Vaibhav Maddhi',
  phone_e164: '+15550001111',
  email: 'vaibhav@example.test',
};

const LEASE: Row = {
  id: 'l1',
  tenant_id: 't1',
  unit_id: 'u1',
  rent_amount: 2000,
  rent_due_day: 1,
  late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
  start_date: '2025-07-01',
  end_date: '2027-06-30',
  status: 'active',
};

const UNIT: Row = { id: 'u1', label: '2B', property_id: 'p1' };
const PROPERTY: Row = { id: 'p1', name: 'Ranson Apartments' };

/** Unpaid `pending` cycle due Jun 1 — 11 days past due on 2026-06-12. */
const OVERDUE_PENDING_EVENT: Row = {
  lease_id: 'l1',
  status: 'pending',
  cycle_month: '2026-06-01',
  due_date: '2026-06-01',
  amount_due: 2000,
  amount_paid: 0,
};

function stubWithRentEvent(event: Row | null): void {
  supabaseStub = buildSupabaseStub({
    tenants: [TENANT],
    leases: [LEASE],
    units: [UNIT],
    properties: [PROPERTY],
    rent_events: event ? [event] : [],
    conversations: [],
    messages: [],
  });
}

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
// getTenantDetail
// ---------------------------------------------------------------------------

describe('queries', () => {
  describe('getTenantDetail', () => {
    it('should return null when the tenant does not exist', async () => {
      stubWithRentEvent(null);
      supabaseStub = buildSupabaseStub({ tenants: [] });

      const detail = await getTenantDetail('missing');

      expect(detail).toBeNull();
    });

    it('should report Behind on chip, note, badge, and metrics when an unpaid pending cycle is past due', async () => {
      // Arrange — the Vaibhav case: due Jun 1, today Jun 12, $2,000 unpaid.
      stubWithRentEvent(OVERDUE_PENDING_EVENT);

      // Act
      const detail = await getTenantDetail('t1');

      // Assert — chip and note read from the SAME derived value.
      expect(detail).not.toBeNull();
      expect(metricValue(detail!.metrics, 'Standing')).toBe('Behind');
      expect(metricValue(detail!.metrics, 'Days late')).toBe('11');
      expect(metricValue(detail!.metrics, 'Balance')).toBe('$2,000');
      expect(detail!.odesaNote.body).toContain(
        'Vaibhav is 11 days behind with $2,000 outstanding.',
      );
      expect(detail!.odesaNote.body).not.toContain('good standing');
      expect(detail!.odesaNote.body).not.toContain('rent is current');
      expect(detail!.badge).toEqual({ variant: 'watching', label: 'Watching' });
      expect(detail!.attentionCount).toBe('payment risk: medium');
    });

    it('should surface an Overdue attention row distinct from Balance outstanding when past due', async () => {
      stubWithRentEvent(OVERDUE_PENDING_EVENT);

      const detail = await getTenantDetail('t1');

      const kinds = detail!.attention.map((a) => a.kind);
      expect(kinds).toContain('Overdue');
      expect(kinds).not.toContain('Balance outstanding');
      const overdue = detail!.attention.find((a) => a.kind === 'Overdue');
      expect(overdue?.detail).toBe('11 days late · $2,000 outstanding');
      expect(overdue?.dot).toBe('clay');
    });

    it('should flag the timeline with the date-derived days past due when overdue', async () => {
      stubWithRentEvent(OVERDUE_PENDING_EVENT);

      const detail = await getTenantDetail('t1');

      const flagged = detail!.timeline.find((e) => e.actor === 'Odesa');
      expect(flagged?.line).toBe('Flagged the cycle as overdue — 11 days past due.');
    });

    it('should offer escalation-prep thread actions for an overdue cycle without wiring a send', async () => {
      stubWithRentEvent(OVERDUE_PENDING_EVENT);

      const detail = await getTenantDetail('t1');

      const actions = detail!.threadActions;
      expect(actions.map((a) => a.label)).toEqual([
        'Draft reminder',
        'Prepare escalation',
        'Review ledger',
      ]);

      // Draft/escalation route to the read-only assistant desk (draft-only —
      // nothing sends to the tenant without owner approval).
      const draft = actions.find((a) => a.label === 'Draft reminder');
      expect(draft!.href).toMatch(/^\/assistant\?q=/);
      const escalation = actions.find((a) => a.label === 'Prepare escalation');
      expect(escalation!.href).toMatch(/^\/assistant\?q=/);

      // Review ledger routes to the focused unit ledger.
      const ledger = actions.find((a) => a.label === 'Review ledger');
      expect(ledger!.href).toContain('#rent');

      // Every action carries a real destination — never a silent no-op button.
      for (const action of actions) {
        expect(action.href).toBeDefined();
      }
    });

    it('should report Current everywhere when the cycle is fully paid despite a stale pending enum', async () => {
      stubWithRentEvent({
        ...OVERDUE_PENDING_EVENT,
        amount_paid: 2000,
      });

      const detail = await getTenantDetail('t1');

      expect(metricValue(detail!.metrics, 'Standing')).toBe('Current');
      expect(metricValue(detail!.metrics, 'Days late')).toBe('0');
      expect(metricValue(detail!.metrics, 'Balance')).toBe('$0');
      expect(detail!.odesaNote.body).toContain('good standing');
      expect(detail!.badge).toEqual({ variant: 'current', label: 'Current' });
      expect(detail!.attention.map((a) => a.kind)).toEqual(['All clear']);
      expect(detail!.attentionCount).toBe('all clear');
    });

    it('should report On plan (never late) for a past-due plan_agreed cycle with a balance', async () => {
      stubWithRentEvent({
        ...OVERDUE_PENDING_EVENT,
        status: 'plan_agreed',
        amount_paid: 500,
      });

      const detail = await getTenantDetail('t1');

      expect(metricValue(detail!.metrics, 'Standing')).toBe('On plan');
      expect(metricValue(detail!.metrics, 'Days late')).toBe('0');
      expect(detail!.odesaNote.body).toContain('payment plan');
      expect(detail!.badge).toEqual({ variant: 'plan', label: 'Payment plan' });
      expect(detail!.attention.map((a) => a.kind)).toContain('Payment plan active');
      expect(detail!.attention.map((a) => a.kind)).not.toContain('Overdue');
    });

    it('should report Due (not Behind) when the balance is outstanding but not yet past due', async () => {
      stubWithRentEvent({
        ...OVERDUE_PENDING_EVENT,
        due_date: '2026-06-20',
      });

      const detail = await getTenantDetail('t1');

      expect(metricValue(detail!.metrics, 'Standing')).toBe('Due');
      expect(metricValue(detail!.metrics, 'Days late')).toBe('0');
      expect(detail!.odesaNote.body).toContain('$2,000 due on the current cycle');
      expect(detail!.attention.map((a) => a.kind)).toContain('Balance outstanding');
      expect(detail!.attention.map((a) => a.kind)).not.toContain('Overdue');
      expect(detail!.badge).toEqual({ variant: 'current', label: 'Current' });
    });

    it('should report Escalated standing with date-aware days late for an escalated cycle', async () => {
      stubWithRentEvent({
        ...OVERDUE_PENDING_EVENT,
        status: 'escalated',
      });

      const detail = await getTenantDetail('t1');

      expect(metricValue(detail!.metrics, 'Standing')).toBe('Escalated');
      expect(metricValue(detail!.metrics, 'Days late')).toBe('11');
      expect(detail!.odesaNote.body).toContain('escalated');
      expect(detail!.attentionCount).toBe('payment risk: high');
    });
  });

  // -------------------------------------------------------------------------
  // listTenantsDirectory
  // -------------------------------------------------------------------------

  describe('listTenantsDirectory', () => {
    it('should pill a date-overdue pending cycle as Watching and count it under Needs attention', async () => {
      stubWithRentEvent(OVERDUE_PENDING_EVENT);

      const directory = await listTenantsDirectory();

      expect(directory.rows).toHaveLength(1);
      expect(directory.rows[0].statusPill).toEqual({
        variant: 'watching',
        label: 'Watching',
      });
      const attention = directory.facets.find((f) => f.id === 'attention');
      expect(attention?.count).toBe(1);
    });

    it('should pill a fully paid cycle as Current despite a stale pending enum', async () => {
      stubWithRentEvent({ ...OVERDUE_PENDING_EVENT, amount_paid: 2000 });

      const directory = await listTenantsDirectory();

      expect(directory.rows[0].statusPill).toEqual({
        variant: 'current',
        label: 'Current',
      });
    });

    it('should pill a plan_agreed cycle as Payment plan, never Watching', async () => {
      stubWithRentEvent({
        ...OVERDUE_PENDING_EVENT,
        status: 'plan_agreed',
        amount_paid: 500,
      });

      const directory = await listTenantsDirectory();

      expect(directory.rows[0].statusPill).toEqual({
        variant: 'plan',
        label: 'Payment plan',
      });
      const plan = directory.facets.find((f) => f.id === 'plan');
      expect(plan?.count).toBe(1);
    });

    it('should return an empty directory when the org has no tenants', async () => {
      supabaseStub = buildSupabaseStub({ tenants: [] });

      const directory = await listTenantsDirectory();

      expect(directory.rows).toEqual([]);
      expect(directory.header.total).toBe(0);
    });
  });
});
