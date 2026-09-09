/**
 * Rent ledger query — powers the `/rent` page.
 *
 * `listRentLedger()` returns the SAME shape the mock `getRentLedger()`
 * produces (summary + facets + rows), so the existing `RentLedger`
 * client island and `RentRow` component render unchanged. Only the data
 * source changes: real `rent_events` for one cycle month (current by
 * default), joined back to lease → unit → property → tenant.
 *
 * All reads go through `createServerClient()` so RLS auto-scopes to the
 * caller's organization_id — these helpers never accept an
 * `organizationId` parameter. Joins are decomposed into follow-up `.in()`
 * queries rather than PostgREST embeds (mirrors the style in
 * `@/lib/properties/queries`), because nested embeds under RLS are
 * brittle and hard to test.
 */

import { createServerClient } from '@/lib/supabase/server';
import { displayName, displayUnitLabel } from '@/lib/demo-safe/normalize';
import { rentCycleFromRow, type DerivedRentCycleStatus } from '@/lib/domain';
import type { MetricCell } from '@/lib/properties/mock-detail';
import type {
  FacetSpec,
  RentFacetId,
  RentLeaseTerms,
  RentLedger,
  RentLedgerRow,
  RentStatus,
  RentStatusPill,
} from '@/lib/properties/mock-portfolio-views';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

// =====================================================================
// Helpers
// =====================================================================

/**
 * First-of-this-month ISO date (YYYY-MM-DD) in local time — the
 * `rent_events.cycle_month` value for the current ledger period. The
 * seed computes the live cycle with `date_trunc('month', CURRENT_DATE)`,
 * so matching on the truncated month keeps the two in lockstep.
 */
function currentCycleMonthIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Local-time YYYY-MM-DD for "today" — computed ONCE at the IO boundary
 * in `listRentLedger` and passed into the pure domain derivation (no
 * hidden clock in the domain module).
 */
function localTodayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** "May 2026" period label for the given cycle-month ISO date. */
function periodLabel(cycleIso: string): string {
  const parsed = parseIsoDate(cycleIso);
  if (!parsed) return '';
  return `${MONTHS[parsed.month]} ${parsed.year}`;
}

/** "May 1" short date label for a YYYY-MM-DD string, or '' if unparseable. */
function shortDateLabel(iso: string | null | undefined): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) return '';
  return `${MONTHS[parsed.month]} ${parsed.day}`;
}

/** Parse a YYYY-MM-DD string without timezone drift. `month` is 0-indexed. */
function parseIsoDate(
  iso: string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!iso || iso.length < 10) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11) return null;
  return { year, month, day };
}

/** numeric(10,2) dollars → integer cents (defensive: handles string/number). */
function dollarsToCents(dollars: number | string | null | undefined): number {
  if (dollars == null) return 0;
  return Math.round(Number(dollars) * 100);
}

/** Format integer cents as "$1,450" (whole dollars, grouped thousands). */
function formatDollars(cents: number): string {
  const whole = Math.round(cents / 100);
  return `$${whole.toLocaleString('en-US')}`;
}

/**
 * Map a derived rent-cycle status to the three-state UI status the
 * ledger renders. The `RentStatus` union and facet ids stay stable —
 * paid → paid; on-plan → on-plan; everything still owing (due / late /
 * escalated / unknown) stays `outstanding`. Only the label sharpens.
 */
function toRentStatusPill(derived: DerivedRentCycleStatus): RentStatusPill {
  switch (derived.kind) {
    case 'paid':
      return { status: 'paid', label: 'Paid' };
    case 'on_plan':
      return { status: 'on-plan', label: 'On plan' };
    case 'escalated':
      return { status: 'outstanding', label: 'Escalated' };
    case 'late':
      return { status: 'outstanding', label: 'Overdue' };
    case 'due':
      return { status: 'outstanding', label: 'Due' };
    case 'unknown':
      return { status: 'outstanding', label: 'Outstanding' };
  }
}

/** Facet membership — keep aligned with `matchesFacet` in rent-ledger.tsx. */
function inRentFacet(facet: RentFacetId, status: RentStatus): boolean {
  switch (facet) {
    case 'all':
      return true;
    case 'paid':
      return status === 'paid';
    case 'outstanding':
      return status === 'outstanding';
    case 'on-plan':
      return status === 'on-plan';
  }
}

// =====================================================================
// Intermediate row shapes from the decomposed joins
// =====================================================================

