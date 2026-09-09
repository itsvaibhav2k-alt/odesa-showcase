/**
 * Pure folds: already-derived rent rows -> typed property/portfolio
 * summaries + a deterministic exception queue.
 *
 * Lateness/balance are NOT computed here — each row carries a
 * `DerivedRentCycleStatus` produced by `src/lib/domain/rent-cycle.ts`.
 * This module only sums those figures and runs the `math.ts` helpers.
 * Spend is honest: when no expense category is provided the spend/NOI
 * fields stay `null`, never a fabricated `0`.
 */

import type { DerivedRentCycleStatus } from '@/lib/domain/rent-cycle';
import { formatMoneyCents } from './format';
import {
  classifyRisk,
  collectionRatePct,
  marginPct,
  occupancyRatePct,
  operatingResultCents,
} from './math';
import type {
  ExceptionSeverity,
  FinancialException,
  FinancialPeriod,
  MoneyCents,
  PortfolioFinancialSummary,
  PropertyFinancialSnapshot,
  RiskLevel,
} from './types';

/** A rent cycle whose status was already derived by `rent-cycle.ts`. */
export interface DerivedRentRow {
  /** amount_due in integer cents. */
  billedCents: MoneyCents;
  /** amount_paid in integer cents. */
  collectedCents: MoneyCents;
  /** Canonical derived status (balance/lateness live here). */
  status: DerivedRentCycleStatus;
}

/** Input for {@link buildPropertySnapshot}. Expenses optional/null. */
export interface PropertySnapshotInput {
  propertyId: string;
  propertyName: string;
  units: number;
  occupiedUnits: number;
  rentRows: DerivedRentRow[];
  /**
   * Prior-cycle rows that contribute to total receivables and late exposure.
   * Current-period billing/collection stay in `rentRows`; these rows prevent
   * aged unpaid balances from disappearing on month rollover without inflating
   * this month's billed/collection denominator.
   */
  priorLateRows?: DerivedRentRow[];
  maintenanceSpendCents?: MoneyCents | null;
  vendorSpendCents?: MoneyCents | null;
  otherExpenseCents?: MoneyCents | null;
  depositsHeldCents?: MoneyCents | null;
  openWorkOrderCount?: number;
}

/** Input for {@link buildPortfolioSummary}. */
export interface PortfolioSummaryInput {
  period: FinancialPeriod;
  properties: PropertySnapshotInput[];
}

/**
 * Sum a set of optional expense categories. Returns `null` when EVERY
 * category is null/undefined (expenses not connected) so downstream NOI
 * stays honestly unknown; otherwise treats absent categories as 0.
 */
function sumExpenses(categories: Array<MoneyCents | null | undefined>): MoneyCents | null {
  const known = categories.filter(
    (value): value is MoneyCents => value !== null && value !== undefined,
  );
  if (known.length === 0) return null;
  return known.reduce((total, value) => total + value, 0);
}

/** Normalise an optional expense category to `null` when absent. */
function expenseOrNull(value: MoneyCents | null | undefined): MoneyCents | null {
  return value === null || value === undefined ? null : value;
}

/**
 * Fold a property's derived rent rows + occupancy into a typed snapshot.
 *
 * @param input - Property identity, units, derived rent rows, optional
 *   expenses.
 * @returns The typed per-property financial snapshot.
 */
