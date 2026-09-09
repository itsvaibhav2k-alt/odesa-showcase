/**
 * Properties drill-down queries.
 *
 * All reads go through `createServerClient()` so RLS auto-scopes to the
 * caller's organization_id. These helpers deliberately do not accept an
 * `organizationId` parameter — callers can't bypass RLS by accident.
 *
 * Each function returns a typed shape with explicit column selection
 * (never `select('*')`). Joins are decomposed into follow-up queries
 * rather than PostgREST embeds because PostgREST's column-select syntax
 * with RLS on nested tables is brittle and hard to test.
 *
 * Surfaces:
 *   - listProperties(sort) — `/properties`
 *   - getProperty(id) — property header + KPI strip source
 *   - listUnitsForProperty(propertyId) — unit-grid source
 *   - getUnitDetail(unitId) — the /properties/[id]/units/[unitId] page
 */

import {
  deriveUnitOccupancyStatus,
  rentCycleFromRow,
  type LeaseStatus,
  type UnitOccupancyKind,
} from '@/lib/domain';
import { createServerClient } from '@/lib/supabase/server';
import { displayName, displayUnitLabel } from '@/lib/demo-safe/normalize';
import type {
  ConversationChannel,
  RentEventStatus,
  WorkOrderStatus,
  WorkOrderVendorResponse,
} from '@/types/database';
import {
  deriveVendorChip,
  type VendorLifecycleChip,
} from '@/lib/work-orders/vendor-lifecycle';

// =====================================================================
// List view types
// =====================================================================

/** A row in the `/properties` list view. */
export interface PropertyListRow {
  id: string;
  name: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  /** Count of units in the property. */
  unitCount: number;
  /** Occupancy as 0–100 integer percentage. 0 when the property has 0 units. */
  occupancyPct: number;
  /** Sum of active lease rent_amount in cents. */
  mrrCents: number;
  /** Count of open work orders (status NOT in completed/cancelled). */
  openWorkOrderCount: number;
}

export type PropertySortKey = 'name' | 'units' | 'occupancy' | 'mrr';

// =====================================================================
// Property detail types
// =====================================================================

/** Full property row used by `/properties/[id]` header. */
export interface PropertyDetail {
  id: string;
  name: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  /** v1.5 — owner-authored rulebook (4k char ceiling enforced in UI). */
  rulesText: string;
  /** v1.5 — graduated trust level on [0, 1]. */
  autonomyLevel: number;
  /** v1.5 — provider routing for the per-property worker. */
  privacyMode: 'hosted' | 'on_prem';
  /** v1.5 — required when privacyMode === 'on_prem', else null. */
  ollamaHost: string | null;
  /** Aggregated KPIs for the property, matching the header strip. */
  kpis: PropertyKpis;
}

export interface PropertyKpis {
  unitCount: number;
  occupancyPct: number;
  mrrCents: number;
  openWorkOrderCount: number;
}

// =====================================================================
// Unit-grid types
// =====================================================================

/**
 * Status dot color semantics for the unit grid. `pending` = the unit's only
 * lease is `status='pending'` (move-in being set up) — NOT vacant.
 */
export type UnitStatus = 'current' | 'ending_soon' | 'late' | 'pending' | 'vacant';

export interface UnitGridCard {
  id: string;
  label: string;
  tenantName: string | null;
  rentAmountCents: number | null;
  /** ISO date (YYYY-MM-DD) of the active lease end_date; null if no lease. */
  leaseEndDate: string | null;
  status: UnitStatus;
}

/**
 * Wave 8 — Units table row. Coarser status union than `UnitStatus` because
 * the table only renders a pill (occupied / vacant / notice / pending), not
 * the colored dot the unit-grid card uses. `notice` covers both `late` and
 * `ending_soon` cases; `pending` = pending lease only (NOT vacant).
 */
export type UnitTableStatus = 'occupied' | 'vacant' | 'notice' | 'pending';

export interface UnitTableRow {
  id: string;
  label: string;
  tenantName: string | null;
  rentAmountCents: number | null;
  status: UnitTableStatus;
  /** ISO date (YYYY-MM-DD) of the most-recent succeeded rent payment, or null. */
  lastPaymentDate: string | null;
  /** Count of open or in-progress maintenance tickets on this unit. */
  openMaintCount: number;
  /**
   * Pass 5 — operator row enrichment for the UnitsPanel actions/balance.
   * Tenant id of the active lease (or the pending lease when the unit is
   * pending move-in); null when neither exists. Powers a View tenant link.
   */
  tenantId: string | null;
  /**
   * Active lease id; pending rows surface the pending lease id instead.
   * null when the unit has neither an active nor a pending lease.
   */
  leaseId: string | null;
  /** ISO date (YYYY-MM-DD) of the relevant lease's end_date, or null. */
  leaseEndDate: string | null;
  /** Current rent-cycle outstanding balance in DOLLARS; 0 when none/none owed. */
  outstandingDollars: number;
  /** Days late on the current rent cycle; 0 when not late. */
  daysLate: number;
  /** id of the current rent_events row for the active lease; null if none. */
  currentRentEventId: string | null;
}

// =====================================================================
// Unit detail types
// =====================================================================

/** The /properties/[id]/units/[unitId] page payload. */
export interface UnitDetail {
  /**
   * Canonical occupancy derived from active + pending leases via
   * `deriveUnitOccupancyStatus`. Consumers must branch on this — never on
   * "tenant is null" alone — so a pending-lease unit is never labeled vacant.
   */
  occupancy: UnitOccupancyKind;
  unit: {
    id: string;
    label: string;
    bedrooms: number | null;
    bathrooms: number | null;
    squareFeet: number | null;
    propertyId: string;
    propertyName: string;
  };
  tenant: {
    id: string;
    fullName: string;
    phoneE164: string;
    email: string | null;
    /**
     * Wave 7 — Stream P. Tenant preferences edited from the unit page.
     * `preferences.confidence` mirrors `tenants.preferences_confidence`;
     * `source` mirrors `tenants.preferences_source`. UI uses both to
     * render the confidence badge alongside the prefs editor.
     */
    preferences: {
      preferredChannel: 'sms' | 'email' | 'voice' | 'none' | null;
      language: string | null;
      emergencyContactName: string | null;
      emergencyContactPhone: string | null;
      parkingSpace: string | null;
      pets: ReadonlyArray<{
        type: string;
        name: string | null;
        depositPaid: boolean;
      }>;
      confidence: number;
      source: 'agent' | 'owner' | 'import';
    };
  } | null;
  lease: {
    id: string;
    rentAmountCents: number;
    rentDueDay: number;
    startDate: string | null;
    endDate: string | null;
    depositCents: number | null;
  } | null;
  payments: PaymentTimelineEntry[];
  /** Stripe-backed rent payment history (last 12 rows, newest first). */
  rentPayments: RentPaymentEntry[];
  conversations: ConversationCard[];
}

