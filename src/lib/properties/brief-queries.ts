/**
 * Property brief — real-data query for `/properties/[id]`.
 *
 * Builds the exact `PropertyDetailMock` shape the brief page consumes (the
 * mockup's `getPropertyDetail(slug)` contract) from live Supabase rows, so the
 * locked UI renders unchanged. The page now keys on the property UUID instead
 * of a mock slug; an unknown / RLS-hidden id resolves to `null` → notFound().
 *
 * Conventions mirror ./queries.ts:
 *   - all reads go through createServerClient() so RLS auto-scopes to the org;
 *     no organizationId is ever passed in,
 *   - explicit column selects (never select('*')),
 *   - PostgREST embeds are decomposed into follow-up .in() queries,
 *   - small private helpers keep the assembler readable.
 *
 * Type-only imports come from the mock module (the page's render contract);
 * only the DATA call is real. The property header reuses getProperty().
 */

import { createServerClient } from '@/lib/supabase/server';
import { getProperty } from '@/lib/properties/queries';
import { rentCycleFromRow, rentRecommendationCopy } from '@/lib/domain';
import { displayName, displayUnitLabel } from '@/lib/demo-safe/normalize';
import type {
  PropertyDetailMock,
  BadgeSpec,
  AttentionItem,
  MetricCell,
  UnitRow,
  KvCell,
  SourceItem,
  PillSpec,
  Tone,
} from '@/lib/properties/mock-detail';

// =====================================================================
// Public brief shape
// =====================================================================

/**
 * The property brief the detail page renders for `/properties/[id]`.
 *
 * Extends the locked `PropertyDetailMock` render contract with one additive,
 * data-backed field — `badgeReasons` — so the hero can explain WHY its status
 * badge reads the way it does. The base shape is unchanged; the field is
 * consumed only by the hero (rendered under `badge`).
 */
export type PropertyBrief = PropertyDetailMock & {
  /**
   * Plain-language reasons for `badge`, ordered most-severe first. Empty for
   * an operationally-calm property (i.e. exactly when `badge.variant` is
   * `'calm'`). Built entirely from numbers already computed in this file.
   */
  badgeReasons: string[];
};

// =====================================================================
// Constants
// =====================================================================

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Work-order statuses considered "open" (mirrors queries.ts). */
const OPEN_WO_STATUSES = ['open', 'assigned', 'in_progress'] as const;

/** Keep the brief scannable — cap how many exception tiles surface at once. */
const MAX_EXCEPTION_TILES = 3;

/** How many unit labels to name before a "and N more" tail in a summary. */
const MAX_NAMED_LATE_UNITS = 3;

/** Active leases whose end_date falls inside this horizon count as "ending soon". */
const LEASE_ENDING_SOON_DAYS = 60;

/** rent_event statuses that mean the tenant is behind on the cycle. */

/** Human labels for the work_order_category enum (no `title` column exists). */
const CATEGORY_LABEL: Record<string, string> = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  appliances: 'Appliance',
  flooring: 'Flooring',
  painting: 'Painting',
  landscaping: 'Landscaping',
  security: 'Security',
  cleaning: 'Cleaning',
  general: 'General',
  other: 'Maintenance',
};

/** Month names for the rent-cycle label, e.g. "Rent · May". */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

// =====================================================================
// Internal row shapes (decomposed query results)
// =====================================================================

interface UnitRowDb {
  id: string;
  label: string;
}

interface LeaseRowDb {
  id: string;
  unit_id: string;
  tenant_id: string;
  rent_amount: number;
  end_date: string | null;
}

interface RentEventRowDb {
  lease_id: string;
  cycle_month: string;
  amount_due: number;
  amount_paid: number;
  status: string;
  due_date: string | null;
}

interface WorkOrderRowDb {
  id: string;
  unit_id: string;
  vendor_id: string | null;
  category: string;
  urgency: string;
  status: string;
  description: string | null;
  updated_at: string;
}

// =====================================================================
// Formatting helpers
// =====================================================================

