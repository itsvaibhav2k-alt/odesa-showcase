/**
 * run-operator-dispatcher — durable execution shell for operator runs.
 *
 * A surface (web chat route / iMessage webhook) inserts an
 * `agent_runs(status='queued')` row, then sends the
 * `odesa/operator-run.requested` event with `{ runId, chatId }`.
 * `chatId` MUST be included at send time — it feeds the concurrency key
 * so at most one run executes per chat (mirrors the DB-level partial
 * unique index on `agent_runs(chat_id) WHERE status IN ('queued','running')`).
 *
 * Deliberate choices:
 *   - `retries: 0` — the executor's side effects (model calls, tool
 *     commits, outbound sends) are NOT idempotent; the retry unit is
 *     the human re-sending their message. Failed runs surface via the
 *     watchdog + visible audit state, never auto-replay.
 *   - single `step.run('execute')` — the executor owns its own
 *     claim/heartbeat/fenced-finalize lifecycle; splitting it into
 *     Inngest steps would re-introduce partial-replay hazards.
 */

import { inngestOperatorWorker } from '@/lib/inngest/client';
import {
  RUN_OPERATOR_DISPATCHER_EVENT,
  RUN_OPERATOR_DISPATCHER_FN_ID,
  type RunOperatorDispatcherEventData,
} from '@/lib/inngest/events';
import {
  executeAgentRun,
  type ExecuteAgentRunOutcome,
} from '@/lib/agent/operator/run-executor';

// Event name / fn id / event-data type live in the dependency-free
// `@/lib/inngest/events` so Vercel-side senders can import them without
// pulling the Agent SDK chain. Re-exported here for compat.
export {
  RUN_OPERATOR_DISPATCHER_EVENT,
  RUN_OPERATOR_DISPATCHER_FN_ID,
  type RunOperatorDispatcherEventData,
} from '@/lib/inngest/events';

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
}

export interface RunOperatorDispatcherJobDeps {
  /** Hook for tests; defaults to the real `executeAgentRun`. */
  executeAgentRunImpl?: typeof executeAgentRun;
}

export interface RunOperatorDispatcherJobInput {
  runId: string;
  step: StepLike;
  deps?: RunOperatorDispatcherJobDeps;
}

/**
 * Drive one queued run inside a single Inngest step. The executor owns
 * all lifecycle semantics (claim, heartbeat, fenced finalize); this
 * wrapper only provides the durable execution slot.
 */
export async function runOperatorDispatcherJob(
  input: RunOperatorDispatcherJobInput,
): Promise<ExecuteAgentRunOutcome> {
  const execute = input.deps?.executeAgentRunImpl ?? executeAgentRun;
  return input.step.run('execute', () => execute(input.runId));
}

// ---------------------------------------------------------------------------
// Inngest function — thin wrapper around runOperatorDispatcherJob
// ---------------------------------------------------------------------------

export const runOperatorDispatcherFn = inngestOperatorWorker.createFunction(
  {
    id: RUN_OPERATOR_DISPATCHER_FN_ID,
    retries: 0,
    concurrency: { key: 'event.data.chatId', limit: 1 },
    triggers: [{ event: RUN_OPERATOR_DISPATCHER_EVENT }],
  },
  async ({ event, step }) => {
    const data = event.data as Partial<RunOperatorDispatcherEventData>;
    if (!data?.runId || typeof data.runId !== 'string') {
      return { kind: 'skipped', reason: 'missing_run_id' };
    }

    return runOperatorDispatcherJob({
      runId: data.runId,
      step: step as unknown as StepLike,
    });
  },
);
