/**
 * Case-context data layer for the redesigned `/inbox` (wave 3).
 *
 * Joins a tenant to their most relevant lease, recent payment history, and
 * the work-order they're most likely asking about (with primary + backup
 * vendor). The composed `CaseContext` is consumed by the case-file column
 * (wave 5) so the operator sees the full operational picture next to the
 * thread.
 *
 * Pure helpers (no supabase client touch) are exported separately so they
 * can be table-tested without mocking the client:
 *
 *   - `computeSlaState`    — urgency × age → 'on_track' | 'at_risk' | 'breached'
 *   - `tierFromStatus`     — rent_event status → DaysLateTier | null
 *   - `emptyCaseContext()` — the canonical shape for `tenantId === null`
 *
 * Reuse policy: this module wraps `sumLateBalanceCents` from
 * `@/lib/today/queries` — it does NOT reimplement the late-balance math.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { sumLateBalanceCents } from '@/lib/today/queries';
import type { Database } from '@/types/database';

type ServerSupabase = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SlaState = 'on_track' | 'at_risk' | 'breached';

export type DaysLateTier = 0 | 1 | 3 | 7 | 'escalated';

export type WorkOrderUrgency = 'emergency' | 'urgent' | 'routine';

export type WorkOrderStatus =
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface LeaseSummary {
  startDate: string | null;
  endDate: string | null;
  rentAmountCents: number | null;
}

export interface PaymentSummary {
  onTimeCount: number;
  totalRecent: number;
  balanceCents: number;
  daysLateTier: DaysLateTier | null;
}

export interface WorkOrderSummary {
  id: string;
  category: string;
  urgency: WorkOrderUrgency;
  status: WorkOrderStatus;
  openedAt: string;
  vendor: {
    id: string;
    name: string;
    acceptanceRate: number | null;
  } | null;
  backupVendor: { id: string; name: string } | null;
  slaState: SlaState;
}

export interface CaseContext {
  lease: LeaseSummary | null;
  payments: PaymentSummary;
  workOrder: WorkOrderSummary | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

const BREACH_THRESHOLD_MS: Record<WorkOrderUrgency, number> = {
  emergency: 4 * HOUR_MS,
  urgent: 24 * HOUR_MS,
  routine: 72 * HOUR_MS,
};

const AT_RISK_FRACTION = 0.75;

/**
 * Computes the SLA state for a work order given urgency, when it was
 * opened, and current status. Completed / cancelled work is always
 * `on_track` — we only assess open work against the breach window.
 *
 * @param urgency    - Urgency tier set by the operator.
 * @param openedAt   - ISO timestamp when the WO was opened.
 * @param status     - Current WO status.
 * @param now        - Reference time (defaults to `Date.now()`); injectable for tests.
 * @returns SLA state: 'breached' once age ≥ threshold, 'at_risk' at ≥75 % of threshold, else 'on_track'.
 */
export function computeSlaState(
  urgency: WorkOrderUrgency,
  openedAt: string,
  status: WorkOrderStatus,
  now: number = Date.now(),
): SlaState {
  if (status === 'completed' || status === 'cancelled') return 'on_track';
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return 'on_track';
  const ageMs = now - opened;
  const threshold = BREACH_THRESHOLD_MS[urgency];
  if (ageMs >= threshold) return 'breached';
  if (ageMs >= threshold * AT_RISK_FRACTION) return 'at_risk';
  return 'on_track';
}

/**
 * Derives the human-facing days-late tier from a `rent_events.status`.
 *
 * - `paid` / `plan_agreed`             → null (no live late state)
 * - `pending` / `reminder_sent`        → 0   (cycle is current)
 * - `due_sent`                         → 0   (notice issued, not yet late)
 * - `late_1`, `late_3`, `late_7`       → 1, 3, 7 respectively
 * - `escalated`                        → 'escalated'
 *
 * Any unknown future status returns null so we fail soft.
 */
export function tierFromStatus(
  status: Database['public']['Enums']['rent_event_status'] | null | undefined,
): DaysLateTier | null {
  switch (status) {
    case 'pending':
    case 'reminder_sent':
    case 'due_sent':
      return 0;
    case 'late_1':
      return 1;
    case 'late_3':
      return 3;
    case 'late_7':
      return 7;
    case 'escalated':
      return 'escalated';
    case 'paid':
    case 'plan_agreed':
    case null:
    case undefined:
      return null;
    default:
      return null;
  }
}

/**
 * The canonical empty `CaseContext` shape, returned when we have no
 * tenant_id to look up (unknown SMS sender). Downstream consumers can
 * still render — every field is non-throwing.
 */
