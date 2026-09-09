/**
 * Vendors directory query.
 *
 * Reads go through `createServerClient()` so RLS auto-scopes to the caller's
 * organization_id — these helpers deliberately take no `organizationId`
 * parameter. Column selection is explicit (never `select('*')`) and joins are
 * decomposed into follow-up queries rather than PostgREST embeds, mirroring
 * `src/lib/properties/queries.ts`.
 *
 * Surface:
 *   - listVendorsDirectory() — `/vendors` list view
 *   - getVendorDetail(id)    — `/vendors/[vendorId]` brief (real UUID lookup)
 *
 * Returns the SAME shape as the `getVendorsDirectory()` mock in
 * `src/lib/properties/mock-portfolio-views.ts` so the existing
 * `ListPageShell` + `VendorRow` components render unchanged. The mock's
 * `VendorsDirectory` / `VendorDirectoryRow` / status-pill types are reused
 * directly (type-only imports).
 *
 * Schema note: the real `vendors` table has no `rating` or `trade` column
 * (id, organization_id, name, category, phone_e164, acceptance_rate). We map:
 *   - trade   ← Title-cased `category` (work_order_category enum)
 *   - rating  ← derived from `acceptance_rate` (0–1) scaled to a 5-star value
 *   - status  ← directory pill is DERIVED from the vendor's open work-order
 *               lifecycle (declined/no-response → "Reassign"; awaiting →
 *               "Awaiting reply"; accepted/working → "Active"; none → "No open
 *               jobs"). No curated-status column exists, so we never fabricate
 *               the mock's preferred/switch curation states.
 */

import { createServerClient } from '@/lib/supabase/server';
import type {
  VendorsDirectory,
  VendorDirectoryRow,
  VendorStatusPill,
  VendorDetailMock,
  VendorActiveRow,
  VendorWorkOrderRow,
} from '@/lib/properties/mock-portfolio-views';
import { vendorHref } from '@/lib/properties/mock-portfolio-views';
import type {
  MetricCell,
  MetricTone,
  KvCell,
  SourceItem,
} from '@/lib/properties/mock-detail';
import { workOrderHref } from '@/lib/properties/mock-detail';
import type { WorkOrderStatus, WorkOrderVendorResponse } from '@/types/database';
import {
  deriveVendorChip,
  type VendorLifecycleChip,
} from '@/lib/work-orders/vendor-lifecycle';

// =====================================================================
// Chip-annotated return views (base mock types are frozen — extend, don't edit)
// =====================================================================

/** A vendor-brief WO row plus its honest lifecycle chip (or null). */
export type VendorWorkOrderRowWithChip = VendorWorkOrderRow & {
  chip: VendorLifecycleChip | null;
};

/** Live directory row plus the raw nullable signal needed for truthful VA copy. */
export type VendorDirectoryRowView = VendorDirectoryRow & {
  acceptanceRate: number | null;
};

export type VendorsDirectoryView = Omit<VendorsDirectory, 'rows'> & {
  rows: VendorDirectoryRowView[];
};

/** `getVendorDetail` view: `VendorDetailMock` with chip-annotated WO rows. */
export type VendorDetailView = Omit<VendorDetailMock, 'workOrders'> & {
  workOrders: VendorWorkOrderRowWithChip[];
  acceptanceRate: number | null;
};

// =====================================================================
// Helpers
// =====================================================================

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Work-order statuses that count as "open" (not closed out). */
const CLOSED_WO_STATUSES = ['completed', 'cancelled'] as const;

/**
 * Map a `work_order_category` enum value to the human trade label the mock
 * renders (e.g. `hvac` → "HVAC", `plumbing` → "Plumbing"). Falls back to a
 * Title-cased version of any unknown value.
 */
const CATEGORY_TRADE_LABEL: Record<string, string> = {
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
  other: 'Other',
};

