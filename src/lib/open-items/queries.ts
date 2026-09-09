/**
 * Open items — cross-portfolio "needs attention" feed for `/open-items`.
 *
 * Replaces the mock `getOpenItems()` with a real Supabase union across four
 * live sources, mapped onto the mock's `OpenItemKind` enum:
 *
 *   - maintenance ← `work_orders` still open (open/assigned/in_progress) PLUS
 *                   completed-but-unreviewed ("Needs owner review") rows
 *   - rent        ← `rent_events` in a late/escalated status
 *   - owner       ← `action_proposals` pending review (status 'proposed'
 *                   OR gate_decision 'review')
 *   - leasing     ← vacant units (no active lease) on the portfolio
 *
 * All reads go through `createServerClient()` so RLS auto-scopes to the
 * caller's organization. Following `@/lib/properties/queries.ts`: explicit
 * column selection (never `select('*')`), joins decomposed into follow-up
 * `in()` queries rather than PostgREST embeds.
 *
 * The return shape is field-for-field identical to the mock's `OpenItemsList`
 * (re-using the mock's `OpenItemRow` / `OpenItemKind` / facet types) so the
 * `OpenItemsFilterList` island renders unchanged. hrefs carry REAL UUIDs into
 * the detail routes (`/work-orders/<uuid>`, `/tenants/<uuid>`,
 * `/properties/<uuid>/units/<uuid>`, `/owner-queue`).
 */

import { createServerClient } from '@/lib/supabase/server';
import type { RentEventStatus } from '@/types/database';
import type {
  FacetSpec,
  OpenItemFacetId,
  OpenItemKind,
  OpenItemRow,
  OpenItemsHeader,
  OpenItemsList,
} from '@/lib/properties/mock-portfolio-views';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Work-order statuses that count as "open" (mirrors properties/queries). */
const OPEN_WO_STATUSES = ['open', 'assigned', 'in_progress'] as const;

/** Rent-event statuses that surface a unit as needing attention. */
const LATE_RENT_STATUSES: RentEventStatus[] = [
  'late_1',
  'late_3',
  'late_7',
  'escalated',
];

/** Owner queue route (the `owner` kind's drill target). */
const OWNER_QUEUE_HREF = '/owner-queue';

/** Maximum cumulative open items pulled into the feed (defensive ceiling). */
const MAX_ITEMS = 200;

// =====================================================================
// Public entry point
// =====================================================================

/**
 * Returns the cross-portfolio open-items list (header summary + facets +
 * ordered rows), unioned across work orders, late rent, owner proposals,
 * and vacant units. Empty sources contribute nothing; a fully-quiet
 * portfolio yields zero rows (the UI renders its own empty state).
 *
 * Row ordering follows the mock's grouping intent: maintenance first,
 * then rent, then owner, then leasing — each group internally ordered
 * by recency / severity. `index` is the 1-based position after ordering.
 */
export async function listOpenItems(): Promise<OpenItemsList> {
  const supabase = await createServerClient();

  // Shared lookups (units → property/label, properties → name) are resolved
  // once and reused across the per-source builders to avoid duplicate reads.
  const [maintenance, rent, owner, leasing] = await Promise.all([
    buildMaintenanceItems(supabase),
    buildRentItems(supabase),
    buildOwnerItems(supabase),
    buildLeasingItems(supabase),
  ]);

  const ordered = [...maintenance, ...rent, ...owner, ...leasing].slice(
    0,
    MAX_ITEMS,
  );

  // Stamp the 1-based index after the final ordering is known.
  const rows: OpenItemRow[] = ordered.map((row, idx) => ({
    ...row,
    index: String(idx + 1),
  }));

  return {
    header: buildHeader(rows),
    facets: buildFacets(rows),
    rows,
  };
}

// =====================================================================
// Source builders — each returns rows WITHOUT the final `index` (stamped
// by listOpenItems after the union is ordered).
// =====================================================================

type PreIndexRow = Omit<OpenItemRow, 'index'>;

/**
 * maintenance ← open `work_orders` PLUS completed-but-unreviewed ones. The
 * "Needs owner review" rows keep the review step discoverable; reviewed and
 * cancelled WOs correctly fall out. Resolves unit → property for the location
 * line. One query, newest first within the group.
 */
