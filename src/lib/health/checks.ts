/**
 * Proactive health checks — pure detection logic (Feature 5).
 *
 * Four deterministic, no-LLM portfolio checks, each yielding zero or
 * more `HealthFlagCandidate`s:
 *
 *   work_order_stale      — work order open longer than 7 days
 *   lease_ending_soon     — active lease ending within 60 days with no
 *                           renewal (pending/future lease) or
 *                           termination (status change) on file
 *   vacant_unit           — unit with no active/pending lease (a pending
 *                           lease gets a "finish lease terms" summary,
 *                           never a vacancy warning)
 *   rent_escalation_stale — rent_event sitting in 'escalated' > 3 days
 *
 * This module is PURE: callers (src/lib/health/generate.ts) fetch the
 * source rows and inject the clock; tests drive `buildHealthFlags`
 * directly on fixtures. Every candidate maps to a concrete property —
 * `action_proposals.property_id` is uuid NOT NULL, so rows whose
 * property cannot be resolved (deleted unit/lease) are skipped rather
 * than guessed.
 *
 * Candidate payloads deliberately avoid money-shaped keys
 * (amount/cost/estimate) — see healthFlagPayloadSchema in
 * worker/types.ts. Summaries avoid ISO dates / "Month YYYY" phrasing so
 * the citation validator's temporal-anchor heuristic does not flag
 * deterministic findings as uncited fact-shaped claims.
 */

import {
  deriveUnitOccupancyStatus,
  type LeaseStatus,
} from '@/lib/domain';
import type { HealthFlagPayload } from '@/lib/agent/worker/types';

// ---------------------------------------------------------------------------
// Thresholds + kinds
// ---------------------------------------------------------------------------

export const WORK_ORDER_STALE_DAYS = 7;
export const LEASE_ENDING_WINDOW_DAYS = 60;
export const RENT_ESCALATED_STALE_DAYS = 3;

export const HEALTH_FLAG_KINDS = [
  'work_order_stale',
  'lease_ending_soon',
  'vacant_unit',
  'rent_escalation_stale',
] as const;

export type HealthFlagKind = (typeof HEALTH_FLAG_KINDS)[number];

/** Work-order statuses that count as "open" for the stale check. */
export const OPEN_WORK_ORDER_STATUSES = [
  'open',
  'assigned',
  'in_progress',
] as const;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Source-row shapes — explicit columns, mirrors the generate.ts selects
// ---------------------------------------------------------------------------

export interface UnitSourceRow {
  id: string;
  property_id: string;
  label: string;
}

