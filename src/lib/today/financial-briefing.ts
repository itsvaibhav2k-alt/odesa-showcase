/**
 * Today v2 — pure financial-briefing transform.
 *
 * Folds the typed `PortfolioFinancialSummary` (built by the financial
 * domain module via `rentCycleFromRow` + `financials/summary`) into the
 * compact, high-signal shape the Today morning console renders:
 * collections status, late-rent exposure, the biggest money exception,
 * and one quiet "watching" financial signal.
 *
 * Pure + deterministic — no IO, no clock — so it is unit-tested directly.
 * It NEVER re-derives lateness or re-aggregates money; every figure is
 * read straight from the already-folded summary. Spend/NOI stay honestly
 * `null` when expense imports aren't connected — this module never
 * fabricates a dollar figure (and never turns a work-order count into
 * one).
 */

import { formatMoneyCents, formatPct } from '@/lib/financials/format';
import type {
  FinancialException,
  PortfolioFinancialSummary,
} from '@/lib/financials/types';
import type {
  TodayFinancialBriefing,
  TodayFinancialException,
  TodayFinancialTone,
  TodayFinancialWatch,
} from '@/types/today';

/** Collection-rate threshold (percent) at/above which collections read green. */
const COLLECTIONS_GREEN_PCT = 95;
/** Collection-rate threshold (percent) at/above which collections read amber. */
const COLLECTIONS_AMBER_PCT = 85;
/** Occupancy threshold (percent) below which Odesa watches occupancy. */
const OCCUPANCY_WATCH_PCT = 90;
/** Occupancy threshold (percent) below which the occupancy signal escalates to clay. */
const OCCUPANCY_CLAY_PCT = 70;

/**
 * Tone for the collections headline. Muted when nothing has been billed
 * (no honest rate to show), otherwise stepped on the collection rate.
 */
function collectionsToneFor(
  collectionRatePct: number | null,
  hasBilled: boolean,
): TodayFinancialTone {
  if (!hasBilled || collectionRatePct === null) return 'muted';
  if (collectionRatePct >= COLLECTIONS_GREEN_PCT) return 'green';
  if (collectionRatePct >= COLLECTIONS_AMBER_PCT) return 'amber';
  return 'clay';
}

/** Pick the largest money-shaped exception (highest `amountCents`). */
function largestMoneyException(
  exceptions: readonly FinancialException[],
): FinancialException | null {
  let best: FinancialException | null = null;
  for (const exception of exceptions) {
    if (exception.amountCents === undefined) continue;
    if (best === null || exception.amountCents > (best.amountCents ?? -1)) {
      best = exception;
    }
  }
  return best;
}

/** Flatten a money exception into the slim Today shape. */
function toTodayException(
  exception: FinancialException | null,
): TodayFinancialException | null {
  if (exception === null) return null;
  return {
    title: exception.title,
    detail: exception.detail,
    amountCents: exception.amountCents ?? null,
    propertyId: exception.propertyId ?? null,
  };
}

/**
 * The single quiet financial signal Odesa is watching, by precedence:
 *   1. Vacancy — when occupancy is below the watch threshold.
 *   2. Honest expense state — when expense imports aren't connected.
 *   3. Operating result — only when expenses ARE connected and occupancy
 *      is healthy (no fabricated figure otherwise).
 */
function watchSignalFor(
  summary: PortfolioFinancialSummary,
  expensesConnected: boolean,
): TodayFinancialWatch {
  const { occupancyRatePct, unitCount, occupiedUnitCount } = summary;

  if (
    occupancyRatePct !== null &&
    unitCount > 0 &&
    occupancyRatePct < OCCUPANCY_WATCH_PCT
  ) {
    return {
      title: 'Occupancy',
      meta: `${occupiedUnitCount} of ${unitCount} units occupied (${formatPct(occupancyRatePct)}).`,
      tone: occupancyRatePct < OCCUPANCY_CLAY_PCT ? 'clay' : 'amber',
    };
  }

  if (!expensesConnected) {
    return {
      title: 'Expense imports',
      meta: 'Not connected — operating result and margin stay unavailable.',
      tone: 'muted',
    };
  }

  return {
    title: 'Operating result',
    meta: `${formatMoneyCents(summary.noiCents)} on a rent basis.`,
    tone: 'green',
  };
}

/**
 * Build the compact Today financial briefing from a portfolio summary.
 *
 * @param summary - The typed portfolio financial summary for the period.
 * @returns The slim, deterministic briefing shape for the Today console.
 */
export function buildTodayFinancialBriefing(
  summary: PortfolioFinancialSummary,
): TodayFinancialBriefing {
  const hasBilled = summary.rentBilledCents > 0;
  const expensesConnected = summary.noiCents !== null;

  return {
    periodLabel: summary.period.label,
    rentBilledCents: summary.rentBilledCents,
    rentCollectedCents: summary.rentCollectedCents,
    rentOutstandingCents: summary.rentOutstandingCents,
    rentLateCents: summary.rentLateCents,
    collectionRatePct: summary.collectionRatePct,
    collectionsTone: collectionsToneFor(summary.collectionRatePct, hasBilled),
    topException: toTodayException(largestMoneyException(summary.exceptions)),
    watch: watchSignalFor(summary, expensesConnected),
    expensesConnected,
    hasBilled,
  };
}
