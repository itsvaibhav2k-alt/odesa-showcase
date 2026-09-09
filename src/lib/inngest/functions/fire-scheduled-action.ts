/**
 * fire-scheduled-action — the durable wake-up for v1.9 scheduled actions.
 *
 * Lifecycle of one schedule row:
 *
 *   schedule MCP creates row (status='scheduled')
 *     → emits inngest event 'odesa/scheduled-action.fire' with { scheduleId }
 *       and inngest_event_id stamped on the row
 *
 *   THIS function picks up the event:
 *     1. step.run('load')          — read the row; bail if not 'scheduled'
 *     2. step.sleepUntil           — durable wait until trigger_at
 *     3. step.run('recheck')       — re-read; cancellation race exits cleanly
 *     4. step.run('eval')          — evaluateCondition against live DB
 *     5. condition fails           — step.run('mark-failed')
 *     6. condition holds:
 *          step.run('spawn')       — spawnForSchedule → ActionProposal
 *          step.run('commit')      — only when proposal.gate_decision='auto'
 *          step.run('mark-fired')  — mark schedule fired with proposal id
 *
 * Cancellation model:
 *   The schedule MCP doesn't call Inngest's cancellation API; it just
 *   sets status='cancelled' on the row. The recheck-after-wake pattern
 *   means a cancelled schedule never spawns a worker. The Inngest run
 *   silently exits and the row stays at 'cancelled'. This avoids
 *   coupling our cancellation model to Inngest's (which would require
 *   stable run ids per schedule and an extra API call).
 *
 * Idempotency:
 *   - load: pure read, repeatable
 *   - recheck: pure read, repeatable
 *   - eval: pure (read-only) per evaluateCondition's contract
 *   - spawn: NOT pure — performs a model call + DB insert. Inngest
 *     re-runs steps on retry, but spawnForSchedule short-circuits on
 *     an existing action_proposals row with
 *     routing->>scheduledActionId = schedule.id (stamped on every
 *     proposal recorded on this path), so a retry after a successful
 *     record reuses the persisted proposal instead of re-spawning.
 *     The remaining window is a crash between the model call and the
 *     insert: that retry costs one extra model call but still ends
 *     with a single proposal row.
 *   - commit: idempotent at the proposals layer (commit.ts no-ops if
 *     status≠'proposed').
 *   - mark-fired / mark-failed: idempotent UPDATEs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, ScheduledActionRow } from '@/types/database';
import { inngest } from '@/lib/inngest/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { evaluateCondition } from '@/lib/agent/scheduling/conditions';
import {
  spawnForSchedule,
  ScheduledActionPropertyNotFoundError,
} from '@/lib/agent/scheduling/spawn-for-schedule';
import { commitProposal } from '@/lib/agent/proposals/commit';
import type {
  ScheduledAction,
  ScheduledCondition,
} from '@/lib/agent/scheduling/types';
import type { WorkerActionType } from '@/lib/agent/worker/types';
import { WORKER_ACTION_TYPES } from '@/lib/agent/worker/types';

export const FIRE_SCHEDULED_ACTION_EVENT = 'odesa/scheduled-action.fire';
export const FIRE_SCHEDULED_ACTION_FN_ID = 'fire-scheduled-action';

// ---------------------------------------------------------------------------
// Pure runner — exercised directly by unit tests with a mocked step.
// ---------------------------------------------------------------------------

/**
 * Subset of Inngest's `step` API we use. Defining it locally lets tests
 * pass a hand-rolled stub that resolves immediately without spinning up
 * an Inngest runtime.
 */
export interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  sleepUntil(id: string, until: Date | string): Promise<unknown>;
}

export interface FireScheduledActionDeps {
  /** Service-role client. Defaults to a fresh `createAdminClient()`. */
  db?: SupabaseClient<Database>;
  /** Hook for tests; defaults to the real `evaluateCondition`. */
  evaluateConditionImpl?: typeof evaluateCondition;
  /** Hook for tests; defaults to the real `spawnForSchedule`. */
  spawnForScheduleImpl?: typeof spawnForSchedule;
  /** Hook for tests; defaults to the real `commitProposal`. */
  commitProposalImpl?: typeof commitProposal;
  /** Clock — defaults to real `new Date()`. */
  now?: () => Date;
}

export interface FireScheduledActionInput {
  scheduleId: string;
  step: StepLike;
  deps?: FireScheduledActionDeps;
}

