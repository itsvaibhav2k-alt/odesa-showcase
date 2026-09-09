/**
 * Canonical tenant standing — chip AND note read from ONE derived
 * value, killing the "good standing" / "Behind" contradiction
 * structurally.
 *
 * Pure module — no IO. Standing is a straight projection of the
 * derived rent cycle from `rent-cycle.ts`; nothing here re-reads the
 * raw enum or re-derives lateness.
 */

import type { DerivedRentCycleStatus } from './rent-cycle';

/** Canonical tenant standing derived from the current rent cycle. */
export type TenantStanding = 'good' | 'due' | 'behind' | 'on_plan' | 'escalated';

const STANDING_LABELS: Readonly<Record<TenantStanding, string>> = {
  good: 'Current',
  due: 'Due',
  behind: 'Behind',
  on_plan: 'On plan',
  escalated: 'Escalated',
};

/** Format integer cents as "$1,450" (whole dollars, grouped thousands). */
function formatDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** "11 days" / "1 day". */
function dayPhrase(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Projects a derived rent cycle onto tenant standing.
 *
 * paid/null → good; due → due; late → behind; on_plan → on_plan;
 * escalated → escalated. The defensive `unknown` kind maps to `due` —
 * a balance we can't classify must never read as good standing.
 *
 * @param cycle - The derived current cycle, or null when none exists.
 * @returns The canonical standing for chips and narratives alike.
 */
export function deriveTenantStanding(cycle: DerivedRentCycleStatus | null): TenantStanding {
  if (cycle === null) return 'good';
  switch (cycle.kind) {
    case 'paid':
      return 'good';
    case 'due':
      return 'due';
    case 'late':
      return 'behind';
    case 'on_plan':
      return 'on_plan';
    case 'escalated':
      return 'escalated';
    case 'unknown':
      return 'due';
  }
}

/**
 * Canonical short chip label for a standing.
 *
 * @param standing - Derived tenant standing.
 * @returns 'Current' | 'Due' | 'Behind' | 'On plan' | 'Escalated'.
 */
export function standingLabel(standing: TenantStanding): string {
  return STANDING_LABELS[standing];
}

/**
 * The Odesa-note sentence for a standing. Short, canonical, and honest:
 * "good standing — rent is current" is said for `good` ONLY.
 *
 * @param standing - Derived tenant standing.
 * @param firstName - Tenant first name.
 * @param balanceCents - Outstanding balance in cents.
 * @param daysLate - Days late (0 when not late).
 * @returns One canonical sentence for the tenant note.
 */
export function standingNarrative(
  standing: TenantStanding,
  firstName: string,
  balanceCents: number,
  daysLate: number,
): string {
  switch (standing) {
    case 'good':
      return `${firstName} is in good standing — rent is current.`;
    case 'due':
      return `${firstName} has ${formatDollars(balanceCents)} due on the current cycle.`;
    case 'behind':
      return `${firstName} is ${dayPhrase(daysLate)} behind with ${formatDollars(balanceCents)} outstanding.`;
    case 'on_plan':
      return `${firstName} is on a payment plan with ${formatDollars(balanceCents)} outstanding.`;
    case 'escalated':
      return `${firstName}'s current cycle is escalated with ${formatDollars(balanceCents)} outstanding.`;
  }
}