async function buildMaintenanceItems(
  supabase: SupabaseServerClient,
): Promise<PreIndexRow[]> {
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select(
      'id, unit_id, category, urgency, status, description, created_at, reviewed_at',
    )
    .or(
      `status.in.(${OPEN_WO_STATUSES.join(',')}),and(status.eq.completed,reviewed_at.is.null)`,
    )
    .order('created_at', { ascending: false });

  if (!workOrders || workOrders.length === 0) return [];

  const unitIds = uniq(workOrders.map((w) => w.unit_id));
  const unitMap = await fetchUnitContext(supabase, unitIds);

  return workOrders.map((wo) => {
    const unit = unitMap.get(wo.unit_id);
    // completed rows are here only because reviewed_at IS NULL -> owner review.
    const needsReview = wo.status === 'completed';
    return {
      kind: 'maintenance' as OpenItemKind,
      title: titleCase(wo.category) || 'Work order',
      loc: locLine(unit?.propertyName, unit?.label),
      detail: needsReview
        ? [wo.description, 'Needs owner review'].filter(Boolean).join(' · ')
        : maintenanceDetail(wo.urgency, wo.status, wo.description),
      action: needsReview ? 'Review work' : 'View ticket',
      href: `/work-orders/${wo.id}`,
    };
  });
}

/**
 * rent ← late/escalated `rent_events`. Resolves lease → tenant for the
 * title and href, lease → unit → property for the location line. Most
 * delinquent first (escalated → late_7 → late_3 → late_1).
 */
async function buildRentItems(
  supabase: SupabaseServerClient,
): Promise<PreIndexRow[]> {
  const { data: events } = await supabase
    .from('rent_events')
    .select('id, lease_id, status, cycle_month, amount_due, due_date')
    .in('status', LATE_RENT_STATUSES);

  if (!events || events.length === 0) return [];

  const leaseIds = uniq(events.map((e) => e.lease_id));
  const { data: leases } = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id')
    .in('id', leaseIds);

  const leaseById = new Map<string, { unitId: string; tenantId: string }>();
  for (const l of leases ?? []) {
    leaseById.set(l.id, { unitId: l.unit_id, tenantId: l.tenant_id });
  }

  const tenantIds = uniq(
    (leases ?? []).map((l) => l.tenant_id).filter(Boolean),
  );
  const unitIds = uniq((leases ?? []).map((l) => l.unit_id).filter(Boolean));

  const [tenantMap, unitMap] = await Promise.all([
    fetchTenantMap(supabase, tenantIds),
    fetchUnitContext(supabase, unitIds),
  ]);

  // De-dupe to one item per lease (a lease may have multiple late cycles),
  // keeping the most-delinquent status.
  const byLease = new Map<string, (typeof events)[number]>();
  for (const ev of events) {
    const existing = byLease.get(ev.lease_id);
    if (!existing || rentRank(ev.status) > rentRank(existing.status)) {
      byLease.set(ev.lease_id, ev);
    }
  }

  const deduped = Array.from(byLease.values()).sort(
    (a, b) => rentRank(b.status) - rentRank(a.status),
  );

  return deduped.map((ev) => {
    const lease = leaseById.get(ev.lease_id);
    const tenant = lease ? tenantMap.get(lease.tenantId) : undefined;
    const unit = lease ? unitMap.get(lease.unitId) : undefined;
    return {
      kind: 'rent' as OpenItemKind,
      title: rentTitle(ev.status),
      loc: locLine(unit?.propertyName, unit?.label),
      detail: rentDetail(tenant?.fullName ?? null, ev.status, ev.amount_due),
      action: 'Review plan',
      href: tenant ? `/tenants/${tenant.id}` : OWNER_QUEUE_HREF,
    };
  });
}

/**
 * owner ← `action_proposals` awaiting a human gate (status 'proposed' OR
 * gate_decision 'review'). Resolves property → name for the location line.
 * Newest first. (Galaxy currently has 0 proposals — this group is often
 * empty, which is fine.)
 */