function formatUsd(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

function formatRentPerMo(dollars: number): string {
  return `${formatUsd(dollars)}/mo`;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/** Most-recent rent cycle present in the data, as a YYYY-MM-DD string. */
function latestCycleMonth(events: RentEventRowDb[]): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (!e.cycle_month) continue;
    if (latest === null || e.cycle_month > latest) latest = e.cycle_month;
  }
  return latest;
}

/** "May" from a YYYY-MM-DD cycle string, else "this cycle". */
function monthLabel(cycle: string | null): string {
  if (!cycle) return 'this cycle';
  const m = Number(cycle.slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12
    ? MONTH_NAMES[m - 1]
    : 'this cycle';
}

/** Short label for the month AFTER the given cycle, e.g. "Jun 1". */
function nextExpectedLabel(cycle: string | null): string {
  if (!cycle) return 'Next cycle';
  const m = Number(cycle.slice(5, 7));
  if (!Number.isFinite(m) || m < 1 || m > 12) return 'Next cycle';
  const nextIdx = m % 12; // 0-based index of next month
  return `${MONTH_SHORT[nextIdx]} 1`;
}

/**
 * Date-aware lateness for a cycle row — a stale `pending` past its due
 * date counts; `plan_agreed` never does. Delegates to the canonical
 * domain derivation so this page agrees with every other surface.
 */
function isLateCycle(event: RentEventRowDb, todayIso: string): boolean {
  return rentCycleFromRow(event, todayIso).isLate;
}

/**
 * Count active leases whose `end_date` falls within the next `withinDays`
 * days (inclusive of today). Uses the real lease end dates already loaded —
 * leases with no end date or an unparseable value are skipped.
 */
function countLeasesEndingSoon(
  leases: readonly LeaseRowDb[],
  todayIso: string,
  withinDays: number,
): number {
  const today = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(today.getTime())) return 0;
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() + withinDays);

  let count = 0;
  for (const lease of leases) {
    if (!lease.end_date) continue;
    const end = new Date(`${lease.end_date}T00:00:00Z`);
    if (Number.isNaN(end.getTime())) continue;
    if (end >= today && end <= horizon) count += 1;
  }
  return count;
}

function workOrderTitle(category: string, description: string | null): string {
  const label = CATEGORY_LABEL[category] ?? CATEGORY_LABEL.other;
  // Prefer the first sentence of the free-form description when present so the
  // attention row reads naturally; fall back to the category label.
  if (description && description.trim().length > 0) {
    const firstSentence = description.split(/[.\n]/)[0]?.trim();
    if (firstSentence) return firstSentence;
  }
  return `${label} request`;
}

// =====================================================================
// Data fetch
// =====================================================================

async function fetchUnits(
  supabase: SupabaseServerClient,
  propertyId: string,
): Promise<UnitRowDb[]> {
  const { data } = await supabase
    .from('units')
    .select('id, label')
    .eq('property_id', propertyId)
    .order('label', { ascending: true });
  return (data ?? []) as UnitRowDb[];
}

async function fetchActiveLeases(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<LeaseRowDb[]> {
  if (unitIds.length === 0) return [];
  const { data } = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id, rent_amount, end_date')
    .in('unit_id', unitIds)
    .eq('status', 'active');
  return ((data ?? []) as Array<{
    id: string;
    unit_id: string;
    tenant_id: string;
    rent_amount: number;
    end_date: string | null;
  }>).map((l) => ({
    id: l.id,
    unit_id: l.unit_id,
    tenant_id: l.tenant_id,
    rent_amount: Number(l.rent_amount),
    end_date: l.end_date,
  }));
}

async function fetchTenantNames(
  supabase: SupabaseServerClient,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (tenantIds.length === 0) return m;
  const { data } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);
  for (const t of (data ?? []) as Array<{ id: string; full_name: string }>) {
    // Keyed on the real tenant id; the value is display-only, so normalize.
    m.set(t.id, displayName(t.full_name));
  }
  return m;
}

