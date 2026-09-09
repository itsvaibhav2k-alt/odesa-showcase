/**
 * Deterministic financial readout — 3–5 plain-English lines summarising a
 * portfolio. This is NOT an LLM: identical input always yields identical
 * output, and it never implies a margin when expenses aren't connected.
 */

import { formatMoneyCents, formatPct } from './format';
import type { AgingBucket, PeriodTotals } from './trend';
import type {
  FinancialException,
  PortfolioFinancialSummary,
  PropertyFinancialSnapshot,
} from './types';

/** Pick the largest money-shaped exception (highest amountCents). */
function largestMoneyException(
  exceptions: FinancialException[],
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

/**
 * Build 3–5 plain sentences describing the portfolio's money picture.
 *
 * @param summary - The typed portfolio summary.
 * @returns Ordered, deterministic readout lines (1 line when empty).
 */
export function buildFinancialReadout(summary: PortfolioFinancialSummary): string[] {
  if (summary.propertyCount === 0) {
    return ['No properties are in this portfolio yet, so there is nothing to report.'];
  }

  const lines: string[] = [];

  // 1. Collections.
  if (summary.rentBilledCents <= 0) {
    lines.push(`No rent has been billed in ${summary.period.label} yet.`);
  } else {
    lines.push(
      `Collected ${formatMoneyCents(summary.rentCollectedCents)} of ` +
        `${formatMoneyCents(summary.rentBilledCents)} billed in ${summary.period.label} ` +
        `(${formatPct(summary.collectionRatePct)}).`,
    );
  }

  // 2. Outstanding / late exposure.
  if (summary.rentOutstandingCents > 0) {
    lines.push(
      `${formatMoneyCents(summary.rentOutstandingCents)} is still outstanding, of which ` +
        `${formatMoneyCents(summary.rentLateCents)} is late.`,
    );
  } else if (summary.rentBilledCents > 0) {
    lines.push('All billed rent is collected — nothing is outstanding.');
  }

  // 3. Occupancy.
  lines.push(
    `${summary.occupiedUnitCount} of ${summary.unitCount} units are occupied ` +
      `(${formatPct(summary.occupancyRatePct)}).`,
  );

  // 4. Largest money exception (or all-clear).
  const exception = largestMoneyException(summary.exceptions);
  if (exception) {
    lines.push(
      `Largest money exception: ${exception.title} ` +
        `(${formatMoneyCents(exception.amountCents)}).`,
    );
  }

  // 5. Honest expense state.
  if (summary.noiCents === null) {
    lines.push(
      "Expense imports aren't connected yet, so operating result and margin are unavailable.",
    );
  }

  // Keep within the 3–5 line contract; trim lowest-priority tail lines
  // while always retaining the collections lead and the honest expense
  // note when present.
  if (lines.length > 5) {
    return lines.slice(0, 5);
  }
  return lines;
}

/** Three-part operator briefing for the financials console. */
export interface OperatorSummary {
  whatChanged: string;
  whyItMatters: string;
  recommendedMove: string;
}

/** '2 tenants' / '1 tenant'. */
function tenantCount(count: number): string {
  return `${count} tenant${count === 1 ? '' : 's'}`;
}

/** Property with the largest open balance, or null when nothing is open. */
function topOutstandingProperty(
  properties: readonly PropertyFinancialSnapshot[],
): PropertyFinancialSnapshot | null {
  let best: PropertyFinancialSnapshot | null = null;
  for (const property of properties) {
    if (property.rentOutstandingCents <= 0) continue;
    if (best === null || property.rentOutstandingCents > best.rentOutstandingCents) {
      best = property;
    }
  }
  return best;
}

/**
 * 'Treat X and Y vacancies as listing work, not collection failure.'
 * Empty string when no fully vacant properties exist — vacancy-listing
 * work is explicitly separated from collection failure.
 */
function vacancySentence(properties: readonly PropertyFinancialSnapshot[]): string {
  const names = properties
    .filter((property) => property.units > 0 && property.occupiedUnits === 0)
    .map((property) => property.propertyName);
  if (names.length === 0) return '';
  const list = new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(names);
  return ` Treat ${list} ${names.length === 1 ? 'vacancy' : 'vacancies'} as listing work, not collection failure.`;
}

/** Frame the open balance's age from the oldest nonzero aging bucket. */
function agingSentence(aging: readonly AgingBucket[]): { text: string; severe: boolean } {
  const nonzero = aging.filter((bucket) => bucket.cents > 0);
  const oldest = nonzero[nonzero.length - 1];
  if (oldest === undefined) {
    return { text: 'An open balance remains this period, but no lease is aged yet.', severe: false };
  }
  const who = tenantCount(oldest.count);
  switch (oldest.id) {
    case 'd31_plus':
      return {
        text: `The balance is seriously aged: ${who} in the 31+ days bucket. This is escalation territory — a reminder alone will not move it.`,
        severe: true,
      };
    case 'd8_30':
      return {
        text: `The balance is hardening: ${who}, oldest bucket 8–30 days. Follow up firmly before it ages further.`,
        severe: true,
      };
    case 'd1_7':
      return {
        text: `The balance is early overdue: ${who}, oldest bucket 1–7 days. This is reminder territory, not escalation.`,
        severe: false,
      };
    default:
      return {
        text: `The open balance is not late yet: ${who} owe inside the current window. A light nudge keeps it that way.`,
        severe: false,
      };
  }
}

/**
 * Build the deterministic three-part operator briefing (NOT an LLM:
 * identical input always yields identical sentences).
 *
 * - whatChanged: period collection rate + the top outstanding-driver
 *   property (max open balance).
 * - whyItMatters: age framing from the oldest nonzero aging bucket —
 *   reminder-calm for 1–7 days, firmer for 8–30 / 31+.
 * - recommendedMove: concrete next step; fully vacant properties are
 *   explicitly named as listing work, never collection failure.
 *
 * @param summary - Portfolio summary for the selected period.
 * @param totals - Period rent totals (drives the collection rate).
 * @param aging - As-of-today delinquency buckets.
 * @returns The three deterministic sentences.
 */
export function buildOperatorSummary(
  summary: PortfolioFinancialSummary,
  totals: PeriodTotals,
  aging: AgingBucket[],
): OperatorSummary {
  const label = summary.period.label;

  if (summary.propertyCount === 0) {
    return {
      whatChanged: 'No properties are in this portfolio yet.',
      whyItMatters: 'There is nothing to collect or track until a property is added.',
      recommendedMove: 'Add a property and its leases to start the rent ledger.',
    };
  }

  const vacancies = vacancySentence(summary.properties);

  if (totals.billedCents <= 0) {
    return {
      whatChanged: `No rent has been billed in ${label} yet.`,
      whyItMatters: 'Without billed rent there is no collection picture for this period.',
      recommendedMove: `Confirm rent cycles are generated for ${label}.${vacancies}`,
    };
  }

  const rate = formatPct((totals.collectedCents / totals.billedCents) * 100);

  if (totals.outstandingCents <= 0) {
    return {
      whatChanged: `${label} collection is ${rate} — every billed dollar is in.`,
      whyItMatters: 'Nothing is outstanding, so no collection risk is building this period.',
      recommendedMove: `No collection work is needed — keep the current cadence.${vacancies}`,
    };
  }

  const driver = topOutstandingProperty(summary.properties);
  const whatChanged =
    driver === null
      ? `${label} collection is ${rate} with ${formatMoneyCents(totals.outstandingCents)} still open.`
      : `${label} collection is ${rate} because ${driver.propertyName} has ${formatMoneyCents(driver.rentOutstandingCents)} open.`;

  const age = agingSentence(aging);
  const move = age.severe
    ? `Review the ${label} rent ledger and prepare an owner-approved escalation on the aged balance.`
    : `Review the ${label} rent ledger and prepare an owner-approved reminder draft.`;

  return {
    whatChanged,
    whyItMatters: age.text,
    recommendedMove: `${move}${vacancies}`,
  };
}