interface RentEventRow {
  id: string;
  lease_id: string;
  cycle_month: string;
  amount_due: number | string;
  amount_paid: number | string;
  status: string;
  due_date: string | null;
  /** Waive audit timestamp — non-null rows render a "Waived" pill. */
  waived_at: string | null;
}

interface LeaseLookup {
  unitId: string;
  tenantId: string;
  /** Inline-editable terms; present only while the lease is active. */
  terms: RentLeaseTerms | null;
}

/** A rent event paired with its canonical derived status (derived ONCE). */
interface LedgerCycle {
  event: RentEventRow;
  derived: DerivedRentCycleStatus;
}

// =====================================================================
// Public API
// =====================================================================

/** First-of-month cycle ISO date — the only shape `?cycle=` may resolve to. */
const CYCLE_ISO_PATTERN = /^\d{4}-\d{2}-01$/;

/**
 * Rent ledger for one cycle month (rows + facets + summary metrics).
 *
 * Mirrors the mock `getRentLedger()` return shape field-for-field so the
 * `/rent` page renders identically off real Supabase data. RLS scopes
 * every read to the caller's organization automatically.
 *
 * Empty months return a well-formed `RentLedger` with zeroed metrics and
 * an empty `rows` array — the page must still render.
 *
 * @param requestedCycleIso - Optional 'YYYY-MM-01' cycle month (from
 *   `/rent?cycle=`). Invalid or absent → the current calendar month.
 */
export async function listRentLedger(requestedCycleIso?: string): Promise<RentLedger> {
  const supabase = await createServerClient();
  const cycleIso =
    requestedCycleIso && CYCLE_ISO_PATTERN.test(requestedCycleIso)
      ? requestedCycleIso
      : currentCycleMonthIso();
  const todayIso = localTodayIso();

  // 1. Rent events for the current cycle month (RLS-scoped to the org).
  const { data: eventsData } = await supabase
    .from('rent_events')
    .select('id, lease_id, cycle_month, amount_due, amount_paid, status, due_date, waived_at')
    .eq('cycle_month', cycleIso);

  const events = (eventsData ?? []) as RentEventRow[];

  if (events.length === 0) {
    return emptyLedger(cycleIso);
  }

  // Derive each cycle's canonical status ONCE — the row pills, "when"
  // labels, and summary metrics all read from the same derived value.
  const cycles: LedgerCycle[] = events.map((event) => ({
    event,
    derived: rentCycleFromRow(event, todayIso),
  }));

  // 2. Resolve the leases referenced by those events → unit + tenant.
  const leaseIds = Array.from(new Set(events.map((e) => e.lease_id)));
  const leaseLookup = await fetchLeaseLookup(supabase, leaseIds);

  // 3. Resolve tenant names and unit (label + property) in parallel.
  const tenantIds = Array.from(
    new Set(
      Array.from(leaseLookup.values()).map((l) => l.tenantId),
    ),
  );
  const unitIds = Array.from(
    new Set(
      Array.from(leaseLookup.values()).map((l) => l.unitId),
    ),
  );

  const [tenantNames, units] = await Promise.all([
    fetchTenantNameMap(supabase, tenantIds),
    fetchUnitMap(supabase, unitIds),
  ]);

  // 4. Resolve property names for the units we found.
  const propertyIds = Array.from(
    new Set(Array.from(units.values()).map((u) => u.propertyId)),
  );
  const propertyNames = await fetchPropertyNameMap(supabase, propertyIds);

  // 5. Assemble ledger rows.
  const rows: RentLedgerRow[] = [];
  for (const { event, derived } of cycles) {
    const lease = leaseLookup.get(event.lease_id);
    if (!lease) continue;
    const unit = units.get(lease.unitId);
    if (!unit) continue;

    const tenantName = displayName(
      tenantNames.get(lease.tenantId) ?? 'Unknown tenant',
    );
    const propertyName = propertyNames.get(unit.propertyId) ?? '';
    // Waived rows derive as paid (balance-first) but must not READ as
    // paid — the audit column drives the honest label.
    const statusPill: RentStatusPill =
      event.waived_at && derived.kind === 'paid'
        ? { status: 'paid', label: 'Waived' }
        : toRentStatusPill(derived);
    const amountCents = dollarsToCents(event.amount_due);

    rows.push({
      initial: avatarInitial(tenantName),
      tenantName,
      property: propertyName,
      unit: displayUnitLabel(unit.label),
      // Real data has no human-readable slugs — the unit-detail route is
      // keyed by UUID (`/properties/[id]/units/[unitId]`), so the IDs ARE
      // the slug values here. Keeps the row key + href stable and unique.
      propSlug: unit.propertyId,
      unitSlug: unit.id,
      amount: formatDollars(amountCents),
      when: whenLabel(derived, event.due_date),
      statusPill,
      href: `/properties/${unit.propertyId}/units/${unit.id}`,
      // rent_event id + lease id + outstanding balance power the "Record
      // payment" affordance on outstanding rows. The action targets this EXACT
      // rent_events row by id (the displayed cycle), not a recomputed cycle.
      rentEventId: event.id,
      leaseId: event.lease_id,
      outstandingDollars: derived.balanceCents / 100,
      ...(lease.terms ? { leaseTerms: lease.terms } : {}),
    });
  }

  rows.sort(compareRows);

  return {
    summary: buildSummary(cycleIso, cycles),
    facets: buildFacets(rows),
    rows,
  };
}

