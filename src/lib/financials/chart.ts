/**
 * Pure chart geometry / routing helpers for the financials console
 * graphs. No IO, no DOM — components feed these the already-derived
 * `MonthlyRentPoint` series and `PropertyFinancialSnapshot`s and get
 * back plot-ready numbers. Money stays integer cents; unknown rates
 * stay null (never plotted as fabricated zeros).
 */

import type { MoneyCents, PropertyFinancialSnapshot, RiskLevel } from './types';
import type { MonthlyRentPoint } from './trend';

/** One property positioned (or benched) on the performance board. */
export interface PropertyMark {
  propertyId: string;
  propertyName: string;
  occupancyPct: number;
  /** null = nothing billed this period (rendered in the unbilled tray). */
  collectionPct: number | null;
  riskLevel: RiskLevel;
  occupiedUnits: number;
  units: number;
  outstandingCents: MoneyCents;
}

/** Nice step multipliers, ascending, per decade. */
const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;

/**
 * Compute a zero-baseline money axis with "nice" ticks covering
 * `maxCents`. Tick step is the smallest {1, 2, 2.5, 5} × 10^k needing
 * at most `segments` intervals to reach the max; the axis is then
 * ceil-trimmed to `tickStep × ceil(max / tickStep)` — never padded out
 * to a full `tickStep × segments` — so $20,525 gets a $25k axis with
 * $5k ticks instead of a $40k one.
 *
 * @param maxCents - Largest plotted value in integer cents.
 * @param segments - Max number of tick intervals (default 5).
 * @returns Axis max plus ticks 0..axisMax inclusive.
 */
export function niceAxis(
  maxCents: number,
  segments = 5,
): { axisMaxCents: number; tickCents: number[] } {
  const safeSegments = segments >= 1 ? Math.floor(segments) : 5;
  // Guard: empty/negative data still gets a sane $1 axis to draw against.
  const target = Number.isFinite(maxCents) && maxCents > 0 ? maxCents : 100;

  const rawStep = target / safeSegments;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  let tickStep = NICE_STEPS[NICE_STEPS.length - 1] * magnitude;
  for (const multiplier of NICE_STEPS) {
    const candidate = multiplier * magnitude;
    if (Math.ceil(target / candidate) <= safeSegments) {
      tickStep = candidate;
      break;
    }
  }

  const usedSegments = Math.ceil(target / tickStep);
  const tickCents = Array.from({ length: usedSegments + 1 }, (_, i) => i * tickStep);
  return { axisMaxCents: tickStep * usedSegments, tickCents };
}

/**
 * Collection rate for one month as a percent. `null` when nothing was
 * billed (a rate over $0 is meaningless, not 0%). NOT clamped — >100%
 * overpayment months report the honest figure; the plot clamps y only.
 */
export function monthRatePct(point: MonthlyRentPoint): number | null {
  if (point.billedCents <= 0) return null;
  return (point.collectedCents / point.billedCents) * 100;
}

/**
 * Outstanding balance still open on the newest month of the series.
 * `null` when the series is empty or the month is settled, so the gap
 * annotation can be omitted entirely instead of showing "−$0".
 */
export function currentMonthGap(
  series: MonthlyRentPoint[],
): { outstandingCents: MoneyCents } | null {
  const last = series[series.length - 1];
  if (last === undefined || last.outstandingCents <= 0) return null;
  return { outstandingCents: last.outstandingCents };
}

/** One point of the cumulative billed-vs-collected pace curve. */
export interface PacePoint {
  /** 'YYYY-MM-01'. */
  cycleMonth: string;
  label: string;
  cumBilledCents: MoneyCents;
  cumCollectedCents: MoneyCents;
  /** Cumulative billed − collected, clamped ≥ 0 (overpay never plots a negative gap). */
  gapCents: MoneyCents;
}

/**
 * Prefix-sum a monthly series into cumulative pace points. Monthly
 * grain only — this is honest cycle history, never a daily curve.
 * Empty series → [].
 */
export function buildCumulativePace(series: MonthlyRentPoint[]): PacePoint[] {
  let cumBilledCents = 0;
  let cumCollectedCents = 0;
  return series.map((point) => {
    cumBilledCents += point.billedCents;
    cumCollectedCents += point.collectedCents;
    return {
      cycleMonth: point.cycleMonth,
      label: point.label,
      cumBilledCents,
      cumCollectedCents,
      gapCents: Math.max(0, cumBilledCents - cumCollectedCents),
    };
  });
}

/** One segment of the portfolio status ring. */
export interface CoverageSegment {
  id: 'current' | 'late' | 'vacant';
  units: number;
  /** Share of ALL units (0–100). */
  pct: number;
  /** Unit-consistent, e.g. '10 units current' / '1 unit late' / '4 units vacant'. */
  label: string;
}

/** '2 late leases' / '1 late lease'. */
function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/**
 * Derive the portfolio status ring segments from summary counts. This
 * is occupancy/late STATUS, not payment evidence — no unit-level
 * payment timestamps exist, so segments never say "collected".
 * Guards: late clamped ≤ occupied, current/vacant clamped ≥ 0;
 * unitCount ≤ 0 → [] (no ring over zero units).
 */
export function buildRentCoverageSegments(input: {
  unitCount: number;
  occupiedUnitCount: number;
  lateLeaseCount: number;
}): CoverageSegment[] {
  if (input.unitCount <= 0) return [];
  const occupied = Math.min(Math.max(input.occupiedUnitCount, 0), input.unitCount);
  const late = Math.min(Math.max(input.lateLeaseCount, 0), occupied);
  const current = Math.max(0, occupied - late);
  const vacant = Math.max(0, input.unitCount - occupied);
  const pct = (units: number): number => (units / input.unitCount) * 100;
  // Unit-consistent labels: every segment counts UNITS by status, so the
  // ring never mixes "leases" and "units" or implies payment evidence.
  return [
    { id: 'current', units: current, pct: pct(current), label: `${countLabel(current, 'unit')} current` },
    { id: 'late', units: late, pct: pct(late), label: `${countLabel(late, 'unit')} late` },
    { id: 'vacant', units: vacant, pct: pct(vacant), label: `${countLabel(vacant, 'unit')} vacant` },
  ];
}

/**
 * Split property snapshots into plottable marks and the "no rent
 * billed" tray. A null collection rate is NEVER plotted (it would fake
 * a (x, 0) point); those properties go to `unbilled` in input order.
 */
export function buildPropertyMarks(
  properties: PropertyFinancialSnapshot[],
): { plotted: PropertyMark[]; unbilled: PropertyMark[] } {
  const plotted: PropertyMark[] = [];
  const unbilled: PropertyMark[] = [];
  for (const property of properties) {
    const mark: PropertyMark = {
      propertyId: property.propertyId,
      propertyName: property.propertyName,
      occupancyPct: property.occupancyRatePct ?? 0,
      collectionPct: property.collectionRatePct,
      riskLevel: property.riskLevel,
      occupiedUnits: property.occupiedUnits,
      units: property.units,
      outstandingCents: property.rentOutstandingCents,
    };
    (mark.collectionPct === null ? unbilled : plotted).push(mark);
  }
  return { plotted, unbilled };
}
