/**
 * run-executor — drives one durable `agent_runs` row to completion.
 *
 * Phase B of the reliability plan: the dispatcher no longer lives inside
 * an HTTP request. A surface (web chat route, iMessage webhook) inserts
 * an `agent_runs(status='queued')` row + fires the
 * `odesa/operator-run.requested` Inngest event; the Inngest function
 * calls `executeAgentRun(runId)` here.
 *
 * Lifecycle of one run:
 *
 *   1. CLAIM — atomic conditional update `queued → running` (RETURNING).
 *      No row claimed → another delivery already owns this run (Inngest
 *      duplicate delivery, manual replay) → `{kind:'skipped'}`.
 *   2. HEARTBEAT — a 10s interval bumps `heartbeat_at` while the
 *      dispatcher runs, so the watchdog can tell "slow" from "dead".
 *   3. DRIVE — `runOperatorDispatcher` with the row's pre-minted
 *      `turn_id` and a 4-minute AbortController (stays under the
 *      Inngest route's maxDuration=300). Events reduce via the same
 *      `reduceEvent`/`composeReply` helpers the iMessage webhook used.
 *   4. iMessage surface — typing loop while driving; the composed reply
 *      is sent to `reply_to_e164` via `sendImessageReply`.
 *   5. FINALIZE — fenced conditional update `running → done` (or
 *      `running → failed` on throw, and on the 4-minute timeout —
 *      the abort surfaces as a tool.error event inside the dispatcher,
 *      so we check `controller.signal.aborted` explicitly and stamp
 *      `error='timeout_4m'` while persisting the partial reply_text).
 *      The `status='running'` fence means
 *      a run the watchdog already failed must no-op here — the watchdog
 *      owns the row once it intervenes ({kind:'superseded'}).
 *
 * Failed iMessage runs get ONE apology text, guarded by
 * `error_notified_at` (stamped only after the apology actually sent, so
 * a failed apology leaves the watchdog free to notify instead).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/admin";
import { runOperatorDispatcher } from "@/lib/agent/operator/dispatcher";
import {
  sendImessageReply,
  startTypingLoop,
} from "@/lib/agent/operator/imessage";
import {
  composeReply,
  reduceEvent,
} from "@/lib/messaging/handle-operator-inbound";
import type { DispatcherChannel } from "@/lib/agent/operator/types";
import {
  DURABLE_RUN_FAILURE_REPLY,
  persistCanonicalAssistantTurn,
} from "@/lib/agent/operator/run-projection";

export type AgentRunRow = Database["public"]["Tables"]["agent_runs"]["Row"];

const RUN_TIMEOUT_MS = 4 * 60_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const IMESSAGE_APOLOGY = "That didn't go through on my end — mind resending?";

class DurableRunWriteError extends Error {
  override readonly name = "DurableRunWriteError";
}

export interface ExecuteAgentRunDeps {
  /** Service-role client. Defaults to a fresh `createAdminClient()`. */
  db?: SupabaseClient<Database>;
  /** Hook for tests; defaults to the real dispatcher generator. */
  runDispatcherImpl?: typeof runOperatorDispatcher;
  /** Hook for tests; defaults to the real Sendblue send helper. */
  sendImessageReplyImpl?: typeof sendImessageReply;
  /** Hook for tests; defaults to the real typing loop. */
  startTypingLoopImpl?: typeof startTypingLoop;
  /** Clock — defaults to real `new Date()`. */
  now?: () => Date;
  /** Override the 4-minute dispatcher abort for tests. */
  timeoutMs?: number;
  /** Override the 10s heartbeat cadence for tests. */
  heartbeatIntervalMs?: number;
}

export type ExecuteAgentRunOutcome =
  /** Claim missed: duplicate delivery / replay — another execution owns it. */
  | { kind: "skipped"; reason: "not_claimed" }
  /** Finalize fence missed: the watchdog failed this run while we ran. */
  | { kind: "superseded"; runId: string }
  | { kind: "done"; runId: string; replyText: string }
  | { kind: "failed"; runId: string; error: string };

/**
 * Execute one queued agent run end-to-end. Returns a discriminated
 * outcome; throws only on claim-query infrastructure failure (so
 * Inngest surfaces it — with retries:0 the row simply stays `queued`
 * for the watchdog to flag).
 */