export interface PaymentTimelineEntry {
  id: string;
  /** cycle_month ISO date (YYYY-MM-DD). */
  cycleMonth: string;
  status: RentEventStatus;
}

/**
 * Wave 7 Stream S — Stripe rent payment row surfaced on the unit detail
 * Payment History section. Only the columns the UI actually renders are
 * lifted into this shape; everything else stays in the DB row.
 */
export interface RentPaymentEntry {
  id: string;
  amountCents: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'canceled';
  createdAt: string;
  paidAt: string | null;
  paymentLinkUrl: string | null;
  receiptUrl: string | null;
}

export interface ConversationCard {
  id: string;
  /** ISO-8601 — whichever is latest between last_message_at and created_at. */
  timestamp: string;
  summary: string | null;
  channel: ConversationChannel;
}

// =====================================================================
// Helpers
// =====================================================================

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

const OPEN_WO_STATUSES = ['open', 'assigned', 'in_progress'] as const;

function dollarsToCents(dollars: number | null | undefined): number {
  if (dollars == null) return 0;
  return Math.round(Number(dollars) * 100);
}

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

// =====================================================================
// List view
// =====================================================================

/**
 * Returns one `PropertyListRow` per property belonging to the caller's
 * organization, with aggregated counts computed client-side (keeping
 * RLS simple). Sort is applied after aggregation so sorting by
 * `occupancy` or `mrr` uses the computed values.
 *
 * @param sort - column to sort by; defaults to 'name' alphabetical asc
 */
export async function listProperties(
  sort: PropertySortKey = 'name',
): Promise<PropertyListRow[]> {
  const supabase = await createServerClient();

  const { data: properties, error: propertiesError } = await supabase
    .from('properties')
    .select(
      'id, name, address_street, address_city, address_state, address_zip',
    )
    .order('name', { ascending: true });

  if (propertiesError) {
    throw new Error('Failed to load properties: ' + propertiesError.message);
  }

  if (!properties || properties.length === 0) return [];

  const propertyIds = properties.map((p) => p.id);

  const [unitsResult, workOrderCounts] = await Promise.all([
    supabase
      .from('units')
      .select('id, property_id')
      .in('property_id', propertyIds),
    fetchOpenWorkOrderCountsByProperty(supabase, propertyIds),
  ]);

  const units = unitsResult.data ?? [];
  const unitIdToPropertyId = new Map<string, string>();
  const unitsByProperty = new Map<string, string[]>();
  for (const u of units) {
    unitIdToPropertyId.set(u.id, u.property_id);
    const arr = unitsByProperty.get(u.property_id) ?? [];
    arr.push(u.id);
    unitsByProperty.set(u.property_id, arr);
  }

  // All active leases for those units — one query keeps RLS simple.
  const unitIds = Array.from(unitIdToPropertyId.keys());
  const activeLeases = unitIds.length
    ? await fetchActiveLeasesForUnits(supabase, unitIds)
    : [];

  // Aggregate per property.
  const rows: PropertyListRow[] = properties.map((p) => {
    const unitIdsInProp = unitsByProperty.get(p.id) ?? [];
    const unitCount = unitIdsInProp.length;

    const leasesInProp = activeLeases.filter((l) =>
      unitIdsInProp.includes(l.unit_id),
    );
    const occupiedUnits = new Set(leasesInProp.map((l) => l.unit_id)).size;
    const occupancyPct = unitCount > 0
      ? Math.round((occupiedUnits / unitCount) * 100)
      : 0;

    const mrrCents = leasesInProp.reduce(
      (sum, l) => sum + dollarsToCents(l.rent_amount),
      0,
    );

    return {
      id: p.id,
      name: p.name,
      addressStreet: p.address_street,
      addressCity: p.address_city,
      addressState: p.address_state,
      addressZip: p.address_zip,
      unitCount,
      occupancyPct,
      mrrCents,
      openWorkOrderCount: workOrderCounts.get(p.id) ?? 0,
    };
  });

  return sortPropertyRows(rows, sort);
}

function sortPropertyRows(
  rows: PropertyListRow[],
  sort: PropertySortKey,
): PropertyListRow[] {
  const copy = [...rows];
  switch (sort) {
    case 'name':
      copy.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'units':
      copy.sort((a, b) => b.unitCount - a.unitCount);
      break;
    case 'occupancy':
      copy.sort((a, b) => b.occupancyPct - a.occupancyPct);
      break;
    case 'mrr':
      copy.sort((a, b) => b.mrrCents - a.mrrCents);
      break;
  }
  return copy;
}

async function fetchOpenWorkOrderCountsByProperty(
  supabase: SupabaseServerClient,
  propertyIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (propertyIds.length === 0) return result;

  // Work orders reference units, which reference properties. Load
  // open WOs with their unit_id, then resolve unit→property via the
  // units table we already fetched (re-query for clean scoping).
  const { data: openWorkOrders } = await supabase
    .from('work_orders')
    .select('id, unit_id, status')
    .in('status', OPEN_WO_STATUSES);

  if (!openWorkOrders || openWorkOrders.length === 0) return result;

  const unitIds = Array.from(new Set(openWorkOrders.map((w) => w.unit_id)));
  const { data: units } = await supabase
    .from('units')
    .select('id, property_id')
    .in('id', unitIds);

  const unitToProp = new Map<string, string>();
  (units ?? []).forEach((u) => unitToProp.set(u.id, u.property_id));

  for (const wo of openWorkOrders) {
    const propId = unitToProp.get(wo.unit_id);
    if (!propId) continue;
    result.set(propId, (result.get(propId) ?? 0) + 1);
  }
  return result;
}

