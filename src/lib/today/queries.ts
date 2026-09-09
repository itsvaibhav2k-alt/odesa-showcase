/**
 * Today dashboard queries.
 *
 * Reads from the `v_org_pulse_kpis` view (rollup of occupancy, rent
 * collected, open WOs, late tenants) and the three source tables for
 * the urgent-items feed. RLS filters by caller's org automatically;
 * these helpers intentionally do not accept an `organizationId`
 * parameter so callers can't accidentally bypass it.
 *
 * Each function returns a Result-envelope style `{ ok, data, error }`
 * so the Today page can surface errors without throwing during SSR.
 *
 * These queries live under `src/lib/today/` rather than being inlined
 * in the page so they can be unit-tested with a mocked Supabase client
 * (Phase 2 adds `tests/today/queries.test.ts`).
 */

import { rentCycleFromRow } from '@/lib/domain';
import { createServerClient } from '@/lib/supabase/server';
import { getPortfolioFinancialSummary } from '@/lib/financials/queries';
import {
  digestSectionsSchema,
  type DigestSections,
} from '@/lib/digest/types';
import { buildTodayFinancialBriefing } from './financial-briefing';
import type { TodayFinancialBriefing } from '@/types/today';
import type {
  ConversationChannel,
  ConversationStatus,
  LeaseStatus,
  WorkOrderStatus,
  WorkOrderUrgency,
} from '@/types/database';

// =====================================================================
// KPI types
// =====================================================================

/** Snapshot of Today KPIs for a single org (current cycle). */
export interface TodayKpis {
  occupancyPct: number;
  rentCollectedCents: number;
  rentDueCents: number;
  openWorkOrdersCount: number;
  lateTenantsCount: number;
  /**
   * Wave 7 Stream S — sum of `rent_payments.amount_cents` where
   * status='succeeded' and paid_at >= start of current month. This is
   * Stripe-collected rent specifically, separate from the rent_events
   * view rollup (which counts manual paid + Stripe paid alike).
   */
  stripeRentCollectedThisMonthCents: number;
  /**
   * Outstanding late balance in cents — sum of `(amount_due -
   * amount_paid)` across `rent_events` that are LATE by the canonical
   * date-aware derivation (due_date vs today + balance; `plan_agreed`
   * is never late). Drives the late-balance signal on the Portfolio
   * Signals strip.
   */
  lateBalanceCents: number;
}

/**
 * Week-over-week delta for the KPI strip. Positive number = up this
 * week vs. last. `null` entries mean "no comparison data yet" (first
 * week of operation or empty org) and the KPI card should not render a
 * delta chip.
 */
export interface TodayKpiDeltas {
  occupancyPct: number | null;
  rentCollectedCents: number | null;
  openWorkOrdersCount: number | null;
  lateTenantsCount: number | null;
}

export interface TodayKpisResult {
  kpis: TodayKpis;
  deltas: TodayKpiDeltas;
}

// =====================================================================
// Urgent-items types
// =====================================================================

/** Union kind for a row in the urgent-items feed. */
export type UrgentItemKind = 'conversation' | 'rent' | 'work_order';

/** Normalized urgent-items row, rendered uniformly in the feed. */
export interface UrgentItem {
  id: string;
  kind: UrgentItemKind;
  tenantName: string | null;
  unitLabel: string | null;
  statusLabel: string;
  /** ISO-8601 timestamp used for ordering (oldest first = most urgent). */
  ageAnchor: string;
  /** Route the action button + row-click should navigate to. */
  href: string;
  /**
   * Source channel of the underlying record, where meaningful. For
   * `kind: 'conversation'` this mirrors `conversations.channel`
   * ('sms' | 'email' | 'voice' | ...). For `kind: 'rent'` and
   * `kind: 'work_order'` the concept is N/A and this is `null` — the
   * Today v2 adapter maps those kinds to their own `WatchChannel`
   * ('rent' / 'maintenance') without consulting this field.
   */
  channel: ConversationChannel | string | null;
  /** Rent `due_date` as an ISO date string. `kind: 'rent'` only. */
  dueDate?: string | null;
  /** Rent `amount_due` in cents (dollars * 100). `kind: 'rent'` only. */
  amountDueCents?: number | null;
  /** Rent `amount_paid` in cents (dollars * 100). `kind: 'rent'` only. */
  amountPaidCents?: number | null;
  /** Work-order urgency. `kind: 'work_order'` only. */
  urgency?: WorkOrderUrgency | null;
  /** Work-order free-text description. `kind: 'work_order'` only. */
  description?: string | null;
  /** Conversation summary. `kind: 'conversation'` only. */
  summary?: string | null;
  /** Raw status enum string, for honest title/boundary logic in the adapter. */
  rawStatus?: string;
}

