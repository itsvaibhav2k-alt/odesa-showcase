/**
 * Tenants directory query.
 *
 * Backs the `/tenants` list view. Returns the SAME shape the mock
 * `getTenantsDirectory()` produced (header summary + facets + rows), so the
 * `TenantsDirectory` client island renders unchanged — only the data source
 * moves from the static fixture to live Supabase.
 *
 * All reads go through `createServerClient()` so RLS auto-scopes to the
 * caller's organization_id. As in `src/lib/properties/queries.ts`, joins are
 * decomposed into follow-up `.in()` queries (never PostgREST embeds) and every
 * select lists explicit columns.
 *
 * Each row links to `/tenants/<tenantId>` (the detail page is wired to real
 * UUIDs separately), so `slug` carries the tenant's real `id` rather than a
 * hand-authored slug.
 */

import { createServerClient } from '@/lib/supabase/server';
import type { MessageDirection, RentEventStatus } from '@/types/database';
import {
  deriveRentCycleStatus,
  deriveTenantStanding,
  rentCycleFromRow,
  rentRecommendationCopy,
  standingLabel,
  standingNarrative,
  type DerivedRentCycleStatus,
  type TenantStanding,
} from '@/lib/domain';
import { tenantHref, unitHref } from '@/lib/properties/mock-detail';
import type {
  ActionLink,
  AttentionItem,
  BadgeSpec,
  BadgeVariant,
  CtxCardSpec,
  KvCell,
  MetricCell,
  SourceItem,
  TenantDetailMock,
  ThreadMessage,
  TimelineEvent,
  Tone,
} from '@/lib/properties/mock-detail';
import type {
  FacetSpec,
  TenantDirectoryRow,
  TenantFacetId,
  TenantStatusPill,
  TenantStatusVariant,
  TenantsDirectoryHeader,
} from '@/lib/properties/mock-portfolio-views';
import type {
  ResidentDirectoryData,
  ResidentDirectoryRow,
} from '@/lib/tenants/directory-types';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Lease statuses that count as the tenant's "current" lease. */
const ACTIVE_LEASE_STATUS = 'active' as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A lease ending within this window flags a renewal (when not late/on-plan). */
const RENEWAL_WINDOW_MS = 60 * DAY_MS;

/**
 * Local-time YYYY-MM-DD for "today" — computed ONCE at the IO boundary
 * and passed into the pure domain derivations (no hidden clock in the
 * domain module).
 */
function localTodayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// =====================================================================
// Public entry point
// =====================================================================

/**
 * Tenants directory (rows + facets + header summary) for the caller's org.
 *
 * Lists every tenant; a tenant without an active lease still appears (their
 * property/unit/rent fall back to em-dashes and the status pill reads
 * "Current"). Matches the mock's posture of one row per tenant.
 */
export async function listTenantsDirectory(): Promise<ResidentDirectoryData> {
  const supabase = await createServerClient();
  const todayIso = localTodayIso();

  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, full_name')
    .order('full_name', { ascending: true });

  if (!tenants || tenants.length === 0) {
    return { header: emptyHeader(), facets: buildFacets([]), rows: [] };
  }

  const tenantIds = tenants.map((t) => t.id);

  // Active leases for these tenants → unit/property/rent + renewal window.
  const { data: leases } = await supabase
    .from('leases')
    .select('id, tenant_id, unit_id, rent_amount, end_date')
    .in('tenant_id', tenantIds)
    .eq('status', ACTIVE_LEASE_STATUS);

  const leaseList = leases ?? [];

  // Resolve unit → property labels and the latest rent cycle per lease.
  const unitIds = Array.from(new Set(leaseList.map((l) => l.unit_id)));
  const leaseIds = leaseList.map((l) => l.id);

  const [unitInfo, rentCycleByLease] = await Promise.all([
    unitIds.length
      ? fetchUnitInfo(supabase, unitIds)
      : Promise.resolve(new Map<string, UnitInfo>()),
    leaseIds.length
      ? fetchLatestRentCycleByLease(supabase, leaseIds, todayIso)
      : Promise.resolve(new Map<string, DerivedRentCycleStatus>()),
  ]);

  // One active lease per tenant (by convention); keep the first seen.
  const leaseByTenant = new Map<string, (typeof leaseList)[number]>();
  for (const l of leaseList) {
    if (!leaseByTenant.has(l.tenant_id)) leaseByTenant.set(l.tenant_id, l);
  }

  const now = Date.now();

  const rows: ResidentDirectoryRow[] = tenants.map((t) => {
    const lease = leaseByTenant.get(t.id);
    const unit = lease ? unitInfo.get(lease.unit_id) : undefined;
    const cycle = lease ? (rentCycleByLease.get(lease.id) ?? null) : null;

    const statusPill = deriveStatusPill(cycle, lease?.end_date ?? null, now);

    return buildRow({
      tenantId: t.id,
      name: t.full_name,
      property: unit?.propertyName ?? '—',
      unit: unit?.unitLabel ?? '—',
      rentLabel: lease ? formatRent(lease.rent_amount) : '—',
      statusPill,
      hasActiveLease: Boolean(lease),
      leaseEndDate: lease?.end_date ?? null,
    });
  });

  return {
    header: buildHeader(rows),
    facets: buildFacets(rows),
    rows,
  };
}

