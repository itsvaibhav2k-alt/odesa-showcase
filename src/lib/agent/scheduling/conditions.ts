/**
 * Condition evaluator for v1.9 scheduled actions.
 *
 * Inngest's `fire-scheduled-action` function wakes up at `trigger_at`,
 * loads the schedule row, and calls `evaluateCondition()` to decide
 * whether the structured precondition still holds. If `holds === true`,
 * the action fires (worker spawn → proposal → autonomy gate). If false,
 * the row is marked `condition_failed` with `reason` persisted for
 * audit. Three condition variants cover the operator's typical asks:
 *
 *   - `rent_unpaid`         "fire only if rent is still unpaid"
 *   - `tenant_no_response`  "fire only if the tenant hasn't replied"
 *   - `always`              unconditional fire (also the legacy/null path)
 *
 * Anything outside these three is the dispatcher's job to refuse at
 * schedule time — the evaluator does not try to interpret novel DSL.
 *
 * Dependency injection: every evaluator takes a Supabase-shaped client
 * so unit tests can swap in a hand-rolled mock. The runtime caller
 * passes the service-role admin client; RLS-aware reads aren't needed
 * here because the Inngest function runs server-side with full DB
 * privileges and we already filter by `organization_id` defensively.
 *
 * Reuse note: `loadLatestRentStatusByLease` from context-loader.ts
 * grabs the most recent rent_event per lease but cannot honour an
 * `as-of triggerAt` cutoff — its query orders by `cycle_month` not
 * `created_at`. The rent-unpaid evaluator therefore writes a focused
 * query that filters on `created_at <= triggerAt` and orders the same
 * way for determinism.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type { ProposalRouting } from '@/lib/agent/worker/types';

import type { ConditionEvalResult, ScheduledCondition } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EvaluateContext {
  /** Service-role admin client. */
  db: SupabaseClient<Database>;
  /** Org scope; reserved for future cross-tenant safeguards. */
  organizationId: string;
  /** The schedule's `trigger_at`, used as the cutoff for "as of now" reads. */
  triggerAt: Date;
}

/**
 * Evaluate a scheduled condition against live DB state.
 *
 * Return shape:
 *   - `holds: true`  → caller should fire the action
 *   - `holds: false` → caller should mark the row `condition_failed`
 *
 * Never throws on a known condition variant — DB errors that the
 * evaluator can't recover from (e.g. unreadable `action_proposals` for
 * the `tenant_no_response` reference) collapse to `holds: false` with
 * a reason naming the failure. Bubbling exceptions out of here would
 * leave the schedule row in an ambiguous state at fire time.
 *
 * `null` condition is treated as `always` for defensiveness — older
 * rows (or any future migration that drops `condition`) should still
 * fire rather than silently expire.
 */
export async function evaluateCondition(
  condition: ScheduledCondition | null,
  ctx: EvaluateContext,
): Promise<ConditionEvalResult> {
  if (condition === null) {
    return { holds: true, reason: 'unconditional fire' };
  }

  switch (condition.type) {
    case 'always':
      return { holds: true, reason: 'unconditional fire' };
    case 'rent_unpaid':
      return evaluateRentUnpaid(condition, ctx);
    case 'tenant_no_response':
      return evaluateTenantNoResponse(condition, ctx);
    default: {
      // Exhaustiveness guard. If a new variant is added to
      // ScheduledCondition without updating this switch, TS catches
      // it here at compile time. At runtime — should the type ever
      // be widened from outside — we fall back to "fire" so a missed
      // case never silently expires the schedule.
      const _exhaustive: never = condition;
      void _exhaustive;
      return { holds: true, reason: 'unconditional fire (unknown variant)' };
    }
  }
}

// ---------------------------------------------------------------------------
// rent_unpaid
// ---------------------------------------------------------------------------

const PAID_RENT_STATUSES: ReadonlyArray<string> = ['paid', 'plan_agreed'];

interface ActiveLeaseRow {
  id: string;
  status: string;
  organization_id: string;
}

interface RentEventLatestRow {
  status: string;
  created_at: string;
}

async function evaluateRentUnpaid(
  condition: Extract<ScheduledCondition, { type: 'rent_unpaid' }>,
  ctx: EvaluateContext,
): Promise<ConditionEvalResult> {
  const lease = await loadActiveLeaseForTenant(ctx, condition.tenantId);
  if (!lease) {
    return {
      holds: false,
      reason: 'Tenant no longer has an active lease',
    };
  }

  const latest = await loadLatestRentEventAsOf(ctx, lease.id, ctx.triggerAt);

  if (latest && PAID_RENT_STATUSES.includes(latest.status)) {
    return {
      holds: false,
      reason: 'Tenant paid before deadline',
    };
  }

  return {
    holds: true,
    reason: 'No payment confirmed by trigger time',
  };
}