// =====================================================================
// Upcoming move-ins
// =====================================================================

/** A lease starting within the look-ahead window, for "This Week". */
export interface UpcomingMoveIn {
  tenantName: string | null;
  unitLabel: string | null;
  /** Lease `start_date` as an ISO date string ('YYYY-MM-DD'). */
  date: string;
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Resolves the caller's `organization_id` from the JWT-backed DB
 * function `current_user_org_id()`. Returns `null` if the caller is
 * unauthenticated or has no `users` row yet.
 */
async function resolveCurrentOrgId(): Promise<string | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('current_user_org_id');
  if (error || !data) return null;
  return data;
}

// =====================================================================
// KPIs
// =====================================================================

/**
 * Reads `v_org_pulse_kpis` for the caller's org and computes the
 * week-over-week deltas from the last 14 days of `rent_events` +
 * `work_orders`.
 *
 * RLS ensures the view and the delta queries are org-scoped; no
 * manual `organization_id` filter needed.
 *
 * @returns an empty-ish snapshot if the view has no row for this org
 * (fresh signup) — callers render the empty-state copy.
 */
export async function getTodayKpis(): Promise<TodayKpisResult> {
  const supabase = await createServerClient();

  // The view can return zero rows for a freshly-created org that has
  // no units/leases/WOs/rent_events yet. Treat that as a zero snapshot.
  const { data: row, error } = await supabase
    .from('v_org_pulse_kpis')
    .select(
      'occupancy_pct, rent_collected_this_month_cents, rent_due_this_month_cents, open_work_orders_count, late_tenants_count',
    )
    .maybeSingle();

  const [stripeRentCollectedThisMonthCents, lateBalanceCents] = await Promise.all([
    fetchStripeRentCollectedThisMonth(supabase),
    getLateBalanceCents(),
  ]);

  const kpis: TodayKpis = error || !row
    ? {
        occupancyPct: 0,
        rentCollectedCents: 0,
        rentDueCents: 0,
        openWorkOrdersCount: 0,
        lateTenantsCount: 0,
        stripeRentCollectedThisMonthCents,
        lateBalanceCents,
      }
    : {
        occupancyPct: Number(row.occupancy_pct ?? 0),
        rentCollectedCents: Number(row.rent_collected_this_month_cents ?? 0),
        rentDueCents: Number(row.rent_due_this_month_cents ?? 0),
        openWorkOrdersCount: Number(row.open_work_orders_count ?? 0),
        lateTenantsCount: Number(row.late_tenants_count ?? 0),
        stripeRentCollectedThisMonthCents,
        lateBalanceCents,
      };

  // Deltas: compute minimal comparisons without an extra view.
  // - open WOs delta: created within last 7d - created in prior 7d
  // - late tenants delta: distinct tenants w/ late rent_events last 7d vs prior 7d
  // - rent collected delta: paid amount_paid last 7d vs prior 7d
  // - occupancy delta: not meaningful in Phase 1 (no historical snapshot); null.
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [woDelta, rentDelta, lateDelta] = await Promise.all([
    computeWorkOrderDelta(supabase, sevenDaysAgo, fourteenDaysAgo),
    computeRentCollectedDelta(supabase, sevenDaysAgo, fourteenDaysAgo),
    computeLateTenantsDelta(supabase, sevenDaysAgo, fourteenDaysAgo),
  ]);

  const deltas: TodayKpiDeltas = {
    occupancyPct: null,
    rentCollectedCents: rentDelta,
    openWorkOrdersCount: woDelta,
    lateTenantsCount: lateDelta,
  };

  return { kpis, deltas };
}

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