export function buildPropertySnapshot(input: PropertySnapshotInput): PropertyFinancialSnapshot {
  let rentBilledCents = 0;
  let rentCollectedCents = 0;
  let rentOutstandingCents = 0;
  let rentLateCents = 0;

  for (const row of input.rentRows) {
    rentBilledCents += row.billedCents;
    rentCollectedCents += row.collectedCents;
    rentOutstandingCents += row.status.balanceCents;
    if (row.status.isLate) rentLateCents += row.status.balanceCents;
  }

  for (const row of input.priorLateRows ?? []) {
    if (row.status.isLate) {
      rentOutstandingCents += row.status.balanceCents;
      rentLateCents += row.status.balanceCents;
    }
  }

  const maintenanceSpendCents = expenseOrNull(input.maintenanceSpendCents);
  const vendorSpendCents = expenseOrNull(input.vendorSpendCents);
  const otherExpenseCents = expenseOrNull(input.otherExpenseCents);
  const operatingExpenseCents = sumExpenses([
    maintenanceSpendCents,
    vendorSpendCents,
    otherExpenseCents,
  ]);

  const noiCents = operatingResultCents(rentCollectedCents, operatingExpenseCents);
  const snapshotMarginPct = marginPct(noiCents, rentCollectedCents);
  const snapshotCollectionRatePct = collectionRatePct(rentCollectedCents, rentBilledCents);
  const snapshotOccupancyRatePct = occupancyRatePct(input.occupiedUnits, input.units);

  const risk = classifyRisk({
    collectionRatePct: snapshotCollectionRatePct,
    occupancyRatePct: snapshotOccupancyRatePct,
    rentLateCents,
    rentOutstandingCents,
    openWorkOrderCount: input.openWorkOrderCount,
    marginPct: snapshotMarginPct,
  });

  return {
    propertyId: input.propertyId,
    propertyName: input.propertyName,
    units: input.units,
    occupiedUnits: input.occupiedUnits,
    rentBilledCents,
    rentCollectedCents,
    rentOutstandingCents,
    rentLateCents,
    maintenanceSpendCents,
    vendorSpendCents,
    otherExpenseCents,
    depositsHeldCents: expenseOrNull(input.depositsHeldCents),
    operatingExpenseCents,
    noiCents,
    marginPct: snapshotMarginPct,
    collectionRatePct: snapshotCollectionRatePct,
    occupancyRatePct: snapshotOccupancyRatePct,
    openWorkOrderCount: input.openWorkOrderCount,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
  };
}

/**
 * Attention ordering for risk levels: worst first, with `unknown` above
 * `healthy` (unassessable is never falsely green).
 */
const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 4,
  attention: 3,
  watch: 2,
  unknown: 1,
  healthy: 0,
};

/**
 * Order property snapshots by attention need: risk level (worst first),
 * then outstanding rent (largest first), then property name for a
 * deterministic tie-break. Returns a NEW array — input is not mutated.
 *
 * @param properties - Per-property snapshots (any order).
 * @returns A new, risk-ordered array.
 */
export function orderPropertiesByRisk(
  properties: readonly PropertyFinancialSnapshot[],
): PropertyFinancialSnapshot[] {
  return [...properties].sort((a, b) => {
    const byRisk = RISK_ORDER[b.riskLevel] - RISK_ORDER[a.riskLevel];
    if (byRisk !== 0) return byRisk;
    const byOutstanding = b.rentOutstandingCents - a.rentOutstandingCents;
    if (byOutstanding !== 0) return byOutstanding;
    return a.propertyName.localeCompare(b.propertyName);
  });
}

/** Map a risk level to the matching exception severity. */
function severityFromRisk(level: RiskLevel): ExceptionSeverity {
  switch (level) {
    case 'critical':
      return 'critical';
    case 'attention':
      return 'attention';
    case 'watch':
      return 'watch';
    default:
      return 'info';
  }
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  critical: 3,
  attention: 2,
  watch: 1,
  info: 0,
};