export async function executeAgentRun(
  runId: string,
  deps: ExecuteAgentRunDeps = {},
): Promise<ExecuteAgentRunOutcome> {
  const db = deps.db ?? createAdminClient();
  const now = deps.now ?? ((): Date => new Date());
  const timeoutMs = deps.timeoutMs ?? RUN_TIMEOUT_MS;
  const heartbeatIntervalMs = deps.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  // ---- 1. Atomic claim: queued → running. ----
  const claimedAt = now().toISOString();
  const { data: run, error: claimError } = await db
    .from("agent_runs")
    .update({
      status: "running",
      started_at: claimedAt,
      heartbeat_at: claimedAt,
    })
    .eq("id", runId)
    .eq("status", "queued")
    .select()
    .maybeSingle();
  if (claimError) {
    throw new Error(
      `run-executor: claim failed for run ${runId}: ${claimError.message}`,
    );
  }
  if (!run) {
    return { kind: "skipped", reason: "not_claimed" };
  }

  const isImessage =
    run.surface === "imessage" &&
    typeof run.reply_to_e164 === "string" &&
    run.reply_to_e164.length > 0;
  const replyToE164 = run.reply_to_e164 ?? "";

  // ---- 2. Heartbeat + 4-minute abort. ----
  const controller = new AbortController();
  let resolveTimeout: (() => void) | null = null;
  const timeoutReached = new Promise<void>((resolve) => {
    resolveTimeout = resolve;
  });
  const timeoutTimer = setTimeout(() => {
    controller.abort(new Error(`run timed out after ${timeoutMs}ms`));
    resolveTimeout?.();
  }, timeoutMs);

  const beat = async (): Promise<void> => {
    const { error } = await db
      .from("agent_runs")
      .update({ heartbeat_at: now().toISOString() })
      .eq("id", runId)
      .eq("status", "running");
    if (error) {
      console.error(
        `[run-executor] heartbeat failed for run ${runId}: ${error.message}`,
      );
    }
  };
  const heartbeatTimer = setInterval(() => {
    void beat().catch(() => undefined);
  }, heartbeatIntervalMs);

  // ---- 3. Typing loop (iMessage only). ----
  const startTyping = deps.startTypingLoopImpl ?? startTypingLoop;
  const stopTyping = isImessage
    ? startTyping({ organizationId: run.organization_id, toE164: replyToE164 })
    : (): void => undefined;

  const sendReply = deps.sendImessageReplyImpl ?? sendImessageReply;
  const runDispatcher = deps.runDispatcherImpl ?? runOperatorDispatcher;
  const actions: string[] = [];
  let sawCommittedProposal = false;
  let sawReviewProposal = false;

  /**
   * Fenced `running → failed` finalize + the one-shot iMessage apology.
   * Shared by the throw path and the timeout path. `replyText` is
   * persisted when provided so partial work stays visible on the row.
   */
  const finalizeOwnedRunAsFailed = async (
    expectedStatus: "running" | "done",
    errorMessage: string,
    safeReplyText: string = DURABLE_RUN_FAILURE_REPLY,
  ): Promise<ExecuteAgentRunOutcome> => {
    const patch: Database["public"]["Tables"]["agent_runs"]["Update"] = {
      status: "failed",
      error: errorMessage,
      finished_at: now().toISOString(),
      reply_text: safeReplyText,
    };

    // Same fence as the done path: only the execution that still owns
    // the 'running' row may stamp 'failed' (and notify the operator).
    const { data: failed, error: failError } = await db
      .from("agent_runs")
      .update(patch)
      .eq("id", runId)
      .eq("status", expectedStatus)
      .select()
      .maybeSingle();
    if (failError) {
      throw new DurableRunWriteError(
        `run-executor: failure finalize failed for run ${runId}: ${failError.message}`,
      );
    }
    if (!failed) {
      return { kind: "superseded", runId };
    }

    try {
      await persistCanonicalAssistantTurn(db, run, safeReplyText);
    } catch (persistErr) {
      // agent_runs.reply_text remains the durable terminal evidence and the
      // active client reads it directly. Log projection failure for repair;
      // never turn the durable row back into a fabricated success.
      console.error(
        `[run-executor] failed-reply projection failed for run ${runId}: ${errMessage(persistErr)}`,
      );
    }

    if (failed && isImessage && !failed.error_notified_at) {
      try {
        await sendReply({
          organizationId: run.organization_id,
          toE164: replyToE164,
          text: IMESSAGE_APOLOGY,
          idempotencyKey: `agent-run:${runId}:apology`,
        });
        await db
          .from("agent_runs")
          .update({ error_notified_at: now().toISOString() })
          .eq("id", runId);
      } catch (notifyErr) {
        // Leave error_notified_at null — the watchdog may notify instead.
        console.error(
          `[run-executor] apology send failed for run ${runId}: ${errMessage(notifyErr)}`,
        );
      }
    }

    return { kind: "failed", runId, error: errorMessage };
  };

  const finalizeFailed = (
    errorMessage: string,
    safeReplyText: string = DURABLE_RUN_FAILURE_REPLY,
  ): Promise<ExecuteAgentRunOutcome> =>
    finalizeOwnedRunAsFailed("running", errorMessage, safeReplyText);

  try {
    // ---- 4. Drive the dispatcher with the pre-minted turn id. ----
    const sendInline = isImessage
      ? (text: string): Promise<void> =>
          sendReply({
            organizationId: run.organization_id,
            toE164: replyToE164,
            text,
            idempotencyKey: `agent-run:${runId}:inline`,
          })
      : undefined;

    let narrative = "";
    let dispatcherFailure: string | null = null;
    const dispatcher = runDispatcher({
      admin: db,
      organizationId: run.organization_id,
      userId: run.user_id,
      chatId: run.chat_id,
      propertyHint: parsePropertyHint(run.property_hint),
      message: run.message,
      channel: run.channel as DispatcherChannel,
      sendInline,
      signal: controller.signal,
      turnId: run.turn_id,
      userTurnPersisted: true,
    });
    const iterator = dispatcher[Symbol.asyncIterator]();

    // Race iterator progress against the hard deadline. AbortController alone
    // is cooperative; a provider or local tool that ignores it must not keep
    // the durable row `running` forever (and keep its heartbeat fresh enough
    // to evade the watchdog).
    while (true) {
      const next = await Promise.race([
        iterator.next().then((step) => ({ kind: "step" as const, step })),
        timeoutReached.then(() => ({ kind: "timeout" as const })),
      ]);

      if (next.kind === "timeout") {
        const close = iterator.return?.(undefined);
        if (close) {
          // Never await a potentially hung provider's cleanup. The run-status
          // fence prevents any late producer from turning this failure into
          // success, while the catch avoids an unhandled rejection.
          void Promise.resolve(close).catch(() => undefined);
        }
        return await finalizeFailed(
          "timeout_4m",
          failureReply(actions, sawCommittedProposal),
        );
      }

      if (next.step.done) break;
      const event = next.step.value;
      if (event.type === "tool.error" && dispatcherFailure === null) {
        // The real dispatcher converts provider/tool exceptions into events
        // instead of throwing. Preserve the first failure as durable run
        // evidence so a trailing `done` event can never become false success.
        dispatcherFailure = `${event.name}: ${event.message}`;
      }
      if (event.type === "proposal.committed") sawCommittedProposal = true;
      if (event.type === "proposal.review_required") sawReviewProposal = true;
      reduceEvent(
        event,
        (chunk) => {
          narrative += chunk;
        },
        (line) => {
          actions.push(line);
        },
      );
    }

    const replyText = composeReply(
      proposalOutcomeNarrative({
        modelNarrative: narrative,
        sawCommittedProposal,
        sawReviewProposal,
      }),
      actions,
    );

    // ---- 4b. Timed-out runs finalize failed, not done. ----
    // The 4-minute abort surfaces as a tool.error event inside the
    // dispatcher (which never throws), so the generator completes
    // normally and we'd otherwise stamp 'done' with a ⚠ line buried in
    // reply_text. The timeout timer is the only abort source here.
    // reply_text is still persisted so partial work stays visible; on
    // iMessage the operator gets the apology, not a half-finished reply.
    if (controller.signal.aborted) {
      return await finalizeFailed(
        "timeout_4m",
        failureReply(actions, sawCommittedProposal),
      );
    }

    if (dispatcherFailure !== null) {
      return await finalizeFailed(
        `dispatcher_error: ${dispatcherFailure}`,
        failureReply(actions, sawCommittedProposal),
      );
    }

    // A provider stream that terminates without any assistant text or
    // deterministic proposal outcome is malformed/unavailable, not a valid
    // empty answer. Persist failure so the UI recovers instead of completing
    // an empty bubble.
    if (replyText.trim().length === 0) {
      return await finalizeFailed(
        "empty_dispatcher_reply",
        failureReply(actions, sawCommittedProposal),
      );
    }

    // ---- 5. Fenced ownership: running → done. ----
    // Establish the winning durable verdict before projecting or sending the
    // completion. If the watchdog already failed this run, no late provider
    // text can overwrite that failure or escape as an iMessage.
    const { data: finalized, error: finalizeError } = await db
      .from("agent_runs")
      .update({
        status: "done",
        reply_text: replyText,
        finished_at: now().toISOString(),
      })
      .eq("id", runId)
      .eq("status", "running")
      .select()
      .maybeSingle();
    if (finalizeError) {
      throw new DurableRunWriteError(
        `run-executor: finalize failed for run ${runId}: ${finalizeError.message}`,
      );
    }
    if (!finalized) {
      // The watchdog already moved this row off 'running' — its verdict
      // stands; do not overwrite.
      console.warn(
        `[run-executor] run ${runId} finalize fenced out (watchdog won)`,
      );
      return { kind: "superseded", runId };
    }

    try {
      // Deterministic proposal lines are the canonical assistant completion,
      // not transient transport decoration. Replace raw model-only text only
      // after this executor owns the terminal status fence.
      await persistCanonicalAssistantTurn(db, run, replyText);

      if (isImessage && replyText.length > 0) {
        await sendReply({
          organizationId: run.organization_id,
          toE164: replyToE164,
          text: replyText,
          idempotencyKey: `agent-run:${runId}:final`,
        });
      }
    } catch (completionError) {
      return await finalizeOwnedRunAsFailed(
        "done",
        `completion delivery failed: ${errMessage(completionError)}`,
        failureReply(actions, sawCommittedProposal),
      );
    }

    return { kind: "done", runId, replyText };
  } catch (err) {
    if (err instanceof DurableRunWriteError) throw err;
    return await finalizeFailed(
      errMessage(err),
      failureReply(actions, sawCommittedProposal),
    );
  } finally {
    stopTyping();
    clearInterval(heartbeatTimer);
    clearTimeout(timeoutTimer);
  }
}

