/**
 * Daily health-check sweep — the single producer of `health_flag`
 * action_proposals (Feature 5).
 *
 * For every organization, fetches the four check sources (units,
 * leases, open work orders, escalated rent_events), folds them through
 * the pure `buildHealthFlags`, and records one proposal per finding via
 * `recordProposal` — the same gate-stamped insert path every worker
 * proposal takes, so `gate_decision` is decided by the commit-gate
 * matrix (health_flag is `review_only` ⇒ ALWAYS 'review', never auto).
 *
 * Dedupe — one OPEN proposal per (kind, subject):
 *   1. Pre-read: one query per org for open ('proposed') health flags;
 *      candidates whose (kind, subject) is already open are skipped.
 *   2. Backstop: the partial unique index
 *      `uq_action_proposals_open_health_flag` (20260611014500) makes a
 *      duplicate insert fail with 23505, which we count as a skip —
 *      plain INSERT on purpose, NEVER `ON CONFLICT` against a partial
 *      unique index (repo lesson in 20260423000000).
 *
 * Proposal shape notes (architect-bound):
 *   - worker_model is the sentinel 'system-health-check' (no model ran)
 *   - routing is null (no commit-time side effect to route)
 *   - reasoning = the candidate summary — the owner-queue card renders
 *     odesaLine/whyFacts from `reasoning`, not from the payload
 *   - confidence = 1 (deterministic check; review_only ignores it)
 *   - property_id is required (uuid NOT NULL) — checks.ts already
 *     skips findings whose property cannot be resolved.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import {
  recordProposal,
  ProposalRecordError,
} from '@/lib/agent/proposals/record';
import {
  buildHealthFlags,
  OPEN_WORK_ORDER_STATUSES,
  RENT_ESCALATED_STALE_DAYS,
  WORK_ORDER_STALE_DAYS,
  type EscalatedRentEventSourceRow,
  type HealthCheckSourceRows,
  type HealthFlagCandidate,
  type LeaseSourceRow,
  type UnitSourceRow,
  type WorkOrderSourceRow,
} from './checks';

/** Sentinel persisted to action_proposals.worker_model — no model ran. */
export const HEALTH_CHECK_WORKER_MODEL = 'system-health-check';

/** Safety bound per source query — a 5–50-unit org never approaches it. */
const SOURCE_QUERY_LIMIT = 500;

const MS_PER_DAY = 86_400_000;

export interface RunHealthChecksOptions {
  /** The sweep instant — thresholds are computed relative to this. */
  now: Date;
  /** Restrict to a single organization; omit to cover every org. */
  organizationId?: string;
}

export interface RunHealthChecksDeps {
  /** Hook for tests; defaults to the real `recordProposal`. */
  recordProposalImpl?: typeof recordProposal;
}

export interface RunHealthChecksResult {
  /** Organizations swept. */
  orgs: number;
  /** Findings produced by the checks (before dedupe). */
  candidates: number;
  /** health_flag proposals inserted by this run. */
  created: number;
  /** Findings skipped because an open flag for (kind, subject) exists. */
  skippedOpen: number;
  /** Findings skipped via the 23505 backstop (concurrent duplicate). */
  skippedRace: number;
}

/**
 * One sweep: detect + record health flags for every organization.
 *
 * @param db - Service-role supabase client (writes bypass RLS).
 * @param options - Sweep instant and optional org scope.
 * @param deps - Test hooks; production callers omit.
 * @returns Per-bucket counts; created + skippedOpen + skippedRace === candidates.
 * @throws {Error} On any non-dedupe database error.
 */