async function computeWorkOrderDelta(
  supabase: SupabaseServerClient,
  since: Date,
  priorSince: Date,
): Promise<number | null> {
  const { count: thisWeek } = await supabase
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since.toISOString());

  const { count: lastWeek } = await supabase
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', priorSince.toISOString())
    .lt('created_at', since.toISOString());

  if (thisWeek == null || lastWeek == null) return null;
  return thisWeek - lastWeek;
}

async function computeRentCollectedDelta(
  supabase: SupabaseServerClient,
  since: Date,
  priorSince: Date,
): Promise<number | null> {
  const { data: thisWeek } = await supabase
    .from('rent_events')
    .select('amount_paid, updated_at, status')
    .eq('status', 'paid')
    .gte('updated_at', since.toISOString());

  const { data: lastWeek } = await supabase
    .from('rent_events')
    .select('amount_paid, updated_at, status')
    .eq('status', 'paid')
    .gte('updated_at', priorSince.toISOString())
    .lt('updated_at', since.toISOString());

  if (!thisWeek || !lastWeek) return null;

  const toCents = (rows: { amount_paid: number }[]): number =>
    rows.reduce((acc, r) => acc + Math.round(Number(r.amount_paid ?? 0) * 100), 0);

  return toCents(thisWeek) - toCents(lastWeek);
}

/**
 * Wave 7 Stream S — sum of Stripe-paid rent for the current calendar
 * month. RLS scopes `rent_payments` to the caller's org.
 */
async function fetchStripeRentCollectedThisMonth(
  supabase: SupabaseServerClient,
): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const { data } = await supabase
    .from('rent_payments')
    .select('amount_cents, status, paid_at')
    .eq('status', 'succeeded')
    .gte('paid_at', startOfMonth.toISOString());

  if (!data) return 0;
  return data.reduce(
    (acc, r) => acc + Math.round(Number(r.amount_cents ?? 0)),
    0,
  );
}

/**
 * Week-over-week delta of distinct leases with a LATE rent event touched
 * in each window. Lateness is the canonical date-aware derivation
 * (due_date vs today + balance) — never the raw enum — so a stale
 * `pending` past its due date counts and `plan_agreed` never does.
 * `.neq('status','paid')` only bounds the fetch; the derivation decides.
 */
async function computeLateTenantsDelta(
  supabase: SupabaseServerClient,
  since: Date,
  priorSince: Date,
): Promise<number | null> {
  const todayIso = toIsoDate(new Date());

  const { data: thisWeek } = await supabase
    .from('rent_events')
    .select('lease_id, status, due_date, amount_due, amount_paid, updated_at')
    .neq('status', 'paid')
    .gte('updated_at', since.toISOString());

  const { data: lastWeek } = await supabase
    .from('rent_events')
    .select('lease_id, status, due_date, amount_due, amount_paid, updated_at')
    .neq('status', 'paid')
    .gte('updated_at', priorSince.toISOString())
    .lt('updated_at', since.toISOString());

  if (!thisWeek || !lastWeek) return null;

  const distinctLate = (rows: LateDerivableRow[]): number =>
    new Set(
      rows
        .filter((r) => rentCycleFromRow(r, todayIso).isLate)
        .map((r) => r.lease_id),
    ).size;

  return distinctLate(thisWeek) - distinctLate(lastWeek);
}

/** rent_events columns needed to derive lateness in TS. */
interface LateDerivableRow {
  lease_id: string;
  status: string;
  due_date: string | null;
  amount_due: number | null;
  amount_paid: number | null;
}

// =====================================================================
// Urgent items
// =====================================================================

/**
 * Returns the top N urgent items across conversations, rent events,
 * and work orders. Ordering: oldest age anchor first (most urgent).
 *
 * Conversations: `status IN ('open','escalated')` sorted by
 * `last_message_at ASC`.
 * Rent events: `status IN ('late_3','late_7','escalated')` sorted by
 * `due_date ASC`.
 * Work orders: `urgency='emergency'` OR (`status='open'` AND
 * `created_at < now - 7d`) sorted by `created_at ASC`.
 *
 * The three pools are merged and trimmed to `limit`. Only two public
 * enums cross this boundary as string literals (status/urgency) — the
 * rest of the mapping stays internal.
 */