/**
 * Find the tenant's active or pending lease (single row per the schema
 * invariant for v1 — one current lease per tenant per org). Returns
 * `null` if none found.
 */
async function loadActiveLeaseForTenant(
  ctx: EvaluateContext,
  tenantId: string,
): Promise<ActiveLeaseRow | null> {
  const { data, error } = await (
    ctx.db as unknown as { from: (t: string) => SupabaseQuery }
  )
    .from('leases')
    .select('id, status, organization_id')
    .eq('tenant_id', tenantId)
    .eq('organization_id', ctx.organizationId)
    .in('status', ['active', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ActiveLeaseRow;
}

/**
 * Latest rent_event for a lease where `created_at <= triggerAt`.
 *
 * Why not reuse `loadLatestRentStatusByLease`: that helper orders by
 * `cycle_month` and ignores `created_at`. For the schedule fire path
 * we need the latest event the operator could have seen at trigger
 * time, which is a temporal cut, not a billing-cycle cut.
 */
async function loadLatestRentEventAsOf(
  ctx: EvaluateContext,
  leaseId: string,
  triggerAt: Date,
): Promise<RentEventLatestRow | null> {
  const { data, error } = await (
    ctx.db as unknown as { from: (t: string) => SupabaseQuery }
  )
    .from('rent_events')
    .select('status, created_at')
    .eq('lease_id', leaseId)
    .lte('created_at', triggerAt.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as RentEventLatestRow;
}

// ---------------------------------------------------------------------------
// tenant_no_response
// ---------------------------------------------------------------------------

interface ProposalReferenceRow {
  status: string;
  committed_at: string | null;
  routing: ProposalRouting | null;
}

interface InboundMessageRow {
  created_at: string;
}

async function evaluateTenantNoResponse(
  condition: Extract<ScheduledCondition, { type: 'tenant_no_response' }>,
  ctx: EvaluateContext,
): Promise<ConditionEvalResult> {
  const proposal = await loadProposalReference(ctx, condition.sinceProposalId);
  if (!proposal) {
    return {
      holds: false,
      reason: 'reference proposal was never committed',
    };
  }

  if (proposal.status !== 'committed' || !proposal.committed_at) {
    return {
      holds: false,
      reason: 'reference proposal was never committed',
    };
  }

  const conversationId = proposal.routing?.conversationId;
  if (!conversationId) {
    return {
      holds: false,
      reason: 'reference proposal has no conversation routing',
    };
  }

  const inbound = await loadFirstInboundReply(
    ctx,
    conversationId,
    proposal.committed_at,
    ctx.triggerAt,
  );

  if (inbound) {
    return {
      holds: false,
      reason: `Tenant replied at ${inbound.created_at}`,
    };
  }

  return {
    holds: true,
    reason: 'No tenant response since reminder sent',
  };
}

async function loadProposalReference(
  ctx: EvaluateContext,
  proposalId: string,
): Promise<ProposalReferenceRow | null> {
  const { data, error } = await (
    ctx.db as unknown as { from: (t: string) => SupabaseQuery }
  )
    .from('action_proposals')
    .select('status, committed_at, routing')
    .eq('id', proposalId)
    .eq('organization_id', ctx.organizationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ProposalReferenceRow;
}

async function loadFirstInboundReply(
  ctx: EvaluateContext,
  conversationId: string,
  committedAt: string,
  triggerAt: Date,
): Promise<InboundMessageRow | null> {
  const { data, error } = await (
    ctx.db as unknown as { from: (t: string) => SupabaseQuery }
  )
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .gt('created_at', committedAt)
    .lte('created_at', triggerAt.toISOString())
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as InboundMessageRow;
}

// ---------------------------------------------------------------------------
// Internal Supabase contract
// ---------------------------------------------------------------------------
//
// The real `SupabaseClient.from(table)` returns a `PostgrestQueryBuilder`
// whose chained methods return narrower types per filter. Mirroring
// that surface in a structural type fights the SDK without buying us
// anything for these focused reads — the chain ends in `.maybeSingle()`
// every time. Mock tests construct a shape with exactly these methods.

interface SupabaseQuery {
  select(cols: string): SupabaseQuery;
  eq(col: string, val: unknown): SupabaseQuery;
  in(col: string, vals: ReadonlyArray<string>): SupabaseQuery;
  gt(col: string, val: string): SupabaseQuery;
  lte(col: string, val: string): SupabaseQuery;
  order(col: string, opts: { ascending: boolean }): SupabaseQuery;
  limit(n: number): SupabaseQuery;
  maybeSingle(): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}