/** A confirmed payment row for the compact /rent activity rail. */
export interface RecentRentPayment {
  id: string;
  rentEventId: string | null;
  tenantName: string;
  amountCents: number;
  paidAt: string;
  paymentMethodType: string | null;
  receiptUrl: string | null;
}

/**
 * Most recent confirmed rent payments. Only `status = succeeded` rows with a
 * real `paid_at` timestamp qualify; `rent_events.updated_at` is deliberately
 * never treated as payment evidence.
 */
export async function listRecentRentPayments(
  limit = 3,
): Promise<RecentRentPayment[]> {
  const supabase = await createServerClient();
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 10));
  const { data, error } = await supabase
    .from('rent_payments')
    .select(
      'id, rent_event_id, tenant_id, amount_cents, paid_at, payment_method_type, receipt_url',
    )
    .eq('status', 'succeeded')
    .not('paid_at', 'is', null)
    .order('paid_at', { ascending: false })
    .limit(safeLimit);

  if (error || !data || data.length === 0) return [];

  const tenantNames = await fetchTenantNameMap(
    supabase,
    Array.from(new Set(data.map((payment) => payment.tenant_id))),
  );

  return data.flatMap((payment) => {
    if (!payment.paid_at) return [];
    return [
      {
        id: payment.id,
        rentEventId: payment.rent_event_id,
        tenantName: displayName(
          tenantNames.get(payment.tenant_id) ?? 'Unknown tenant',
        ),
        amountCents: payment.amount_cents,
        paidAt: payment.paid_at,
        paymentMethodType: payment.payment_method_type,
        receiptUrl: payment.receipt_url,
      },
    ];
  });
}

// =====================================================================
// Summary + facets
// =====================================================================

/**
 * Header summary metrics for the ledger. Billed = Σ amount_due;
 * Collected = Σ amount_paid as a % of billed; Outstanding = billed −
 * collected in dollars; On a plan = count of derived on-plan cycles;
 * Late = count of cycles whose DERIVED status is late (date-overdue or
 * escalated — not just the raw enum, so an unpaid past-due `pending`
 * cycle counts).
 */
function buildSummary(
  cycleIso: string,
  cycles: readonly LedgerCycle[],
): RentLedger['summary'] {
  const period = periodLabel(cycleIso);

  let billedCents = 0;
  let collectedCents = 0;
  let onPlanCount = 0;
  let lateCount = 0;

  for (const { event, derived } of cycles) {
    billedCents += dollarsToCents(event.amount_due);
    collectedCents += dollarsToCents(event.amount_paid);
    if (derived.isOnPlan) onPlanCount += 1;
    if (derived.isLate) lateCount += 1;
  }

  const outstandingCents = Math.max(billedCents - collectedCents, 0);
  const collectedPct = billedCents > 0
    ? Math.round((collectedCents / billedCents) * 100)
    : 0;

  const billedLabel = formatDollars(billedCents);
  const collectedLabel = `${collectedPct}%`;
  const outstandingLabel = formatDollars(outstandingCents);

  const metrics: MetricCell[] = [
    { label: 'Billed', value: billedLabel },
    { label: 'Collected', value: collectedLabel },
    {
      label: 'Outstanding',
      value: outstandingLabel,
      ...(outstandingCents > 0 ? { tone: 'warn' as const } : {}),
    },
    { label: 'On a plan', value: String(onPlanCount) },
    {
      label: 'Late',
      value: String(lateCount),
      ...(lateCount > 0 ? { tone: 'warn' as const } : {}),
    },
  ];

  const summary = [
    `${billedLabel} billed`,
    `${collectedPct}% collected`,
    `${outstandingLabel} outstanding`,
    `${onPlanCount} on a plan`,
  ].join(' · ');

  return {
    period,
    summary,
    metrics,
    facts: {
      billedCents,
      collectedCents,
      outstandingCents,
      collectionRate: collectedPct,
      onPlanCount,
      lateCount,
    },
  };
}

