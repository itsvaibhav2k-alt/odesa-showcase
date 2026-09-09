/**
 * agent-run-watchdog — every-2-minutes sweep over the durable-run and
 * reconciliation state machines (Phase B of the reliability plan).
 *
 * Buckets (each its own step.run; every UPDATE is conditional and
 * therefore idempotent — a re-run or an overlapping sweep is harmless):
 *
 *   1. fail-stale-heartbeats — `running` rows whose heartbeat_at is
 *      older than 90s → failed('heartbeat_stale'). The executor beats
 *      every 10s, so 90s of silence means the process died (or stalled
 *      so hard the watchdog should own the verdict). The `WHERE
 *      status='running'` fence pairs with the executor's fenced
 *      finalize: whoever updates first wins, the loser no-ops.
 *   2. fail-never-started — `queued` rows older than 10 minutes →
 *      failed('never_started'). The Inngest event was lost or the
 *      executor never claimed; with retries:0 nothing else will.
 *   3. notify-failed-imessage — failed iMessage runs with
 *      error_notified_at IS NULL get ONE "mind sending it again?"
 *      text to reply_to_e164, then the stamp. Send-then-stamp matches
 *      the executor's apology path: a failed send leaves the stamp
 *      null so the next sweep retries the notification.
 *   4. flag-stuck-committing / flag-stuck-sending — action_proposals
 *      stuck at 'committing' and messages stuck at draft_status
 *      'sending' for >2 minutes are the A2 fail-closed reconciliation
 *      states. We log + Sentry-flag them for a human — we can't know
 *      whether the side effect (the provider send) fired, so a blind
 *      retry could double-send. NEVER auto-retry these.
 *
 * Failed runs are never auto-replayed — replay is the human re-sending
 * their message, guarded by visible audit state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";

import type { Database } from "@/types/database";
import { inngest } from "@/lib/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendImessageReply } from "@/lib/agent/operator/imessage";
import {
  DURABLE_RUN_FAILURE_REPLY,
  persistCanonicalAssistantTurn,
  type RunTurnProjection,
} from "@/lib/agent/operator/run-projection";

export const AGENT_RUN_WATCHDOG_FN_ID = "agent-run-watchdog";
export const AGENT_RUN_WATCHDOG_CRON = "*/2 * * * *";

/** Executor beats every 10s; 90s of silence = dead process. */
const HEARTBEAT_STALE_MS = 90_000;
/** A queued row the executor never claimed within 10 minutes is lost. */
const QUEUED_STALE_MS = 10 * 60_000;
/** committing/sending rows older than this need a human eyeball. */
const RECONCILIATION_STALE_MS = 2 * 60_000;
/** Bound the per-sweep notification fan-out. */
const NOTIFY_BATCH_LIMIT = 25;

export const WATCHDOG_APOLOGY =
  "That didn't go through — mind sending it again?";

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

export interface AgentRunWatchdogDeps {
  /** Service-role client. Defaults to a fresh `createAdminClient()`. */
  db?: SupabaseClient<Database>;
  /** Hook for tests; defaults to the real Sendblue send helper. */
  sendImessageReplyImpl?: typeof sendImessageReply;
  /** Hook for tests; defaults to `Sentry.captureMessage(..., 'warning')`. */
  captureMessageImpl?: (message: string) => void;
  /** Clock — defaults to real `new Date()`. */
  now?: () => Date;
  /** Test hook for the refresh-safe assistant failure projection. */
  persistCanonicalAssistantTurnImpl?: typeof persistCanonicalAssistantTurn;
}

export interface AgentRunWatchdogInput {
  step: StepLike;
  deps?: AgentRunWatchdogDeps;
}

export interface AgentRunWatchdogOutcome {
  heartbeatStaleFailed: number;
  neverStartedFailed: number;
  errorNotified: number;
  stuckCommitting: number;
  stuckSending: number;
}

/**
 * One full watchdog sweep. Returns per-bucket counts the caller (the
 * Inngest wrapper or a test) can assert on. Throws only when a bucket's
 * query itself fails — the conditional updates make a partial sweep +
 * retry safe.
 */
