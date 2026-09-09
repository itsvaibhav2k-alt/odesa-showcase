/**
 * Properties — portfolio command-center queries (real Supabase data).
 *
 * Real replacement for `./mock-portfolio.ts`. Every function here returns the
 * EXACT same shape its mock counterpart did so the `/properties` page and its
 * portfolio components render unchanged — only the data is now derived from
 * live rows.
 *
 * All reads go through `createServerClient()` so RLS auto-scopes to the
 * caller's organization (no `organizationId` parameter — callers can't bypass
 * RLS by accident). Mirrors the house style in `./queries.ts`: explicit column
 * selects (never `select('*')`), joins decomposed into follow-up `.in()`
 * queries rather than PostgREST embeds, and small typed helpers.
 *
 * The derived health model:
 *   - occupancy   — distinct active leases vs. unit count
 *   - collected   — current-cycle rent_events (amount_paid vs amount_due)
 *   - active items — open work_orders + late rent + lease renewals (≤60d)
 *   - status enum  — atrisk > watching > leasing > calm (precedence below)
 *
 * Type-only imports come from `./mock-portfolio` so the component contract is
 * preserved field-for-field; only the data VALUES are now real.
 */

import { rentCycleFromRow, type DerivedRentCycleStatus } from '@/lib/domain';
import { createServerClient } from '@/lib/supabase/server';
import type {
  PortfolioProperty,
  PortfolioSummary,
  PortfolioTab,
  PortfolioUnit,
  PriorityItem,
  PropertyIssue,
  PropertyStatus,
  StatMetric,
} from './mock-portfolio';

// =====================================================================
// Constants
// =====================================================================

const OPEN_WO_STATUSES = ['open', 'assigned', 'in_progress'] as const;

