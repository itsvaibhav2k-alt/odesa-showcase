/**
 * Trust graduation — pure logic that turns proposal outcomes into a
 * delta on the property's `autonomy_level`.
 *
 * v1 simplification (per task #5 description): a single
 * `autonomy_level` per property, NOT per-action-type. Per-action-type
 * graduation is deferred to v1.6, where the column will widen to
 * `autonomy_level_per_action JSONB`. Today we only mutate the scalar
 * column on `properties`.
 *
 * Outcome semantics — the deltas mirror the addendum's "graduated
 * trust" curve. Auto-committed actions where the owner did not
 * intervene confirm the worker's judgment most strongly; rejection
 * is the strongest negative signal. Edits sit in the middle:
 * direction was right, payload was wrong.
 *
 *   committed              → +0.01   (auto, owner did not touch)
 *   committed_after_review → +0.005  (review-gated, owner approved)
 *   edited                 → −0.02   (right intent, wrong payload)
 *   rejected               → −0.05   (wrong intent altogether)
 *   expired                →  0.00   (no signal: timed out unread)
 *
 * The result is then clamped to [0, 1] before the caller writes it
 * back. This module does NOT call Supabase — outcome.ts is the side-
 * effect layer that loads the current level, calls graduateAutonomy,
 * and persists the new level.
 */

// ---------------------------------------------------------------------------
// Outcome enumeration
// ---------------------------------------------------------------------------
//
// `committed` and `committed_after_review` both end at status='committed';
// the discriminator for trust is whether the owner reviewed before commit.
// The proposal record's `gate_decision` (auto vs review) tells us which.

export type ProposalOutcomeKind =
  | 'committed'
  | 'committed_after_review'
  | 'edited'
  | 'rejected'
  | 'expired';

// ---------------------------------------------------------------------------
// Delta table
// ---------------------------------------------------------------------------

export const AUTONOMY_DELTAS: Readonly<Record<ProposalOutcomeKind, number>> = {
  committed: 0.01,
  committed_after_review: 0.005,
  edited: -0.02,
  rejected: -0.05,
  expired: 0,
};

// Floor and ceiling for the autonomy_level scalar. Match the SQL
// CHECK constraint on properties.autonomy_level (0..1).
const AUTONOMY_FLOOR = 0;
const AUTONOMY_CEILING = 1;

// ---------------------------------------------------------------------------
// graduateAutonomy
// ---------------------------------------------------------------------------

export interface GraduateAutonomyResult {
  /** The clamped new autonomy level the caller should persist. */
  next: number;
  /** Raw delta applied (pre-clamp). Useful for audit / Sentry breadcrumbs. */
  delta: number;
  /** Did clamping change the result? Helps spot saturation. */
  clamped: boolean;
}

/**
 * Compute the new autonomy_level for a property after a proposal
 * outcome. Pure function: no IO, no mutation of inputs.
 *
 * Inputs:
 *   - currentLevel : property.autonomy_level (0..1) prior to outcome.
 *   - outcome      : the discriminated outcome kind.
 *
 * Returns a `GraduateAutonomyResult`. If `delta` is 0 (e.g. expired)
 * the result echoes the input level untouched — callers may skip the
 * UPDATE entirely in that case.
 */
export function graduateAutonomy(
  currentLevel: number,
  outcome: ProposalOutcomeKind,
): GraduateAutonomyResult {
  const delta = AUTONOMY_DELTAS[outcome];
  const raw = currentLevel + delta;
  const clamped = clamp(raw, AUTONOMY_FLOOR, AUTONOMY_CEILING);
  return {
    next: clamped,
    delta,
    clamped: clamped !== raw,
  };
}

/**
 * Resolve the outcome kind from the proposal's gate_decision and the
 * persisted action_proposals.status / outcome JSONB. The DB stores
 * `committed | rejected | edited | expired`; we lift `committed` into
 * `committed | committed_after_review` based on whether the gate
 * routed it to auto or review at proposal time.
 *
 * Pure helper used by outcome.ts so it can call graduateAutonomy
 * without re-deriving the kind itself.
 */
export function resolveOutcomeKind(
  gateDecision: 'auto' | 'review' | 'block',
  status: 'committed' | 'rejected' | 'edited' | 'expired',
): ProposalOutcomeKind {
  if (status === 'committed') {
    return gateDecision === 'auto' ? 'committed' : 'committed_after_review';
  }
  return status;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
