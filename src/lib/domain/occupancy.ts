/**
 * Canonical lease / unit-occupancy derivation.
 *
 * Pure module — no IO, no hidden clock (`todayIso` injected). Replaces
 * the scattered "active-only" occupancy checks that read pending-lease
 * units as vacant.
 *
 * Trust requirement: conflicting lease states are surfaced as
 * `needs_review` — never silently resolved to one of them.
 */

import type { LeaseStatus } from '@/types/database';

/** Derived lease status; `active_past_end` is still a tenant relationship. */
export type DerivedLeaseStatus = 'active' | 'active_past_end' | 'pending' | 'expired' | 'terminated';

/** Canonical unit occupancy. `pending_move_in` is NOT vacant and NOT occupied. */
export type UnitOccupancyKind =
  | 'occupied'
  | 'active_past_end'
  | 'pending_move_in'
  | 'vacant'
  | 'needs_review';

/** Lease facts needed to derive occupancy. */
export interface OccupancyLeaseInput {
  status: LeaseStatus;
  /** 'YYYY-MM-DD' or null (open-ended). */
  endDate: string | null;
}

/**
 * Derives the calendar-aware status of a single lease.
 *
 * An `active` lease whose end date has passed becomes
 * `active_past_end` — still a tenant relationship, not vacant.
 * Lexicographic compare is safe for ordering ISO `YYYY-MM-DD` strings.
 *
 * @param leaseInput - Lease status and end date.
 * @param todayIso - 'YYYY-MM-DD', injected — no hidden clock.
 * @returns The derived lease status.
 */
export function deriveLeaseStatus(
  leaseInput: OccupancyLeaseInput,
  todayIso: string,
): DerivedLeaseStatus {
  if (leaseInput.status !== 'active') return leaseInput.status;
  if (leaseInput.endDate !== null && leaseInput.endDate < todayIso) return 'active_past_end';
  return 'active';
}

/**
 * Derives unit occupancy from all of the unit's leases. Precedence:
 *
 * 1. one active lease with end_date >= today or null → occupied
 * 2. one active lease with end_date < today → active_past_end
 * 3. pending lease only → pending_move_in (NOT vacant, NOT occupied)
 * 4. no active/pending lease → vacant
 * 5. multiple active leases, or conflicting active + pending →
 *    needs_review (never silently pick one — trust requirement)
 *
 * Expired and terminated leases are ignored.
 *
 * @param leases - Every lease attached to the unit.
 * @param todayIso - 'YYYY-MM-DD', injected — no hidden clock.
 * @returns The canonical occupancy kind for the unit.
 */
export function deriveUnitOccupancyStatus(
  leases: readonly OccupancyLeaseInput[],
  todayIso: string,
): UnitOccupancyKind {
  const active = leases.filter((lease) => lease.status === 'active');
  const pending = leases.filter((lease) => lease.status === 'pending');

  if (active.length > 1) return 'needs_review';
  if (active.length === 1 && pending.length > 0) return 'needs_review';

  if (active.length === 1) {
    return deriveLeaseStatus(active[0], todayIso) === 'active_past_end'
      ? 'active_past_end'
      : 'occupied';
  }

  if (pending.length > 0) return 'pending_move_in';

  return 'vacant';
}