function failureReply(
  actions: readonly string[],
  sawCommittedProposal: boolean,
): string {
  const narrative = sawCommittedProposal
    ? "Odesa couldn't finish the full request. The completed records listed below were saved; no other action is shown as completed. Review this thread and Owner Queue before trying again."
    : DURABLE_RUN_FAILURE_REPLY;
  return composeReply(narrative, [...actions]);
}

function proposalOutcomeNarrative(input: {
  modelNarrative: string;
  sawCommittedProposal: boolean;
  sawReviewProposal: boolean;
}): string {
  if (input.sawReviewProposal && input.sawCommittedProposal) {
    return "I prepared the consequential request for review. Only the completed records listed below were changed.";
  }
  if (input.sawReviewProposal) {
    return "I prepared this request for review. No consequential action was completed.";
  }
  if (input.sawCommittedProposal) {
    return "The completed operation is listed below.";
  }
  return input.modelNarrative;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Narrow the `property_hint` jsonb snapshot back into the dispatcher's
 * `{id, name}` hint shape. Anything malformed → undefined (the
 * dispatcher recovers without the hint).
 */
export function parsePropertyHint(
  value: unknown,
): { id: string; name: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (
    typeof rec["id"] === "string" &&
    rec["id"].length > 0 &&
    typeof rec["name"] === "string" &&
    rec["name"].length > 0
  ) {
    return { id: rec["id"], name: rec["name"] };
  }
  return undefined;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
