/**
 * Portfolio financial summary query — the RLS-scoped adapter that feeds
 * the `/financials` surface (and the Today / property briefings).
 *
 * Like `@/lib/rent/queries`, every read goes through `createServerClient()`
 * so RLS auto-scopes to the caller's `organization_id`; this helper never
 * accepts an `organizationId` parameter. Joins are decomposed into
 * follow-up `.in()` queries rather than PostgREST embeds (mirrors the
 * style in `@/lib/properties/queries` and `@/lib/rent/queries`), because
 * nested embeds under RLS are brittle and hard to test.
 *
 * Division of labour is preserved: every `rent_events` row is routed
 * through `rentCycleFromRow` (`@/lib/domain`) for canonical
 * balance/lateness, and the per-property/portfolio FOLD + percentages
 * happen in `@/lib/financials/summary` + `math`. This file does NEITHER —
 * it only shapes Supabase rows into the pure-module input contract.
 *
 * Honest-data invariant: maintenance / vendor / other expense spend is
 * NOT in the schema, so the spend fields are left unset (the pure fold
 * keeps them `null`, never a fabricated `0`). A work-order COUNT is passed
 * through ONLY as a risk signal — never converted to a dollar amount.
 */

import { rentCycleFromRow } from '@/lib/domain';
import { createServerClient } from '@/lib/supabase/server';

import { buildPortfolioSummary, type DerivedRentRow, type PropertySnapshotInput } from './summary';
import {
  buildAgingBuckets,
  buildMonthlySeries,
  periodTotals,
  resolvePeriodCycles,
  type AgingBucket,
  type CycleRowInput,
  type MonthlyRentPoint,
  type PeriodKey,
  type PeriodTotals,
  type ResolvedPeriod,
} from './trend';
import type {
  FinancialException,
  FinancialPeriod,
  PortfolioFinancialSummary,
  PropertyFinancialSnapshot,
} from './types';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

/** Work-order statuses treated as "open" (mirrors `@/lib/properties`). */
const OPEN_WO_STATUSES = ['open', 'assigned', 'in_progress'] as const;

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

// =====================================================================
// Date helpers — computed ONCE at the IO boundary (no hidden clock in
// the pure domain/fold modules).
// =====================================================================

/**
 * First-of-this-month ISO date (YYYY-MM-DD) in local time — the
 * `rent_events.cycle_month` value for the current reporting period.
 * Matches `currentCycleMonthIso` in `@/lib/rent/queries` so the two
 * surfaces stay in lockstep.
 */
function currentCycleMonthIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** Local-time YYYY-MM-DD for "today", injected into the pure derivation. */
function localTodayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build the closed reporting window for a cycle-month ISO date. The
 * period is the full calendar month: start = the 1st, end = the last
 * day, label = e.g. `June 2026`. Falls back gracefully on a malformed
 * cycle string (should never happen from {@link currentCycleMonthIso}).
 */
