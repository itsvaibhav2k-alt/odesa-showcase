/**
 * spawnForSchedule — re-spawn a property worker at a scheduled action's
 * trigger_at, then persist the resulting proposal with
 * `routing.scheduledActionId` for audit linkage.
 *
 * Why re-spawn instead of committing a pre-stored draft?
 *
 *   When the operator schedules an action ("remind Jane on Friday if
 *   rent is unpaid"), the dispatcher captures *intent* — action_type,
 *   target tenant, framing — not a finished SMS body. Property state
 *   may shift between schedule time and trigger time: the tenant may
 *   have paid partial rent; new memory facts about the tenant's
 *   pattern may have been recorded; org-level autonomy may have been
 *   bumped. Re-spawning at fire time produces a draft that reflects
 *   *now*, not the snapshot from days ago.
 *
 *   The cost is one fresh model call per fire, but scheduling is rare
 *   (Galaxy: a few per week) so this is the right trade.
 *
 * Pipeline:
 *   0. Dedup short-circuit: if an action_proposals row already exists
 *      with `routing->>scheduledActionId = schedule.id`, the expensive
 *      part of a previous fire already happened (Inngest re-runs the
 *      'spawn' step when a later step fails) — map and return it
 *      without a model call.
 *   1. Load the property row to read `privacy_mode`, `autonomy_level`,
 *      `ollama_host` — the gate matrix and the provider selector both
 *      need them.
 *   2. Pick a provider via `selectProvider({ privacyMode, ollamaHost },
 *      { actionType })`. On-prem orgs get Ollama; hosted orgs get the
 *      Anthropic model that ACTION_MODEL_POLICY maps the action_type to.
 *   3. Build `data` from `schedule.actionPayload`. The schedule MCP
 *      stores per-action_type input shapes that already satisfy the
 *      WorkerActionInput discriminator (it asserted shape at schedule
 *      time). spawn.ts re-validates the *output*, not the input, so we
 *      pass `actionPayload` through verbatim and rely on the existing
 *      output validator to catch any drift.
 *   4. spawnPropertyWorker → in-memory ActionProposal (id=null, gate=null).
 *   5. recordProposal with `routing.scheduledActionId = schedule.id` so
 *      the persisted row links back to the schedule. The gate decision
 *      lands on the proposal — the Inngest function decides auto-commit
 *      vs leave-as-review based on `proposal.gate_decision`.
 *
 * Does NOT commit. The caller (Inngest fire function) inspects the
 * returned proposal's gate_decision and calls commitProposal when
 * auto. Splitting spawn from commit lets the fire function emit
 * audit-friendly intermediate state and lets a 'review' outcome land
 * naturally as an Owner Queue item.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { spawnPropertyWorker } from '@/lib/agent/worker/spawn';
import { selectProvider } from '@/lib/agent/worker/providers/select';
import {
  recordProposal,
  rowToActionProposal,
  type RecordProposalInput,
} from '@/lib/agent/proposals/record';
import type { GateOutcome, PrivacyMode } from '@/lib/agent/worker/commit-gate';
import type { SupabaseLike } from '@/lib/agent/worker/context-loader';
import type { ActionProposal } from '@/lib/agent/worker/types';
import type { ScheduledAction } from './types';

export interface SpawnForScheduleDeps {
  /** Service-role client used for the property lookup and for proposal persistence. */
  db: SupabaseClient<Database>;
}

export interface SpawnForScheduleResult {
  /** The persisted proposal (id filled, gate_decision filled). */
  proposal: ActionProposal;
  /** Convenience copy of proposal.gate_decision so callers don't re-read the row. */
  decision: 'auto' | 'review' | 'block';
}

/**
 * Thrown when the property the schedule references can't be loaded.
 * v1.9 schedules always carry a propertyId (every fire is scoped to a
 * property), but the row may be deleted between schedule time and
 * trigger time. Callers (Inngest fire function) translate this into a
 * `condition_failed` row update with the reason captured.
 */