/** Urgencies that escalate a property to `atrisk`. */
const SEVERE_WO_URGENCIES = ['emergency', 'urgent'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Window (in days) within which an active lease end_date counts as a renewal. */
const RENEWAL_WINDOW_DAYS = 60;

/** Stay below both PostgREST's response cap and practical URL limits. */
const PAGE_SIZE = 500;
const IN_FILTER_CHUNK_SIZE = 200;

/**
 * Human labels for the four derived statuses — mirrors the mock's
 * `statusLabel` strings exactly so the status pill text is unchanged.
 */
const STATUS_LABELS: Record<PropertyStatus, string> = {
  atrisk: 'At risk',
  watching: 'Watching',
  leasing: 'Leasing',
  calm: 'Calm',
};

/** Title-case label derived from a `work_order_category` enum value. */
const CATEGORY_LABELS: Record<string, string> = {
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
  other: 'General',
};

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

interface QueryFailure {
  message: string;
}

interface PageResult<Row> {
  data: Row[] | null;
  error: QueryFailure | null;
}

// =====================================================================
// Internal aggregation model
// =====================================================================

interface LoadedUnit {
  id: string;
  propertyId: string;
  label: string;
}

interface LoadedLease {
  id: string;
  unitId: string;
  tenantId: string | null;
  /** Resolved in `loadPortfolio` from a single batched tenants fetch. */
  tenantName: string | null;
  rentAmount: number;
  endDate: string | null;
}

interface LoadedWorkOrder {
  id: string;
  unitId: string;
  category: string;
  urgency: string;
  status: string;
}

interface LoadedRentEvent {
  leaseId: string;
  cycleMonth: string;
  amountDue: number;
  amountPaid: number;
  status: string;
  dueDate: string | null;
  /** Canonical date-aware derivation — the ONE lateness source. */
  derived: DerivedRentCycleStatus;
}

/** Everything a property needs for its card + the cross-portfolio rollups. */
interface PropertyAggregate {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  units: LoadedUnit[];
  /** Active leases on this property's units. */
  leases: LoadedLease[];
  /** Open (non-terminal) work orders on this property's units. */
  openWorkOrders: LoadedWorkOrder[];
  /** Current-cycle rent events for this property's active leases. */
  currentRentEvents: LoadedRentEvent[];
  unitCount: number;
  occupiedUnits: number;
}

// =====================================================================
// Core loader — one fetch graph shared by every public function
// =====================================================================

/**
 * Loads the full portfolio aggregate in a small, predictable set of
 * round-trips (properties → units → leases / work_orders → rent_events).
 * Returns the per-property aggregates ordered by operational severity
 * (most-severe first) so the cards and priority feed read top-down like
 * the mock did.
 */
async function loadPortfolio(): Promise<PropertyAggregate[]> {
  const supabase = await createServerClient();
  // One clock read at the IO boundary so every derived status agrees.
  const todayIso = currentIsoDate();

  const properties = await fetchAllPages<{
    id: string;
    name: string;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
  }>('properties', (from, to) =>
    supabase
      .from('properties')
      .select(
        'id, name, address_street, address_city, address_state, address_zip',
      )
      .order('id', { ascending: true })
      .range(from, to),
  );

  if (properties.length === 0) return [];

  const propertyIds = properties.map((p) => p.id);

  const unitRows = await fetchAllForIds<{
    id: string;
    property_id: string;
    label: string;
  }>(propertyIds, 'units', (ids, from, to) =>
    supabase
      .from('units')
      .select('id, property_id, label')
      .in('property_id', ids)
      .order('id', { ascending: true })
      .range(from, to),
  );

  const units: LoadedUnit[] = unitRows.map((u) => ({
    id: u.id,
    propertyId: u.property_id,
    label: u.label,
  }));

  const unitIds = units.map((u) => u.id);
  const unitById = new Map<string, LoadedUnit>();
  for (const u of units) unitById.set(u.id, u);

  // Active leases + open work orders for those units — parallel.
  const [leases, openWorkOrders] = await Promise.all([
    fetchActiveLeases(supabase, unitIds),
    fetchOpenWorkOrders(supabase, unitIds),
  ]);

  // Current-cycle rent events + tenant names for those leases — parallel.
  const leaseIds = leases.map((l) => l.id);
  const [currentRentEvents, tenantNameById] = await Promise.all([
    fetchCurrentRentEvents(supabase, leaseIds, todayIso),
    fetchTenantNames(supabase, leases),
  ]);

  // Index leases / work orders / rent events by property via unit→property.
  // Resolve each lease's tenant name here (no mutation — fresh lease objects).
  const leaseToProperty = new Map<string, string>();
  const leasesByProperty = new Map<string, LoadedLease[]>();
  for (const l of leases) {
    const unit = unitById.get(l.unitId);
    if (!unit) continue;
    const resolved: LoadedLease = {
      ...l,
      tenantName: l.tenantId ? (tenantNameById.get(l.tenantId) ?? null) : null,
    };
    leaseToProperty.set(l.id, unit.propertyId);
    pushInto(leasesByProperty, unit.propertyId, resolved);
  }

  const woByProperty = new Map<string, LoadedWorkOrder[]>();
  for (const wo of openWorkOrders) {
    const unit = unitById.get(wo.unitId);
    if (!unit) continue;
    pushInto(woByProperty, unit.propertyId, wo);
  }

  const rentByProperty = new Map<string, LoadedRentEvent[]>();
  for (const ev of currentRentEvents) {
    const propId = leaseToProperty.get(ev.leaseId);
    if (!propId) continue;
    pushInto(rentByProperty, propId, ev);
  }

  const unitsByProperty = new Map<string, LoadedUnit[]>();
  for (const u of units) pushInto(unitsByProperty, u.propertyId, u);

  const aggregates: PropertyAggregate[] = properties.map((p) => {
    const propUnits = unitsByProperty.get(p.id) ?? [];
    const propLeases = leasesByProperty.get(p.id) ?? [];
    const occupiedUnits = new Set(propLeases.map((l) => l.unitId)).size;
    return {
      id: p.id,
      name: p.name,
      street: p.address_street,
      city: p.address_city,
      state: p.address_state,
      zip: p.address_zip,
      units: propUnits,
      leases: propLeases,
      openWorkOrders: woByProperty.get(p.id) ?? [],
      currentRentEvents: rentByProperty.get(p.id) ?? [],
      unitCount: propUnits.length,
      occupiedUnits,
    };
  });

  // Order by operational severity (most-severe first), ties by name.
  return aggregates.sort((a, b) => {
    const bySev = severityRank(b) - severityRank(a);
    if (bySev !== 0) return bySev;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Read a complete PostgREST collection with deterministic range pagination.
 * A short final page is the only completion signal; every page error aborts
 * the aggregate so the UI cannot turn a failed child read into a false zero.
 */
async function fetchAllPages<Row>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`Failed to load portfolio ${label}: ${error.message}`);
    }
    if (!data) {
      throw new Error(
        `Failed to load portfolio ${label}: query returned no data`,
      );
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/** Chunk large `.in(...)` filters, then paginate each chunk independently. */
async function fetchAllForIds<Row>(
  ids: readonly string[],
  label: string,
  page: (
    ids: readonly string[],
    from: number,
    to: number,
  ) => PromiseLike<PageResult<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += IN_FILTER_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + IN_FILTER_CHUNK_SIZE);
    rows.push(
      ...(await fetchAllPages(label, (from, to) => page(chunk, from, to))),
    );
  }
  return rows;
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key) ?? [];
  arr.push(value);
  map.set(key, arr);
}