export async function getUrgentItems(limit = 5): Promise<UrgentItem[]> {
  const supabase = await createServerClient();
  const orgId = await resolveCurrentOrgId();
  if (!orgId) return [];

  const [conversations, rentEvents, workOrders] = await Promise.all([
    fetchUrgentConversations(supabase, limit),
    fetchUrgentRentEvents(supabase, limit),
    fetchUrgentWorkOrders(supabase, limit),
  ]);

  const merged = [...conversations, ...rentEvents, ...workOrders];
  merged.sort((a, b) => a.ageAnchor.localeCompare(b.ageAnchor));
  return merged.slice(0, limit);
}

async function fetchUrgentConversations(
  supabase: SupabaseServerClient,
  limit: number,
): Promise<UrgentItem[]> {
  const openStatuses: ConversationStatus[] = ['open', 'escalated'];
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('conversations')
    .select('id, tenant_id, status, channel, last_message_at, summary, created_at')
    .in('status', openStatuses)
    // Suppress threads the operator has muted or snoozed (until the snooze
    // window passes) so they drop out of the Owner Review queue.
    .eq('muted', false)
    .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
    .order('last_message_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (!data || data.length === 0) return [];

  const tenantIds = Array.from(
    new Set(data.map((c) => c.tenant_id).filter((x): x is string => !!x)),
  );
  const tenantMap = tenantIds.length
    ? await fetchTenantMap(supabase, tenantIds)
    : new Map<string, { name: string; unitLabel: string | null }>();

  return data.map((c) => {
    const t = c.tenant_id ? tenantMap.get(c.tenant_id) : undefined;
    return {
      id: c.id,
      kind: 'conversation' as const,
      tenantName: t?.name ?? null,
      unitLabel: t?.unitLabel ?? null,
      statusLabel: statusLabelForConversation(c.status),
      ageAnchor: c.last_message_at ?? c.created_at,
      href: `/review/conversation/${c.id}`,
      channel: c.channel ?? null,
      summary: c.summary,
      rawStatus: c.status,
    };
  });
}

/**
 * Minimum derived days late before a rent cycle is "urgent" — mirrors the
 * old `late_3`-and-up enum filter, but date-true.
 */
const URGENT_RENT_MIN_DAYS_LATE = 3;

/**
 * Rent cycles that are urgently late, derived date-aware in TS (due_date
 * vs today + balance) via the canonical domain module. A stale `pending`
 * past its due date qualifies; `plan_agreed` never does. The query only
 * bounds the candidate set (`.neq('status','paid')`); the derivation
 * decides.
 */
async function fetchUrgentRentEvents(
  supabase: SupabaseServerClient,
  limit: number,
): Promise<UrgentItem[]> {
  const todayIso = toIsoDate(new Date());
  const { data } = await supabase
    .from('rent_events')
    .select('id, lease_id, status, due_date, amount_due, amount_paid, created_at')
    .neq('status', 'paid')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit * 5);

  const urgent = (data ?? [])
    .map((r) => ({ row: r, derived: rentCycleFromRow(r, todayIso) }))
    .filter(
      ({ derived }) =>
        derived.isLate
        && (derived.isEscalated || derived.daysLate >= URGENT_RENT_MIN_DAYS_LATE),
    )
    .slice(0, limit);

  if (urgent.length === 0) return [];

  const leaseIds = Array.from(new Set(urgent.map(({ row }) => row.lease_id)));
  const leaseMap = await fetchLeaseTenantUnitMap(supabase, leaseIds);

  return urgent.map(({ row: r, derived }) => {
    const meta = leaseMap.get(r.lease_id);
    return {
      id: r.id,
      kind: 'rent' as const,
      tenantName: meta?.tenantName ?? null,
      unitLabel: meta?.unitLabel ?? null,
      // Canonical domain label, e.g. 'Overdue · 11 days' | 'Escalated'.
      statusLabel: derived.label,
      ageAnchor: r.due_date ?? r.created_at,
      href: `/review/rent/${r.id}`,
      channel: null,
      // rent_events amounts are stored in dollars — mirror
      // sumLateBalanceCents' `* 100` conversion to cents.
      dueDate: r.due_date,
      amountDueCents: Math.round(Number(r.amount_due ?? 0) * 100),
      amountPaidCents: Math.round(Number(r.amount_paid ?? 0) * 100),
      rawStatus: r.status,
    };
  });
}