export class ScheduledActionPropertyNotFoundError extends Error {
  readonly scheduleId: string;
  readonly propertyId: string | null;

  constructor(scheduleId: string, propertyId: string | null) {
    super(
      `spawnForSchedule: property ${propertyId ?? '<null>'} for schedule ${scheduleId} could not be loaded`,
    );
    this.name = 'ScheduledActionPropertyNotFoundError';
    this.scheduleId = scheduleId;
    this.propertyId = propertyId;
  }
}

/**
 * Re-spawn a worker at fire time. Returns the persisted proposal and a
 * convenience copy of the gate decision.
 *
 * Throws `ScheduledActionPropertyNotFoundError` when the property row
 * can't be resolved. Throws `WorkerOutputValidationError` (from
 * spawn.ts) on a malformed model envelope. Throws `ProposalRecordError`
 * (from record.ts) on a persistence failure. Surfacing the underlying
 * errors lets the Inngest fire function distinguish operational
 * failures (Sentry, retry) from condition-style "won't fire" outcomes.
 */
export async function spawnForSchedule(
  schedule: ScheduledAction,
  deps: SpawnForScheduleDeps,
): Promise<SpawnForScheduleResult> {
  if (!schedule.propertyId) {
    throw new ScheduledActionPropertyNotFoundError(schedule.id, null);
  }

  // Step 0 — idempotency short-circuit. Every proposal recorded on this
  // path carries `routing.scheduledActionId` (see buildRouting below),
  // so an existing row for this schedule means a previous attempt
  // already did the model call + insert. Inngest re-runs the 'spawn'
  // step when a later step (commit / mark-fired / result persistence)
  // fails — reuse the persisted proposal instead of re-spawning a
  // duplicate. jsonb filter pattern mirrors
  // src/app/api/messaging/drafts/[id]/approve/route.ts.
  const existing = await findExistingScheduleProposal(deps.db, schedule.id);
  if (existing) {
    return existing;
  }

  // Step 1 — load privacy mode + autonomy level + ollama host off the
  // property row. recordProposal needs these for the gate matrix; the
  // provider selector needs privacy mode + ollama host.
  const propertyRow = await loadPropertyForSchedule(
    deps.db,
    schedule.propertyId,
    schedule.id,
  );

  // Step 2 — pick the provider. selectProvider throws
  // PrivacyModeMisconfiguredError when on_prem is set without a host;
  // we let it bubble — the Inngest function will mark the schedule
  // condition_failed with a clear reason.
  const provider = selectProvider(
    {
      privacyMode: propertyRow.privacyMode,
      ollamaHost: propertyRow.ollamaHost,
    },
    { actionType: schedule.actionType },
  );

  // Step 3 — build worker input. The schedule MCP captured the
  // per-action_type input shape at schedule time; pass it through
  // verbatim. spawn.ts validates the model OUTPUT against the per-
  // action zod schema, so any drift between stored payload shape and
  // the live action_type would surface as an output-validation error
  // we'd want to see anyway.
  const data = schedule.actionPayload as unknown;

  // Step 4 — invoke the worker. spawn.ts loads PropertyContext fresh
  // each call; that's the whole point of re-spawning at fire time.
  let inMemory: ActionProposal;
  try {
    inMemory = await spawnPropertyWorker({
      propertyId: schedule.propertyId,
      action_type: schedule.actionType,
      data,
      deps: {
        client: deps.db as unknown as SupabaseLike,
        provider,
      },
    });
  } catch (err) {
    // Re-throw verbatim so the caller can react on instanceof checks
    // (WorkerOutputValidationError vs operational errors).
    throw err;
  }

  // Step 5 — persist with routing.scheduledActionId so we can join
  // schedule rows ↔ proposal rows in audit queries. Carries any
  // routing fields the worker output already required (e.g. tenantId
  // for draft_sms_reply); spawn.ts leaves routing=null so we build a
  // fresh routing object here.
  const routing = buildRouting(schedule);

  const recordInput: RecordProposalInput = {
    organizationId: inMemory.organizationId,
    propertyId: inMemory.propertyId,
    workerModel: inMemory.workerModel,
    actionType: inMemory.action_type,
    payload: inMemory.payload,
    reasoning: inMemory.reasoning,
    confidence: inMemory.confidence,
    contextFactIds: inMemory.context_fact_ids,
    autonomyLevel: propertyRow.autonomyLevel,
    privacyMode: propertyRow.privacyMode,
    routing,
  };

  const recorded = await recordProposal(deps.db, recordInput);

  return {
    proposal: recorded.proposal,
    decision: recorded.decision.outcome,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up the most recent action_proposals row recorded for this
 * schedule (`routing->>scheduledActionId = scheduleId`). Returns the
 * mapped proposal + its persisted gate decision, or null when no
 * previous attempt recorded one.
 *
 * Throws on a query error: spawning anyway could duplicate a model
 * call AND a tenant-facing proposal, so we fail loud and let the
 * Inngest step retry re-run the check.
 */
async function findExistingScheduleProposal(
  db: SupabaseClient<Database>,
  scheduleId: string,
): Promise<SpawnForScheduleResult | null> {
  const { data, error } = await db
    .from('action_proposals')
    .select('*')
    .filter('routing->>scheduledActionId', 'eq', scheduleId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `spawnForSchedule: dedup lookup for schedule ${scheduleId} failed: ${error.message}`,
    );
  }
  if (!data) return null;

  const proposal = rowToActionProposal(data);
  // rowToActionProposal asserts gate_decision into the GateOutcome
  // union (throws otherwise), so the fallback is unreachable — it only
  // keeps the type narrow without a cast, failing safe to 'review'.
  const decision: GateOutcome = proposal.gate_decision ?? 'review';
  return { proposal, decision };
}

interface PropertyForSchedule {
  privacyMode: PrivacyMode;
  ollamaHost: string | null;
  autonomyLevel: number;
}

async function loadPropertyForSchedule(
  db: SupabaseClient<Database>,
  propertyId: string,
  scheduleId: string,
): Promise<PropertyForSchedule> {
  const { data, error } = await db
    .from('properties')
    .select('privacy_mode, ollama_host, autonomy_level')
    .eq('id', propertyId)
    .maybeSingle();

  if (error) {
    throw new ScheduledActionPropertyNotFoundError(scheduleId, propertyId);
  }
  if (!data) {
    throw new ScheduledActionPropertyNotFoundError(scheduleId, propertyId);
  }

  // The DB column is `string`; narrow to the union the gate expects.
  const privacyMode: PrivacyMode =
    data.privacy_mode === 'on_prem' ? 'on_prem' : 'hosted';

  return {
    privacyMode,
    ollamaHost: data.ollama_host ?? null,
    autonomyLevel: data.autonomy_level,
  };
}

/**
 * Build the proposal routing for a scheduled fire.
 *
 *   - `scheduledActionId` is always set; that's the audit linkage.
 *   - `tenantId` is mirrored when the schedule's condition pins to a
 *     tenant (rent_unpaid / tenant_no_response). draft_sms_reply
 *     dispatches need this on commit.
 *
 * conversationId is intentionally omitted — scheduled fires aren't
 * tied to a specific inbound message. The notify path picks the most
 * recent open conversation when one is needed (or creates one).
 */
function buildRouting(schedule: ScheduledAction): {
  scheduledActionId: string;
  tenantId?: string;
} {
  const tenantId = extractTenantId(schedule);
  const base: { scheduledActionId: string; tenantId?: string } = {
    scheduledActionId: schedule.id,
  };
  if (tenantId) {
    base.tenantId = tenantId;
  }
  return base;
}

function extractTenantId(schedule: ScheduledAction): string | null {
  const cond = schedule.condition;
  if (!cond) return null;
  if (cond.type === 'rent_unpaid') return cond.tenantId;
  if (cond.type === 'tenant_no_response') return cond.tenantId;
  return null;
}
