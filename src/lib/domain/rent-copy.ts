/**
 * Canonical rent recommendation copy — the ONE place the
 * escalation/late-fee narrative is phrased.
 *
 * Every surface that recommends a next step on an outstanding rent cycle
 * (tenant note, unit note, property brief) must read its recommendation
 * sentence from here, so the app can never say a cycle is `Escalated`
 * while also recommending a reminder "before any escalation". Status
 * itself still comes from {@link deriveRentCycleStatus} — this module
 * only turns a derived state into owner-facing recommendation copy.
 *
 * Pure module — no IO. Lines for `late`, `escalation_prepared`, and
 * `escalated` are deliberately stable (no interpolation) so they read
 * identically on every surface and stay easy to assert against.
 */

/**
 * Recommendation phase for an outstanding (or current) rent cycle.
 *
 * Maps from {@link TenantStanding}/{@link RentCycleKind} plus the two
 * escalation sub-phases the enum alone can't express:
 *   - `past_grace`          — late and past the grace window (fee eligible).
 *   - `escalation_prepared` — options drafted, awaiting owner approval.
 */
export type RentRecommendationKind =
  | 'current'
  | 'due'
  | 'late'
  | 'past_grace'
  | 'on_plan'
  | 'escalation_prepared'
  | 'escalated';

/** Optional context for the recommendation copy. Money in dollars. */
export interface RentRecommendationOpts {
  /** Tenant first name, when a personalized lead is useful. */
  firstName?: string;
  /** Outstanding balance in dollars. */
  balanceDollars?: number;
  /** Days late (0 when not late). */
  daysLate?: number;
  /** Configured late fee in dollars, when one applies. */
  lateFeeDollars?: number | null;
}

/** Whole-dollar display, grouped thousands: 75 -> "$75". */
function formatWholeDollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * The single owner-facing recommendation sentence for a rent cycle.
 *
 * @param kind - The recommendation phase (see {@link RentRecommendationKind}).
 * @param opts - Optional context; only `past_grace` interpolates a fee.
 * @returns One canonical recommendation sentence (never contradictory).
 *
 * @example
 * rentRecommendationCopy('late');
 * // 'Rent is late. Odesa recommends a calm reminder before escalation.'
 */
export function rentRecommendationCopy(
  kind: RentRecommendationKind,
  opts: RentRecommendationOpts = {},
): string {
  switch (kind) {
    case 'current':
      return 'Rent is current. Odesa will surface anything new the moment it appears.';
    case 'due':
      return 'Rent is due on the current cycle. No owner action is needed yet.';
    case 'late':
      return 'Rent is late. Odesa recommends a calm reminder before escalation.';
    case 'past_grace':
      return opts.lateFeeDollars != null
        ? `Rent is past the grace period — a ${formatWholeDollars(opts.lateFeeDollars)} late fee is now eligible (not yet applied). Odesa recommends a reminder you can approve before escalation.`
        : 'Rent is past the grace period — a late fee is now eligible (not yet applied). Odesa recommends a reminder you can approve before escalation.';
    case 'on_plan':
      return 'A payment plan is in place. Odesa recommends confirming the next catch-up payment.';
    case 'escalation_prepared':
      return 'Escalation is prepared, but nothing sends until you approve it.';
    case 'escalated':
      return 'Escalation has started. Next step: record payment if paid offline, approve the next notice, or pause escalation.';
  }
}