/** Build the four ledger facets with live counts from the assembled rows. */
function buildFacets(
  rows: readonly RentLedgerRow[],
): readonly FacetSpec<RentFacetId>[] {
  const countFor = (facet: RentFacetId): number =>
    rows.reduce(
      (n, r) => (inRentFacet(facet, r.statusPill.status) ? n + 1 : n),
      0,
    );

  return [
    { id: 'all', label: 'All', count: countFor('all') },
    { id: 'paid', label: 'Paid', count: countFor('paid') },
    { id: 'outstanding', label: 'Outstanding', count: countFor('outstanding') },
    { id: 'on-plan', label: 'On a plan', count: countFor('on-plan') },
  ];
}

/** A well-formed empty ledger (no rent events for the month). */
function emptyLedger(cycleIso: string): RentLedger {
  return {
    summary: buildSummary(cycleIso, []),
    facets: buildFacets([]),
    rows: [],
  };
}

// =====================================================================
// Row-shaping helpers
// =====================================================================

/** Uppercase first letter of the tenant name for the avatar glyph. */
function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
}

/**
 * "When" cell: paid rows show the due/cycle date (e.g. "May 1"); rows
 * still owing show "Due {Mon D}"; date-overdue rows append the derived
 * days late, e.g. "Due Jun 1 · 11 days late". Falls back to the derived
 * short label when the date can't be parsed.
 */
function whenLabel(derived: DerivedRentCycleStatus, dueDate: string | null): string {
  const dateLabel = shortDateLabel(dueDate);
  if (derived.kind === 'paid') {
    return dateLabel || 'Paid';
  }
  if (derived.isLate) {
    return dateLabel
      ? `Due ${dateLabel} · ${derived.daysLate} day${derived.daysLate === 1 ? '' : 's'} late`
      : derived.label;
  }
  return dateLabel ? `Due ${dateLabel}` : 'Due';
}

/** Stable row ordering: by property name, then unit label. */
function compareRows(a: RentLedgerRow, b: RentLedgerRow): number {
  const byProperty = a.property.localeCompare(b.property);
  if (byProperty !== 0) return byProperty;
  return a.unit.localeCompare(b.unit, undefined, { numeric: true });
}

// =====================================================================
// Decomposed-join fetch helpers
// =====================================================================

async function fetchLeaseLookup(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
): Promise<Map<string, LeaseLookup>> {
  const result = new Map<string, LeaseLookup>();
  if (leaseIds.length === 0) return result;

  const { data } = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id, rent_amount, rent_due_day, end_date, status')
    .in('id', leaseIds);

  for (const l of data ?? []) {
    // Inline editing is only offered while the lease is still active —
    // the action also fails closed on terminated/expired leases.
    const terms: RentLeaseTerms | null =
      l.status === 'active' && l.rent_amount != null
        ? {
            leaseId: l.id,
            rentAmount: Number(l.rent_amount),
            rentDueDay: l.rent_due_day,
            endDate: l.end_date,
          }
        : null;
    result.set(l.id, { unitId: l.unit_id, tenantId: l.tenant_id, terms });
  }
  return result;
}

async function fetchTenantNameMap(
  supabase: SupabaseServerClient,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (tenantIds.length === 0) return result;

  const { data } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);

  for (const t of data ?? []) result.set(t.id, t.full_name);
  return result;
}

interface UnitInfo {
  id: string;
  label: string;
  propertyId: string;
}

async function fetchUnitMap(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<Map<string, UnitInfo>> {
  const result = new Map<string, UnitInfo>();
  if (unitIds.length === 0) return result;

  const { data } = await supabase
    .from('units')
    .select('id, label, property_id')
    .in('id', unitIds);

  for (const u of data ?? []) {
    result.set(u.id, { id: u.id, label: u.label, propertyId: u.property_id });
  }
  return result;
}

async function fetchPropertyNameMap(
  supabase: SupabaseServerClient,
  propertyIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (propertyIds.length === 0) return result;

  const { data } = await supabase
    .from('properties')
    .select('id, name')
    .in('id', propertyIds);

  for (const p of data ?? []) result.set(p.id, p.name);
  return result;
}