export type FireOutcome =
  | { kind: 'skipped'; reason: 'not_found' | 'not_scheduled' | 'recheck_not_scheduled' }
  | { kind: 'condition_failed'; reason: string }
  | { kind: 'fired_auto'; proposalId: string }
  | { kind: 'fired_review'; proposalId: string }
  | { kind: 'fired_blocked'; proposalId: string }
  | { kind: 'spawn_failed'; reason: string };

/**
 * Pure orchestration of the fire pipeline. Returns a discriminated
 * outcome the caller (Inngest function wrapper or a test) can assert
 * on directly.
 *
 * Throws only when the underlying steps throw — i.e. when a step
 * itself signals "Inngest should retry me." We catch the
 * spawn-not-found case explicitly so it lands as `condition_failed`
 * (operational meaning: schedule is unreachable, mark and move on)
 * rather than as a retry loop.
 */
export async function runFireScheduledAction(
  input: FireScheduledActionInput,
): Promise<FireOutcome> {
  const { scheduleId, step } = input;
  const deps = input.deps ?? {};
  const db = deps.db ?? createAdminClient();
  const now = deps.now ?? (() => new Date());

  // Step 1 — load. If the row vanished or isn't scheduled, bail.
  const initial = await step.run('load', () => loadSchedule(db, scheduleId));
  if (!initial) {
    return { kind: 'skipped', reason: 'not_found' };
  }
  if (initial.status !== 'scheduled') {
    return { kind: 'skipped', reason: 'not_scheduled' };
  }

  // Step 2 — durable sleep. Inngest persists this; survives restarts.
  await step.sleepUntil('wait-for-trigger', new Date(initial.trigger_at));

  // Step 3 — recheck. Cancellation race: status may have moved to
  // 'cancelled' while we slept.
  const fresh = await step.run('recheck', () => loadSchedule(db, scheduleId));
  if (!fresh || fresh.status !== 'scheduled') {
    return { kind: 'skipped', reason: 'recheck_not_scheduled' };
  }

  const schedule = rowToScheduledAction(fresh);

  // Step 4 — evaluate the condition. evaluateCondition is pure
  // read-only; safe to retry as a step. We re-read trigger_at from the
  // fresh row so a clock-skew-induced trigger drift doesn't poison the
  // evaluation.
  const evaluator = deps.evaluateConditionImpl ?? evaluateCondition;
  const condition = await step.run('eval-condition', () =>
    evaluator(schedule.condition, {
      db,
      organizationId: schedule.organizationId,
      triggerAt: new Date(schedule.triggerAt),
    }),
  );

  if (!condition.holds) {
    await step.run('mark-condition-failed', () =>
      markConditionFailed(db, scheduleId, condition.reason, now()),
    );
    return { kind: 'condition_failed', reason: condition.reason };
  }

  // Step 5 — spawn. Wrapped in a step.run so a transient failure (model
  // 5xx, DB blip) gets Inngest's retry treatment. The
  // ScheduledActionPropertyNotFoundError path is special-cased: that
  // means the schedule references a property that no longer exists, so
  // there's nothing to retry — we mark it as condition_failed with a
  // clear reason.
  const spawner = deps.spawnForScheduleImpl ?? spawnForSchedule;
  let spawnResult: Awaited<ReturnType<typeof spawnForSchedule>>;
  try {
    spawnResult = await step.run('spawn', () => spawner(schedule, { db }));
  } catch (err) {
    if (err instanceof ScheduledActionPropertyNotFoundError) {
      const reason = `property ${err.propertyId ?? '<null>'} not found at fire time`;
      await step.run('mark-condition-failed-property', () =>
        markConditionFailed(db, scheduleId, reason, now()),
      );
      return { kind: 'spawn_failed', reason };
    }
    throw err;
  }

  const proposal = spawnResult.proposal;
  const proposalId = proposal.id ?? '';

  // Step 6 — auto-commit only when the explicit disposition permits it.
  // 'review' leaves the proposal in Owner Queue; 'block' records the decision
  // and lets ops debug from the proposal row. Either way we still
  // mark the schedule fired with the proposal id for audit.
  if (spawnResult.decision === 'auto' && proposalId) {
    const commit = deps.commitProposalImpl ?? commitProposal;
    await step.run('commit', async () => {
      const result = await commit(db, proposalId, { kind: 'system' });
      if (result.proposal.status !== 'committed') {
        throw new Error(
          'Scheduled action was recorded but did not complete; reconciliation is required',
        );
      }
      return result;
    });
  }

  // Step 7 — mark fired.
  await step.run('mark-fired', () =>
    markFired(db, scheduleId, proposalId || null, now()),
  );

  if (spawnResult.decision === 'auto') {
    return { kind: 'fired_auto', proposalId };
  }
  if (spawnResult.decision === 'review') {
    return { kind: 'fired_review', proposalId };
  }
  return { kind: 'fired_blocked', proposalId };
}