async function fetchActiveLeasesForUnits(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<Array<{ unit_id: string; rent_amount: number }>> {
  const { data } = await supabase
    .from('leases')
    .select('unit_id, rent_amount')
    .in('unit_id', unitIds)
    .eq('status', 'active');
  return data ?? [];
}

// =====================================================================
// Property detail
// =====================================================================

/**
 * Fetches the property header fields and the four KPIs used in the
 * property-detail page's strip. Returns `null` if the property doesn't
 * exist (or RLS hides it).
 */
export async function getProperty(id: string): Promise<PropertyDetail | null> {
  const supabase = await createServerClient();

  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select(
      'id, name, address_street, address_city, address_state, address_zip, rules_text, autonomy_level, privacy_mode, ollama_host',
    )
    .eq('id', id)
    .maybeSingle();

  if (propertyError) {
    throw new Error('Failed to load property: ' + propertyError.message);
  }

  if (!property) return null;

  const [{ data: units }, openWoResult] = await Promise.all([
    supabase.from('units').select('id').eq('property_id', id),
    supabase
      .from('work_orders')
      .select('id, unit_id, status'),
  ]);

  const unitList = units ?? [];
  const unitCount = unitList.length;
  const unitIds = unitList.map((u) => u.id);

  const activeLeases = unitIds.length
    ? await fetchActiveLeasesForUnits(supabase, unitIds)
    : [];
  const occupiedUnits = new Set(activeLeases.map((l) => l.unit_id)).size;
  const occupancyPct = unitCount > 0
    ? Math.round((occupiedUnits / unitCount) * 100)
    : 0;
  const mrrCents = activeLeases.reduce(
    (sum, l) => sum + dollarsToCents(l.rent_amount),
    0,
  );

  const openWorkOrders = (openWoResult.data ?? []).filter(
    (w) =>
      (OPEN_WO_STATUSES as readonly string[]).includes(w.status)
      && unitIds.includes(w.unit_id),
  );

  return {
    id: property.id,
    name: property.name,
    addressStreet: property.address_street,
    addressCity: property.address_city,
    addressState: property.address_state,
    addressZip: property.address_zip,
    rulesText: property.rules_text ?? '',
    autonomyLevel: Number(property.autonomy_level ?? 0),
    privacyMode: (property.privacy_mode ?? 'hosted') as 'hosted' | 'on_prem',
    ollamaHost: property.ollama_host ?? null,
    kpis: {
      unitCount,
      occupancyPct,
      mrrCents,
      openWorkOrderCount: openWorkOrders.length,
    },
  };
}

// =====================================================================
// Unit grid
// =====================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active/pending leases on a unit, indexed for occupancy + display. */
interface UnitLeases {
  /** Newest active lease (display source) — null when none. */
  active: UnitLeaseSlot | null;
  /** Newest pending lease — null when none. */
  pending: UnitLeaseSlot | null;
  /** Inputs for `deriveUnitOccupancyStatus` (every active/pending lease). */
  occupancyInputs: Array<{ status: LeaseStatus; endDate: string | null }>;
}

interface UnitLeaseSlot {
  id: string;
  tenantId: string;
  rentAmount: number;
  endDate: string | null;
}

/**
 * Groups active + pending leases per unit. The display lease is the active
 * one when present, else the pending one; occupancy is always derived from
 * the full set so a pending-lease unit reads `pending`, never `vacant`.
 */
function groupUnitLeases(
  leases: ReadonlyArray<{
    id: string;
    unit_id: string;
    tenant_id: string;
    rent_amount: number;
    end_date: string | null;
    status: string;
  }>,
): Map<string, UnitLeases> {
  const byUnit = new Map<string, UnitLeases>();
  for (const l of leases) {
    const entry = byUnit.get(l.unit_id) ?? {
      active: null,
      pending: null,
      occupancyInputs: [],
    };
    const slot: UnitLeaseSlot = {
      id: l.id,
      tenantId: l.tenant_id,
      rentAmount: Number(l.rent_amount),
      endDate: l.end_date,
    };
    if (l.status === 'active' && !entry.active) entry.active = slot;
    if (l.status === 'pending' && !entry.pending) entry.pending = slot;
    entry.occupancyInputs.push({
      status: l.status as LeaseStatus,
      endDate: l.end_date,
    });
    byUnit.set(l.unit_id, entry);
  }
  return byUnit;
}

/**
 * Returns the units for a property along with the status dot the unit
 * card should render. Status precedence (first wins):
 *
 *   1. `late`         — date-aware late current-cycle rent on the active lease
 *   2. `ending_soon`  — active lease end_date within 60 days
 *   3. `current`      — active lease present
 *   4. `pending`      — pending lease only (move-in being set up — NOT vacant)
 *   5. `vacant`       — no active or pending lease
 *
 * `needs_review` occupancy (conflicting active/pending leases) renders from
 * the active lease — there IS a tenant relationship, so it is never vacant.
 */
export async function listUnitsForProperty(
  propertyId: string,
): Promise<UnitGridCard[]> {
  const supabase = await createServerClient();
  // One clock read at the IO boundary so every derived status agrees.
  const todayIso = currentIsoDate();

  const { data: units } = await supabase
    .from('units')
    .select('id, label')
    .eq('property_id', propertyId)
    .order('label', { ascending: true });

  if (!units || units.length === 0) return [];

  const unitIds = units.map((u) => u.id);

  const { data: leases } = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id, rent_amount, end_date, status')
    .in('unit_id', unitIds)
    .in('status', ['active', 'pending']);

  const leasesByUnit = groupUnitLeases(leases ?? []);
  const tenantIds: string[] = [];
  const activeLeaseIds: string[] = [];
  for (const entry of leasesByUnit.values()) {
    if (entry.active) {
      tenantIds.push(entry.active.tenantId);
      activeLeaseIds.push(entry.active.id);
    }
    if (entry.pending) tenantIds.push(entry.pending.tenantId);
  }

  const [tenantMap, lateLeaseIds] = await Promise.all([
    tenantIds.length ? fetchTenantNameMap(supabase, tenantIds) : Promise.resolve(new Map<string, string>()),
    activeLeaseIds.length ? fetchLateLeaseIds(supabase, activeLeaseIds, todayIso) : Promise.resolve(new Set<string>()),
  ]);

  const now = Date.now();
  const soonMs = 60 * DAY_MS;

  return units.map((u) => {
    const entry = leasesByUnit.get(u.id);
    const occupancy = deriveUnitOccupancyStatus(entry?.occupancyInputs ?? [], todayIso);
    const label = displayUnitLabel(u.label);

    if (occupancy === 'vacant') {
      return {
        id: u.id,
        label,
        tenantName: null,
        rentAmountCents: null,
        leaseEndDate: null,
        status: 'vacant' as const,
      };
    }

    if (occupancy === 'pending_move_in') {
      const pending = entry?.pending;
      return {
        id: u.id,
        label,
        tenantName: pending ? tenantMap.get(pending.tenantId) ?? null : null,
        rentAmountCents: pending ? Math.round(pending.rentAmount * 100) : null,
        leaseEndDate: pending?.endDate ?? null,
        status: 'pending' as const,
      };
    }

    // occupied / active_past_end / needs_review — active lease present.
    const lease = entry?.active;
    if (!lease) {
      // Defensive: occupancy said active but the slot is missing.
      return {
        id: u.id,
        label,
        tenantName: null,
        rentAmountCents: null,
        leaseEndDate: null,
        status: 'vacant' as const,
      };
    }

    let status: UnitStatus;
    if (lateLeaseIds.has(lease.id)) {
      status = 'late';
    } else if (lease.endDate) {
      const endMs = Date.parse(lease.endDate);
      if (!Number.isNaN(endMs) && endMs - now <= soonMs && endMs - now >= 0) {
        status = 'ending_soon';
      } else {
        status = 'current';
      }
    } else {
      status = 'current';
    }

    return {
      id: u.id,
      label,
      tenantName: tenantMap.get(lease.tenantId) ?? null,
      rentAmountCents: Math.round(lease.rentAmount * 100),
      leaseEndDate: lease.endDate,
      status,
    };
  });
}

/**
 * Wave 8 — Units table feed.
 *
 * Returns one `UnitTableRow` per unit on the property, joined with:
 *   - the active lease's tenant name + rent amount
 *   - the most-recent `succeeded` rent_payments.paid_at per lease
 *   - the count of `open` + `in_progress` maintenance_tickets per unit
 *
 * Implementation: we resolve everything in a small number of round-trips
 * (units → leases / tickets in parallel → tenants / payments in parallel)
 * to keep the query graph predictable under RLS.
 */
export async function listUnitsTableRowsForProperty(
  propertyId: string,
): Promise<UnitTableRow[]> {
  const supabase = await createServerClient();

  const { data: units } = await supabase
    .from('units')
    .select('id, label')
    .eq('property_id', propertyId)
    .order('label', { ascending: true });

  if (!units || units.length === 0) return [];

  const unitIds = units.map((u) => u.id);

  // One clock read at the IO boundary so every derived status agrees.
  const todayIso = currentIsoDate();

  const [{ data: leases }, { data: tickets }] = await Promise.all([
    supabase
      .from('leases')
      .select('id, unit_id, tenant_id, rent_amount, end_date, status')
      .in('unit_id', unitIds)
      .in('status', ['active', 'pending']),
    supabase
      .from('maintenance_tickets')
      .select('id, unit_id, status')
      .in('unit_id', unitIds)
      .in('status', ['open', 'in_progress']),
  ]);

  const leasesByUnit = groupUnitLeases(leases ?? []);
  const tenantIds: string[] = [];
  const activeLeaseIds: string[] = [];
  for (const entry of leasesByUnit.values()) {
    if (entry.active) {
      tenantIds.push(entry.active.tenantId);
      activeLeaseIds.push(entry.active.id);
    }
    if (entry.pending) tenantIds.push(entry.pending.tenantId);
  }

  const maintCountByUnit = new Map<string, number>();
  for (const t of tickets ?? []) {
    maintCountByUnit.set(t.unit_id, (maintCountByUnit.get(t.unit_id) ?? 0) + 1);
  }

  const [tenantMap, rentCycleByLease, lastPaidByLease] = await Promise.all([
    tenantIds.length
      ? fetchTenantNameMap(supabase, tenantIds)
      : Promise.resolve(new Map<string, string>()),
    // One round-trip for the current-cycle rent_events of every active
    // lease — powers BOTH the `notice` lateness pill AND each row's
    // balance / days-late / current rent_event id (record-payment target).
    activeLeaseIds.length
      ? fetchCurrentRentCycleByLease(supabase, activeLeaseIds, todayIso)
      : Promise.resolve(new Map<string, CurrentRentCycle>()),
    activeLeaseIds.length
      ? fetchLastPaidAtByLease(supabase, activeLeaseIds)
      : Promise.resolve(new Map<string, string>()),
  ]);

  const now = Date.now();
  const soonMs = 60 * DAY_MS;

  return units.map((u) => {
    const entry = leasesByUnit.get(u.id);
    const occupancy = deriveUnitOccupancyStatus(entry?.occupancyInputs ?? [], todayIso);
    const openMaintCount = maintCountByUnit.get(u.id) ?? 0;
    const label = displayUnitLabel(u.label);

    if (occupancy === 'pending_move_in') {
      const pending = entry?.pending;
      return {
        id: u.id,
        label,
        tenantName: pending ? tenantMap.get(pending.tenantId) ?? null : null,
        rentAmountCents: pending ? Math.round(pending.rentAmount * 100) : null,
        status: 'pending' as const,
        lastPaymentDate: null,
        openMaintCount,
        // Pending move-in has no rent cycle yet — actions point at the
        // pending lease/tenant; balance + days-late stay zeroed.
        tenantId: pending?.tenantId ?? null,
        leaseId: pending?.id ?? null,
        leaseEndDate: pending?.endDate ?? null,
        outstandingDollars: 0,
        daysLate: 0,
        currentRentEventId: null,
      };
    }

    // occupied / active_past_end / needs_review — active lease present.
    // (`!lease` also covers true `vacant`.)
    const lease = entry?.active;
    if (occupancy === 'vacant' || !lease) {
      return {
        id: u.id,
        label,
        tenantName: null,
        rentAmountCents: null,
        status: 'vacant' as const,
        lastPaymentDate: null,
        openMaintCount,
        tenantId: null,
        leaseId: null,
        leaseEndDate: null,
        outstandingDollars: 0,
        daysLate: 0,
        currentRentEventId: null,
      };
    }

    const cycle = rentCycleByLease.get(lease.id) ?? null;

    let status: UnitTableStatus = 'occupied';
    if (cycle?.isLate) {
      status = 'notice';
    } else if (lease.endDate) {
      const endMs = Date.parse(lease.endDate);
      if (!Number.isNaN(endMs) && endMs - now <= soonMs && endMs - now >= 0) {
        status = 'notice';
      }
    }

    return {
      id: u.id,
      label,
      tenantName: tenantMap.get(lease.tenantId) ?? null,
      rentAmountCents: Math.round(lease.rentAmount * 100),
      status,
      lastPaymentDate: lastPaidByLease.get(lease.id) ?? null,
      openMaintCount,
      tenantId: lease.tenantId,
      leaseId: lease.id,
      leaseEndDate: lease.endDate,
      outstandingDollars: cycle?.outstandingDollars ?? 0,
      daysLate: cycle?.daysLate ?? 0,
      currentRentEventId: cycle?.rentEventId ?? null,
    };
  });
}

async function fetchLastPaidAtByLease(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('rent_payments')
    .select('lease_id, paid_at, status')
    .in('lease_id', leaseIds)
    .eq('status', 'succeeded')
    .order('paid_at', { ascending: false });

  const result = new Map<string, string>();
  for (const row of data ?? []) {
    if (!row.paid_at) continue;
    // Only keep the first (newest) entry per lease — the order() above
    // gives us descending paid_at, so subsequent rows are older.
    if (result.has(row.lease_id)) continue;
    result.set(row.lease_id, row.paid_at);
  }
  return result;
}

/**
 * Pass 5 — current-cycle rent derivation per active lease.
 *
 * `outstandingDollars` is the canonical balance in DOLLARS, `daysLate` and
 * `isLate` come date-aware from `deriveRentCycleStatus` (via the row
 * adapter), and `rentEventId` is the current `rent_events.id` so the
 * UnitsPanel can target the existing RecordPaymentModal.
 */
interface CurrentRentCycle {
  rentEventId: string;
  outstandingDollars: number;
  daysLate: number;
  isLate: boolean;
}

/**
 * Loads the NEWEST `rent_events` row up to the current cycle month for each
 * active lease in one `.in()` round-trip and derives its status through the
 * canonical domain module — mirroring the "newest rent_event is the current
 * cycle" pattern in ./unit-detail-queries.ts. Newest-up-to-current (not
 * strictly current) so unpaid prior-cycle debt stays visible after month
 * rollover instead of dropping to $0. `status` is selected (beyond the
 * id/balance columns) because `plan_agreed`/`escalated` must suppress
 * lateness; the raw enum is never read directly. Returns a map keyed by
 * lease_id.
 */
async function fetchCurrentRentCycleByLease(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
  todayIso: string,
): Promise<Map<string, CurrentRentCycle>> {
  const { data } = await supabase
    .from('rent_events')
    .select('id, lease_id, status, due_date, amount_due, amount_paid, cycle_month')
    .in('lease_id', leaseIds)
    .lte('cycle_month', currentCycleMonth())
    .order('cycle_month', { ascending: false });

  const map = new Map<string, CurrentRentCycle>();
  for (const r of data ?? []) {
    // Rows arrive newest-cycle-first; keep the newest row per lease.
    if (map.has(r.lease_id)) continue;
    const derived = rentCycleFromRow(r, todayIso);
    map.set(r.lease_id, {
      rentEventId: r.id,
      outstandingDollars: derived.balanceCents / 100,
      daysLate: derived.daysLate,
      isLate: derived.isLate,
    });
  }
  return map;
}

async function fetchTenantNameMap(
  supabase: SupabaseServerClient,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('tenants')
    .select('id, full_name')
    .in('id', tenantIds);
  const m = new Map<string, string>();
  // Map stays keyed by the real tenant id; only the display value is
  // normalized (never used as a lookup key).
  (data ?? []).forEach((t) => m.set(t.id, displayName(t.full_name)));
  return m;
}

/**
 * Lease ids whose CURRENT-cycle rent event is late, derived date-aware in
 * TS (due_date vs `todayIso` + balance) via the canonical domain module —
 * never the raw status enum. A stale `pending` past its due date counts;
 * `plan_agreed` never does.
 */
async function fetchLateLeaseIds(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
  todayIso: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from('rent_events')
    .select('lease_id, status, due_date, amount_due, amount_paid')
    .in('lease_id', leaseIds)
    .eq('cycle_month', currentCycleMonth());
  const set = new Set<string>();
  for (const r of data ?? []) {
    if (rentCycleFromRow(r, todayIso).isLate) set.add(r.lease_id);
  }
  return set;
}

// =====================================================================
// Unit detail
// =====================================================================

/**
 * Returns the unit + its active tenant + active lease + payment
 * timeline (last 12 cycles) + last 3 conversations for the tenant.
 * Returns `null` if the unit doesn't exist or RLS hides it.
 */
export async function getUnitDetail(
  unitId: string,
): Promise<UnitDetail | null> {
  const supabase = await createServerClient();

  const { data: unit } = await supabase
    .from('units')
    .select('id, label, bedrooms, bathrooms, square_feet, property_id')
    .eq('id', unitId)
    .maybeSingle();

  if (!unit) return null;

  const { data: property } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', unit.property_id)
    .maybeSingle();

  if (!property) return null;

  // Active + pending leases — pending feeds occupancy (`pending_move_in`
  // is NOT vacant); the newest active lease stays the tenant/lease source.
  const { data: leaseRows } = await supabase
    .from('leases')
    .select('id, tenant_id, rent_amount, rent_due_day, start_date, end_date, status, late_fee_policy')
    .eq('unit_id', unitId)
    .in('status', ['active', 'pending'])
    .order('start_date', { ascending: false, nullsFirst: false });

  const allLeases = leaseRows ?? [];
  const leaseRow = allLeases.find((l) => l.status === 'active') ?? null;

  // One clock read at the IO boundary so every derived status agrees.
  const occupancy = deriveUnitOccupancyStatus(
    allLeases.map((l) => ({
      status: l.status as LeaseStatus,
      endDate: l.end_date,
    })),
    currentIsoDate(),
  );

  let tenant: UnitDetail['tenant'] = null;
  let lease: UnitDetail['lease'] = null;
  let payments: PaymentTimelineEntry[] = [];
  let rentPayments: RentPaymentEntry[] = [];
  let conversations: ConversationCard[] = [];

  if (leaseRow) {
    const [
      { data: tenantRow },
      { data: paymentRows },
      { data: rentPaymentRows },
    ] = await Promise.all([
      supabase
        .from('tenants')
        .select('id, full_name, phone_e164, email, preferred_channel, language, emergency_contact_name, emergency_contact_phone, parking_space, pets_jsonb, preferences_confidence, preferences_source')
        .eq('id', leaseRow.tenant_id)
        .maybeSingle(),
      supabase
        .from('rent_events')
        .select('id, cycle_month, status')
        .eq('lease_id', leaseRow.id)
        .order('cycle_month', { ascending: true })
        .limit(12),
      supabase
        .from('rent_payments')
        .select(
          'id, amount_cents, status, created_at, paid_at, payment_link_url, receipt_url',
        )
        .eq('lease_id', leaseRow.id)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);

    if (tenantRow) {
      tenant = {
        id: tenantRow.id,
        fullName: tenantRow.full_name,
        phoneE164: tenantRow.phone_e164,
        email: tenantRow.email,
        preferences: {
          preferredChannel: normalizeChannel(tenantRow.preferred_channel),
          language: tenantRow.language,
          emergencyContactName: tenantRow.emergency_contact_name,
          emergencyContactPhone: tenantRow.emergency_contact_phone,
          parkingSpace: tenantRow.parking_space,
          pets: parsePets(tenantRow.pets_jsonb),
          confidence: Number(tenantRow.preferences_confidence ?? 0.7),
          source: normalizeSource(tenantRow.preferences_source),
        },
      };

      const { data: convRows } = await supabase
        .from('conversations')
        .select('id, last_message_at, created_at, summary, channel')
        .eq('tenant_id', tenantRow.id)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(3);

      conversations = (convRows ?? []).map((c) => ({
        id: c.id,
        timestamp: c.last_message_at ?? c.created_at,
        summary: c.summary,
        channel: c.channel,
      }));
    }

    lease = {
      id: leaseRow.id,
      rentAmountCents: dollarsToCents(leaseRow.rent_amount),
      rentDueDay: leaseRow.rent_due_day,
      startDate: leaseRow.start_date,
      endDate: leaseRow.end_date,
      depositCents: extractDepositCents(leaseRow.late_fee_policy),
    };

    payments = (paymentRows ?? []).map((p) => ({
      id: p.id,
      cycleMonth: p.cycle_month,
      status: p.status,
    }));

    rentPayments = (rentPaymentRows ?? []).map((r) => ({
      id: r.id,
      amountCents: Number(r.amount_cents ?? 0),
      status: normalizeRentPaymentStatus(r.status),
      createdAt: r.created_at,
      paidAt: r.paid_at,
      paymentLinkUrl: r.payment_link_url,
      receiptUrl: r.receipt_url,
    }));
  }

  return {
    occupancy,
    unit: {
      id: unit.id,
      label: unit.label,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms == null ? null : Number(unit.bathrooms),
      squareFeet: unit.square_feet,
      propertyId: property.id,
      propertyName: property.name,
    },
    tenant,
    lease,
    payments,
    rentPayments,
    conversations,
  };
}

function normalizeRentPaymentStatus(
  status: string | null,
): RentPaymentEntry['status'] {
  switch (status) {
    case 'succeeded':
    case 'failed':
    case 'refunded':
    case 'canceled':
    case 'pending':
      return status;
    default:
      return 'pending';
  }
}

/**
 * Looks up an optional `deposit_cents` field inside the lease's
 * `late_fee_policy` jsonb blob. Returns `null` when absent or malformed.
 * Deposits aren't a first-class column in v1 — they ride inside the
 * jsonb metadata until the schema splits them out.
 */
function extractDepositCents(policy: unknown): number | null {
  if (!policy || typeof policy !== 'object') return null;
  const maybe = (policy as Record<string, unknown>).deposit_cents;
  if (typeof maybe === 'number' && Number.isFinite(maybe)) {
    return Math.round(maybe);
  }
  const dollars = (policy as Record<string, unknown>).deposit;
  if (typeof dollars === 'number' && Number.isFinite(dollars)) {
    return Math.round(dollars * 100);
  }
  return null;
}

// =====================================================================
// v1.5 — proposal summary feed (powers autonomy-panel + proposals-feed)
// =====================================================================

export type ProposalGateDecision = 'auto' | 'review' | 'block';
export type ProposalStatus =
  | 'proposed'
  | 'committing'
  | 'committed'
  | 'failed'
  | 'unsupported'
  | 'rejected'
  | 'edited'
  | 'expired';

/** One row in the autonomy-panel's grouped action_type rollup. */
export interface AutonomyActionRow {
  actionType: string;
  /** Most-permissive gate ever observed for this action type (auto > review > block). */
  decision: ProposalGateDecision;
  committedCount: number;
  reviewCount: number;
  blockedCount: number;
}

/** One row in the proposals feed (last N). */
export interface ProposalFeedRow {
  id: string;
  createdAt: string;
  actionType: string;
  workerModel: string;
  confidence: number;
  gateDecision: ProposalGateDecision;
  status: ProposalStatus;
  reasoning: string;
  /** JSON delta when the owner edited the proposal, else null. */
  editDiff: unknown | null;
  committedAt: string | null;
}

export interface PropertyProposalSummary {
  /** Grouped rollup keyed by action_type, decision sorted descending. */
  autonomy: AutonomyActionRow[];
  /** Most-recent proposals (default 10), newest first. */
  recent: ProposalFeedRow[];
}

const GATE_PRECEDENCE: Record<ProposalGateDecision, number> = {
  auto: 3,
  review: 2,
  block: 1,
};

/**
 * Returns rolled-up action_type stats + the most-recent proposals for
 * the given property. Single helper because both surfaces (autonomy
 * panel + proposals feed) read from the same table and benefit from
 * one round-trip.
 *
 * Implementation: pulls up to 200 recent rows ordered by created_at
 * desc, then aggregates client-side. 200 is a soft ceiling — the panel
 * only needs N committed per action_type and the feed only renders
 * `recentLimit`. Going wider would push the autonomy rollup toward
 * lifetime stats; that's a Phase 6 dashboard concern.
 */
export async function getPropertyProposalSummary(
  propertyId: string,
  recentLimit: number = 10,
): Promise<PropertyProposalSummary> {
  const supabase = await createServerClient();

  const { data } = await supabase
    .from('action_proposals')
    .select(
      'id, action_type, worker_model, confidence, gate_decision, status, reasoning, edit_diff, committed_at, created_at',
    )
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = data ?? [];

  // Recent feed — first `recentLimit` rows, with safe casts.
  const recent: ProposalFeedRow[] = rows.slice(0, recentLimit).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    actionType: r.action_type,
    workerModel: r.worker_model,
    confidence: Number(r.confidence ?? 0),
    gateDecision: (r.gate_decision ?? 'review') as ProposalGateDecision,
    status: (r.status ?? 'proposed') as ProposalStatus,
    reasoning: r.reasoning ?? '',
    editDiff: r.edit_diff ?? null,
    committedAt: r.committed_at,
  }));

  // Autonomy rollup — group by action_type, count decisions/statuses.
  const buckets = new Map<
    string,
    {
      committed: number;
      review: number;
      blocked: number;
      bestDecision: ProposalGateDecision;
    }
  >();

  for (const r of rows) {
    const actionType = r.action_type;
    const gate = (r.gate_decision ?? 'review') as ProposalGateDecision;
    const status = (r.status ?? 'proposed') as ProposalStatus;
    const bucket = buckets.get(actionType) ?? {
      committed: 0,
      review: 0,
      blocked: 0,
      bestDecision: 'block' as ProposalGateDecision,
    };

    if (status === 'committed') bucket.committed += 1;
    if (gate === 'review') bucket.review += 1;
    if (gate === 'block') bucket.blocked += 1;

    if (GATE_PRECEDENCE[gate] > GATE_PRECEDENCE[bucket.bestDecision]) {
      bucket.bestDecision = gate;
    }

    buckets.set(actionType, bucket);
  }

  const autonomy: AutonomyActionRow[] = Array.from(buckets.entries())
    .map(([actionType, b]) => ({
      actionType,
      decision: b.bestDecision,
      committedCount: b.committed,
      reviewCount: b.review,
      blockedCount: b.blocked,
    }))
    .sort((a, b) => {
      // Order: most-permissive first, ties broken by name for stability.
      const byDecision =
        GATE_PRECEDENCE[b.decision] - GATE_PRECEDENCE[a.decision];
      if (byDecision !== 0) return byDecision;
      return a.actionType.localeCompare(b.actionType);
    });

  return { autonomy, recent };
}