async function fetchActiveLeases(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<LoadedLease[]> {
  if (unitIds.length === 0) return [];
  const data = await fetchAllForIds<{
    id: string;
    unit_id: string;
    tenant_id: string | null;
    rent_amount: number;
    end_date: string | null;
    status: string;
  }>(unitIds, 'leases', (ids, from, to) =>
    supabase
      .from('leases')
      .select('id, unit_id, tenant_id, rent_amount, end_date, status')
      .in('unit_id', ids)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, to),
  );
  return data.map((l) => ({
    id: l.id,
    unitId: l.unit_id,
    tenantId: l.tenant_id,
    tenantName: null,
    rentAmount: Number(l.rent_amount),
    endDate: l.end_date,
  }));
}

async function fetchOpenWorkOrders(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<LoadedWorkOrder[]> {
  if (unitIds.length === 0) return [];
  const data = await fetchAllForIds<{
    id: string;
    unit_id: string;
    category: string;
    urgency: string;
    status: string;
  }>(unitIds, 'work_orders', (ids, from, to) =>
    supabase
      .from('work_orders')
      .select('id, unit_id, category, urgency, status')
      .in('unit_id', ids)
      .in('status', OPEN_WO_STATUSES)
      .order('id', { ascending: true })
      .range(from, to),
  );
  return data.map((w) => ({
    id: w.id,
    unitId: w.unit_id,
    category: w.category,
    urgency: w.urgency,
    status: w.status,
  }));
}

/**
 * One batched tenant-name fetch for the entire portfolio (`.in('id', ids)`),
 * keyed tenantId → full_name. Returns an empty map when there are no tenants so
 * search text falls back to name + location + unit labels.
 */
async function fetchTenantNames(
  supabase: SupabaseServerClient,
  leases: readonly LoadedLease[],
): Promise<Map<string, string>> {
  const tenantIds = Array.from(
    new Set(leases.map((l) => l.tenantId).filter((id): id is string => !!id)),
  );
  if (tenantIds.length === 0) return new Map();

  const data = await fetchAllForIds<{ id: string; full_name: string }>(
    tenantIds,
    'tenants',
    (ids, from, to) =>
      supabase
        .from('tenants')
        .select('id, full_name')
        .in('id', ids)
        .order('id', { ascending: true })
        .range(from, to),
  );

  const map = new Map<string, string>();
  for (const t of data) map.set(t.id, t.full_name);
  return map;
}

/**
 * Loads rent events for the current cycle only. The seed (and the production
 * cycle job) key the live cycle on `date_trunc('month', current_date)`, so we
 * filter to the first-of-this-month ISO date.
 */
async function fetchCurrentRentEvents(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
  todayIso: string,
): Promise<LoadedRentEvent[]> {
  if (leaseIds.length === 0) return [];
  const data = await fetchAllForIds<{
    id: string;
    lease_id: string;
    cycle_month: string;
    amount_due: number;
    amount_paid: number;
    status: string;
    due_date: string | null;
  }>(leaseIds, 'rent_events', (ids, from, to) =>
    supabase
      .from('rent_events')
      .select(
        'id, lease_id, cycle_month, amount_due, amount_paid, status, due_date',
      )
      .in('lease_id', ids)
      .eq('cycle_month', currentCycleMonth())
      .order('id', { ascending: true })
      .range(from, to),
  );
  return data.map((r) => ({
    leaseId: r.lease_id,
    cycleMonth: r.cycle_month,
    amountDue: Number(r.amount_due ?? 0),
    amountPaid: Number(r.amount_paid ?? 0),
    status: r.status,
    dueDate: r.due_date,
    derived: rentCycleFromRow(r, todayIso),
  }));
}

// =====================================================================
// Date helpers
// =====================================================================

/** ISO `YYYY-MM-01` for the current calendar month (the live rent cycle). */
function currentCycleMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** ISO `YYYY-MM-DD` today (UTC) — injected into the domain derivations. */
function currentIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Short month name for the current cycle, e.g. "May". */
function currentMonthLabel(): string {
  return new Date().toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}

// =====================================================================
// Per-property derivation
// =====================================================================

interface PropertySignals {
  /** Date-aware late/escalated current-cycle rent events (on_plan excluded). */
  lateRent: LoadedRentEvent[];
  /** Any escalated current-cycle rent event present. */
  hasEscalated: boolean;
  /** Open work orders flagged emergency/urgent. */
  severeWorkOrders: LoadedWorkOrder[];
  /** Active leases whose end_date is within the renewal window. */
  renewals: LoadedLease[];
  /** Units with no active lease. */
  vacantCount: number;
  /** Open work orders count. */
  openWoCount: number;
}

function computeSignals(agg: PropertyAggregate): PropertySignals {
  // Canonical lateness: derived from due_date vs today + balance, never the
  // raw enum. `plan_agreed` is never late; a stale `pending` past due IS.
  const lateRent = agg.currentRentEvents.filter((ev) => ev.derived.isLate);
  const hasEscalated = agg.currentRentEvents.some(
    (ev) => ev.derived.isEscalated,
  );
  const severeWorkOrders = agg.openWorkOrders.filter((wo) =>
    (SEVERE_WO_URGENCIES as readonly string[]).includes(wo.urgency),
  );

  const now = Date.now();
  const windowMs = RENEWAL_WINDOW_DAYS * DAY_MS;
  const renewals = agg.leases.filter((l) => {
    if (!l.endDate) return false;
    const endMs = Date.parse(l.endDate);
    if (Number.isNaN(endMs)) return false;
    return endMs - now <= windowMs && endMs - now >= 0;
  });

  return {
    lateRent,
    hasEscalated,
    severeWorkOrders,
    renewals,
    vacantCount: Math.max(agg.unitCount - agg.occupiedUnits, 0),
    openWoCount: agg.openWorkOrders.length,
  };
}

/**
 * Status precedence (first match wins):
 *   atrisk   — escalated rent OR an emergency/urgent open work order
 *   watching — any open work order OR late rent OR a renewal due
 *   leasing  — a vacant unit with no other open issues
 *   calm     — everything clear
 */
function deriveStatus(s: PropertySignals): PropertyStatus {
  if (s.hasEscalated || s.severeWorkOrders.length > 0) return 'atrisk';
  if (s.openWoCount > 0 || s.lateRent.length > 0 || s.renewals.length > 0) {
    return 'watching';
  }
  if (s.vacantCount > 0) return 'leasing';
  return 'calm';
}

/** Severity rank for ordering (higher = more urgent), used by loadPortfolio. */
function severityRank(agg: PropertyAggregate): number {
  const s = computeSignals(agg);
  switch (deriveStatus(s)) {
    case 'atrisk':
      return 3;
    case 'watching':
      return 2;
    case 'leasing':
      return 1;
    case 'calm':
      return 0;
  }
}

/** Count of distinct active operational items on a property. */
function activeItemCount(s: PropertySignals): number {
  return s.openWoCount + s.lateRent.length + s.renewals.length + s.vacantCount;
}

/** Sum of current-cycle outstanding balances (cents, positive only). */
function outstandingCentsFor(agg: PropertyAggregate): number {
  return agg.currentRentEvents.reduce(
    (sum, ev) => sum + Math.max(ev.derived.balanceCents, 0),
    0,
  );
}

/** Count of current-cycle leases carrying late or outstanding rent. */
function rentIssueCountFor(agg: PropertyAggregate): number {
  return agg.currentRentEvents.filter((ev) => ev.derived.isOutstanding).length;
}

function buildStats(agg: PropertyAggregate, s: PropertySignals): StatMetric[] {
  const occupancyMetric: StatMetric = {
    label: 'Occupancy',
    value: `${agg.occupiedUnits}/${agg.unitCount}`,
    ...(s.vacantCount > 0 ? { tone: 'warn' as const } : {}),
  };

  const collected = collectedMetric(agg);

  return [
    occupancyMetric,
    collected,
    { label: 'Active items', value: String(activeItemCount(s)) },
  ];
}

/**
 * "{Month} collected" — percentage of current-cycle rent paid vs due. When
 * there are no current-cycle rent events, the value is explicitly unavailable;
 * absence of a record is never presented as 100% collection.
 */
function collectedMetric(agg: PropertyAggregate): StatMetric {
  const label = `${currentMonthLabel()} collected`;
  const totalDue = agg.currentRentEvents.reduce(
    (sum, ev) => sum + ev.amountDue,
    0,
  );
  const totalPaid = agg.currentRentEvents.reduce(
    (sum, ev) => sum + ev.amountPaid,
    0,
  );

  if (totalDue <= 0) {
    return { label, value: 'Not recorded' };
  }

  const pct = Math.round((totalPaid / totalDue) * 100);
  return {
    label,
    value: `${pct}%`,
    tone: pct >= 100 ? 'good' : 'warn',
  };
}

function buildIssues(
  agg: PropertyAggregate,
  s: PropertySignals,
): PropertyIssue[] {
  const issues: PropertyIssue[] = [];
  const unitById = new Map(agg.units.map((u) => [u.id, u] as const));

  // Rent issues first (most owner-salient).
  for (const ev of s.lateRent) {
    const lease = agg.leases.find((l) => l.id === ev.leaseId);
    const unit = lease ? unitById.get(lease.unitId) : undefined;
    const where = unit ? `Unit ${unit.label}` : 'A unit';
    if (ev.derived.isEscalated) {
      issues.push({
        tone: 'clay',
        glyph: '⚠',
        text: `${where} rent escalated`,
        meta: lateMeta(ev.derived.daysLate),
      });
    } else {
      issues.push({
        tone: 'amber',
        glyph: '⚠',
        text: `${where} rent late`,
        meta: lateMeta(ev.derived.daysLate),
      });
    }
  }

  // Open work orders (derive a title from category since there is no title col).
  for (const wo of agg.openWorkOrders) {
    const unit = unitById.get(wo.unitId);
    const where = unit ? `Unit ${unit.label}` : 'A unit';
    const tone: PropertyIssue['tone'] = (
      SEVERE_WO_URGENCIES as readonly string[]
    ).includes(wo.urgency)
      ? 'clay'
      : 'amber';
    issues.push({
      tone,
      glyph: '⚠',
      text: `${categoryLabel(wo.category)} · ${where}`,
      meta: workOrderMeta(wo.status, wo.urgency),
    });
  }

  // Lease renewals (watching, not alarming).
  for (const lease of s.renewals) {
    const unit = unitById.get(lease.unitId);
    const where = unit ? `Unit ${unit.label}` : 'A unit';
    issues.push({
      tone: 'neutral',
      glyph: '◷',
      text: `${where} renewal`,
      meta: 'lease ending within 60 days',
    });
  }

  // Vacancies (leasing).
  if (s.vacantCount > 0) {
    issues.push({
      tone: 'neutral',
      glyph: '◷',
      text: vacancyText(s.vacantCount),
      meta: 'no active lease recorded',
    });
  }

  if (issues.length === 0) {
    issues.push({ tone: 'allclear', glyph: '✓', text: 'All clear' });
  }

  return issues;
}

/** Date-true "N days late" meta from the derived cycle status. */
function lateMeta(daysLate: number): string {
  if (daysLate <= 0) return 'late';
  return `${daysLate} day${daysLate === 1 ? '' : 's'} late`;
}

function workOrderMeta(status: string, urgency: string): string {
  const urgencyLabel =
    urgency === 'emergency'
      ? 'emergency'
      : urgency === 'urgent'
        ? 'urgent'
        : 'routine';
  const statusLabel =
    status === 'open'
      ? 'unassigned'
      : status === 'assigned'
        ? 'vendor dispatched'
        : 'in progress';
  return `${urgencyLabel} · ${statusLabel}`;
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? 'General';
}

function vacancyText(count: number): string {
  return count === 1 ? '1 unit vacant' : `${count} units vacant`;
}

/** "{City}, {State} · N units" location line. */
function buildLocation(agg: PropertyAggregate): string {
  const place = [agg.city, agg.state].filter(Boolean).join(', ');
  const unitsLabel = `${agg.unitCount} unit${agg.unitCount === 1 ? '' : 's'}`;
  return place ? `${place} · ${unitsLabel}` : unitsLabel;
}

/** Recorded postal address. Missing pieces are omitted, never synthesized. */
function buildAddress(agg: PropertyAggregate): string | undefined {
  const locality = [agg.city, agg.state].filter(Boolean).join(', ');
  const localityWithZip = [locality, agg.zip].filter(Boolean).join(' ');
  const address = [agg.street, localityWithZip].filter(Boolean).join(' · ');
  return address || undefined;
}

/**
 * Lowercased search corpus: property name + location + every unit label + every
 * active-lease tenant name (resolved on the aggregate's leases in loadPortfolio).
 */
function buildSearchText(agg: PropertyAggregate): string {
  const parts: string[] = [
    agg.name,
    buildLocation(agg),
    buildAddress(agg) ?? '',
  ];
  for (const u of agg.units) parts.push(u.label);
  for (const l of agg.leases) {
    if (l.tenantName) parts.push(l.tenantName);
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function buildUnitRows(agg: PropertyAggregate): PortfolioUnit[] {
  return agg.units.map((unit) => {
    const lease = agg.leases.find((item) => item.unitId === unit.id) ?? null;
    const rentEvent = lease
      ? (agg.currentRentEvents.find((item) => item.leaseId === lease.id) ??
        null)
      : null;
    const workOrders = agg.openWorkOrders.filter(
      (item) => item.unitId === unit.id,
    );
    const firstWorkOrder = workOrders[0] ?? null;

    let rentState: PortfolioUnit['rentState'] = 'not-recorded';
    if (rentEvent?.derived.isLate) rentState = 'late';
    else if (rentEvent?.derived.isOutstanding) rentState = 'outstanding';
    else if (rentEvent) rentState = 'current';

    return {
      id: unit.id,
      label: unit.label,
      tenantName: lease?.tenantName ?? null,
      occupancy: lease ? 'occupied' : 'vacant',
      leaseEnd: lease?.endDate ?? null,
      rentState,
      openWorkCount: workOrders.length,
      openIssue: firstWorkOrder ? categoryLabel(firstWorkOrder.category) : null,
    };
  });
}

/** Summary lead + rest for the card body, mirroring the mock's two-part copy. */
function buildSummary(
  status: PropertyStatus,
  s: PropertySignals,
): { lead?: string; rest: string } {
  switch (status) {
    case 'atrisk': {
      if (s.hasEscalated) {
        return {
          lead: 'Rent escalated',
          rest: 'Payment 7+ days late · review required',
        };
      }
      return { lead: 'Maintenance urgent', rest: 'Emergency work order open' };
    }
    case 'watching': {
      if (s.lateRent.length > 0) {
        return { lead: 'Rent late', rest: 'Payment overdue this cycle' };
      }
      if (s.openWoCount > 0) {
        return { lead: 'Work order open', rest: 'Open work order recorded' };
      }
      return {
        lead: 'Lease ending',
        rest: 'Recorded end date is within 60 days',
      };
    }
    case 'leasing':
      return { lead: 'Vacancy recorded', rest: 'No active lease is recorded' };
    case 'calm':
      return { rest: 'No current rent, lease, vacancy, or open-work flags' };
  }
}

// =====================================================================
// Public API — drop-in replacements for ./mock-portfolio
// =====================================================================

/**
 * Returns one portfolio card per property, ordered by operational severity
 * (most-urgent first). Each `id` is the real property UUID so the card's
 * `propertyHref(id)` resolves to `/properties/<uuid>`.
 */
export async function getProperties(): Promise<PortfolioProperty[]> {
  const aggregates = await loadPortfolio();

  return aggregates.map((agg) => {
    const signals = computeSignals(agg);
    const status = deriveStatus(signals);
    const summary = buildSummary(status, signals);
    const activeItems = activeItemCount(signals);
    const address = buildAddress(agg);

    return {
      id: agg.id,
      name: agg.name,
      ...(address ? { address } : {}),
      location: buildLocation(agg),
      status,
      statusLabel: STATUS_LABELS[status],
      ...(summary.lead ? { summaryLead: summary.lead } : {}),
      summaryRest: summary.rest,
      stats: buildStats(agg, signals),
      issues: buildIssues(agg, signals),
      activeItems,
      signals: {
        needsAttention: status !== 'calm' || activeItems > 0,
        rentLate: signals.lateRent.length > 0,
        maintenanceOpen: signals.openWoCount > 0,
        vacant: signals.vacantCount > 0,
        leaseEnding: signals.renewals.length > 0,
      },
      outstandingCents: outstandingCentsFor(agg),
      rentIssueCount: rentIssueCountFor(agg),
      maintenanceOpenCount: signals.openWoCount,
      unitCount: agg.unitCount,
      occupiedUnitCount: agg.occupiedUnits,
      searchText: buildSearchText(agg),
      units: buildUnitRows(agg),
    };
  });
}

/**
 * Cross-portfolio priority feed for the "needs attention" panel, ordered by
 * severity. Built from the same aggregate as the cards so the feed and cards
 * never disagree. Each item's `loc` uses "{Property} · Unit {label}" so the
 * panel's property-count derivation (splits on " · ") stays correct.
 */
export async function getPriorityItems(): Promise<PriorityItem[]> {
  const aggregates = await loadPortfolio();
  const items: PriorityItem[] = [];

  for (const agg of aggregates) {
    const unitById = new Map(agg.units.map((u) => [u.id, u] as const));
    const signals = computeSignals(agg);

    // Escalated rent — most urgent.
    for (const ev of signals.lateRent) {
      const lease = agg.leases.find((l) => l.id === ev.leaseId);
      const unit = lease ? unitById.get(lease.unitId) : undefined;
      const escalated = ev.derived.isEscalated;
      items.push({
        id: `rent-${ev.leaseId}`,
        dot: escalated ? 'clay' : 'amber',
        kind: escalated ? 'Rent escalated' : 'Rent late',
        loc: locLine(agg.name, unit?.label),
        detail: escalated
          ? `${lateMeta(ev.derived.daysLate)} · escalation ready`
          : `${lateMeta(ev.derived.daysLate)} · follow-up needed`,
        actions: [
          { label: escalated ? 'Escalate' : 'Review', variant: 'primary' },
          { label: 'View', variant: 'default' },
        ],
      });
    }

    // Open work orders.
    for (const wo of agg.openWorkOrders) {
      const unit = unitById.get(wo.unitId);
      const severe = (SEVERE_WO_URGENCIES as readonly string[]).includes(
        wo.urgency,
      );
      items.push({
        id: `wo-${wo.id}`,
        dot: severe ? 'clay' : 'amber',
        kind: `${categoryLabel(wo.category)} issue`,
        loc: locLine(agg.name, unit?.label),
        detail: workOrderMeta(wo.status, wo.urgency),
        actions: [
          { label: severe ? 'Dispatch' : 'Check status', variant: 'primary' },
          { label: 'View', variant: 'default' },
        ],
      });
    }

    // Renewals.
    for (const lease of signals.renewals) {
      const unit = unitById.get(lease.unitId);
      items.push({
        id: `renewal-${lease.id}`,
        dot: 'neutral',
        kind: 'Lease renewal',
        loc: locLine(agg.name, unit?.label),
        detail: 'Renewal due · owner approval needed',
        actions: [
          { label: 'Review', variant: 'primary' },
          { label: 'View', variant: 'default' },
        ],
      });
    }

    // Vacancies.
    if (signals.vacantCount > 0) {
      const vacantUnit = agg.units.find(
        (u) => !agg.leases.some((l) => l.unitId === u.id),
      );
      items.push({
        id: `vacancy-${agg.id}`,
        dot: 'neutral',
        kind: 'Vacancy',
        loc: locLine(agg.name, vacantUnit?.label),
        detail: `${signals.vacantCount} listed · leasing active`,
        actions: [
          { label: 'View listing', variant: 'primary' },
          { label: 'View', variant: 'default' },
        ],
      });
    }
  }

  return items;
}

/** "{Property} · Unit {label}" priority/issue location line. */
function locLine(propertyName: string, unitLabel: string | undefined): string {
  return unitLabel ? `${propertyName} · Unit ${unitLabel}` : propertyName;
}

/**
 * Portfolio roll-up for the sticky header: property count, total units,
 * occupancy percentage (occupied units / total units), and MRR (sum of active
 * lease rent, formatted as whole dollars).
 */
export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const aggregates = await loadPortfolio();

  const propertyCount = aggregates.length;
  const totalUnits = aggregates.reduce((sum, a) => sum + a.unitCount, 0);
  const occupiedUnits = aggregates.reduce((sum, a) => sum + a.occupiedUnits, 0);
  const occupancyPct =
    totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

  const mrrDollars = aggregates.reduce(
    (sum, a) => sum + a.leases.reduce((s, l) => s + l.rentAmount, 0),
    0,
  );

  // Attention breakdown summed across properties. Owner-decision is omitted —
  // there is no reliable portfolio-level proposal count, so it is not faked.
  const attention = aggregates.reduce(
    (acc, agg) => {
      const signals = computeSignals(agg);
      const rent = rentIssueCountFor(agg);
      const maintenance = signals.openWoCount;
      const leasing = signals.renewals.length;
      const vacant = signals.vacantCount;
      return {
        rent: acc.rent + rent,
        maintenance: acc.maintenance + maintenance,
        leasing: acc.leasing + leasing,
        vacant: acc.vacant + vacant,
        total: acc.total + rent + maintenance + leasing + vacant,
      };
    },
    { rent: 0, maintenance: 0, leasing: 0, vacant: 0, total: 0 },
  );

  return {
    properties: propertyCount,
    units: totalUnits,
    occupancy: `${occupancyPct}%`,
    mrr: formatDollars(mrrDollars),
    attention,
  };
}

/** Whole-dollar currency, e.g. `$24,180`. */
function formatDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * Facet tabs. Overview stays in-page; the others navigate to their list
 * routes (hrefs are attached by the client). Counts come from live rows where
 * a real source exists:
 *   - tenants — distinct tenants on active leases
 *   - vendors — vendor count
 *   - documents — no documents table exists, so the count is omitted (the
 *     header tab simply renders without a badge, same as the rent tab).
 */
export async function getTabs(): Promise<PortfolioTab[]> {
  const supabase = await createServerClient();

  const [tenantCount, vendorCount] = await Promise.all([
    countActiveTenants(supabase),
    countVendors(supabase),
  ]);

  return [
    { id: 'overview', label: 'Overview' },
    { id: 'tenants', label: 'Tenants', count: tenantCount },
    { id: 'vendors', label: 'Vendors', count: vendorCount },
    { id: 'rent', label: 'Rent' },
    { id: 'documents', label: 'Documents' },
  ];
}

async function countActiveTenants(
  supabase: SupabaseServerClient,
): Promise<number> {
  const data = await fetchAllPages<{ id: string; tenant_id: string }>(
    'active tenants',
    (from, to) =>
      supabase
        .from('leases')
        .select('id, tenant_id')
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to),
  );
  return new Set(data.map((l) => l.tenant_id)).size;
}

async function countVendors(supabase: SupabaseServerClient): Promise<number> {
  const { count, error } = await supabase
    .from('vendors')
    .select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`Failed to load portfolio vendors: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Ask-Odesa prompt suggestions. These are static UI affordances (not derived
 * from any table) — preserved verbatim from the mock so the prompt bar reads
 * identically.
 */
export function getAskPrompts(): string[] {
  return [
    'Which property needs attention first?',
    "Summarize today's risks",
    'Escalate overdue vendors',
    'Show rent outstanding by unit',
    'Draft an owner update',
  ];
}
