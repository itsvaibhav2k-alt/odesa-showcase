/**
 * Pure financial math — the ONLY place portfolio metrics and percentages
 * are computed. Integer cents in, integer cents (or `null`) out.
 *
 * Division of labour: per-cycle rent lateness/balance is decided once in
 * `src/lib/domain/rent-cycle.ts`. This module does NOT re-derive
 * lateness; it only aggregates already-derived figures into rates,
 * operating result, and a conservative risk classification. Missing data
 * yields `null`/`unknown`, never an invented number, and a work-order
 * COUNT is never turned into a `MoneyCents` value.
 */

import { formatMoneyCents, formatPct } from './format';
import type { MoneyCents, RiskLevel } from './types';

/** Round a ratio*100 to one decimal place for stable percent display. */
function toPct(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Collected rent as a percent of billed rent. `null` when nothing was
 * billed (no rate is meaningful). May exceed 100 on credits/backpay.
 */
export function collectionRatePct(
  collectedCents: MoneyCents,
  billedCents: MoneyCents,
): number | null {
  if (billedCents <= 0) return null;
  return toPct(collectedCents, billedCents);
}

/**
 * Occupied units as a percent of total units. `null` when there are no
 * units to assess.
 */
export function occupancyRatePct(
  occupiedUnits: number,
  totalUnits: number,
): number | null {
  if (totalUnits <= 0) return null;
  return toPct(occupiedUnits, totalUnits);
}

/**
 * Operating result on a rent basis: collected rent minus connected
 * expenses. `null` when expenses are not connected (never assume 0).
 * Result may be negative.
 */
export function operatingResultCents(
  collectedCents: MoneyCents,
  operatingExpenseCents: MoneyCents | null,
): MoneyCents | null {
  if (operatingExpenseCents === null) return null;
  return collectedCents - operatingExpenseCents;
}

/**
 * Operating result as a percent of collected rent. `null` when the
 * result is unknown or nothing was collected. May be negative.
 */
export function marginPct(
  operatingResultCents: MoneyCents | null,
  collectedCents: MoneyCents,
): number | null {
  if (operatingResultCents === null) return null;
  if (collectedCents <= 0) return null;
  return toPct(operatingResultCents, collectedCents);
}

/** Risk classification thresholds (percent points). */
const COLLECTION_CRITICAL = 50;
const COLLECTION_ATTENTION = 85;
const COLLECTION_WATCH = 95;
const OCCUPANCY_ATTENTION = 50;
const OCCUPANCY_WATCH = 90;
const WORK_ORDER_WATCH = 3;

/** Inputs for {@link classifyRisk}. All money in integer cents. */
export interface RiskInput {
  collectionRatePct: number | null;
  occupancyRatePct: number | null;
  rentLateCents: MoneyCents;
  rentOutstandingCents: MoneyCents;
  /** Open work-order count — a risk signal only, never a dollar value. */
  openWorkOrderCount?: number;
  /** Operating margin %, only considered when expenses are connected. */
  marginPct?: number | null;
}

/** Result of a risk classification. */
export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

const RANK: Record<Exclude<RiskLevel, 'unknown'>, number> = {
  healthy: 0,
  watch: 1,
  attention: 2,
  critical: 3,
};

/**
 * Classify a property/portfolio's financial risk conservatively. When
 * neither collection nor occupancy can be assessed the result is
 * `unknown` (never a falsely-green `healthy`). Otherwise the worst
 * triggered signal wins. Reasons are plain English and never fabricate a
 * dollar amount from a work-order count.
 *
 * @param input - Already-aggregated rates and exposures.
 * @returns The risk level and the human reasons behind it.
 */
export function classifyRisk(input: RiskInput): RiskAssessment {
  const reasons: string[] = [];
  let worst: Exclude<RiskLevel, 'unknown'> = 'healthy';
  let assessable = false;

  const escalate = (level: Exclude<RiskLevel, 'unknown'>): void => {
    if (RANK[level] > RANK[worst]) worst = level;
  };

  if (input.collectionRatePct !== null) {
    assessable = true;
    const pct = input.collectionRatePct;
    if (pct < COLLECTION_CRITICAL) {
      escalate('critical');
      reasons.push(`Collection at ${formatPct(pct)} — under half of billed rent collected`);
    } else if (pct < COLLECTION_ATTENTION) {
      escalate('attention');
      reasons.push(`Collection at ${formatPct(pct)} — well below target`);
    } else if (pct < COLLECTION_WATCH) {
      escalate('watch');
      reasons.push(`Collection at ${formatPct(pct)} — slightly below target`);
    }
  }

  if (input.occupancyRatePct !== null) {
    assessable = true;
    const pct = input.occupancyRatePct;
    if (pct < OCCUPANCY_ATTENTION) {
      escalate('attention');
      reasons.push(`Occupancy at ${formatPct(pct)} — significant vacancy`);
    } else if (pct < OCCUPANCY_WATCH) {
      escalate('watch');
      reasons.push(`Occupancy at ${formatPct(pct)} — below full`);
    }
  }

  if (input.rentLateCents > 0) {
    assessable = true;
    escalate('watch');
    reasons.push(`${formatMoneyCents(input.rentLateCents)} of rent is late`);
  }

  if (typeof input.openWorkOrderCount === 'number' && input.openWorkOrderCount >= WORK_ORDER_WATCH) {
    escalate('watch');
    reasons.push(`${input.openWorkOrderCount} open work orders need attention`);
  }

  if (input.marginPct !== null && input.marginPct !== undefined && input.marginPct < 0) {
    escalate('attention');
    reasons.push(`Operating margin is negative (${formatPct(input.marginPct)})`);
  }

  if (!assessable) {
    return {
      level: 'unknown',
      reasons: ['No billed rent or occupancy data to assess'],
    };
  }

  return { level: worst, reasons };
}