async function buildOwnerItems(
  supabase: SupabaseServerClient,
): Promise<PreIndexRow[]> {
  const { data: proposals } = await supabase
    .from('action_proposals')
    .select(
      'id, property_id, action_type, status, gate_decision, reasoning, created_at',
    )
    .order('created_at', { ascending: false });

  if (!proposals || proposals.length === 0) return [];

  const pending = proposals.filter(
    (p) => p.status === 'proposed' || p.gate_decision === 'review',
  );
  if (pending.length === 0) return [];

  const propertyIds = uniq(pending.map((p) => p.property_id));
  const propertyMap = await fetchPropertyNameMap(supabase, propertyIds);

  return pending.map((p) => ({
    kind: 'owner' as OpenItemKind,
    title: titleCase(p.action_type) || 'Owner decision',
    loc: propertyMap.get(p.property_id) ?? 'Portfolio',
    detail: ownerDetail(p.reasoning),
    action: 'View decision',
    href: OWNER_QUEUE_HREF,
  }));
}

/**
 * leasing ← vacant units (no active lease). Resolves property → name for
 * the location line. href targets the unit detail with real UUIDs.
 * Ordered by property name then unit label for stability.
 */
async function buildLeasingItems(
  supabase: SupabaseServerClient,
): Promise<PreIndexRow[]> {
  const { data: units } = await supabase
    .from('units')
    .select('id, label, property_id');

  if (!units || units.length === 0) return [];

  const unitIds = units.map((u) => u.id);
  const { data: activeLeases } = await supabase
    .from('leases')
    .select('unit_id')
    .in('unit_id', unitIds)
    .eq('status', 'active');

  const occupied = new Set((activeLeases ?? []).map((l) => l.unit_id));
  const vacant = units.filter((u) => !occupied.has(u.id));
  if (vacant.length === 0) return [];

  const propertyIds = uniq(vacant.map((u) => u.property_id));
  const propertyMap = await fetchPropertyNameMap(supabase, propertyIds);

  return vacant
    .map((u) => ({
      unit: u,
      propertyName: propertyMap.get(u.property_id) ?? 'Portfolio',
    }))
    .sort((a, b) => {
      const byProp = a.propertyName.localeCompare(b.propertyName);
      if (byProp !== 0) return byProp;
      return a.unit.label.localeCompare(b.unit.label);
    })
    .map(({ unit, propertyName }) => ({
      kind: 'leasing' as OpenItemKind,
      title: 'Vacancy',
      loc: locLine(propertyName, unit.label),
      detail: 'No active lease · ready to list',
      action: 'View unit',
      href: `/properties/${unit.property_id}/units/${unit.id}`,
    }));
}

// =====================================================================
// Shared lookups
// =====================================================================

interface UnitContext {
  label: string;
  propertyId: string;
  propertyName: string | null;
}

/**
 * Resolves a set of unit ids to { label, propertyId, propertyName } in two
 * round-trips (units, then their distinct properties).
 */
async function fetchUnitContext(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<Map<string, UnitContext>> {
  const result = new Map<string, UnitContext>();
  if (unitIds.length === 0) return result;

  const { data: units } = await supabase
    .from('units')
    .select('id, label, property_id')
    .in('id', unitIds);

  const rows = units ?? [];
  const propertyIds = uniq(rows.map((u) => u.property_id));
  const propertyMap = await fetchPropertyNameMap(supabase, propertyIds);

  for (const u of rows) {
    result.set(u.id, {
      label: u.label,
      propertyId: u.property_id,
      propertyName: propertyMap.get(u.property_id) ?? null,
    });
  }
  return result;
}

async function fetchPropertyNameMap(
  supabase: SupabaseServerClient,
  propertyIds: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (propertyIds.length === 0) return map;
  const { data } = await supabase
    .from('properties')
    .select('id, name')
    .in('id', propertyIds);
  for (const p of data ?? []) map.set(p.id, p.name);
  return map;
}

interface TenantInfo {
  id: string;
  fullName: string;
}

async function fetchTenantMap(
  supabase: SupabaseServerClient,
  tenantIds: readonly string[],
): Promise<Map<string, TenantInfo>> {
  const map = new Map<string, TenantInfo>();
  if (tenantIds.length === 0) return map;
  const { data } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);
  for (const t of data ?? []) map.set(t.id, { id: t.id, fullName: t.full_name });
  return map;
}

// =====================================================================
// Header + facets
// =====================================================================

/**
 * Builds the header summary line in the mock's format:
 *   "N open · X urgent · Y owner decisions · Z properties"
 *
 * - urgent           → maintenance rows whose detail flags emergency/urgent
 *                      plus escalated rent
 * - owner decisions  → count of `owner` kind rows
 * - properties       → distinct property location prefixes touched
 */