/** Build the deterministic, severity-sorted exception queue. */
function buildExceptions(properties: PropertyFinancialSnapshot[]): FinancialException[] {
  const exceptions: FinancialException[] = [];

  for (const property of properties) {
    if (property.rentLateCents > 0) {
      exceptions.push({
        id: `late:${property.propertyId}`,
        severity: severityFromRisk(property.riskLevel),
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        title: `Late rent at ${property.propertyName}`,
        detail: `${formatMoneyCents(property.rentLateCents)} of rent is past due.`,
        amountCents: property.rentLateCents,
        recommendedAction: 'Review in Rent and queue a reminder draft for the owner.',
        source: 'rent',
      });
    } else if (
      property.collectionRatePct !== null &&
      property.collectionRatePct < 85 &&
      property.rentOutstandingCents > 0
    ) {
      exceptions.push({
        id: `collections:${property.propertyId}`,
        severity: severityFromRisk(property.riskLevel),
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        title: `Collections lagging at ${property.propertyName}`,
        detail: `${formatMoneyCents(property.rentOutstandingCents)} is outstanding this period.`,
        amountCents: property.rentOutstandingCents,
        recommendedAction: 'Review outstanding balances in Rent.',
        source: 'rent',
      });
    }

    if (
      property.occupancyRatePct !== null &&
      property.occupancyRatePct < 50 &&
      property.units > 0
    ) {
      exceptions.push({
        id: `vacancy:${property.propertyId}`,
        severity: 'attention',
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        title: `Revenue risk: vacancy at ${property.propertyName}`,
        detail: `${property.occupiedUnits} of ${property.units} units occupied — vacant units mean $0 expected rent.`,
        recommendedAction: 'Prepare the vacant unit for listing to restore rent.',
        source: 'system',
      });
    }
  }

  // Honest portfolio-level note: spend isn't connected anywhere.
  if (properties.length > 0 && properties.every((p) => p.operatingExpenseCents === null)) {
    exceptions.push({
      id: 'expense-imports',
      severity: 'info',
      title: 'Expense imports not connected yet',
      detail:
        'Maintenance and vendor spend are not imported, so operating result and margin are unavailable.',
      recommendedAction: 'Connect expense imports to unlock NOI and margin.',
      source: 'system',
    });
  }

  return exceptions.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (bySeverity !== 0) return bySeverity;
    const byAmount = (b.amountCents ?? -1) - (a.amountCents ?? -1);
    if (byAmount !== 0) return byAmount;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Fold a set of property inputs into a typed portfolio summary with a
 * deterministic exception queue.
 *
 * @param input - The reporting period and per-property inputs.
 * @returns The typed portfolio financial summary.
 */
export function buildPortfolioSummary(
  input: PortfolioSummaryInput,
): PortfolioFinancialSummary {
  const properties = input.properties.map(buildPropertySnapshot);

  let unitCount = 0;
  let occupiedUnitCount = 0;
  let rentBilledCents = 0;
  let rentCollectedCents = 0;
  let rentOutstandingCents = 0;
  let rentLateCents = 0;
  let openWorkOrderCount = 0;

  const maintenanceCategories: Array<MoneyCents | null> = [];
  const vendorCategories: Array<MoneyCents | null> = [];
  const operatingCategories: Array<MoneyCents | null> = [];

  for (const property of properties) {
    unitCount += property.units;
    occupiedUnitCount += property.occupiedUnits;
    rentBilledCents += property.rentBilledCents;
    rentCollectedCents += property.rentCollectedCents;
    rentOutstandingCents += property.rentOutstandingCents;
    rentLateCents += property.rentLateCents;
    openWorkOrderCount += property.openWorkOrderCount ?? 0;
    maintenanceCategories.push(property.maintenanceSpendCents);
    vendorCategories.push(property.vendorSpendCents);
    operatingCategories.push(property.operatingExpenseCents);
  }

  const maintenanceSpendCents = sumExpenses(maintenanceCategories);
  const vendorSpendCents = sumExpenses(vendorCategories);
  const operatingExpenseCents = sumExpenses(operatingCategories);
  const noiCents = operatingResultCents(rentCollectedCents, operatingExpenseCents);

  return {
    period: input.period,
    propertyCount: properties.length,
    unitCount,
    occupiedUnitCount,
    rentBilledCents,
    rentCollectedCents,
    rentOutstandingCents,
    rentLateCents,
    maintenanceSpendCents,
    vendorSpendCents,
    operatingExpenseCents,
    noiCents,
    marginPct: marginPct(noiCents, rentCollectedCents),
    collectionRatePct: collectionRatePct(rentCollectedCents, rentBilledCents),
    occupancyRatePct: occupancyRatePct(occupiedUnitCount, unitCount),
    openWorkOrderCount,
    properties,
    exceptions: buildExceptions(properties),
  };
}