export async function runHealthChecks(
  db: SupabaseClient<Database>,
  options: RunHealthChecksOptions,
  deps: RunHealthChecksDeps = {},
): Promise<RunHealthChecksResult> {
  const record = deps.recordProposalImpl ?? recordProposal;

  let orgQuery = db.from('organizations').select('id');
  if (options.organizationId) {
    orgQuery = orgQuery.eq('id', options.organizationId);
  }
  const { data: orgs, error: orgError } = await orgQuery;
  if (orgError) {
    throw new Error(
      `health-check: organizations query failed: ${orgError.message}`,
    );
  }

  const result: RunHealthChecksResult = {
    orgs: (orgs ?? []).length,
    candidates: 0,
    created: 0,
    skippedOpen: 0,
    skippedRace: 0,
  };

  for (const org of orgs ?? []) {
    const rows = await collectSourceRows(db, org.id, options.now);
    const candidates = buildHealthFlags(rows, options.now);
    result.candidates += candidates.length;
    if (candidates.length === 0) continue;

    const openKeys = await fetchOpenFlagKeys(db, org.id);

    for (const candidate of candidates) {
      if (openKeys.has(dedupeKey(candidate))) {
        result.skippedOpen += 1;
        continue;
      }
      try {
        await record(db, {
          organizationId: org.id,
          propertyId: candidate.propertyId,
          workerModel: HEALTH_CHECK_WORKER_MODEL,
          actionType: 'health_flag',
          payload: candidate.payload,
          reasoning: candidate.payload.summary,
          confidence: 1,
          contextFactIds: [],
          // review_only policy ignores both; pass the conservative floor.
          autonomyLevel: 0,
          privacyMode: 'hosted',
          routing: null,
        });
        result.created += 1;
      } catch (error) {
        if (isOpenFlagUniqueViolation(error)) {
          result.skippedRace += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dedupe pre-read
// ---------------------------------------------------------------------------

function dedupeKey(candidate: HealthFlagCandidate): string {
  return `${candidate.payload.kind}\u0000${candidate.payload.subject}`;
}

/**
 * All currently-open (status='proposed') health-flag (kind, subject)
 * keys for an org. The status filter mirrors the partial unique index
 * predicate — a committed/rejected flag frees its slot.
 */
async function fetchOpenFlagKeys(
  db: SupabaseClient<Database>,
  organizationId: string,
): Promise<Set<string>> {
  const { data, error } = await db
    .from('action_proposals')
    .select('id, payload')
    .eq('organization_id', organizationId)
    .eq('action_type', 'health_flag')
    .eq('status', 'proposed')
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(
      `health-check: open-flags query failed: ${error.message}`,
    );
  }

  const keys = new Set<string>();
  for (const row of data ?? []) {
    const payload = row.payload as { kind?: unknown; subject?: unknown } | null;
    if (
      payload &&
      typeof payload.kind === 'string' &&
      typeof payload.subject === 'string'
    ) {
      keys.add(`${payload.kind}\u0000${payload.subject}`);
    }
  }
  return keys;
}

/** True when the error is the 23505 backstop from the partial unique index. */
function isOpenFlagUniqueViolation(error: unknown): boolean {
  if (!(error instanceof ProposalRecordError)) return false;
  const cause = error.cause as { code?: string } | null;
  return cause?.code === '23505';
}

// ---------------------------------------------------------------------------
// Source queries — explicit column lists, all org-scoped
// ---------------------------------------------------------------------------

async function collectSourceRows(
  db: SupabaseClient<Database>,
  organizationId: string,
  now: Date,
): Promise<HealthCheckSourceRows> {
  const [units, leases, workOrders, escalatedRentEvents] = await Promise.all([
    fetchUnits(db, organizationId),
    fetchLeases(db, organizationId),
    fetchStaleOpenWorkOrders(db, organizationId, now),
    fetchStaleEscalatedRentEvents(db, organizationId, now),
  ]);

  return { units, leases, workOrders, escalatedRentEvents };
}

async function fetchUnits(
  db: SupabaseClient<Database>,
  organizationId: string,
): Promise<UnitSourceRow[]> {
  const { data, error } = await db
    .from('units')
    .select('id, property_id, label')
    .eq('organization_id', organizationId)
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`health-check: units query failed: ${error.message}`);
  }
  return data ?? [];
}

/**
 * All leases, every status — the vacancy check needs the active set,
 * the renewal check needs pending/future leases, and the escalation
 * check resolves property through possibly-ended leases.
 */
async function fetchLeases(
  db: SupabaseClient<Database>,
  organizationId: string,
): Promise<LeaseSourceRow[]> {
  const { data, error } = await db
    .from('leases')
    .select('id, unit_id, status, start_date, end_date')
    .eq('organization_id', organizationId)
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`health-check: leases query failed: ${error.message}`);
  }
  return data ?? [];
}

async function fetchStaleOpenWorkOrders(
  db: SupabaseClient<Database>,
  organizationId: string,
  now: Date,
): Promise<WorkOrderSourceRow[]> {
  const staleBefore = new Date(
    now.getTime() - WORK_ORDER_STALE_DAYS * MS_PER_DAY,
  ).toISOString();
  const { data, error } = await db
    .from('work_orders')
    .select('id, unit_id, status, urgency, description, created_at')
    .eq('organization_id', organizationId)
    .in('status', [...OPEN_WORK_ORDER_STATUSES])
    .lt('created_at', staleBefore)
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`health-check: work_orders query failed: ${error.message}`);
  }
  return data ?? [];
}

async function fetchStaleEscalatedRentEvents(
  db: SupabaseClient<Database>,
  organizationId: string,
  now: Date,
): Promise<EscalatedRentEventSourceRow[]> {
  const staleBefore = new Date(
    now.getTime() - RENT_ESCALATED_STALE_DAYS * MS_PER_DAY,
  ).toISOString();
  const { data, error } = await db
    .from('rent_events')
    .select('id, lease_id, status, cycle_month, updated_at')
    .eq('organization_id', organizationId)
    .eq('status', 'escalated')
    .lt('updated_at', staleBefore)
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(
      `health-check: rent_events query failed: ${error.message}`,
    );
  }
  return data ?? [];
}