async function fetchRentEvents(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
): Promise<RentEventRowDb[]> {
  if (leaseIds.length === 0) return [];
  const { data } = await supabase
    .from('rent_events')
    .select('lease_id, cycle_month, amount_due, amount_paid, status, due_date')
    .in('lease_id', leaseIds);
  return ((data ?? []) as Array<{
    lease_id: string;
    cycle_month: string;
    amount_due: number;
    amount_paid: number;
    status: string;
    due_date: string | null;
  }>).map((r) => ({
    lease_id: r.lease_id,
    cycle_month: r.cycle_month,
    amount_due: Number(r.amount_due),
    amount_paid: Number(r.amount_paid),
    status: r.status,
    due_date: r.due_date,
  }));
}

async function fetchWorkOrders(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<WorkOrderRowDb[]> {
  if (unitIds.length === 0) return [];
  const { data } = await supabase
    .from('work_orders')
    .select('id, unit_id, vendor_id, category, urgency, status, description, updated_at')
    .in('unit_id', unitIds);
  return (data ?? []) as WorkOrderRowDb[];
}

async function fetchVendorNames(
  supabase: SupabaseServerClient,
  vendorIds: readonly string[],
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (vendorIds.length === 0) return m;
  const { data } = await supabase
    .from('vendors')
    .select('id, name')
    .in('id', vendorIds);
  for (const v of (data ?? []) as Array<{ id: string; name: string }>) {
    m.set(v.id, v.name);
  }
  return m;
}

// =====================================================================
// Assembly
// =====================================================================

/**
 * Returns the property brief in the page's `PropertyDetailMock` shape, built
 * entirely from real Supabase rows. `id` is the property UUID. Returns `null`
 * when the property doesn't exist or RLS hides it (so the page can notFound()).
 *
 * Field provenance (vs the rich mock):
 *   - name / address / kpis        ← getProperty()
 *   - badge / attention / metrics  ← derived from rent_events + work_orders
 *   - units                        ← units + active leases + tenants + late flags
 *   - rent / vendors / sources     ← derived from the latest rent cycle + WOs
 * Narrative-only mock fields (payment-plan copy, appliance ages, audit
 * freshness strings) have no DB source and are derived/sensible-defaulted.
 *
 * @param id - property UUID
 * @returns the brief payload, or null when not found
 */
export async function getPropertyBrief(
  id: string,
): Promise<PropertyBrief | null> {
  const supabase = await createServerClient();

  // Header + KPIs (also the not-found gate).
  const property = await getProperty(id);
  if (!property) return null;

  const units = await fetchUnits(supabase, id);
  const unitIds = units.map((u) => u.id);
  // Display-only label map, keyed on the real unit id (never the label).
  const unitLabelById = new Map(
    units.map((u) => [u.id, displayUnitLabel(u.label)] as const),
  );

  const leases = await fetchActiveLeases(supabase, unitIds);
  const leaseByUnit = new Map(leases.map((l) => [l.unit_id, l] as const));
  const leaseById = new Map(leases.map((l) => [l.id, l] as const));
  const leaseIds = leases.map((l) => l.id);
  const tenantIds = Array.from(new Set(leases.map((l) => l.tenant_id)));

  const [tenantNames, rentEvents, workOrders] = await Promise.all([
    fetchTenantNames(supabase, tenantIds),
    fetchRentEvents(supabase, leaseIds),
    fetchWorkOrders(supabase, unitIds),
  ]);

  const vendorIds = Array.from(
    new Set(
      workOrders
        .map((w) => w.vendor_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const vendorNames = await fetchVendorNames(supabase, vendorIds);

  // --- Rent cycle math (latest cycle present in the data) -----------------
  const cycle = latestCycleMonth(rentEvents);
  const cycleEvents = cycle
    ? rentEvents.filter((e) => e.cycle_month === cycle)
    : [];
  const cycleDue = cycleEvents.reduce((s, e) => s + e.amount_due, 0);
  const cyclePaid = cycleEvents.reduce((s, e) => s + e.amount_paid, 0);
  const collectedPct = pct(cyclePaid, cycleDue);
  const outstanding = Math.max(0, cycleDue - cyclePaid);

  // Late leases → which units are behind. Date-aware (due_date vs today +
  // balance), never the raw enum. Scans EVERY fetched cycle, not just the
  // latest, so unpaid prior-cycle debt survives month rollover — a fresh
  // due_sent row on one lease must not hide another lease's June escalation.
  const todayIso = new Date().toISOString().slice(0, 10);
  const lateLeaseIds = new Set(
    rentEvents.filter((e) => isLateCycle(e, todayIso)).map((e) => e.lease_id),
  );
  const lateUnitLabels: string[] = [];
  for (const leaseId of lateLeaseIds) {
    const lease = leaseById.get(leaseId);
    const label = lease ? unitLabelById.get(lease.unit_id) : undefined;
    if (label) lateUnitLabels.push(`Unit ${label}`);
  }
  lateUnitLabels.sort();

  // --- Work orders --------------------------------------------------------
  const openWorkOrders = workOrders.filter((w) =>
    (OPEN_WO_STATUSES as readonly string[]).includes(w.status),
  );
  const completedWorkOrders = workOrders
    .filter((w) => w.status === 'completed')
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  // --- Occupancy ----------------------------------------------------------
  const occupiedCount = new Set(leases.map((l) => l.unit_id)).size;
  const occupancyLabel = `${occupiedCount}/${units.length}`;

  // --- Badge --------------------------------------------------------------
  const endingSoonCount = countLeasesEndingSoon(
    leases,
    todayIso,
    LEASE_ENDING_SOON_DAYS,
  );
  const badge = deriveBadge(lateLeaseIds.size, openWorkOrders.length, units.length);
  // Data-backed explanation for the hero badge. Empty exactly when calm so the
  // hero can render nothing under a "Calm" badge.
  const badgeReasons = badge.variant === 'calm'
    ? []
    : buildBadgeReasons(
        outstanding,
        lateLeaseIds.size,
        openWorkOrders.length,
        endingSoonCount,
      );

  // --- Assemble sections --------------------------------------------------
  const monthName = monthLabel(cycle);

  const meta = buildMeta(property, units.length, occupiedCount, collectedPct, monthName);
  const attention = buildAttention(
    lateUnitLabels,
    outstanding,
    collectedPct,
    monthName,
    openWorkOrders,
    unitLabelById,
    vendorNames,
  );
  const attentionCount = buildAttentionCount(attention.length, lateLeaseIds.size);
  const metrics = buildMetrics(
    occupancyLabel,
    collectedPct,
    monthName,
    attention.length,
    property.kpis.mrrCents,
    openWorkOrders.length,
  );
  const unitsList = buildUnits(units, leaseByUnit, tenantNames, lateLeaseIds);
  const unitsSub = buildUnitsSub(units.length, lateLeaseIds.size, openWorkOrders.length);
  const rent = buildRent(monthName, collectedPct, outstanding, lateUnitLabels, cycle);
  const vendors = buildVendors(openWorkOrders, completedWorkOrders, unitLabelById, vendorNames);
  const sources = buildSources(workOrders.length);

  return {
    slug: id,
    name: property.name,
    badge,
    badgeReasons,
    meta,
    attentionCount,
    attention,
    odesaNote: {
      body: buildOdesaNoteBody(lateUnitLabels, openWorkOrders.length),
      basedOn: 'payment history · work order log · lease terms',
    },
    metrics,
    unitsSub,
    units: unitsList,
    rent,
    vendors,
    sources,
    ask: {
      subject: property.name,
      contextLabel: property.name,
      prompts: [
        'What should I do first?',
        'Show rent risk',
        'Summarize open maintenance',
        'Which units need attention?',
        'Prepare owner update',
      ],
    },
  };
}

// =====================================================================
// Section builders (pure)
// =====================================================================

function deriveBadge(
  lateCount: number,
  openWoCount: number,
  unitCount: number,
): BadgeSpec {
  if (unitCount === 0) return { variant: 'calm', label: 'Calm' };
  if (lateCount > 0) return { variant: 'atrisk', label: 'At risk' };
  if (openWoCount > 0) return { variant: 'watching', label: 'Watching' };
  return { variant: 'calm', label: 'Calm' };
}

/**
 * Plain-language reasons for the hero status badge, ordered most-severe first:
 * outstanding rent (the concrete financial exposure) → units past grace →
 * open maintenance → upcoming lease renewals. Every entry is backed by a real
 * number already computed in the assembler. Callers pass `[]` for a calm
 * property; this returns the natural empty array when nothing is flagged.
 */
function buildBadgeReasons(
  outstanding: number,
  lateCount: number,
  openWoCount: number,
  endingSoonCount: number,
): string[] {
  const reasons: string[] = [];
  if (outstanding > 0) {
    reasons.push(`${formatUsd(outstanding)} rent outstanding`);
  }
  if (lateCount > 0) {
    reasons.push(
      `${lateCount} ${lateCount === 1 ? 'unit needs' : 'units need'} rent follow-up`,
    );
  }
  if (openWoCount > 0) {
    reasons.push(
      `${openWoCount} open maintenance ticket${openWoCount === 1 ? '' : 's'}`,
    );
  }
  if (endingSoonCount > 0) {
    reasons.push(
      `${endingSoonCount} lease${endingSoonCount === 1 ? '' : 's'} ending soon`,
    );
  }
  return reasons;
}

function buildMeta(
  property: NonNullable<Awaited<ReturnType<typeof getProperty>>>,
  unitCount: number,
  occupiedCount: number,
  collectedPct: number,
  monthName: string,
): string[] {
  const locationParts = [property.addressCity, property.addressState].filter(
    (v): v is string => Boolean(v),
  );
  const meta: string[] = [];
  if (locationParts.length > 0) meta.push(locationParts.join(', '));
  meta.push(`${unitCount} ${unitCount === 1 ? 'unit' : 'units'}`);
  meta.push(`${occupiedCount}/${unitCount} occupied`);
  meta.push(`${collectedPct}% ${monthName} collected`);
  return meta;
}

function buildAttention(
  lateUnitLabels: string[],
  outstanding: number,
  collectedPct: number,
  monthName: string,
  openWorkOrders: WorkOrderRowDb[],
  unitLabelById: Map<string, string>,
  vendorNames: Map<string, string>,
): AttentionItem[] {
  const rows: AttentionItem[] = [];

  // Rent late — a single tile when exactly one unit is behind; otherwise a
  // single rolled-up summary so a row of identical tiles never floods the
  // brief. The grouped summary counts as one exception tile.
  if (lateUnitLabels.length === 1) {
    const unitLabel = lateUnitLabels[0];
    rows.push({
      dot: 'clay',
      kind: 'Rent late',
      loc: unitLabel,
      detail: 'Payment past the grace period · follow-up recommended',
      ariaLabel: `Rent late at ${unitLabel}. Payment past the grace period · follow-up recommended`,
      actions: [
        { label: 'View ledger', variant: 'primary' },
        { label: 'Message tenant', variant: 'default' },
      ],
    });
  } else if (lateUnitLabels.length > 1) {
    const n = lateUnitLabels.length;
    const shown = lateUnitLabels.slice(0, MAX_NAMED_LATE_UNITS);
    const extra = n - shown.length;
    const detail =
      extra > 0 ? `${shown.join(', ')} and ${extra} more` : shown.join(', ');
    const summary = `${n} leases past grace period`;
    rows.push({
      dot: 'clay',
      kind: 'Rent late',
      loc: summary,
      detail,
      ariaLabel: `Rent late. ${summary} · ${detail}`,
      actions: [{ label: 'Open ledger', variant: 'primary' }],
    });
  }

  // Collection-risk summary when there is an outstanding balance.
  if (outstanding > 0) {
    const detail = `${formatUsd(outstanding)} outstanding · ${collectedPct}% of ${monthName} collected`;
    rows.push({
      dot: 'amber',
      kind: 'Collection risk',
      detail,
      ariaLabel: `Collection risk. ${detail}`,
      actions: [{ label: 'View ledger', variant: 'default' }],
    });
  }

  // One row per open work order.
  for (const wo of openWorkOrders) {
    const unitLabel = unitLabelById.get(wo.unit_id);
    const loc = unitLabel ? `Unit ${unitLabel}` : undefined;
    const vendorName = wo.vendor_id ? vendorNames.get(wo.vendor_id) : null;
    const dot: Tone = wo.urgency === 'emergency' ? 'clay' : 'amber';
    const kind = workOrderTitle(wo.category, wo.description);
    const detail = vendorName
      ? `${vendorName} · ${wo.status.replace('_', ' ')}`
      : `Awaiting vendor · ${wo.status.replace('_', ' ')}`;
    const ariaLoc = loc ? ` at ${loc}` : '';
    rows.push({
      dot,
      kind,
      loc,
      detail,
      ariaLabel: `${kind}${ariaLoc}. ${detail}`,
      actions: [{ label: 'View order', variant: 'default' }],
    });
  }

  // Cap visible exception tiles so the brief stays scannable. The rolled-up
  // rent-late summary already counts as a single tile here.
  const capped = rows.slice(0, MAX_EXCEPTION_TILES);

  // Operationally-calm fallback so the brief never renders empty.
  if (capped.length === 0) {
    capped.push({
      dot: 'green',
      kind: 'All clear',
      detail: 'Rent collected · no open work orders · no active items',
      ariaLabel: 'All clear. Rent collected · no open work orders · no active items',
      actions: [{ label: 'View ledger', variant: 'default' }],
    });
  }

  return capped;
}

function buildAttentionCount(rowCount: number, lateCount: number): string {
  if (rowCount === 0) return 'all clear';
  const active = `${rowCount} active`;
  return lateCount > 0 ? `${active} · ${lateCount} risk` : active;
}

function buildMetrics(
  occupancyLabel: string,
  collectedPct: number,
  monthName: string,
  activeItems: number,
  mrrCents: number,
  openWoCount: number,
): MetricCell[] {
  return [
    { label: 'Occupancy', value: occupancyLabel },
    {
      label: `${monthName} collected`,
      value: `${collectedPct}%`,
      tone: collectedPct >= 100 ? 'good' : 'warn',
    },
    { label: 'Active items', value: String(activeItems) },
    { label: 'Monthly rent', value: formatUsd(mrrCents / 100) },
    { label: 'Open work orders', value: String(openWoCount) },
  ];
}

function buildUnits(
  units: UnitRowDb[],
  leaseByUnit: Map<string, LeaseRowDb>,
  tenantNames: Map<string, string>,
  lateLeaseIds: Set<string>,
): UnitRow[] {
  return units.map((u) => {
    const lease = leaseByUnit.get(u.id);
    const label = `Unit ${displayUnitLabel(u.label)}`;

    if (!lease) {
      // Vacant: the status pill already says "Vacant" — don't repeat it as
      // a tenant name (that read like a tenant literally named "Vacant").
      const status: PillSpec = { variant: 'watching', label: 'Vacant' };
      return {
        unitSlug: u.id,
        label,
        tenantName: '',
        rent: '—',
        status,
        ariaLabel: `View ${label}, vacant`,
      };
    }

    const tenantName = tenantNames.get(lease.tenant_id) ?? 'Tenant';
    const rent = formatRentPerMo(lease.rent_amount);
    const isLate = lateLeaseIds.has(lease.id);
    const status: PillSpec = isLate
      ? { variant: 'plan', label: 'Rent late' }
      : { variant: 'current', label: 'Current' };
    const sub = isLate ? 'Past grace period' : undefined;
    const ariaLabel = sub
      ? `View ${label}, tenant ${tenantName}, ${rent}, ${status.label}, ${sub}`
      : `View ${label}, tenant ${tenantName}, ${rent}, ${status.label}`;

    return {
      unitSlug: u.id,
      label,
      tenantName,
      sub,
      rent,
      status,
      ariaLabel,
    };
  });
}

function buildUnitsSub(
  unitCount: number,
  lateCount: number,
  openWoCount: number,
): string {
  const base = `${unitCount} ${unitCount === 1 ? 'unit' : 'units'}`;
  const parts: string[] = [];
  if (lateCount > 0) parts.push(`${lateCount} rent late`);
  if (openWoCount > 0) parts.push(`${openWoCount} open work order${openWoCount === 1 ? '' : 's'}`);
  if (parts.length === 0) parts.push('all current');
  return `${base} · ${parts.join(' · ')}`;
}

function buildRent(
  monthName: string,
  collectedPct: number,
  outstanding: number,
  lateUnitLabels: string[],
  cycle: string | null,
): PropertyDetailMock['rent'] {
  const cells: KvCell[] = [
    { k: `${monthName} collected`, v: `${collectedPct}%` },
    { k: 'Outstanding', v: formatUsd(outstanding), mono: true },
    { k: 'Late unit', v: lateUnitLabels.length > 0 ? lateUnitLabels.join(', ') : 'None' },
    { k: 'Next expected', v: nextExpectedLabel(cycle) },
  ];
  const note = outstanding > 0
    ? 'If the outstanding balance is missed, Odesa will draft escalation options for your review.'
    : undefined;
  return { label: `Rent · ${monthName}`, cells, note };
}

function buildVendors(
  openWorkOrders: WorkOrderRowDb[],
  completedWorkOrders: WorkOrderRowDb[],
  unitLabelById: Map<string, string>,
  vendorNames: Map<string, string>,
): PropertyDetailMock['vendors'] {
  if (openWorkOrders.length > 0) {
    const lead = openWorkOrders[0];
    const unitLabel = unitLabelById.get(lead.unit_id);
    const vendorName = lead.vendor_id ? vendorNames.get(lead.vendor_id) : null;
    const dot: Tone = lead.urgency === 'emergency' ? 'clay' : 'amber';
    const count = openWorkOrders.length;
    return {
      dot,
      kind: `${count} open work order${count === 1 ? '' : 's'}`,
      detail: unitLabel
        ? `${workOrderTitle(lead.category, lead.description)} · Unit ${unitLabel}`
        : workOrderTitle(lead.category, lead.description),
      cells: [
        { k: 'Lead order', v: vendorName ?? 'Awaiting vendor' },
        { k: 'Status', v: lead.status.replace('_', ' ') },
      ],
    };
  }

  // No open work — surface the most recent completed visit when available.
  const lastDone = completedWorkOrders[0];
  if (lastDone) {
    const vendorName = lastDone.vendor_id ? vendorNames.get(lastDone.vendor_id) : null;
    return {
      dot: 'green',
      kind: 'No open work orders',
      detail: 'This property is operationally calm on maintenance.',
      cells: [
        { k: 'Last vendor', v: vendorName ?? '—' },
        { k: 'Work', v: workOrderTitle(lastDone.category, lastDone.description) },
      ],
    };
  }

  return {
    dot: 'green',
    kind: 'No open work orders',
    detail: 'This property is operationally calm on maintenance.',
    cells: [
      { k: 'Last vendor visit', v: 'None on record' },
      { k: 'Work', v: '—' },
    ],
  };
}

function buildSources(workOrderCount: number): SourceItem[] {
  const sources: SourceItem[] = [
    { label: 'Payment history', freshness: 'synced' },
    { label: 'Lease terms', freshness: 'active' },
  ];
  if (workOrderCount > 0) {
    sources.push({ label: 'Work order log', freshness: 'live' });
  }
  sources.push({ label: 'Owner rules', freshness: 'active' });
  return sources;
}

function buildOdesaNoteBody(
  lateUnitLabels: string[],
  openWoCount: number,
): string {
  if (lateUnitLabels.length === 0 && openWoCount === 0) {
    return 'This property is **operationally calm**. Rent is collected and there are no open work orders. Odesa will surface anything new the moment it appears.';
  }
  const parts: string[] = [];
  if (lateUnitLabels.length > 0) {
    parts.push(
      `Odesa is watching rent at **${lateUnitLabels.join(', ')}**`,
    );
  }
  if (openWoCount > 0) {
    parts.push(
      `tracking **${openWoCount} open work order${openWoCount === 1 ? '' : 's'}**`,
    );
  }
  const lead = `${parts.join(' and ')}.`;
  // When rent is late, the recommendation aligns with the canonical rent
  // helper instead of flatly claiming no escalation is recommended.
  if (lateUnitLabels.length > 0) {
    return `${lead} ${rentRecommendationCopy('late')}`;
  }
  return `${lead} No owner escalation is recommended unless an item stalls.`;
}