export async function runAgentRunWatchdog(
  input: AgentRunWatchdogInput,
): Promise<AgentRunWatchdogOutcome> {
  const { step } = input;
  const deps = input.deps ?? {};
  const db = deps.db ?? createAdminClient();
  const send = deps.sendImessageReplyImpl ?? sendImessageReply;
  const capture =
    deps.captureMessageImpl ??
    ((message: string): void => {
      Sentry.captureMessage(message, "warning");
    });
  const now = deps.now ?? ((): Date => new Date());
  const persistFailureProjection =
    deps.persistCanonicalAssistantTurnImpl ?? persistCanonicalAssistantTurn;

  // ---- Bucket 1: running + stale heartbeat → failed('heartbeat_stale').
  const heartbeatStaleFailed = await step.run(
    "fail-stale-heartbeats",
    async (): Promise<number> => {
      const cutoff = new Date(
        now().getTime() - HEARTBEAT_STALE_MS,
      ).toISOString();
      const { data, error } = await db
        .from("agent_runs")
        .update({
          status: "failed",
          error: "heartbeat_stale",
          reply_text: DURABLE_RUN_FAILURE_REPLY,
          finished_at: now().toISOString(),
        })
        .eq("status", "running")
        .lt("heartbeat_at", cutoff)
        .select("id, organization_id, chat_id, turn_id");
      if (error) {
        throw new Error(
          `agent-run-watchdog: stale-heartbeat sweep failed: ${error.message}`,
        );
      }
      const failed = data ?? [];
      for (const row of failed) {
        console.error(
          `[agent-run-watchdog] run ${row.id} failed: heartbeat stale >90s`,
        );
        if (isRunTurnProjection(row)) {
          try {
            await persistFailureProjection(db, row, DURABLE_RUN_FAILURE_REPLY);
          } catch (err) {
            capture(
              `agent-run-watchdog: failed to project stale run ${row.id}: ${errMessage(err)}`,
            );
          }
        }
      }
      return failed.length;
    },
  );

  // ---- Bucket 2: queued >10 min → failed('never_started').
  const neverStartedFailed = await step.run(
    "fail-never-started",
    async (): Promise<number> => {
      const cutoff = new Date(now().getTime() - QUEUED_STALE_MS).toISOString();
      const { data, error } = await db
        .from("agent_runs")
        .update({
          status: "failed",
          error: "never_started",
          reply_text: DURABLE_RUN_FAILURE_REPLY,
          finished_at: now().toISOString(),
        })
        .eq("status", "queued")
        .lt("created_at", cutoff)
        .select("id, organization_id, chat_id, turn_id");
      if (error) {
        throw new Error(
          `agent-run-watchdog: never-started sweep failed: ${error.message}`,
        );
      }
      const failed = data ?? [];
      for (const row of failed) {
        console.error(
          `[agent-run-watchdog] run ${row.id} failed: never started within 10m`,
        );
        if (isRunTurnProjection(row)) {
          try {
            await persistFailureProjection(db, row, DURABLE_RUN_FAILURE_REPLY);
          } catch (err) {
            capture(
              `agent-run-watchdog: failed to project never-started run ${row.id}: ${errMessage(err)}`,
            );
          }
        }
      }
      return failed.length;
    },
  );

  // ---- Bucket 3: failed iMessage runs → ONE apology, then the stamp.
  const errorNotified = await step.run(
    "notify-failed-imessage",
    async (): Promise<number> => {
      const { data, error } = await db
        .from("agent_runs")
        .select("id, organization_id, reply_to_e164")
        .eq("status", "failed")
        .eq("surface", "imessage")
        .is("error_notified_at", null)
        .not("reply_to_e164", "is", null)
        .limit(NOTIFY_BATCH_LIMIT);
      if (error) {
        throw new Error(
          `agent-run-watchdog: notify query failed: ${error.message}`,
        );
      }

      let notified = 0;
      for (const run of data ?? []) {
        if (!run.reply_to_e164) continue;
        try {
          await send({
            organizationId: run.organization_id,
            toE164: run.reply_to_e164,
            text: WATCHDOG_APOLOGY,
            idempotencyKey: `agent-run:${run.id}:apology`,
          });
        } catch (err) {
          // Stamp stays null → the next sweep retries the notification.
          console.error(
            `[agent-run-watchdog] apology send failed for run ${run.id}: ${errMessage(err)}`,
          );
          continue;
        }
        const { error: stampError } = await db
          .from("agent_runs")
          .update({ error_notified_at: now().toISOString() })
          .eq("id", run.id)
          .is("error_notified_at", null);
        if (stampError) {
          // Apology DID send; an unstamped row risks a duplicate next
          // sweep — log loudly so a repeat has a paper trail.
          console.error(
            `[agent-run-watchdog] apology sent but stamp failed for run ${run.id}: ${stampError.message}`,
          );
          continue;
        }
        notified += 1;
      }
      return notified;
    },
  );

  // ---- Bucket 4a: proposals stuck at 'committing' >2 min (visibility only).
  // action_proposals has no updated_at; the CAS claim to 'committing'
  // happens moments after creation, so created_at is a sound staleness
  // proxy. Read-only: stuck rows mean "verify with the tenant before
  // resending" — auto-retry could double-send.
  const reconciliationCutoff = new Date(
    now().getTime() - RECONCILIATION_STALE_MS,
  ).toISOString();

  const stuckCommitting = await step.run(
    "flag-stuck-committing",
    async (): Promise<number> => {
      const { data, error } = await db
        .from("action_proposals")
        .select("id, organization_id, action_type")
        .eq("status", "committing")
        .lt("created_at", reconciliationCutoff);
      if (error) {
        throw new Error(
          `agent-run-watchdog: stuck-committing query failed: ${error.message}`,
        );
      }
      const rows = data ?? [];
      if (rows.length > 0) {
        const detail = rows.map((r) => `${r.id} (${r.action_type})`).join(", ");
        const message =
          `[agent-run-watchdog] ${rows.length} action_proposal(s) stuck at ` +
          `'committing' >2m — needs manual reconciliation, do NOT blind-retry: ${detail}`;
        console.error(message);
        capture(message);
      }
      return rows.length;
    },
  );

  // ---- Bucket 4b: messages stuck at draft_status 'sending' >2 min.
  const stuckSending = await step.run(
    "flag-stuck-sending",
    async (): Promise<number> => {
      const { data, error } = await db
        .from("messages")
        .select("id, organization_id, conversation_id")
        .eq("draft_status", "sending")
        .lt("created_at", reconciliationCutoff);
      if (error) {
        throw new Error(
          `agent-run-watchdog: stuck-sending query failed: ${error.message}`,
        );
      }
      const rows = data ?? [];
      if (rows.length > 0) {
        const detail = rows.map((r) => r.id).join(", ");
        const message =
          `[agent-run-watchdog] ${rows.length} message(s) stuck at ` +
          `'sending' >2m — provider send state unknown, verify before resending: ${detail}`;
        console.error(message);
        capture(message);
      }
      return rows.length;
    },
  );

  return {
    heartbeatStaleFailed,
    neverStartedFailed,
    errorNotified,
    stuckCommitting,
    stuckSending,
  };
}

function isRunTurnProjection(
  value: unknown,
): value is RunTurnProjection & { id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row["id"] === "string" &&
    typeof row["chat_id"] === "string" &&
    typeof row["organization_id"] === "string" &&
    typeof row["turn_id"] === "string"
  );
}

// ---------------------------------------------------------------------------
// Inngest function — thin wrapper around runAgentRunWatchdog
// ---------------------------------------------------------------------------

export const agentRunWatchdogCron = inngest.createFunction(
  {
    id: AGENT_RUN_WATCHDOG_FN_ID,
    triggers: [{ cron: AGENT_RUN_WATCHDOG_CRON }],
  },
  async ({ step }) => {
    return runAgentRunWatchdog({ step: step as unknown as StepLike });
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