function buildHeader(rows: readonly OpenItemRow[]): OpenItemsHeader {
  const total = rows.length;
  const urgent = rows.filter((r) => isUrgent(r)).length;
  const ownerDecisions = rows.filter((r) => r.kind === 'owner').length;
  const properties = new Set(
    rows.map((r) => propertyPrefix(r.loc)).filter(Boolean),
  ).size;

  const summary = `${total} open · ${urgent} urgent · ${ownerDecisions} owner decision${
    ownerDecisions === 1 ? '' : 's'
  } · ${properties} ${properties === 1 ? 'property' : 'properties'}`;

  return { summary, total };
}

function buildFacets(
  rows: readonly OpenItemRow[],
): readonly FacetSpec<OpenItemFacetId>[] {
  const countKind = (kind: OpenItemKind): number =>
    rows.reduce((n, r) => (r.kind === kind ? n + 1 : n), 0);

  return [
    { id: 'all', label: 'All', count: rows.length },
    { id: 'maintenance', label: 'Maintenance', count: countKind('maintenance') },
    { id: 'rent', label: 'Rent', count: countKind('rent') },
    { id: 'owner', label: 'Owner decisions', count: countKind('owner') },
    { id: 'leasing', label: 'Leasing', count: countKind('leasing') },
  ];
}

// =====================================================================
// Detail / title formatting helpers (pure)
// =====================================================================

/** "22 Oak St · Unit 1A", gracefully degrading when parts are missing. */
function locLine(
  propertyName: string | null | undefined,
  unitLabel: string | null | undefined,
): string {
  const parts: string[] = [];
  if (propertyName) parts.push(propertyName);
  if (unitLabel) parts.push(`Unit ${unitLabel}`);
  return parts.join(' · ') || 'Portfolio';
}

/** Leading "Property" segment of a `loc` line (before the first ` · `). */
function propertyPrefix(loc: string): string {
  const idx = loc.indexOf(' · ');
  return idx === -1 ? loc : loc.slice(0, idx);
}

function maintenanceDetail(
  urgency: string | null,
  status: string | null,
  description: string | null,
): string {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (urgency && urgency !== 'routine') parts.push(`${titleCase(urgency)} priority`);
  if (status) parts.push(statusLabel(status));
  return parts.join(' · ') || 'Open work order';
}

function rentTitle(status: string): string {
  return status === 'escalated' ? 'Rent escalated' : 'Rent late';
}

function rentDetail(
  tenantName: string | null,
  status: string,
  amountDue: number | string | null,
): string {
  const parts: string[] = [];
  if (tenantName) parts.push(tenantName);
  parts.push(rentStatusLabel(status));
  const amount = formatAmount(amountDue);
  if (amount) parts.push(`${amount} due`);
  return parts.join(' · ');
}

function ownerDetail(reasoning: string | null): string {
  const trimmed = (reasoning ?? '').trim();
  if (!trimmed) return 'Owner decision pending';
  const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0];
  const clipped =
    firstSentence.length > 120
      ? `${firstSentence.slice(0, 117)}…`
      : firstSentence;
  return `${clipped} · owner decision pending`;
}

function rentStatusLabel(status: string): string {
  switch (status) {
    case 'late_1':
      return '1 day late';
    case 'late_3':
      return '3 days late';
    case 'late_7':
      return '7 days late';
    case 'escalated':
      return 'escalated';
    default:
      return statusLabel(status);
  }
}

function statusLabel(status: string): string {
  return titleCase(status);
}

/** Numeric rank so the most-delinquent rent event sorts first. */
function rentRank(status: string | null): number {
  switch (status) {
    case 'escalated':
      return 4;
    case 'late_7':
      return 3;
    case 'late_3':
      return 2;
    case 'late_1':
      return 1;
    default:
      return 0;
  }
}

/** A row counts as urgent for the header tally. */
function isUrgent(row: OpenItemRow): boolean {
  if (row.kind === 'rent') {
    return row.title === 'Rent escalated' || /7 days late/.test(row.detail);
  }
  if (row.kind === 'maintenance') {
    return /Emergency priority|Urgent priority/.test(row.detail);
  }
  return false;
}

function formatAmount(amount: number | string | null): string | null {
  if (amount == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** "in_progress" → "In progress"; "hvac" → "Hvac"; "late_3" → "Late 3". */
function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  const spaced = value.replace(/_/g, ' ').trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function uniq(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