async function fetchUrgentWorkOrders(
  supabase: SupabaseServerClient,
  limit: number,
): Promise<UrgentItem[]> {
  // We split the OR across two queries (easier than building a raw .or())
  // then merge-dedupe in memory — cheap and keeps the RLS surface simple.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString();

  const urgencyEmergency: WorkOrderUrgency = 'emergency';
  const openStatus: WorkOrderStatus = 'open';

  const [{ data: emergency }, { data: stale }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('id, tenant_id, unit_id, status, urgency, description, created_at')
      .eq('urgency', urgencyEmergency)
      .not('status', 'in', '(completed,cancelled)')
      .order('created_at', { ascending: true })
      .limit(limit),
    supabase
      .from('work_orders')
      .select('id, tenant_id, unit_id, status, urgency, description, created_at')
      .eq('status', openStatus)
      .lt('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true })
      .limit(limit),
  ]);

  const rawRows = [...(emergency ?? []), ...(stale ?? [])];
  const deduped = Array.from(new Map(rawRows.map((wo) => [wo.id, wo])).values());

  if (deduped.length === 0) return [];

  const tenantIds = Array.from(
    new Set(deduped.map((w) => w.tenant_id).filter((x): x is string => !!x)),
  );
  const unitIds = Array.from(new Set(deduped.map((w) => w.unit_id)));
  const [tenantMap, unitMap] = await Promise.all([
    tenantIds.length
      ? fetchTenantMap(supabase, tenantIds)
      : Promise.resolve(
          new Map<string, { name: string; unitLabel: string | null }>(),
        ),
    fetchUnitLabelMap(supabase, unitIds),
  ]);

  return deduped.map((w) => ({
    id: w.id,
    kind: 'work_order' as const,
    tenantName: (w.tenant_id && tenantMap.get(w.tenant_id)?.name) ?? null,
    unitLabel: unitMap.get(w.unit_id) ?? null,
    statusLabel: statusLabelForWorkOrder(w.urgency, w.status),
    ageAnchor: w.created_at,
    href: `/review/work_order/${w.id}`,
    channel: null,
    urgency: w.urgency,
    description: w.description,
    rawStatus: w.status,
  }));
}

// ---------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------

async function fetchTenantMap(
  supabase: SupabaseServerClient,
  tenantIds: readonly string[],
): Promise<Map<string, { name: string; unitLabel: string | null }>> {
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);

  const nameMap = new Map<string, string>();
  (tenants ?? []).forEach((t) => nameMap.set(t.id, t.full_name));

  // Find each tenant's current active lease → unit label. One extra
  // round-trip for leases + units keeps the helper RLS-safe.
  const { data: leases } = await supabase
    .from('leases')
    .select('tenant_id, unit_id, status')
    .in('tenant_id', tenantIds)
    .eq('status', 'active');

  const unitIds = Array.from(
    new Set((leases ?? []).map((l) => l.unit_id).filter((x): x is string => !!x)),
  );
  const unitLabels = unitIds.length
    ? await fetchUnitLabelMap(supabase, unitIds)
    : new Map<string, string>();

  const result = new Map<string, { name: string; unitLabel: string | null }>();
  for (const id of tenantIds) {
    const name = nameMap.get(id) ?? '';
    const lease = (leases ?? []).find((l) => l.tenant_id === id);
    const unitLabel = lease ? unitLabels.get(lease.unit_id) ?? null : null;
    result.set(id, { name, unitLabel });
  }
  return result;
}

async function fetchLeaseTenantUnitMap(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
): Promise<Map<string, { tenantName: string; unitLabel: string | null }>> {
  if (leaseIds.length === 0) return new Map();

  const { data: leases } = await supabase
    .from('leases')
    .select('id, tenant_id, unit_id')
    .in('id', leaseIds);

  const tenantIds = Array.from(
    new Set((leases ?? []).map((l) => l.tenant_id).filter((x): x is string => !!x)),
  );
  const unitIds = Array.from(
    new Set((leases ?? []).map((l) => l.unit_id).filter((x): x is string => !!x)),
  );

  const [{ data: tenants }, unitMap] = await Promise.all([
    tenantIds.length
      ? supabase.from('tenants').select('id, full_name').in('id', tenantIds)
      : Promise.resolve({ data: [] }),
    unitIds.length ? fetchUnitLabelMap(supabase, unitIds) : Promise.resolve(new Map<string, string>()),
  ]);

  const tenantNameMap = new Map<string, string>();
  (tenants ?? []).forEach((t) => tenantNameMap.set(t.id, t.full_name));

  const out = new Map<string, { tenantName: string; unitLabel: string | null }>();
  (leases ?? []).forEach((l) => {
    out.set(l.id, {
      tenantName: tenantNameMap.get(l.tenant_id) ?? '',
      unitLabel: unitMap.get(l.unit_id) ?? null,
    });
  });
  return out;
}