function buildPeriod(cycleIso: string): FinancialPeriod {
  const match = /^(\d{4})-(\d{2})-01$/.exec(cycleIso);
  if (!match) {
    return { startDate: cycleIso, endDate: cycleIso, label: cycleIso };
  }
  const year = Number(match[1]);
  const month = Number(match[2]); // 1-indexed
  // Day 0 of the NEXT month is the last day of THIS month.
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`;
  return {
    startDate: cycleIso,
    endDate,
    label: `${MONTHS_FULL[month - 1]} ${year}`,
  };
}

// =====================================================================
// Intermediate row shapes from the decomposed joins
// =====================================================================

interface RentEventRow {
  lease_id: string;
  cycle_month: string;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  status: string | null;
  due_date: string | null;
}

/** numeric(10,2) dollars → integer cents (defensive: string/number/null). */
function dollarsToCents(dollars: number | string | null | undefined): number {
  if (dollars === null || dollars === undefined) return 0;
  const value = typeof dollars === 'string' ? Number(dollars) : dollars;
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

// =====================================================================
// Public API
// =====================================================================

/** Everything the `/financials` console renders for a selected period. */
export interface FinancialsConsole {
  /** The canonical summary, folded over the SELECTED period's cycles. */
  summary: PortfolioFinancialSummary;
  /** Trailing ≤12-month trend incl. current — period-independent. */
  series: MonthlyRentPoint[];
  /** Delinquency aging buckets, as-of-today — period-independent. */
  aging: AgingBucket[];
  /** Rent totals for the selected period. */
  totals: PeriodTotals;
  /** Rent totals for the comparable prior window. */
  priorTotals: PeriodTotals;
  periodKey: PeriodKey;
}

/**
 * Build the full financials console for a selected reporting period,
 * RLS-scoped to the caller's organization.
 *
 * Pulls `properties` + `units` + `rent_events` through the current cycle
 * + the `leases` they reference + open `work_orders`, routes each rent
 * row through the canonical `rentCycleFromRow` derivation, then folds the
 * result via `buildPortfolioSummary` for the selected period plus the
 * pure trend/aging/period folds (zero extra queries — the trend/aging
 * inputs are the same rows). Spend / NOI stay honestly `null` (expense
 * imports not connected). UI consumes the typed console only — never raw
 * Supabase rows.
 *
 * Bucketing per period: in-period rows drive billed/collected; older
 * still-late rows survive as prior-late exposure; rows AFTER the period
 * end (possible only for `'last'`) are excluded from the summary fold but
 * kept for the period-independent series/aging.
 *
 * An empty org (no properties) returns a well-formed zeroed console so
 * every surface still renders.
 *
 * @param periodKey - The selected reporting window (default `'mtd'`).
 * @returns The typed {@link FinancialsConsole} for that period.
 */
export async function getFinancialsConsole(periodKey: PeriodKey = 'mtd'): Promise<FinancialsConsole> {
  const supabase = await createServerClient();
  const cycleIso = currentCycleMonthIso();
  const todayIso = localTodayIso();
  const resolved = resolvePeriodCycles(periodKey, cycleIso);
  const flatRows: CycleRowInput[] = [];

  // 1. Properties (RLS-scoped). No properties → well-formed empty console.
  const { data: propertiesData } = await supabase
    .from('properties')
    .select('id, name')
    .order('name', { ascending: true });

  const properties = (propertiesData ?? []) as Array<{ id: string; name: string }>;
  if (properties.length === 0) {
    return assembleConsole(
      buildPortfolioSummary({ period: resolved.period, properties: [] }),
      flatRows,
      resolved,
      cycleIso,
    );
  }

  const propertyIds = properties.map((p) => p.id);

  // 2. Units for those properties + open work-order counts, in parallel.
  const [unitsResult, workOrderCounts] = await Promise.all([
    supabase.from('units').select('id, property_id').in('property_id', propertyIds),
    fetchOpenWorkOrderCountsByProperty(supabase, propertyIds),
  ]);

  const units = (unitsResult.data ?? []) as Array<{ id: string; property_id: string }>;
  const unitIdToPropertyId = new Map<string, string>();
  const unitCountByProperty = new Map<string, number>();
  for (const u of units) {
    unitIdToPropertyId.set(u.id, u.property_id);
    unitCountByProperty.set(u.property_id, (unitCountByProperty.get(u.property_id) ?? 0) + 1);
  }
  const unitIds = Array.from(unitIdToPropertyId.keys());

  // 3. Rent events through the current cycle + occupancy (active leases).
  // In-period rows drive billed/collected. Prior late rows are kept for
  // receivables/late exposure so aged balances survive month rollover without
  // inflating the period's billed/collection denominator.
  const [eventsResult, occupiedUnitIds] = await Promise.all([
    supabase
      .from('rent_events')
      .select('lease_id, cycle_month, amount_due, amount_paid, status, due_date')
      .lte('cycle_month', cycleIso),
    fetchOccupiedUnitIds(supabase, unitIds),
  ]);

  const events = (eventsResult.data ?? []) as RentEventRow[];

  // 4. Resolve event lease_id → unit_id (so each event lands on a property).
  const leaseIds = Array.from(new Set(events.map((e) => e.lease_id)));
  const leaseToUnit = await fetchLeaseUnitMap(supabase, leaseIds);

  // 5. Bucket derived rent rows by property (in-period → rentRows, older
  //    and still late → priorLateRows, newer than the period end — only
  //    possible for 'last' — excluded from the fold). Every attributable
  //    row also lands in flatRows for the period-independent series/aging.
  const inPeriod = new Set(resolved.cycleMonths);
  const periodStartCycle = resolved.cycleMonths[0];
  const rentRowsByProperty = new Map<string, DerivedRentRow[]>();
  const priorLateRowsByProperty = new Map<string, DerivedRentRow[]>();
  for (const event of events) {
    const unitId = leaseToUnit.get(event.lease_id);
    if (unitId === undefined) continue;
    const propertyId = unitIdToPropertyId.get(unitId);
    if (propertyId === undefined) continue;

    const derived = rentCycleFromRow(event, todayIso);
    const billedCents = dollarsToCents(event.amount_due);
    const collectedCents = dollarsToCents(event.amount_paid);
    flatRows.push({
      leaseId: event.lease_id,
      cycleMonth: event.cycle_month,
      billedCents,
      collectedCents,
      status: derived,
    });

    const row: DerivedRentRow = { billedCents, collectedCents, status: derived };
    if (inPeriod.has(event.cycle_month)) {
      const bucket = rentRowsByProperty.get(propertyId) ?? [];
      bucket.push(row);
      rentRowsByProperty.set(propertyId, bucket);
    } else if (event.cycle_month < periodStartCycle && derived.isLate) {
      const bucket = priorLateRowsByProperty.get(propertyId) ?? [];
      bucket.push(row);
      priorLateRowsByProperty.set(propertyId, bucket);
    }
  }

  // 6. Occupied units per property (distinct active-leased units).
  const occupiedCountByProperty = new Map<string, number>();
  for (const unitId of occupiedUnitIds) {
    const propertyId = unitIdToPropertyId.get(unitId);
    if (propertyId === undefined) continue;
    occupiedCountByProperty.set(propertyId, (occupiedCountByProperty.get(propertyId) ?? 0) + 1);
  }

  // 7. Assemble the pure-fold input. Spend fields stay UNSET → `null`
  //    downstream (expense imports not connected). Work-order COUNT is a
  //    risk signal only, never coerced into a dollar figure.
  const propertyInputs: PropertySnapshotInput[] = properties.map((property) => ({
    propertyId: property.id,
    propertyName: property.name,
    units: unitCountByProperty.get(property.id) ?? 0,
    occupiedUnits: occupiedCountByProperty.get(property.id) ?? 0,
    rentRows: rentRowsByProperty.get(property.id) ?? [],
    priorLateRows: priorLateRowsByProperty.get(property.id) ?? [],
    openWorkOrderCount: workOrderCounts.get(property.id) ?? 0,
  }));

  return assembleConsole(
    buildPortfolioSummary({ period: resolved.period, properties: propertyInputs }),
    flatRows,
    resolved,
    cycleIso,
  );
}

/** Attach the pure trend/aging/period folds to a folded summary. */
function assembleConsole(
  summary: PortfolioFinancialSummary,
  flatRows: readonly CycleRowInput[],
  resolved: ResolvedPeriod,
  currentCycleIso: string,
): FinancialsConsole {
  return {
    summary,
    series: buildMonthlySeries(flatRows, currentCycleIso),
    aging: buildAgingBuckets(flatRows),
    totals: periodTotals(flatRows, resolved.cycleMonths),
    priorTotals: periodTotals(flatRows, resolved.priorCycleMonths),
    periodKey: resolved.key,
  };
}

/**
 * Build the portfolio financial summary for the current calendar month —
 * the `'mtd'` slice of {@link getFinancialsConsole}, byte-identical to the
 * pre-console behavior. Kept as the narrow entry point for the Today page
 * and property briefings.
 *
 * @returns The typed {@link PortfolioFinancialSummary} for this period.
 */
export async function getPortfolioFinancialSummary(): Promise<PortfolioFinancialSummary> {
  return (await getFinancialsConsole('mtd')).summary;
}

/** A single property's financial briefing for the current cycle. */
export interface PropertyFinancialBriefing {
  /** The reporting window (current calendar month). */
  period: FinancialPeriod;
  /** The typed per-property snapshot (rent basis; spend stays null). */
  snapshot: PropertyFinancialSnapshot;
  /**
   * Deterministic, property-scoped exception queue. The portfolio-wide
   * "expense imports not connected" info row is filtered out here — the
   * property briefing UI states that honestly in its own spend note.
   */
  exceptions: FinancialException[];
}

/**
 * Build the financial briefing for ONE property, RLS-scoped to the
 * caller's organization. Mirrors {@link getPortfolioFinancialSummary} but
 * narrows every read to the property's own units / leases / rent events,
 * then folds the single property through `buildPortfolioSummary` to reuse
 * the canonical {@link buildPropertySnapshot} + exception derivation.
 *
 * Returns `null` when the property doesn't exist or RLS hides it, so the
 * caller can fall back to its existing surface. Spend / NOI / margin stay
 * honestly `null` (expense imports not connected); the open work-order
 * COUNT flows through only as a risk signal, never as a dollar figure.
 *
 * @param propertyId - The property to brief.
 * @returns The typed {@link PropertyFinancialBriefing}, or `null`.
 */
export async function getPropertyFinancialSnapshot(
  propertyId: string,
): Promise<PropertyFinancialBriefing | null> {
  const supabase = await createServerClient();
  const cycleIso = currentCycleMonthIso();
  const todayIso = localTodayIso();
  const period = buildPeriod(cycleIso);

  // 1. The property itself (RLS-scoped). Hidden / missing → null.
  const { data: propertyRows } = await supabase
    .from('properties')
    .select('id, name')
    .eq('id', propertyId);

  const property = ((propertyRows ?? []) as Array<{ id: string; name: string }>)[0];
  if (property === undefined) return null;

  // 2. Units on this property + its open work-order count, in parallel.
  const [unitsResult, workOrderCounts] = await Promise.all([
    supabase.from('units').select('id, property_id').eq('property_id', propertyId),
    fetchOpenWorkOrderCountsByProperty(supabase, [propertyId]),
  ]);

  const units = (unitsResult.data ?? []) as Array<{ id: string; property_id: string }>;
  const unitIds = units.map((u) => u.id);

  // 3. Leases on those units (lease → unit map) + occupancy, in parallel.
  const [leaseRows, occupiedUnitIds] = await Promise.all([
    unitIds.length
      ? supabase.from('leases').select('id, unit_id').in('unit_id', unitIds)
      : Promise.resolve({ data: [] as Array<{ id: string; unit_id: string }> }),
    fetchOccupiedUnitIds(supabase, unitIds),
  ]);

  const leases = (leaseRows.data ?? []) as Array<{ id: string; unit_id: string }>;
  const leaseIds = leases.map((l) => l.id);

  // 4. Rent events for those leases through the current cycle. Current rows
  // drive billed/collected; prior late rows feed receivables/late exposure.
  const eventsResult = leaseIds.length
    ? await supabase
        .from('rent_events')
        .select('lease_id, cycle_month, amount_due, amount_paid, status, due_date')
        .in('lease_id', leaseIds)
        .lte('cycle_month', cycleIso)
    : { data: [] as RentEventRow[] };

  const events = (eventsResult.data ?? []) as RentEventRow[];

  // 5. Derive each rent row through the canonical rent-cycle derivation.
  const rentRows: DerivedRentRow[] = [];
  const priorLateRows: DerivedRentRow[] = [];
  for (const event of events) {
    const row: DerivedRentRow = {
      billedCents: dollarsToCents(event.amount_due),
      collectedCents: dollarsToCents(event.amount_paid),
      status: rentCycleFromRow(event, todayIso),
    };
    if (event.cycle_month === cycleIso) {
      rentRows.push(row);
    } else if (row.status.isLate) {
      priorLateRows.push(row);
    }
  }

  // 6. Occupied units that belong to THIS property.
  const propertyUnitIds = new Set(unitIds);
  let occupiedUnits = 0;
  for (const unitId of occupiedUnitIds) {
    if (propertyUnitIds.has(unitId)) occupiedUnits += 1;
  }

  // 7. Fold the single property — reuses buildPropertySnapshot + the
  //    deterministic exception queue. Spend fields stay UNSET → null.
  const input: PropertySnapshotInput = {
    propertyId: property.id,
    propertyName: property.name,
    units: unitIds.length,
    occupiedUnits,
    rentRows,
    priorLateRows,
    openWorkOrderCount: workOrderCounts.get(property.id) ?? 0,
  };

  const summary = buildPortfolioSummary({ period, properties: [input] });

  return {
    period: summary.period,
    snapshot: summary.properties[0],
    // Drop the portfolio-wide "expense imports" info row — the property
    // briefing states the honest spend gap in its own note.
    exceptions: summary.exceptions.filter((e) => e.id !== 'expense-imports'),
  };
}

// =====================================================================
// Decomposed-join fetch helpers
// =====================================================================

/**
 * Map each lease id to its `unit_id`, so a rent event can be attributed
 * to a property (event → lease → unit → property).
 */
async function fetchLeaseUnitMap(
  supabase: SupabaseServerClient,
  leaseIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (leaseIds.length === 0) return result;

  const { data } = await supabase
    .from('leases')
    .select('id, unit_id')
    .in('id', leaseIds);

  for (const l of (data ?? []) as Array<{ id: string; unit_id: string }>) {
    result.set(l.id, l.unit_id);
  }
  return result;
}

/**
 * Distinct unit ids that currently have an ACTIVE lease — the canonical
 * occupancy signal (mirrors `fetchActiveLeasesForUnits` in
 * `@/lib/properties/queries`).
 */
async function fetchOccupiedUnitIds(
  supabase: SupabaseServerClient,
  unitIds: readonly string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (unitIds.length === 0) return result;

  const { data } = await supabase
    .from('leases')
    .select('unit_id, status')
    .in('unit_id', unitIds)
    .eq('status', 'active');

  for (const l of (data ?? []) as Array<{ unit_id: string }>) {
    result.add(l.unit_id);
  }
  return result;
}

/**
 * Count OPEN work orders per property (open → lease-free: WO → unit →
 * property). Mirrors `fetchOpenWorkOrderCountsByProperty` in
 * `@/lib/properties/queries`. This is a RISK SIGNAL only — the count is
 * never turned into a spend dollar amount.
 */
async function fetchOpenWorkOrderCountsByProperty(
  supabase: SupabaseServerClient,
  propertyIds: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (propertyIds.length === 0) return result;

  const { data: openWorkOrders } = await supabase
    .from('work_orders')
    .select('id, unit_id, status')
    .in('status', OPEN_WO_STATUSES);

  const workOrders = (openWorkOrders ?? []) as Array<{ unit_id: string }>;
  if (workOrders.length === 0) return result;

  const woUnitIds = Array.from(new Set(workOrders.map((w) => w.unit_id)));
  const { data: units } = await supabase
    .from('units')
    .select('id, property_id')
    .in('id', woUnitIds);

  const unitToProp = new Map<string, string>();
  for (const u of (units ?? []) as Array<{ id: string; property_id: string }>) {
    unitToProp.set(u.id, u.property_id);
  }

  for (const wo of workOrders) {
    const propId = unitToProp.get(wo.unit_id);
    if (propId === undefined) continue;
    result.set(propId, (result.get(propId) ?? 0) + 1);
  }
  return result;
}