export interface LeaseSourceRow {
  id: string;
  unit_id: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface WorkOrderSourceRow {
  id: string;
  unit_id: string;
  status: string;
  urgency: string;
  description: string | null;
  created_at: string;
}

export interface EscalatedRentEventSourceRow {
  id: string;
  lease_id: string;
  status: string;
  cycle_month: string;
  updated_at: string;
}

export interface HealthCheckSourceRows {
  units: ReadonlyArray<UnitSourceRow>;
  leases: ReadonlyArray<LeaseSourceRow>;
  workOrders: ReadonlyArray<WorkOrderSourceRow>;
  escalatedRentEvents: ReadonlyArray<EscalatedRentEventSourceRow>;
}

/** One would-be health_flag proposal, pre-persistence. */
export interface HealthFlagCandidate {
  propertyId: string;
  payload: HealthFlagPayload;
}

// ---------------------------------------------------------------------------
// buildHealthFlags — run all four checks over one org's source rows
// ---------------------------------------------------------------------------

/**
 * Runs every health check against one organization's source rows.
 *
 * Pure function: no IO, injected clock. Candidate order is
 * deterministic (check order above, source order within a check).
 *
 * @param rows - The org-scoped source rows (see generate.ts selects).
 * @param now - The sweep instant.
 * @returns All current health-flag candidates; empty when healthy.
 */
export function buildHealthFlags(
  rows: HealthCheckSourceRows,
  now: Date,
): HealthFlagCandidate[] {
  const unitsById = new Map(rows.units.map((u) => [u.id, u]));
  const leasesById = new Map(rows.leases.map((l) => [l.id, l]));

  return [
    ...detectStaleWorkOrders(rows.workOrders, unitsById, now),
    ...detectLeasesEndingSoon(rows.leases, unitsById, now),
    ...detectVacantUnits(rows.units, rows.leases, now),
    ...detectStaleRentEscalations(
      rows.escalatedRentEvents,
      leasesById,
      unitsById,
      now,
    ),
  ];
}

// ---------------------------------------------------------------------------
// (a) work_order_stale — open > 7 days
// ---------------------------------------------------------------------------

export function detectStaleWorkOrders(
  workOrders: ReadonlyArray<WorkOrderSourceRow>,
  unitsById: ReadonlyMap<string, UnitSourceRow>,
  now: Date,
): HealthFlagCandidate[] {
  const openStatuses = new Set<string>(OPEN_WORK_ORDER_STATUSES);
  const candidates: HealthFlagCandidate[] = [];

  for (const wo of workOrders) {
    if (!openStatuses.has(wo.status)) continue;
    const ageMs = msSince(wo.created_at, now);
    if (ageMs === null || ageMs <= WORK_ORDER_STALE_DAYS * MS_PER_DAY) continue;
    const ageDays = Math.floor(ageMs / MS_PER_DAY);
    const unit = unitsById.get(wo.unit_id);
    if (!unit) continue; // property unresolvable — never guess

    const description = (wo.description ?? '').trim();
    const detail =
      description.length > 0 ? ` — "${truncate(description, 120)}"` : '';
    candidates.push({
      propertyId: unit.property_id,
      payload: {
        kind: 'work_order_stale',
        subject: wo.id,
        refs: [
          { type: 'work_order', id: wo.id },
          { type: 'unit', id: unit.id },
        ],
        summary:
          `Work order on unit ${unit.label} has been open ${ageDays} days ` +
          `without resolution${detail}. Worth a look at where it stalled.`,
      },
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// (b) lease_ending_soon — ends within 60 days, no renewal/termination noted
// ---------------------------------------------------------------------------
//
// "Renewal noted" = another lease on the same unit that is 'pending',
// or whose start_date falls after this lease's end_date (a follow-on
// term already on file). "Termination noted" = the lease status moved
// off 'active' ('terminated'/'expired'), which the status filter below
// already excludes.

export function detectLeasesEndingSoon(
  leases: ReadonlyArray<LeaseSourceRow>,
  unitsById: ReadonlyMap<string, UnitSourceRow>,
  now: Date,
): HealthFlagCandidate[] {
  const todayMs = utcMidnightMs(now);
  const candidates: HealthFlagCandidate[] = [];

  for (const lease of leases) {
    if (lease.status !== 'active' || !lease.end_date) continue;
    const endMs = dateOnlyMs(lease.end_date);
    if (endMs === null) continue;
    const daysUntil = Math.round((endMs - todayMs) / MS_PER_DAY);
    if (daysUntil < 0 || daysUntil > LEASE_ENDING_WINDOW_DAYS) continue;
    if (hasFollowOnLease(lease, leases)) continue;
    const unit = unitsById.get(lease.unit_id);
    if (!unit) continue;

    const when =
      daysUntil === 0
        ? 'ends today'
        : `ends in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
    candidates.push({
      propertyId: unit.property_id,
      payload: {
        kind: 'lease_ending_soon',
        subject: lease.id,
        refs: [
          { type: 'lease', id: lease.id },
          { type: 'unit', id: unit.id },
        ],
        summary:
          `Lease on unit ${unit.label} ${when} with no renewal or ` +
          `termination on file. Decide whether to renew, re-list, or end it.`,
      },
    });
  }

  return candidates;
}

/** True when another lease on the same unit reads as a renewal already noted. */
function hasFollowOnLease(
  ending: LeaseSourceRow,
  leases: ReadonlyArray<LeaseSourceRow>,
): boolean {
  const endMs = dateOnlyMs(ending.end_date ?? '');
  for (const other of leases) {
    if (other.id === ending.id || other.unit_id !== ending.unit_id) continue;
    if (other.status === 'pending') return true;
    const otherStartMs = dateOnlyMs(other.start_date ?? '');
    if (otherStartMs !== null && endMs !== null && otherStartMs > endMs) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// (c) vacant_unit — no active or pending lease
// ---------------------------------------------------------------------------

/**
 * Flags units with no tenant relationship, via the canonical occupancy
 * derivation. A pending-lease unit is NEVER reported as vacant — it gets
 * a distinct "finish lease terms" summary instead. Units with an active
 * lease (including one past its end date — still a tenant relationship)
 * are not flagged.
 */
export function detectVacantUnits(
  units: ReadonlyArray<UnitSourceRow>,
  leases: ReadonlyArray<LeaseSourceRow>,
  now: Date,
): HealthFlagCandidate[] {
  const todayIso = now.toISOString().slice(0, 10);
  const leasesByUnit = new Map<string, LeaseSourceRow[]>();
  for (const lease of leases) {
    const arr = leasesByUnit.get(lease.unit_id) ?? [];
    arr.push(lease);
    leasesByUnit.set(lease.unit_id, arr);
  }

  const candidates: HealthFlagCandidate[] = [];
  for (const unit of units) {
    const occupancy = deriveUnitOccupancyStatus(
      (leasesByUnit.get(unit.id) ?? []).map((l) => ({
        status: l.status as LeaseStatus,
        endDate: l.end_date,
      })),
      todayIso,
    );

    if (occupancy === 'pending_move_in') {
      candidates.push({
        propertyId: unit.property_id,
        payload: {
          kind: 'vacant_unit' as const,
          subject: unit.id,
          refs: [{ type: 'unit', id: unit.id }],
          summary: `Unit ${unit.label} has a pending lease — finish lease terms.`,
        },
      });
      continue;
    }

    if (occupancy !== 'vacant') continue;

    candidates.push({
      propertyId: unit.property_id,
      payload: {
        kind: 'vacant_unit' as const,
        subject: unit.id,
        refs: [{ type: 'unit', id: unit.id }],
        summary:
          `Unit ${unit.label} has no active lease. If it is not already ` +
          `listed, it is sitting vacant.`,
      },
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// (d) rent_escalation_stale — 'escalated' rent_event untouched > 3 days
// ---------------------------------------------------------------------------

export function detectStaleRentEscalations(
  rentEvents: ReadonlyArray<EscalatedRentEventSourceRow>,
  leasesById: ReadonlyMap<string, LeaseSourceRow>,
  unitsById: ReadonlyMap<string, UnitSourceRow>,
  now: Date,
): HealthFlagCandidate[] {
  const candidates: HealthFlagCandidate[] = [];

  for (const event of rentEvents) {
    if (event.status !== 'escalated') continue;
    const staleMs = msSince(event.updated_at, now);
    if (staleMs === null || staleMs <= RENT_ESCALATED_STALE_DAYS * MS_PER_DAY) {
      continue;
    }
    const staleDays = Math.floor(staleMs / MS_PER_DAY);
    const lease = leasesById.get(event.lease_id);
    const unit = lease ? unitsById.get(lease.unit_id) : undefined;
    if (!lease || !unit) continue;

    candidates.push({
      propertyId: unit.property_id,
      payload: {
        kind: 'rent_escalation_stale',
        subject: event.id,
        refs: [
          { type: 'rent_event', id: event.id },
          { type: 'lease', id: lease.id },
        ],
        summary:
          `A rent escalation on unit ${unit.label} has sat unresolved for ` +
          `${staleDays} days. It needs an owner decision to move forward.`,
      },
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Date helpers (pure, UTC)
// ---------------------------------------------------------------------------

/** Milliseconds elapsed since an ISO timestamp; null if unparseable. */
function msSince(iso: string, now: Date): number | null {
  const thenMs = Date.parse(iso);
  if (Number.isNaN(thenMs)) return null;
  return now.getTime() - thenMs;
}

/** Epoch ms of a 'YYYY-MM-DD' date at UTC midnight; null if unparseable. */
function dateOnlyMs(dateOnly: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const ms = Date.parse(`${dateOnly}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Epoch ms of `now` truncated to UTC midnight. */
function utcMidnightMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