// =====================================================================
// Joins
// =====================================================================

interface UnitInfo {
  unitLabel: string;
  propertyName: string;
}

/**
 * Resolves the given unit ids to `{ unitLabel, propertyName }` by loading the
 * units, then their parent properties in a second `.in()` query.
 */
async function fetchUnitInfo(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<Map<string, UnitInfo>> {
  const { data: units } = await supabase
    .from('units')
    .select('id, label, property_id')
    .in('id', unitIds);

  const unitList = units ?? [];
  if (unitList.length === 0) return new Map();

  const propertyIds = Array.from(new Set(unitList.map((u) => u.property_id)));
  const { data: properties } = await supabase
    .from('properties')
    .select('id, name')
    .in('id', propertyIds);

  const propertyNameById = new Map<string, string>();
  for (const p of properties ?? []) propertyNameById.set(p.id, p.name);

  const result = new Map<string, UnitInfo>();
  for (const u of unitList) {
    result.set(u.id, {
      unitLabel: u.label,
      propertyName: propertyNameById.get(u.property_id) ?? '—',
    });
  }
  return result;
}

/**
 * Returns the canonically derived status of the latest (newest
 * `cycle_month`) rent_event per lease. Drives the row's status pill — a
 * tenant on a payment plan or date-overdue surfaces over the default
 * "Current".
 */
async function fetchLatestRentCycleByLease(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
  todayIso: string,
): Promise<Map<string, DerivedRentCycleStatus>> {
  const { data } = await supabase
    .from('rent_events')
    .select('lease_id, status, cycle_month, due_date, amount_due, amount_paid')
    .in('lease_id', leaseIds)
    .order('cycle_month', { ascending: false });

  const result = new Map<string, DerivedRentCycleStatus>();
  for (const r of data ?? []) {
    // order() above is newest-first, so the first row per lease wins.
    if (result.has(r.lease_id)) continue;
    result.set(r.lease_id, rentCycleFromRow(r, todayIso));
  }
  return result;
}

// =====================================================================
// Status derivation
// =====================================================================

/**
 * Maps a lease's derived current rent cycle + renewal window to the
 * four-variant tenant status pill. Precedence (first wins):
 *
 *   1. plan      — derived cycle is on a payment plan
 *   2. watching  — derived cycle is late/escalated (date-aware, not enum-only)
 *   3. renewal   — active lease end_date within 60 days
 *   4. current   — otherwise (includes tenants without an active lease)
 */
function deriveStatusPill(
  cycle: DerivedRentCycleStatus | null,
  leaseEndDate: string | null,
  now: number,
): TenantStatusPill {
  if (cycle?.isOnPlan) {
    return pill('plan', 'Payment plan');
  }
  if (cycle?.isLate) {
    return pill('watching', 'Watching');
  }
  if (leaseEndDate && isWithinRenewalWindow(leaseEndDate, now)) {
    return pill('renewal', 'Renewal due');
  }
  return pill('current', 'Current');
}

function isWithinRenewalWindow(endDate: string, now: number): boolean {
  const endMs = Date.parse(endDate);
  if (Number.isNaN(endMs)) return false;
  const delta = endMs - now;
  return delta >= 0 && delta <= RENEWAL_WINDOW_MS;
}

function pill(variant: TenantStatusVariant, label: string): TenantStatusPill {
  return { variant, label };
}

// =====================================================================
// Row + header + facet builders
// =====================================================================

interface RowInput {
  tenantId: string;
  name: string;
  property: string;
  unit: string;
  rentLabel: string;
  statusPill: TenantStatusPill;
  hasActiveLease: boolean;
  leaseEndDate: string | null;
}

/**
 * Builds a directory row, deriving the avatar initial and href. `slug` carries
 * the real tenant UUID so the row links to `/tenants/<tenantId>`.
 */
function buildRow(input: RowInput): ResidentDirectoryRow {
  return {
    slug: input.tenantId,
    initial: input.name.charAt(0).toUpperCase(),
    name: input.name,
    property: input.property,
    unit: input.unit,
    rentLabel: input.rentLabel,
    statusPill: input.statusPill,
    hasActiveLease: input.hasActiveLease,
    leaseEndDate: input.leaseEndDate,
    href: tenantHref(input.tenantId),
  };
}

/** Formats a dollar rent amount as e.g. "$1,520/mo". */
function formatRent(rentAmount: number | string | null | undefined): string {
  if (rentAmount == null) return '—';
  const dollars = Math.round(Number(rentAmount));
  if (Number.isNaN(dollars)) return '—';
  return `$${dollars.toLocaleString('en-US')}/mo`;
}

/**
 * Builds the header summary line, e.g.
 * "10 tenants · 10 occupied · 1 on a plan · 1 watching".
 */
function buildHeader(rows: readonly TenantDirectoryRow[]): TenantsDirectoryHeader {
  const total = rows.length;
  const occupied = rows.filter((r) => r.rentLabel !== '—').length;
  const onPlan = rows.filter((r) => r.statusPill.variant === 'plan').length;
  const watching = rows.filter((r) => r.statusPill.variant === 'watching').length;

  const segments = [
    `${total} ${total === 1 ? 'tenant' : 'tenants'}`,
    `${occupied} occupied`,
  ];
  if (onPlan > 0) segments.push(`${onPlan} on a plan`);
  if (watching > 0) segments.push(`${watching} watching`);

  return { summary: segments.join(' · '), total };
}

function emptyHeader(): TenantsDirectoryHeader {
  return { summary: '0 tenants', total: 0 };
}

/** Facet membership — mirrors `inFacet` in `tenants-directory.tsx`. */
function inFacet(facet: TenantFacetId, r: TenantDirectoryRow): boolean {
  switch (facet) {
    case 'all':
      return true;
    case 'attention':
      return r.statusPill.variant === 'watching' || r.statusPill.variant === 'renewal';
    case 'plan':
      return r.statusPill.variant === 'plan';
    case 'renewals':
      return r.statusPill.variant === 'renewal';
  }
}

function buildFacets(
  rows: readonly TenantDirectoryRow[],
): readonly FacetSpec<TenantFacetId>[] {
  return [
    { id: 'all', label: 'All', count: countRows(rows, 'all') },
    { id: 'attention', label: 'Needs attention', count: countRows(rows, 'attention') },
    { id: 'plan', label: 'On a plan', count: countRows(rows, 'plan') },
    { id: 'renewals', label: 'Renewals', count: countRows(rows, 'renewals') },
  ];
}

function countRows(
  rows: readonly TenantDirectoryRow[],
  facet: TenantFacetId,
): number {
  return rows.reduce((n, r) => (inFacet(facet, r) ? n + 1 : n), 0);
}

// =====================================================================
// Tenant detail — /tenants/[tenantId]
// =====================================================================
//
// Returns the `TenantDetailMock` shape the tenant brief page consumes,
// built from real Supabase data:
//
//   tenant → active lease → unit/property   (header + meta + related card)
//   rent_events (latest cycle)              (badge, metrics, attention, timeline)
//   conversations + messages                (communication thread + timeline)
//
// `propSlug` / `unitSlug` carry real property / unit UUIDs so the page's
// `propertyHref(propSlug)` + `unitHref(propSlug, unitSlug)` cross-links
// land on the real UUID-keyed property / unit routes.
//
// Real rows are far sparser than the hand-authored mock: the seeded Galaxy
// org has no conversations/messages and no payment-plan rows, so the thread
// is empty and several "rich" copy fields are derived from the rent cycle
// (see the field notes in the agent report). The page renders gracefully —
// an empty thread / timeline array yields an empty (but valid) panel.

interface LatestRentCycle {
  /** rent_events.id of the displayed cycle — targets Record Payment. */
  id: string;
  status: RentEventStatus;
  cycleMonth: string;
  dueDate: string | null;
  amountDue: number;
  amountPaid: number;
}

/**
 * Tenant brief for the caller's org. Reads `[tenantId]` as a real UUID and
 * returns `null` when the tenant doesn't exist or RLS hides it (the page
 * calls `notFound()` on null). Tenants without an active lease still resolve
 * (property/unit/rent fall back to em-dashes and the badge reads "Current").
 */
export async function getTenantDetail(
  id: string,
): Promise<TenantDetailMock | null> {
  const supabase = await createServerClient();
  const todayIso = localTodayIso();

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, full_name, phone_e164, email')
    .eq('id', id)
    .maybeSingle();

  if (!tenant) return null;

  // Active lease (at most one per tenant by convention) → unit → property.
  const { data: leaseRow } = await supabase
    .from('leases')
    .select('id, unit_id, rent_amount, rent_due_day, late_fee_policy, start_date, end_date')
    .eq('tenant_id', tenant.id)
    .eq('status', ACTIVE_LEASE_STATUS)
    .order('start_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const unitInfo = leaseRow
    ? await fetchUnitContext(supabase, leaseRow.unit_id)
    : null;

  // Latest rent cycle on the active lease — drives badge / metrics / timeline.
  const latestCycle = leaseRow
    ? await fetchLatestRentCycle(supabase, leaseRow.id)
    : null;

  // Communication thread — newest conversation for the tenant, last messages.
  const thread = await fetchTenantThread(supabase, tenant.id, tenant.full_name);

  const now = Date.now();
  const firstName = tenant.full_name.split(/\s+/)[0] || tenant.full_name;

  // Derive the canonical cycle status ONCE — the badge, Standing chip,
  // Odesa note, attention rows, timeline, and thread actions all read
  // from this single value so the page can never contradict itself.
  const cycle = latestCycle
    ? deriveRentCycleStatus({
        status: latestCycle.status,
        dueDate: latestCycle.dueDate,
        amountDueCents: Math.round(latestCycle.amountDue * 100),
        amountPaidCents: Math.round(latestCycle.amountPaid * 100),
        todayIso,
      })
    : null;
  const standing = deriveTenantStanding(cycle);

  const badge = deriveBadge(cycle, leaseRow?.end_date ?? null, now);
  const balance = cycle ? cycle.balanceCents / 100 : 0;
  const daysLate = cycle?.daysLate ?? 0;

  const propertyName = unitInfo?.propertyName ?? '—';
  const unitLabel = unitInfo?.unitLabel ?? '—';
  const rentLabel = leaseRow ? formatRent(leaseRow.rent_amount) : '—';
  const leaseEndLabel = formatMonthYear(leaseRow?.end_date ?? null);

  const meta = [
    propertyName,
    unitLabel,
    rentLabel,
    leaseRow?.end_date ? `lease through ${leaseEndLabel}` : 'no active lease',
  ];

  return {
    slug: tenant.id,
    name: tenant.full_name,
    badge,
    meta,
    // Real UUIDs so propertyHref()/unitHref() resolve to the UUID-keyed routes.
    propSlug: unitInfo?.propertyId ?? '',
    unitSlug: leaseRow?.unit_id ?? '',
    attentionLabel: `What matters with ${firstName}`,
    attentionCount: deriveAttentionCount(cycle),
    attention: buildAttention(cycle, leaseEndLabel, leaseRow?.end_date ?? null),
    odesaNote: {
      body: buildOdesaNote(standing, firstName, cycle),
      basedOn: 'payment ledger · lease terms · message thread',
    },
    metrics: buildMetrics({
      balance,
      daysLate,
      rentLabel,
      leaseEndLabel,
      hasLease: Boolean(leaseRow),
      standing,
    }),
    timelineSub: formatMonthYear(latestCycle?.cycleMonth ?? null, 'long') || 'No rent cycle',
    timeline: buildTimeline(latestCycle, cycle, thread),
    thread,
    threadActions: buildThreadActions(cycle, {
      firstName,
      unitLabel,
      balance,
      daysLate,
      propSlug: unitInfo?.propertyId ?? '',
      unitSlug: leaseRow?.unit_id ?? '',
    }),
    // Powers the "Record payment" modal — only meaningful with an active
    // lease; the page also gates on outstandingDollars > 0.
    ...(leaseRow ? { leaseId: leaseRow.id } : {}),
    ...(latestCycle ? { rentEventId: latestCycle.id } : {}),
    outstandingDollars: balance,
    leaseRules: buildLeaseRules(leaseRow?.late_fee_policy, leaseRow?.rent_due_day ?? null, daysLate),
    related: buildRelatedCard({
      propertyName,
      unitLabel,
      badgeLabel: badge.label,
    }),
    sources: buildSources(thread.length > 0),
    ask: {
      subject: tenant.full_name,
      contextLabel: tenant.full_name,
      prompts: [
        'Draft a reminder',
        'Summarize payment history',
        'Show lease terms',
        'What needs attention?',
        'Prepare owner update',
      ],
    },
  };
}

// ---------------------------------------------------------------------
// Detail joins
// ---------------------------------------------------------------------

interface UnitContext {
  unitLabel: string;
  propertyId: string;
  propertyName: string;
}

/** Resolves a unit id to its label + parent property (id + name). */
async function fetchUnitContext(
  supabase: SupabaseServerClient,
  unitId: string,
): Promise<UnitContext | null> {
  const { data: unit } = await supabase
    .from('units')
    .select('id, label, property_id')
    .eq('id', unitId)
    .maybeSingle();

  if (!unit) return null;

  const { data: property } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', unit.property_id)
    .maybeSingle();

  return {
    unitLabel: unit.label,
    propertyId: unit.property_id,
    propertyName: property?.name ?? '—',
  };
}

/** Newest rent_event (by cycle_month) on the lease — the current cycle. */
async function fetchLatestRentCycle(
  supabase: SupabaseServerClient,
  leaseId: string,
): Promise<LatestRentCycle | null> {
  const { data } = await supabase
    .from('rent_events')
    .select('id, status, cycle_month, due_date, amount_due, amount_paid')
    .eq('lease_id', leaseId)
    .order('cycle_month', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    status: data.status,
    cycleMonth: data.cycle_month,
    dueDate: data.due_date,
    amountDue: Number(data.amount_due ?? 0),
    amountPaid: Number(data.amount_paid ?? 0),
  };
}

/**
 * Builds the communication thread from the tenant's most-recent conversation.
 * Inbound messages render under the tenant's name; outbound render as Odesa
 * (terracotta). Drafts (pending_review) get the serif-italic draft styling.
 * Returns `[]` when the tenant has no conversations — the panel renders empty.
 */
async function fetchTenantThread(
  supabase: SupabaseServerClient,
  tenantId: string,
  tenantName: string,
): Promise<ThreadMessage[]> {
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, last_message_at, created_at')
    .eq('tenant_id', tenantId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) return [];

  const { data: messages } = await supabase
    .from('messages')
    .select('id, direction, body, draft_status, sent_at, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(8);

  return (messages ?? [])
    .filter((m) => Boolean(m.body))
    .map((m) => {
      const isOdesa = (m.direction as MessageDirection) === 'outbound';
      const isDraft = m.draft_status === 'pending_review';
      return {
        who: isOdesa ? 'Odesa' : tenantName,
        odesa: isOdesa,
        time: isDraft ? 'Draft' : formatDay(m.sent_at ?? m.created_at),
        body: m.body ?? '',
        ...(isDraft ? { draft: true } : {}),
      };
    });
}

// ---------------------------------------------------------------------
// Derivation: badge / attention / odesa note
// ---------------------------------------------------------------------

/**
 * Maps the derived current rent cycle + renewal window to the tenant badge.
 * Precedence: plan → watching → renewal → current (matches the directory pill).
 */
function deriveBadge(
  cycle: DerivedRentCycleStatus | null,
  leaseEndDate: string | null,
  now: number,
): BadgeSpec {
  if (cycle?.isOnPlan) return badge('plan', 'Payment plan');
  if (cycle?.isLate) return badge('watching', 'Watching');
  if (leaseEndDate && isWithinRenewalWindow(leaseEndDate, now)) {
    return badge('leasing', 'Renewal due');
  }
  return badge('current', 'Current');
}

function badge(variant: BadgeVariant, label: string): BadgeSpec {
  return { variant, label };
}

function deriveAttentionCount(cycle: DerivedRentCycleStatus | null): string {
  if (cycle?.isEscalated) return 'payment risk: high';
  if (cycle?.isLate) return 'payment risk: medium';
  if (cycle?.isOnPlan) return 'payment risk: low';
  if (cycle?.isOutstanding) return 'payment risk: low';
  return 'all clear';
}

/**
 * Builds the attention brief rows. A date-overdue/escalated cycle surfaces
 * an "Overdue" row (distinct from the not-yet-due "Balance outstanding"
 * row); an on-plan cycle a plan row; an active lease in the renewal window
 * surfaces a renewal row; otherwise the tenant is operationally calm.
 */
function buildAttention(
  cycle: DerivedRentCycleStatus | null,
  leaseEndLabel: string,
  leaseEndDate: string | null,
): AttentionItem[] {
  const rows: AttentionItem[] = [];
  const balance = cycle ? cycle.balanceCents / 100 : 0;

  if (cycle?.isLate) {
    rows.push(
      attentionRow(
        'clay',
        'Overdue',
        `${cycle.daysLate} day${cycle.daysLate === 1 ? '' : 's'} late · ${formatDollars(balance)} outstanding`,
        [{ label: 'Review ledger', variant: 'primary' }],
      ),
    );
  } else if (cycle?.isOnPlan) {
    rows.push(
      attentionRow(
        'amber',
        'Payment plan active',
        `${formatDollars(balance)} outstanding on the current cycle`,
        [{ label: 'Schedule reminder', variant: 'default' }],
      ),
    );
  } else if (cycle?.isOutstanding) {
    rows.push(
      attentionRow(
        'amber',
        'Balance outstanding',
        `${formatDollars(balance)} due on the current cycle`,
        [{ label: 'Review ledger', variant: 'default' }],
      ),
    );
  }

  if (leaseEndDate && isWithinRenewalWindow(leaseEndDate, Date.now())) {
    rows.push(
      attentionRow(
        'gold',
        'Renewal due',
        `Lease ends ${leaseEndLabel} · within the renewal window`,
        [{ label: 'Review renewal', variant: 'default' }],
      ),
    );
  }

  if (rows.length === 0) {
    rows.push(
      attentionRow(
        'green',
        'All clear',
        'Rent current · no open items · strong standing',
        [{ label: 'View history', variant: 'default' }],
      ),
    );
  }

  return rows;
}

function attentionRow(
  dot: Tone,
  kind: string,
  detail: string,
  actions: ActionLink[],
): AttentionItem {
  return {
    dot,
    kind,
    detail,
    ariaLabel: `${kind}. ${detail}`,
    actions,
  };
}

/**
 * The Odesa note for the tenant brief. The factual sentence comes from
 * `standingNarrative` over the SAME derived standing the Standing chip
 * renders — the two can never disagree — with an Odesa recommendation
 * appended where one applies.
 */
function buildOdesaNote(
  standing: TenantStanding,
  firstName: string,
  cycle: DerivedRentCycleStatus | null,
): string {
  const narrative = standingNarrative(
    standing,
    firstName,
    cycle?.balanceCents ?? 0,
    cycle?.daysLate ?? 0,
  );
  switch (standing) {
    case 'escalated':
      return `${narrative} ${rentRecommendationCopy('escalated')}`;
    case 'behind':
      return `${narrative} Odesa recommends sending a **calm payment reminder** before any escalation.`;
    case 'on_plan':
      return `${narrative} Odesa recommends keeping the plan in place and **confirming the next catch-up payment**.`;
    case 'due':
      return narrative;
    case 'good':
      return `${narrative} Odesa will surface anything new the moment it appears.`;
  }
}

// ---------------------------------------------------------------------
// Derivation: metrics / timeline / thread actions / lease rules / related
// ---------------------------------------------------------------------

interface MetricsInput {
  balance: number;
  daysLate: number;
  rentLabel: string;
  leaseEndLabel: string;
  hasLease: boolean;
  standing: TenantStanding;
}

function buildMetrics(input: MetricsInput): MetricCell[] {
  return [
    {
      label: 'Balance',
      value: formatDollars(input.balance),
      ...(input.balance > 0 ? { tone: 'warn' as const } : {}),
    },
    {
      label: 'Days late',
      value: String(input.daysLate),
      ...(input.daysLate > 0 ? { tone: 'warn' as const } : {}),
    },
    { label: 'Rent', value: input.rentLabel },
    { label: 'Lease end', value: input.hasLease ? input.leaseEndLabel : '—' },
    {
      label: 'Standing',
      value: standingLabel(input.standing),
      ...(input.standing === 'good' ? { tone: 'good' as const } : {}),
    },
  ];
}

/**
 * Builds the payment timeline from the current rent cycle plus any thread
 * messages. The rent cycle anchors the timeline; messages append as actor
 * events. Returns `[]` only when there's neither a cycle nor a thread.
 */
function buildTimeline(
  cycle: LatestRentCycle | null,
  derived: DerivedRentCycleStatus | null,
  thread: readonly ThreadMessage[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (cycle) {
    const month = formatMonthYear(cycle.cycleMonth, 'long');
    events.push({
      time: month || 'This cycle',
      variant: 'tenant',
      line: `Rent due — ${formatDollars(cycle.amountDue)}.`,
    });
    if (cycle.amountPaid > 0) {
      events.push({
        time: month || 'This cycle',
        variant: 'tenant',
        line: `Payment received — ${formatDollars(cycle.amountPaid)}.`,
      });
    }
    if (derived?.isLate) {
      events.push({
        time: month || 'This cycle',
        variant: 'odesa',
        actor: 'Odesa',
        line: `Flagged the cycle as overdue — ${derived.daysLate} day${derived.daysLate === 1 ? '' : 's'} past due.`,
      });
    }
  }

  for (const msg of thread) {
    if (msg.draft) continue;
    events.push({
      time: msg.time,
      variant: msg.odesa ? 'odesa' : 'tenant',
      actor: msg.who,
      line: msg.body,
    });
  }

  return events;
}

/**
 * Thread quick actions derived from the current cycle. Each action now
 * carries a real `href`: drafting/escalation prompts route to the read-only
 * `/assistant?q=…` desk (draft-only — nothing sends to the tenant without
 * owner approval), and "Review ledger" routes to the focused unit detail.
 * Direct sending lives in the separate `ComposeMessageModal`. None of these
 * render as a silent no-op button.
 *
 * NOTE: "Record payment" is intentionally NOT added here — it is wired to the
 * RecordPaymentModal on the page so it never renders as a bare no-op.
 */
interface ThreadActionContext {
  firstName: string;
  unitLabel: string;
  balance: number;
  daysLate: number;
  propSlug: string;
  unitSlug: string;
}

function assistantHref(prompt: string): string {
  return `/assistant?q=${encodeURIComponent(prompt)}`;
}

function buildThreadActions(
  cycle: DerivedRentCycleStatus | null,
  ctx: ThreadActionContext,
): ActionLink[] {
  const where = ctx.unitLabel !== '—' ? ` — Unit ${ctx.unitLabel}` : '';
  const bal = formatDollars(ctx.balance);
  const lateClause =
    ctx.daysLate > 0
      ? `, balance ${bal}, ${ctx.daysLate} day${ctx.daysLate === 1 ? '' : 's'} late`
      : `, balance ${bal}`;
  const hasUnit = Boolean(ctx.propSlug && ctx.unitSlug);
  const ledgerAction: ActionLink[] = hasUnit
    ? [
        {
          label: 'Review ledger',
          variant: 'default',
          href: `${unitHref(ctx.propSlug, ctx.unitSlug)}#rent`,
        },
      ]
    : [];

  if (cycle?.isOnPlan) {
    return [
      {
        label: 'Draft reminder',
        variant: 'primary',
        href: assistantHref(
          `Draft a calm payment-plan reminder for ${ctx.firstName}${where}${lateClause}. Draft only — nothing sends to the tenant until I approve it.`,
        ),
      },
      {
        label: 'Schedule for Thursday',
        variant: 'default',
        href: assistantHref(
          `Draft a Thursday check-in reminder for ${ctx.firstName} about the payment plan${where}. Draft only — owner approval required before sending.`,
        ),
      },
      ...ledgerAction,
    ];
  }
  if (cycle?.isLate) {
    return [
      {
        label: 'Draft reminder',
        variant: 'primary',
        href: assistantHref(
          `Draft a calm rent reminder for ${ctx.firstName}${where}${lateClause}. Draft only — nothing sends to the tenant until I approve it.`,
        ),
      },
      {
        label: 'Prepare escalation',
        variant: 'default',
        href: assistantHref(
          `Prepare owner escalation options for ${ctx.firstName}${where}${lateClause}, taking prior reminders into account. Nothing tenant-facing sends until I approve it.`,
        ),
      },
      ...ledgerAction,
    ];
  }
  return [
    {
      label: 'Draft message',
      variant: 'primary',
      href: assistantHref(
        `Draft a friendly message to ${ctx.firstName}${where}. Draft only — owner approval required before sending.`,
      ),
    },
    ...ledgerAction,
  ];
}

/**
 * Builds the Lease · rules KV from the lease's `late_fee_policy` jsonb
 * (`grace_days`, `fixed_fee_cents`) + rent due day. Falls back to em-dashes
 * when the policy is missing or malformed.
 *
 * The 'Late fee' cell makes the fee's state explicit so it never reads as
 * already added to the balance: '$50 eligible, not applied' once the cycle
 * is past grace, otherwise '$50 configured, not applied'. Late fees are
 * computed on-demand and are never folded into the outstanding total.
 */
function buildLeaseRules(
  policy: unknown,
  rentDueDay: number | null,
  daysLate: number,
): KvCell[] {
  const graceDays = readNumberField(policy, 'grace_days');
  const feeCents = readNumberField(policy, 'fixed_fee_cents');
  const lateFeeValue =
    feeCents != null
      ? `${formatDollars(feeCents / 100)} ${
          daysLate > (graceDays ?? 0) ? 'eligible' : 'configured'
        }, not applied`
      : '—';

  return [
    { k: 'Rent due', v: rentDueDay != null ? `Day ${rentDueDay}` : '—' },
    {
      k: 'Grace period',
      v: graceDays != null ? `${graceDays} day${graceDays === 1 ? '' : 's'}` : '—',
    },
    { k: 'Late fee', v: lateFeeValue },
    { k: 'Escalation', v: 'Owner review after missed plan payment' },
  ];
}

function buildRelatedCard(input: {
  propertyName: string;
  unitLabel: string;
  badgeLabel: string;
}): CtxCardSpec {
  const avatar = input.propertyName.charAt(0).toUpperCase() || '—';
  const name =
    input.propertyName !== '—' && input.unitLabel !== '—'
      ? `${input.propertyName} · ${input.unitLabel}`
      : input.propertyName;
  return {
    avatar,
    name,
    sub: `Tenant standing: ${input.badgeLabel}`,
    // hrefs are supplied by the page (propertyHref/unitHref) — the card's own
    // action links stay empty so they don't double-render.
    actions: [],
  };
}

function buildSources(hasThread: boolean): SourceItem[] {
  const sources: SourceItem[] = [
    { label: 'Payment ledger', freshness: 'live' },
    { label: 'Lease terms', freshness: 'active' },
  ];
  if (hasThread) {
    sources.push({ label: 'Message thread', freshness: 'latest reply' });
  }
  sources.push({ label: 'Owner rules', freshness: 'active' });
  return sources;
}

// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------

/** "$1,520" — whole-dollar currency for metrics / attention copy. */
function formatDollars(amount: number): string {
  const dollars = Math.round(amount);
  if (Number.isNaN(dollars)) return '—';
  return `$${dollars.toLocaleString('en-US')}`;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Mar 2027" (short) / "March 2027" (long) from an ISO date; '' when null. */
function formatMonthYear(
  iso: string | null | undefined,
  variant: 'short' | 'long' = 'short',
): string {
  if (!iso || iso.length < 7) return '';
  const year = iso.slice(0, 4);
  const monthIdx = Number(iso.slice(5, 7)) - 1;
  if (Number.isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11) return '';
  const names = variant === 'long' ? MONTHS_LONG : MONTHS_SHORT;
  return `${names[monthIdx]} ${year}`;
}

/** "May 6" from an ISO timestamp; falls back to the raw value on parse failure. */
function formatDay(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return iso ?? '';
  const monthIdx = Number(iso.slice(5, 7)) - 1;
  const day = Number(iso.slice(8, 10));
  if (Number.isNaN(monthIdx) || Number.isNaN(day) || monthIdx < 0 || monthIdx > 11) {
    return iso;
  }
  return `${MONTHS_SHORT[monthIdx]} ${day}`;
}

/** Reads a finite numeric field out of a jsonb policy blob, else null. */
function readNumberField(policy: unknown, key: string): number | null {
  if (!policy || typeof policy !== 'object') return null;
  const value = (policy as Record<string, unknown>)[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}