// =====================================================================
// Wave 7 Stream P — tenant preference helpers
// =====================================================================

function normalizeChannel(
  v: string | null | undefined,
): 'sms' | 'email' | 'voice' | 'none' | null {
  if (v === 'sms' || v === 'email' || v === 'voice' || v === 'none') {
    return v;
  }
  return null;
}

function normalizeSource(
  v: string | null | undefined,
): 'agent' | 'owner' | 'import' {
  if (v === 'owner' || v === 'import') return v;
  return 'agent';
}

interface PetEntry {
  type: string;
  name: string | null;
  depositPaid: boolean;
}

/**
 * Parse `tenants.pets_jsonb` (which the schema stores as `jsonb` —
 * an unknown shape on the supabase typed client) into a typed array.
 * Drops any non-object entries so a malformed cell can't crash the
 * unit detail page.
 */
function parsePets(value: unknown): ReadonlyArray<PetEntry> {
  if (!Array.isArray(value)) return [];
  const out: PetEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const type = typeof rec.type === 'string' ? rec.type : null;
    if (!type) continue;
    const name = typeof rec.name === 'string' ? rec.name : null;
    const depositPaid = rec.deposit_paid === true || rec.depositPaid === true;
    out.push({ type, name, depositPaid });
  }
  return out;
}