export function emptyCaseContext(): CaseContext {
  return {
    lease: null,
    payments: {
      onTimeCount: 0,
      totalRecent: 0,
      balanceCents: 0,
      daysLateTier: null,
    },
    workOrder: null,
  };
}

// ---------------------------------------------------------------------------
// getLeaseSummary
// ---------------------------------------------------------------------------

/**
 * Loads the most-recent active lease for a tenant. Returns `null` when
 * the tenant has no active lease (e.g. former tenant, lease pre-signed).
 */
export async function getLeaseSummary(
  supabase: ServerSupabase,
  tenantId: string,
): Promise<LeaseSummary | null> {
  const { data } = await supabase
    .from('leases')
    .select('id, rent_amount, start_date, end_date, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('start_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const rentDollars =
    typeof data.rent_amount === 'string'
      ? Number(data.rent_amount)
      : (data.rent_amount as number | null);
  const rentAmountCents =
    rentDollars != null && Number.isFinite(rentDollars)
      ? Math.round(rentDollars * 100)
      : null;

  return {
    startDate: data.start_date ?? null,
    endDate: (data as { end_date?: string | null }).end_date ?? null,
    rentAmountCents,
  };
}

// ---------------------------------------------------------------------------
// getPaymentSummary
// ---------------------------------------------------------------------------

const LATE_STATUSES: ReadonlyArray<
  Database['public']['Enums']['rent_event_status']
> = ['late_1', 'late_3', 'late_7', 'escalated'];

/**
 * Builds a 12-cycle (by default) payment summary for a tenant.
 *
 * - `onTimeCount` = count of rent_events that have at least one matching
 *   `rent_payments` row with `paid_at <= due_date`.
 * - `totalRecent` = number of rent_events sampled (≤ recentN).
 * - `balanceCents` = `sumLateBalanceCents` over events in late tiers — we
 *   wrap the existing pure helper from `today/queries` rather than
 *   re-deriving the math.
 * - `daysLateTier` = derived from the most-recent non-paid event status.
 */
export async function getPaymentSummary(
  supabase: ServerSupabase,
  tenantId: string,
  opts: { recentN?: number } = {},
): Promise<PaymentSummary> {
  const recentN = opts.recentN ?? 12;

  // 1. Find the tenant's leases (active or historical) so we can scope
  //    rent_events. Tenants tied to multiple leases over time still get
  //    a coherent picture because we order events by due_date desc.
  const { data: leases } = await supabase
    .from('leases')
    .select('id')
    .eq('tenant_id', tenantId);

  const leaseIds = (leases ?? []).map((l) => l.id);
  if (leaseIds.length === 0) {
    return {
      onTimeCount: 0,
      totalRecent: 0,
      balanceCents: 0,
      daysLateTier: null,
    };
  }

  // 2. Pull the most recent N rent_events for those leases.
  const { data: events } = await supabase
    .from('rent_events')
    .select('id, lease_id, status, amount_due, amount_paid, due_date')
    .in('lease_id', leaseIds)
    .order('due_date', { ascending: false, nullsFirst: false })
    .limit(recentN);

  const eventRows = events ?? [];
  if (eventRows.length === 0) {
    return {
      onTimeCount: 0,
      totalRecent: 0,
      balanceCents: 0,
      daysLateTier: null,
    };
  }

  // 3. Resolve on-time count via rent_payments (paid_at <= due_date).
  const eventIds = eventRows.map((e) => e.id);
  const { data: payments } = await supabase
    .from('rent_payments')
    .select('rent_event_id, paid_at, status')
    .in('rent_event_id', eventIds)
    .eq('status', 'succeeded');

  const onTimeByEvent = new Set<string>();
  for (const p of payments ?? []) {
    if (!p.rent_event_id || !p.paid_at) continue;
    const ev = eventRows.find((e) => e.id === p.rent_event_id);
    if (!ev?.due_date) continue;
    if (p.paid_at <= ev.due_date) {
      onTimeByEvent.add(p.rent_event_id);
    }
  }

  // 4. Late balance — delegate to the canonical sum.
  const lateRows = eventRows.filter((e) =>
    LATE_STATUSES.includes(e.status),
  );
  const balanceCents = sumLateBalanceCents(lateRows);

  // 5. Days-late tier from the latest non-paid event.
  const latestNonPaid = eventRows.find((e) => e.status !== 'paid');
  const daysLateTier = latestNonPaid
    ? tierFromStatus(latestNonPaid.status)
    : null;

  return {
    onTimeCount: onTimeByEvent.size,
    totalRecent: eventRows.length,
    balanceCents,
    daysLateTier,
  };
}

// ---------------------------------------------------------------------------
// getMostRelevantWorkOrder
// ---------------------------------------------------------------------------

const ACTIVE_WO_STATUSES: ReadonlyArray<WorkOrderStatus> = [
  'open',
  'assigned',
  'in_progress',
];

const RECENT_COMPLETED_WINDOW_MS = 30 * 24 * HOUR_MS;

/**
 * Surfaces the work-order the tenant is most likely asking about.
 * Conversations and work_orders aren't FK-linked, so we use heuristic
 * recency: prefer the most recent open/assigned/in_progress WO; fall
 * back to a completed WO from the last 30 days; otherwise null.
 *
 * Vendor + backup vendor are resolved in two extra queries:
 *  - `vendor`        — joined via `work_orders.vendor_id`
 *  - `backupVendor`  — same-category vendor from `property_vendors`
 *                       for the WO's unit's property (highest confidence)
 */
export async function getMostRelevantWorkOrder(
  supabase: ServerSupabase,
  tenantId: string,
  now: number = Date.now(),
): Promise<WorkOrderSummary | null> {
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select(
      'id, category, urgency, status, vendor_id, unit_id, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(20);

  const rows = workOrders ?? [];
  if (rows.length === 0) return null;

  const cutoff = now - RECENT_COMPLETED_WINDOW_MS;

  const pick =
    rows.find((r) =>
      ACTIVE_WO_STATUSES.includes(r.status as WorkOrderStatus),
    ) ??
    rows.find((r) => {
      if (r.status !== 'completed') return false;
      const openedMs = Date.parse(r.created_at);
      return Number.isFinite(openedMs) && openedMs >= cutoff;
    }) ??
    null;

  if (!pick) return null;

  // Primary vendor.
  let vendor: WorkOrderSummary['vendor'] = null;
  if (pick.vendor_id) {
    const { data: vendorRow } = await supabase
      .from('vendors')
      .select('id, name, acceptance_rate')
      .eq('id', pick.vendor_id)
      .maybeSingle();
    if (vendorRow) {
      const rate =
        typeof vendorRow.acceptance_rate === 'number' &&
        Number.isFinite(vendorRow.acceptance_rate)
          ? vendorRow.acceptance_rate
          : null;
      vendor = {
        id: vendorRow.id,
        name: vendorRow.name,
        acceptanceRate: rate,
      };
    }
  }

  // Backup vendor: same-category from property_vendors for the unit's
  // property, ordered by confidence desc, excluding the primary.
  let backupVendor: WorkOrderSummary['backupVendor'] = null;
  if (pick.unit_id) {
    const { data: unitRow } = await supabase
      .from('units')
      .select('id, property_id')
      .eq('id', pick.unit_id)
      .maybeSingle();
    if (unitRow?.property_id) {
      const { data: pvRows } = await supabase
        .from('property_vendors')
        .select('vendor_id, category, confidence')
        .eq('property_id', unitRow.property_id)
        .eq('category', pick.category)
        .order('confidence', { ascending: false, nullsFirst: false });
      const backupId =
        (pvRows ?? []).find((pv) => pv.vendor_id !== pick.vendor_id)
          ?.vendor_id ?? null;
      if (backupId) {
        const { data: backupRow } = await supabase
          .from('vendors')
          .select('id, name')
          .eq('id', backupId)
          .maybeSingle();
        if (backupRow) {
          backupVendor = { id: backupRow.id, name: backupRow.name };
        }
      }
    }
  }

  const slaState = computeSlaState(
    pick.urgency as WorkOrderUrgency,
    pick.created_at,
    pick.status as WorkOrderStatus,
    now,
  );

  return {
    id: pick.id,
    category: pick.category as string,
    urgency: pick.urgency as WorkOrderUrgency,
    status: pick.status as WorkOrderStatus,
    openedAt: pick.created_at,
    vendor,
    backupVendor,
    slaState,
  };
}

// ---------------------------------------------------------------------------
// getCaseContext
// ---------------------------------------------------------------------------

/**
 * Composes the full `CaseContext` for a tenant. Returns the canonical
 * empty shape when `tenantId` is null (unknown SMS sender) so callers
 * never have to branch on null inside their render layer.
 *
 * The three sub-queries run in parallel — they don't depend on each
 * other's results.
 */
export async function getCaseContext(
  supabase: ServerSupabase,
  tenantId: string | null,
): Promise<CaseContext> {
  if (!tenantId) return emptyCaseContext();

  const [lease, payments, workOrder] = await Promise.all([
    getLeaseSummary(supabase, tenantId),
    getPaymentSummary(supabase, tenantId),
    getMostRelevantWorkOrder(supabase, tenantId),
  ]);

  return { lease, payments, workOrder };
}