// ---------------------------------------------------------------------------
// Inngest function — thin wrapper around runFireScheduledAction
// ---------------------------------------------------------------------------

interface FireScheduledActionEventData {
  scheduleId: string;
}

export const fireScheduledAction = inngest.createFunction(
  {
    id: FIRE_SCHEDULED_ACTION_FN_ID,
    triggers: [{ event: FIRE_SCHEDULED_ACTION_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as FireScheduledActionEventData;
    if (!data?.scheduleId || typeof data.scheduleId !== 'string') {
      return { kind: 'skipped', reason: 'missing_schedule_id' };
    }

    return runFireScheduledAction({
      scheduleId: data.scheduleId,
      step: step as unknown as StepLike,
    });
  },
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadSchedule(
  db: SupabaseClient<Database>,
  scheduleId: string,
): Promise<ScheduledActionRow | null> {
  const { data, error } = await db
    .from('scheduled_actions')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `fire-scheduled-action: failed to load schedule ${scheduleId}: ${error.message}`,
    );
  }
  return data ?? null;
}

async function markConditionFailed(
  db: SupabaseClient<Database>,
  scheduleId: string,
  reason: string,
  now: Date,
): Promise<void> {
  const { error } = await db
    .from('scheduled_actions')
    .update({
      status: 'condition_failed',
      condition_failure_reason: reason,
      updated_at: now.toISOString(),
    })
    .eq('id', scheduleId);
  if (error) {
    throw new Error(
      `fire-scheduled-action: failed to mark schedule ${scheduleId} condition_failed: ${error.message}`,
    );
  }
}

async function markFired(
  db: SupabaseClient<Database>,
  scheduleId: string,
  proposalId: string | null,
  now: Date,
): Promise<void> {
  const { error } = await db
    .from('scheduled_actions')
    .update({
      status: 'fired',
      fired_at: now.toISOString(),
      fired_proposal_id: proposalId,
      updated_at: now.toISOString(),
    })
    .eq('id', scheduleId);
  if (error) {
    throw new Error(
      `fire-scheduled-action: failed to mark schedule ${scheduleId} fired: ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Row → ScheduledAction mapper
// ---------------------------------------------------------------------------

const VALID_ACTION_TYPES = new Set<string>(WORKER_ACTION_TYPES);
const VALID_STATUSES = new Set<string>([
  'scheduled',
  'fired',
  'condition_failed',
  'cancelled',
  'expired',
]);

/**
 * Map a snake_case Postgres row into the camel-case ScheduledAction
 * shape the rest of the scheduling subsystem consumes. Throws on
 * unknown action_type or status — those would mean the row was
 * mutated outside the schema's CHECK constraints, which is an
 * operational bug worth surfacing.
 */
export function rowToScheduledAction(row: ScheduledActionRow): ScheduledAction {
  if (!VALID_ACTION_TYPES.has(row.action_type)) {
    throw new Error(
      `fire-scheduled-action: unknown action_type "${row.action_type}" on schedule ${row.id}`,
    );
  }
  if (!VALID_STATUSES.has(row.status)) {
    throw new Error(
      `fire-scheduled-action: unknown status "${row.status}" on schedule ${row.id}`,
    );
  }

  // The condition column is freeform JSON in the DB; the dispatcher
  // narrowed it to ScheduledCondition at write time. We trust that
  // narrowing — evaluateCondition will reject any malformed shape.
  const condition = (row.condition as ScheduledCondition | null) ?? null;

  // actionPayload is also JSON; per-action_type shape was validated at
  // schedule time. Pass through as Record<string, unknown> for the
  // ScheduledAction interface.
  const actionPayload = (row.action_payload as Record<string, unknown>) ?? {};

  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    userId: row.user_id,
    triggerAt: row.trigger_at,
    condition,
    conditionText: row.condition_text,
    actionType: row.action_type as WorkerActionType,
    actionPayload,
    actionText: row.action_text,
    status: row.status as ScheduledAction['status'],
    firedAt: row.fired_at,
    firedProposalId: row.fired_proposal_id,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    conditionFailureReason: row.condition_failure_reason,
    inngestEventId: row.inngest_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