// =====================================================================
// Wave 8 — Maintenance tab + Payments tab feeds
// =====================================================================

/**
 * One row in the property Maintenance tab.
 *
 * Note: the `maintenance_tickets` table has no FK to `appliances` — the
 * Wave 6 migration intentionally keeps tickets lightweight (org / property
 * / unit + free-form summary). Appliance linkage is a future schema
 * concern; we surface unit context only.
 */
export interface MaintenanceTicketRow {
  id: string;
  summary: string;
  severity: 'low' | 'medium' | 'high' | 'urgent';
  /** Raw work_orders.urgency, so the priority can be edited inline in the room. */
  urgency: 'emergency' | 'urgent' | 'routine';
  status: 'open' | 'in_progress' | 'resolved' | 'cancelled';
  reportedBy: string | null;
  createdAt: string;
  unitId: string;
  unitLabel: string | null;
  /**
   * Read-only vendor-lifecycle chip (Awaiting reply · Nh / accepted / declined
   * / needs review / approved …) derived from the RAW work_orders status +
   * vendor fields. `null` when there is nothing to assert (open, no vendor).
   * Always set by `listMaintenanceTicketsForProperty`; optional only so unit
   * test row factories need not supply it.
   */
  vendorChip?: VendorLifecycleChip | null;
}