async function fetchUnitLabelMap(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<Map<string, string>> {
  if (unitIds.length === 0) return new Map();
  const { data: units } = await supabase
    .from('units')
    .select('id, label')
    .in('id', unitIds);
  const m = new Map<string, string>();
  (units ?? []).forEach((u) => m.set(u.id, u.label));
  return m;
}

// ---------------------------------------------------------------------
// Status label mappers — keep copy warm ("Late 3d", not "late_3")
// ---------------------------------------------------------------------

function statusLabelForConversation(status: ConversationStatus): string {
  switch (status) {
    case 'open':
      return 'Open reply';
    case 'escalated':
      return 'Escalated';
    case 'resolved':
      return 'Resolved';
  }
}

function statusLabelForWorkOrder(
  urgency: WorkOrderUrgency,
  status: WorkOrderStatus,
): string {
  if (urgency === 'emergency') return 'Emergency repair';
  if (status === 'open') return 'Open work order';
  return 'Work order';
}

// =====================================================================
// Upcoming move-ins + late balance (Foundations — Wave 1)
// =====================================================================

/** Formats a `Date` as a 'YYYY-MM-DD' string for `date`-column compares. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Leases starting within the next `daysAhead` days (inclusive of
 * today), for the right-rail "This Week" module. RLS scopes `leases`
 * to the caller's org; no `organization_id` parameter so callers can't
 * bypass it. Reuses {@link fetchLeaseTenantUnitMap} for tenant/unit
 * labels.
 *
 * @param daysAhead - Size of the forward window in days (default 7).
 * @returns Move-ins sorted by date ascending; empty array on no match.
 */
export async function getUpcomingMoveIns(daysAhead = 7): Promise<UpcomingMoveIn[]> {
  const supabase = await createServerClient();

  const today = new Date();
  const horizon = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const upcomingStatuses: LeaseStatus[] = ['active', 'pending'];

  const { data } = await supabase
    .from('leases')
    .select('id, start_date, status')
    .in('status', upcomingStatuses)
    .gte('start_date', toIsoDate(today))
    .lte('start_date', toIsoDate(horizon))
    .order('start_date', { ascending: true, nullsFirst: false });

  if (!data || data.length === 0) return [];

  // Defensive: `start_date` is nullable in the schema, and the range
  // filter already excludes nulls — narrow the type for the caller.
  const dated = data.filter(
    (l): l is { id: string; start_date: string; status: LeaseStatus } => !!l.start_date,
  );
  if (dated.length === 0) return [];

  const leaseMap = await fetchLeaseTenantUnitMap(
    supabase,
    dated.map((l) => l.id),
  );

  return dated.map((l) => {
    const meta = leaseMap.get(l.id);
    return {
      tenantName: meta?.tenantName ?? null,
      unitLabel: meta?.unitLabel ?? null,
      date: l.start_date,
    };
  });
}

/** A `rent_events` row narrowed to the fields the late-balance sum needs. */
export interface RentBalanceRow {
  amount_due: number | null;
  amount_paid: number | null;
}

/**
 * Folds `rent_events` rows into a total late balance in cents.
 *
 * `rent_events` amounts are stored in dollars (mirroring
 * `computeRentCollectedDelta` above), so each row is converted to cents
 * before summing. Negative per-row balances (overpayment) are floored
 * at zero so a credit on one lease can't mask a real shortfall on
 * another. Pure — extracted so the arithmetic is unit-testable without
 * mocking the Supabase client.
 *
 * @param rows - Late `rent_events` rows.
 * @returns The total late balance owed, in cents (never negative).
 */
export function sumLateBalanceCents(rows: readonly RentBalanceRow[]): number {
  return rows.reduce((acc, r) => {
    const dueCents = Math.round(Number(r.amount_due ?? 0) * 100);
    const paidCents = Math.round(Number(r.amount_paid ?? 0) * 100);
    return acc + Math.max(0, dueCents - paidCents);
  }, 0);
}

/**
 * Outstanding late balance in cents — sum of `(amount_due -
 * amount_paid)` across `rent_events` that are LATE by the canonical
 * date-aware derivation (due_date vs today + balance), never the raw
 * enum: a stale `pending` past its due date counts, `plan_agreed` never
 * does. `.neq('status','paid')` only bounds the fetch; the derivation
 * decides. RLS-scoped (no `organization_id` parameter). See
 * {@link sumLateBalanceCents} for the fold semantics.
 *
 * @returns The total late balance owed, in cents (never negative).
 */
export async function getLateBalanceCents(): Promise<number> {
  const supabase = await createServerClient();
  const todayIso = toIsoDate(new Date());

  const { data } = await supabase
    .from('rent_events')
    .select('amount_due, amount_paid, status, due_date')
    .neq('status', 'paid');

  if (!data) return 0;
  const lateRows = data.filter((r) => rentCycleFromRow(r, todayIso).isLate);
  return sumLateBalanceCents(lateRows);
}

/**
 * Counts agent runs that ended in `failed` within the last 24 hours for
 * the caller's org. Feeds the Today headline accountability override so a
 * calm rail can never hide failed automation (see
 * {@link deriveWatchHeadline}). RLS scopes `agent_runs` to the org.
 *
 * @param hours - Lookback window in hours (default 24).
 * @returns The number of failed runs in the window (0 on any read issue).
 */
export async function getFailedAgentRunCount(hours = 24): Promise<number> {
  const supabase = await createServerClient();
  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('created_at', sinceIso);

  return count ?? 0;
}

// =====================================================================
// Today financial briefing (Phase 5)
// =====================================================================

/**
 * Compact financial briefing for the Today morning console.
 *
 * Reuses the canonical {@link getPortfolioFinancialSummary} adapter (which
 * routes every `rent_events` row through `rentCycleFromRow` and folds via
 * `financials/summary`) and projects it through the pure
 * {@link buildTodayFinancialBriefing} transform. RLS scopes the underlying
 * read; this helper takes no `organizationId`. Money stays integer cents;
 * spend/NOI stay honestly `null` when expense imports aren't connected.
 *
 * @returns The slim {@link TodayFinancialBriefing} for the current period.
 */
export async function getTodayFinancialBriefing(): Promise<TodayFinancialBriefing> {
  const summary = await getPortfolioFinancialSummary();
  return buildTodayFinancialBriefing(summary);
}

// =====================================================================
// Daily digest ("Overnight" card)
// =====================================================================

/** Latest per-day digest snapshot, parsed and ready to render. */
export interface DailyDigest {
  id: string;
  /** Calendar date the digest is filed under ('YYYY-MM-DD'). */
  digestDate: string;
  /** ISO bounds of the 24h window the generator computed. */
  windowStart: string;
  windowEnd: string;
  /** Sections-shape version stored alongside the snapshot. */
  version: number;
  sections: DigestSections;
}

/**
 * Reads the most recent `daily_digests` row for the caller's org. RLS
 * scopes the table (SELECT-only policy); writes happen exclusively via
 * the generate-daily-digest cron through the service role.
 *
 * The jsonb `sections` payload crosses a trust boundary (DB → renderer),
 * so it is validated with `digestSectionsSchema`. An unparseable or
 * missing digest returns `null` and the Overnight card hides gracefully.
 *
 * @returns The latest digest, or `null` when none exists / shape is unknown.
 */
export async function getLatestDailyDigest(): Promise<DailyDigest | null> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('daily_digests')
    .select('id, digest_date, sections, version, window_start, window_end')
    .order('digest_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const parsed = digestSectionsSchema.safeParse(data.sections);
  if (!parsed.success) return null;

  return {
    id: data.id,
    digestDate: data.digest_date,
    windowStart: data.window_start,
    windowEnd: data.window_end,
    version: data.version,
    sections: parsed.data,
  };
}