function tradeLabel(category: string | null | undefined): string {
  if (!category) return 'General';
  return CATEGORY_TRADE_LABEL[category] ?? titleCase(category);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Derive a 5-star rating string from `acceptance_rate` (a 0–1 numeric).
 * There is no first-class `rating` column yet, so acceptance rate is the
 * best proxy available — scaled to [0, 5] and rendered with one decimal,
 * matching the mock's "4.8" style.
 */
function ratingFromAcceptance(acceptanceRate: number | null | undefined): string {
  const rate = acceptanceRate == null ? 1 : Number(acceptanceRate);
  const clamped = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;
  return (clamped * 5).toFixed(1);
}

function normalizedAcceptanceRate(
  acceptanceRate: number | null | undefined,
): number | null {
  if (acceptanceRate == null) return null;
  const rate = Number(acceptanceRate);
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : null;
}

/** "1 open" / "0 open" — pluralization stays singular per the mock's labels. */
function openLabel(count: number): string {
  return `${count} open`;
}

/**
 * Detail-page status pill. The schema has no curated-status column, so the
 * vendor brief's title badge stays neutral `active`. (The DIRECTORY pill is
 * derived from live work-order lifecycle via `deriveVendorPill` instead.)
 */
function statusPillFor(): VendorStatusPill {
  return { variant: 'active', label: 'Active' };
}

/** A vendor's open WO in the small shape `deriveVendorChip` needs. */
interface OpenWoLite {
  status: WorkOrderStatus;
  vendorId: string;
  vendorResponse: WorkOrderVendorResponse | null;
  vendorAssignedAt: string | null;
  reviewedAt: string | null;
}

/** Chip tone → attention rank (higher wins when a vendor has several WOs). */
const CHIP_RANK: Record<VendorLifecycleChip['tone'], number> = {
  clay: 3,
  warn: 2,
  good: 1,
  neutral: 0,
};

/** Map the most-actionable lifecycle chip to the directory's compact pill. */
function chipToPill(chip: VendorLifecycleChip): VendorStatusPill {
  switch (chip.tone) {
    case 'clay':
      return { variant: 'switch', label: 'Reassign' };
    case 'warn':
      return { variant: 'switch', label: 'Awaiting reply' };
    case 'good':
      return { variant: 'active', label: 'Active' };
    default:
      return { variant: 'alternative', label: chip.label };
  }
}

/**
 * Honest directory pill derived from the vendor's OPEN work orders. Surfaces
 * the most attention-worthy lifecycle state; a vendor with open work but no
 * chip reads "Active"; no open work reads "No open jobs". Never fabricates a
 * curation state (there is no curated-status column).
 */
function deriveVendorPill(
  openWos: readonly OpenWoLite[],
  vendorName: string,
): VendorStatusPill {
  let best: VendorLifecycleChip | null = null;
  let bestRank = -1;
  for (const wo of openWos) {
    const chip = deriveVendorChip({
      status: wo.status,
      vendorId: wo.vendorId,
      vendorName,
      vendorResponse: wo.vendorResponse,
      vendorAssignedAt: wo.vendorAssignedAt,
      reviewedAt: wo.reviewedAt,
    });
    if (!chip) continue;
    const rank = CHIP_RANK[chip.tone];
    if (rank > bestRank) {
      bestRank = rank;
      best = chip;
    }
  }
  if (best) return chipToPill(best);
  return openWos.length > 0
    ? { variant: 'active', label: 'Active' }
    : { variant: 'alternative', label: 'No open jobs' };
}

// =====================================================================
// Directory
// =====================================================================

/**
 * Returns the `/vendors` directory for the caller's organization: one row
 * per vendor (RLS-scoped) with its open work-order count, plus the header
 * summary line. Open work-order count = work_orders for the vendor whose
 * status is NOT in (completed, cancelled).
 *
 * Matches the `getVendorsDirectory()` mock shape field-for-field. Each row's
 * `slug` is the vendor's real UUID so `/vendors/[vendorId]` resolves once the
 * detail page is wired to UUIDs.
 */
export async function listVendorsDirectory(): Promise<VendorsDirectoryView> {
  const supabase = await createServerClient();

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, name, category, acceptance_rate')
    .order('name', { ascending: true });

  if (!vendors || vendors.length === 0) {
    return {
      header: { summary: '0 vendors · 0 open work orders', total: 0 },
      rows: [],
    };
  }

  const vendorIds = vendors.map((v) => v.id);
  const openByVendor = await fetchOpenWorkOrdersByVendor(supabase, vendorIds);

  const rows: VendorDirectoryRowView[] = vendors.map((v) => {
    const openWos = openByVendor.get(v.id) ?? [];
    return {
      slug: v.id,
      initial: (v.name?.charAt(0) ?? '?').toUpperCase(),
      name: v.name,
      trade: tradeLabel(v.category),
      rating: ratingFromAcceptance(v.acceptance_rate),
      acceptanceRate: normalizedAcceptanceRate(v.acceptance_rate),
      openLabel: openLabel(openWos.length),
      statusPill: deriveVendorPill(openWos, v.name),
      href: vendorHref(v.id),
    };
  });

  const totalOpen = rows.reduce((sum, r) => sum + parseLeadingInt(r.openLabel), 0);

  return {
    header: {
      summary: `${rows.length} ${pluralize(rows.length, 'vendor')} · ${totalOpen} open work ${pluralize(totalOpen, 'order')}`,
      total: rows.length,
    },
    rows,
  };
}

/**
 * Loads open work orders (status NOT in completed/cancelled) per vendor with
 * the lifecycle fields the directory pill derives from. Decomposed follow-up
 * query rather than a PostgREST embed so RLS scoping stays simple and testable.
 * The open count is just the per-vendor array length.
 */
async function fetchOpenWorkOrdersByVendor(
  supabase: SupabaseServerClient,
  vendorIds: readonly string[],
): Promise<Map<string, OpenWoLite[]>> {
  const result = new Map<string, OpenWoLite[]>();
  if (vendorIds.length === 0) return result;

  const { data: workOrders } = await supabase
    .from('work_orders')
    .select('vendor_id, status, vendor_response, vendor_assigned_at, reviewed_at')
    .in('vendor_id', vendorIds)
    .not('status', 'in', `(${CLOSED_WO_STATUSES.join(',')})`);

  for (const wo of workOrders ?? []) {
    if (!wo.vendor_id) continue;
    const list = result.get(wo.vendor_id) ?? [];
    list.push({
      status: wo.status as WorkOrderStatus,
      vendorId: wo.vendor_id,
      vendorResponse: wo.vendor_response,
      vendorAssignedAt: wo.vendor_assigned_at,
      reviewedAt: wo.reviewed_at,
    });
    result.set(wo.vendor_id, list);
  }
  return result;
}

/** Parse the leading integer out of an "N open" label (defensive). */
function parseLeadingInt(label: string): number {
  const n = parseInt(label, 10);
  return Number.isFinite(n) ? n : 0;
}

function pluralize(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

// =====================================================================
// Vendor detail
// =====================================================================

/**
 * A vendor's work_orders joined to their unit + property, in the small
 * shape the brief needs. `unit_id` resolves to a label, `property_id` (via
 * the unit) to a property name, so each WO row can render a "Property ·
 * Unit · status" sub line.
 */
interface VendorWorkOrderRecord {
  id: string;
  category: string;
  status: WorkOrderStatus;
  description: string | null;
  createdAt: string;
  unitLabel: string | null;
  propertyName: string | null;
  vendorResponse: WorkOrderVendorResponse | null;
  vendorAssignedAt: string | null;
  reviewedAt: string | null;
}

/** Work-order statuses that read as "done" (calm check, not active diamond). */
const DONE_WO_STATUSES: ReadonlySet<WorkOrderStatus> = new Set([
  'completed',
  'cancelled',
]);

/**
 * The free-text badge label the brief renders per work-order status. These
 * strings are deliberately the ones `vendor-work-order-list.tsx`'s
 * `badgeVariantFor()` knows how to type — unknown labels fall back to the
 * neutral "scheduled" badge, so the mapping stays safe.
 */
function woBadgeLabel(status: WorkOrderStatus): string {
  switch (status) {
    case 'completed':
      return 'Resolved';
    case 'cancelled':
      return 'Cancelled';
    case 'assigned':
    case 'in_progress':
      return 'Accepted';
    case 'open':
    default:
      return 'Open';
  }
}

/** Title-cased status word for the WO sub line, e.g. "in_progress" → "In progress". */
function statusWord(status: WorkOrderStatus): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "Property · Unit · status" sub line for a WO row (segments present only). */
function woSubLine(wo: VendorWorkOrderRecord): string {
  const parts: string[] = [];
  if (wo.propertyName) parts.push(wo.propertyName);
  if (wo.unitLabel) parts.push(`Unit ${wo.unitLabel}`);
  parts.push(statusWord(wo.status).toLowerCase());
  return parts.join(' · ');
}

/** WO title derived from category (work_orders has no title column). */
function woTitle(category: string): string {
  return `${tradeLabel(category)} work order`;
}

/** Calendar year of the vendor's `created_at` for the "since YEAR" meta chip. */
function sinceYear(createdAt: string | null | undefined): string | null {
  if (!createdAt || createdAt.length < 4) return null;
  const year = createdAt.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

/** Whole-percent on-time figure derived from acceptance_rate (0–1). */
function onTimePct(acceptanceRate: number | null | undefined): number {
  const rate = acceptanceRate == null ? 1 : Number(acceptanceRate);
  const clamped = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;
  return Math.round(clamped * 100);
}

/** A rating ≥ 4.5 reads "good", < 4.0 reads "warn", else neutral. */
function ratingTone(rating: string): MetricTone | undefined {
  const value = Number(rating);
  if (!Number.isFinite(value)) return undefined;
  if (value >= 4.5) return 'good';
  if (value < 4.0) return 'warn';
  return undefined;
}

/** On-time tone: ≥ 90% good, < 80% warn, else neutral. */
function onTimeTone(pct: number): MetricTone | undefined {
  if (pct >= 90) return 'good';
  if (pct < 80) return 'warn';
  return undefined;
}

/**
 * Returns the vendor brief for `/vendors/[vendorId]` in the
 * `VendorDetailMock` shape the page already renders, or `null` when the id
 * is unknown or RLS hides it (foreign org). The page renders `notFound()`
 * on `null`.
 *
 * Real-data mapping (the `vendors` table is far leaner than the mockup):
 *   - statusPill   ← always `active` (no curated-status column — see
 *                    `statusPillFor()`); the page's `switch` branch is never
 *                    taken, so the title badge is always "current".
 *   - meta         ← [trade, rating★, "N jobs", "since YEAR"] derived from
 *                    category / acceptance_rate / WO count / created_at.
 *   - metrics      ← Rating, Jobs (total WOs), On-time % (= acceptance_rate),
 *                    Acceptance %, Open WOs. NB: there is no avg-response
 *                    source, so the mock's "Avg response" cell is replaced by
 *                    "Acceptance" (the real signal we have).
 *   - workOrders   ← real work_orders for this vendor, joined unit→property.
 *   - active       ← derived: first open WO (if any) + a reliability line.
 *   - contact      ← Phone (real) + Trade (derived). No email / coverage /
 *                    insurance / terms columns exist.
 *   - sources      ← Job history only (live). No documents table.
 *
 * @param id - vendors.id (a real UUID)
 */
export async function getVendorDetail(
  id: string,
): Promise<VendorDetailView | null> {
  const supabase = await createServerClient();

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, name, category, phone_e164, acceptance_rate, created_at')
    .eq('id', id)
    .maybeSingle();

  if (!vendor) return null;

  const workOrders = await fetchVendorWorkOrders(supabase, vendor.id);

  const trade = tradeLabel(vendor.category);
  const rating = ratingFromAcceptance(vendor.acceptance_rate);
  const onTime = onTimePct(vendor.acceptance_rate);
  const acceptancePct = onTime; // same source — surfaced under two labels.

  const totalJobs = workOrders.length;
  const openWorkOrders = workOrders.filter(
    (w) => !DONE_WO_STATUSES.has(w.status),
  );
  const completedCount = totalJobs - openWorkOrders.length;
  const openCount = openWorkOrders.length;

  // ----- Title meta chips -----
  const meta = [trade, `${rating}★`, `${totalJobs} ${pluralize(totalJobs, 'job')}`];
  const since = sinceYear(vendor.created_at);
  if (since) meta.push(`since ${since}`);

  // ----- "What's active" -----
  const active = buildActiveRows(openWorkOrders, onTime, totalJobs);
  const activeSub = openCount > 0
    ? `${openCount} open · in progress`
    : 'no open jobs · steady';

  const odesaNote = {
    body: openCount > 0
      ? `${vendor.name} has ${openCount} open work ${pluralize(openCount, 'order')} and a ${onTime}% acceptance rate across ${totalJobs} ${pluralize(totalJobs, 'job')}.`
      : `${vendor.name} has no open work orders. ${onTime}% acceptance rate across ${totalJobs} ${pluralize(totalJobs, 'job')}.`,
    basedOn: 'work order log · vendor record',
  };

  // ----- Metrics strip -----
  const metrics: MetricCell[] = [
    { label: 'Rating', value: `${rating}★`, ...withTone(ratingTone(rating)) },
    { label: 'Jobs', value: String(totalJobs) },
    { label: 'On-time', value: `${onTime}%`, ...withTone(onTimeTone(onTime)) },
    { label: 'Acceptance', value: `${acceptancePct}%` },
    { label: 'Open WOs', value: String(openCount) },
  ];

  // ----- Work orders panel -----
  const workOrdersSub = `${openCount} open · ${completedCount} completed`;
  const workOrderRows: VendorWorkOrderRowWithChip[] = workOrders.map((wo) => ({
    calm: DONE_WO_STATUSES.has(wo.status),
    woId: wo.id,
    title: woTitle(wo.category),
    sub: woSubLine(wo),
    badge: woBadgeLabel(wo.status),
    href: workOrderHref(wo.id),
    chip: deriveVendorChip({
      status: wo.status,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorResponse: wo.vendorResponse,
      vendorAssignedAt: wo.vendorAssignedAt,
      reviewedAt: wo.reviewedAt,
    }),
  }));

  // ----- Contact · terms -----
  const contact: KvCell[] = [
    { k: 'Phone', v: vendor.phone_e164 ?? '—' },
    { k: 'Trade', v: trade },
  ];

  // ----- Sources -----
  const sources: SourceItem[] = [
    { label: 'Job history', freshness: `${totalJobs} ${pluralize(totalJobs, 'job')}` },
    { label: 'Vendor record', freshness: 'live' },
  ];

  return {
    slug: vendor.id,
    name: vendor.name,
    acceptanceRate: normalizedAcceptanceRate(vendor.acceptance_rate),
    statusPill: statusPillFor(),
    meta,
    activeSub,
    active,
    odesaNote,
    metrics,
    workOrdersSub,
    workOrders: workOrderRows,
    contact,
    sources,
    ask: {
      subject: vendor.name,
      contextLabel: vendor.name,
      prompts: [
        'Show past jobs',
        'Message the vendor',
        'Check open work orders',
        'Assign to a property',
      ],
    },
  };
}

/** Spread helper: only attach `tone` when it's defined (keeps shape clean). */
function withTone(tone: MetricTone | undefined): { tone?: MetricTone } {
  return tone ? { tone } : {};
}

/**
 * Builds the "What's active" rows. Row 1 tracks the first open WO when one
 * exists; the trailing row is the steady reliability line. With no open
 * jobs we surface a single reliability row so the panel never renders empty.
 */
function buildActiveRows(
  openWorkOrders: readonly VendorWorkOrderRecord[],
  onTime: number,
  totalJobs: number,
): VendorActiveRow[] {
  const rows: VendorActiveRow[] = [];

  const first = openWorkOrders[0];
  if (first) {
    const locParts: string[] = [];
    if (first.propertyName) locParts.push(first.propertyName);
    if (first.unitLabel) locParts.push(`Unit ${first.unitLabel}`);
    locParts.push(statusWord(first.status).toLowerCase());
    rows.push({
      index: '1',
      kind: `Open work order`,
      detail: `${tradeLabel(first.category)} · ${locParts.join(' · ')}`,
      action: { label: 'View ticket', variant: 'default', href: workOrderHref(first.id) },
    });
  }

  rows.push({
    index: String(rows.length + 1),
    kind: openWorkOrders.length > 0 ? 'Reliability' : 'No open jobs',
    detail: `${onTime}% acceptance across ${totalJobs} ${pluralize(totalJobs, 'job')}`,
    action: { label: 'View history', variant: 'default', href: '#vendor-work-orders' },
  });

  return rows;
}

/**
 * Loads every work_order for the vendor, decomposed into follow-up unit and
 * property reads (no PostgREST embeds — matches the house style). Ordered
 * newest-first so the brief leads with the freshest activity.
 */
async function fetchVendorWorkOrders(
  supabase: SupabaseServerClient,
  vendorId: string,
): Promise<VendorWorkOrderRecord[]> {
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select(
      'id, category, status, description, unit_id, created_at, vendor_response, vendor_assigned_at, reviewed_at',
    )
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });

  if (!workOrders || workOrders.length === 0) return [];

  const unitIds = Array.from(
    new Set(workOrders.map((w) => w.unit_id).filter((v): v is string => Boolean(v))),
  );

  const { data: units } = unitIds.length
    ? await supabase
        .from('units')
        .select('id, label, property_id')
        .in('id', unitIds)
    : { data: [] as Array<{ id: string; label: string; property_id: string }> };

  const unitById = new Map<string, { label: string; propertyId: string }>();
  for (const u of units ?? []) {
    unitById.set(u.id, { label: u.label, propertyId: u.property_id });
  }

  const propertyIds = Array.from(
    new Set(
      (units ?? [])
        .map((u) => u.property_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );

  const { data: properties } = propertyIds.length
    ? await supabase
        .from('properties')
        .select('id, name')
        .in('id', propertyIds)
    : { data: [] as Array<{ id: string; name: string }> };

  const propertyNameById = new Map<string, string>();
  for (const p of properties ?? []) propertyNameById.set(p.id, p.name);

  return workOrders.map((w) => {
    const unit = w.unit_id ? unitById.get(w.unit_id) : undefined;
    const propertyName = unit ? propertyNameById.get(unit.propertyId) ?? null : null;
    return {
      id: w.id,
      category: w.category,
      status: w.status as WorkOrderStatus,
      description: w.description,
      createdAt: w.created_at,
      unitLabel: unit?.label ?? null,
      propertyName,
      vendorResponse: w.vendor_response,
      vendorAssignedAt: w.vendor_assigned_at,
      reviewedAt: w.reviewed_at,
    };
  });
}