const MAINTENANCE_STATUS_RANK: Record<MaintenanceTicketRow['status'], number> = {
  open: 0,
  in_progress: 1,
  resolved: 2,
  cancelled: 3,
};

/**
 * Lists the property's maintenance tickets, read from the canonical
 * `work_orders` table — the one the voice tool, unit-page intake, review flow,
 * vendor views, `/work-orders`, and this room's own "+ Create ticket" action
 * all write to. work_orders is keyed by unit + org (no property_id column), so
 * we resolve the property's units first, then read their work orders and map
 * them onto the ticket row shape. The parallel `maintenance_tickets` table is
 * vestigial (nothing populates it), which previously left this room reading
 * empty while real work orders existed elsewhere. Ordered by status priority
 * (open > in_progress > resolved > cancelled) then `created_at` descending.
 * `organizationId` is defense-in-depth alongside RLS.
 */
export async function listMaintenanceTicketsForProperty(
  organizationId: string,
  propertyId: string,
): Promise<MaintenanceTicketRow[]> {
  const supabase = await createServerClient();

  const { data: units } = await supabase
    .from('units')
    .select('id, label')
    .eq('property_id', propertyId);

  const unitIds = (units ?? []).map((u) => u.id);
  if (unitIds.length === 0) return [];

  const { data: workOrders } = await supabase
    .from('work_orders')
    .select(
      'id, description, category, urgency, status, created_at, unit_id, status_timeline, vendor_id, vendor_response, vendor_assigned_at, reviewed_at',
    )
    .eq('organization_id', organizationId)
    .in('unit_id', unitIds)
    .order('created_at', { ascending: false });

  if (!workOrders || workOrders.length === 0) return [];

  const unitLabelById = new Map<string, string>();
  for (const u of units ?? []) unitLabelById.set(u.id, displayUnitLabel(u.label));

  const rows: MaintenanceTicketRow[] = workOrders.map((w) => ({
    id: w.id,
    summary: w.description ?? '(no description)',
    severity: workOrderSeverity(w.urgency),
    urgency: normalizeWorkOrderUrgency(w.urgency),
    status: workOrderStatus(w.status),
    reportedBy: workOrderReporter(w.status_timeline),
    createdAt: w.created_at,
    unitId: w.unit_id,
    unitLabel: unitLabelById.get(w.unit_id) ?? null,
    // Derived from the RAW work_orders.status (not the collapsed row.status),
    // since deriveVendorChip's transitions key off the true lifecycle state.
    vendorChip: deriveVendorChip({
      status: (w.status ?? 'open') as WorkOrderStatus,
      vendorId: w.vendor_id ?? null,
      vendorName: null,
      vendorResponse: (w.vendor_response ?? null) as WorkOrderVendorResponse | null,
      vendorAssignedAt: w.vendor_assigned_at ?? null,
      reviewedAt: w.reviewed_at ?? null,
    }),
  }));

  return rows.sort((a, b) => {
    const byStatus =
      MAINTENANCE_STATUS_RANK[a.status] - MAINTENANCE_STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    // Newest first within the same status bucket.
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

/** work_orders.urgency (emergency|urgent|routine) → ticket severity. */
function workOrderSeverity(
  urgency: string | null,
): MaintenanceTicketRow['severity'] {
  switch (urgency) {
    case 'emergency':
      return 'urgent';
    case 'urgent':
      return 'high';
    case 'routine':
      return 'low';
    default:
      return 'medium';
  }
}

/** Raw work_orders.urgency for inline editing; unknowns default to routine. */
function normalizeWorkOrderUrgency(
  urgency: string | null,
): MaintenanceTicketRow['urgency'] {
  return urgency === 'emergency' || urgency === 'urgent' || urgency === 'routine'
    ? urgency
    : 'routine';
}

/** work_orders.status → ticket status (assigned collapses to in_progress; completed → resolved). */
function workOrderStatus(
  status: string | null,
): MaintenanceTicketRow['status'] {
  switch (status) {
    case 'assigned':
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'resolved';
    case 'cancelled':
      return 'cancelled';
    case 'open':
    default:
      return 'open';
  }
}

/** Derive a human reporter label from the first status-timeline entry's source. */
function workOrderReporter(timeline: unknown): string | null {
  const first = Array.isArray(timeline) ? timeline[0] : null;
  const source =
    first && typeof first === 'object'
      ? (first as { source?: unknown }).source
      : undefined;
  return source === 'retell_voice' ? 'Voice call' : null;
}

/**
 * One row in the property Payments tab. Joined back to lease → unit →
 * tenant so the UI can render "tenant · unit" without follow-up reads.
 */
export interface RentPaymentRow {
  id: string;
  amountCents: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'canceled';
  createdAt: string;
  paidAt: string | null;
  receiptUrl: string | null;
  paymentLinkUrl: string | null;
  leaseId: string;
  tenantId: string;
  tenantName: string | null;
  unitId: string;
  unitLabel: string | null;
}

export interface PropertyRentPaymentsResult {
  rows: RentPaymentRow[];
  /** YYYY-MM → sum of `succeeded` amount_cents for that calendar month. */
  totalsByMonth: Record<string, number>;
}

/**
 * Lists every rent_payment whose lease is bound to a unit on this
 * property. Returns the rows ordered newest-first plus a precomputed
 * month-total map so the Payments tab can render the current-month +
 * 3-month strip without re-traversing the list.
 *
 * Implementation: we don't trust PostgREST embeds to push the
 * unit.property_id filter through RLS-protected joins, so we resolve
 * the unit set first and pass an `in()` of lease_ids into the
 * rent_payments query.
 */
export async function listRentPaymentsForProperty(
  organizationId: string,
  propertyId: string,
): Promise<PropertyRentPaymentsResult> {
  const supabase = await createServerClient();

  const { data: units } = await supabase
    .from('units')
    .select('id, label')
    .eq('property_id', propertyId);

  const unitList = units ?? [];
  if (unitList.length === 0) {
    return { rows: [], totalsByMonth: {} };
  }
  const unitIds = unitList.map((u) => u.id);
  const unitLabelById = new Map<string, string>();
  for (const u of unitList) unitLabelById.set(u.id, displayUnitLabel(u.label));

  const { data: leases } = await supabase
    .from('leases')
    .select('id, unit_id, tenant_id')
    .in('unit_id', unitIds);

  const leaseList = leases ?? [];
  if (leaseList.length === 0) {
    return { rows: [], totalsByMonth: {} };
  }
  const leaseIds = leaseList.map((l) => l.id);
  const leaseMeta = new Map<
    string,
    { unitId: string; tenantId: string }
  >();
  for (const l of leaseList) {
    leaseMeta.set(l.id, { unitId: l.unit_id, tenantId: l.tenant_id });
  }

  const { data: payments } = await supabase
    .from('rent_payments')
    .select(
      'id, lease_id, amount_cents, status, created_at, paid_at, receipt_url, payment_link_url',
    )
    .eq('organization_id', organizationId)
    .in('lease_id', leaseIds)
    .order('created_at', { ascending: false });

  const paymentList = payments ?? [];
  if (paymentList.length === 0) {
    return { rows: [], totalsByMonth: {} };
  }

  const tenantIds = Array.from(
    new Set(
      paymentList
        .map((p) => leaseMeta.get(p.lease_id)?.tenantId)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const tenantNameById = tenantIds.length
    ? await fetchTenantNameMap(supabase, tenantIds)
    : new Map<string, string>();

  const rows: RentPaymentRow[] = paymentList.map((p) => {
    const meta = leaseMeta.get(p.lease_id);
    const unitId = meta?.unitId ?? '';
    const tenantId = meta?.tenantId ?? '';
    return {
      id: p.id,
      amountCents: Number(p.amount_cents ?? 0),
      status: normalizeRentPaymentStatus(p.status),
      createdAt: p.created_at,
      paidAt: p.paid_at,
      receiptUrl: p.receipt_url,
      paymentLinkUrl: p.payment_link_url,
      leaseId: p.lease_id,
      tenantId,
      tenantName: tenantNameById.get(tenantId) ?? null,
      unitId,
      unitLabel: unitLabelById.get(unitId) ?? null,
    };
  });

  const totalsByMonth: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== 'succeeded') continue;
    // Bucket by paid_at when present (Stripe-confirmed money date),
    // else by created_at (rare — defensive).
    const stamp = r.paidAt ?? r.createdAt;
    const month = monthKey(stamp);
    if (!month) continue;
    totalsByMonth[month] = (totalsByMonth[month] ?? 0) + r.amountCents;
  }

  return { rows, totalsByMonth };
}

function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Cheap slice over Date parsing — these come from Postgres as ISO-8601.
  if (iso.length < 7) return null;
  const candidate = iso.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(candidate)) return null;
  return candidate;
}
