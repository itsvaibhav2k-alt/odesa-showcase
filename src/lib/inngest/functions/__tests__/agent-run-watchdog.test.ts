/**
 * Unit tests for the agent-run-watchdog Inngest cron.
 *
 * Mirrors the fire-scheduled-action / run-operator-dispatcher test
 * surfaces: a registration smoke (id + cron trigger) plus the pure
 * runner `runAgentRunWatchdog` driven against a StepLike stub and a
 * recording db stub. Buckets under test:
 *   1. stale heartbeat → failed('heartbeat_stale') via conditional
 *      update; fresh heartbeats live behind the WHERE cutoff.
 *   2. queued >10m → failed('never_started').
 *   3. failed iMessage runs: ONE apology, stamped with a null-guard;
 *      send failure leaves the stamp null for the next sweep.
 *   4. stuck 'committing' proposals / 'sending' messages: logged +
 *      Sentry-flagged, NEVER mutated.
 */

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { sendImessageReply } from "@/lib/agent/operator/imessage";
import {
  agentRunWatchdogCron,
  runAgentRunWatchdog,
  AGENT_RUN_WATCHDOG_CRON,
  AGENT_RUN_WATCHDOG_FN_ID,
  WATCHDOG_APOLOGY,
  type StepLike,
} from "../agent-run-watchdog";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-10T12:00:00.000Z");
const HEARTBEAT_CUTOFF = "2026-06-10T11:58:30.000Z"; // now - 90s
const QUEUED_CUTOFF = "2026-06-10T11:50:00.000Z"; // now - 10m
const RECONCILE_CUTOFF = "2026-06-10T11:58:00.000Z"; // now - 2m
const E164 = "+15555550100";

// ---------------------------------------------------------------------------
// db stub — records every terminated query; a responder supplies results
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: string;
  op: "update" | "select";
  patch: Record<string, unknown> | null;
  /** Filter calls in order: ['eq'|'lt'|'is', col, val] / ['not', col, op, val]. */
  filters: Array<[string, ...unknown[]]>;
}

type Responder = (q: RecordedQuery) => {
  data: unknown;
  error: { message: string } | null;
};

function makeDb(
  recorded: RecordedQuery[],
  respond: Responder,
): SupabaseClient<Database> {
  return {
    from: vi.fn((table: string) => {
      const q: RecordedQuery = {
        table,
        op: "select",
        patch: null,
        filters: [],
      };
      const builder: Record<string, unknown> = {};
      builder.update = (patch: Record<string, unknown>) => {
        q.op = "update";
        q.patch = patch;
        return builder;
      };
      builder.select = () => builder;
      builder.limit = () => builder;
      builder.eq = (col: string, val: unknown) => {
        q.filters.push(["eq", col, val]);
        return builder;
      };
      builder.lt = (col: string, val: unknown) => {
        q.filters.push(["lt", col, val]);
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        q.filters.push(["is", col, val]);
        return builder;
      };
      builder.not = (col: string, op: string, val: unknown) => {
        q.filters.push(["not", col, op, val]);
        return builder;
      };
      builder.then = (
        fulfilled?: (v: ReturnType<Responder>) => unknown,
      ): Promise<unknown> => {
        recorded.push(q);
        const result = respond(q);
        return Promise.resolve(fulfilled ? fulfilled(result) : result);
      };
      return builder;
    }),
  } as unknown as SupabaseClient<Database>;
}

/** Responder returning empty everywhere except per-table/op overrides. */
function respondWith(
  overrides: Array<{
    table: string;
    op: RecordedQuery["op"];
    data: unknown;
  }> = [],
): Responder {
  return (q) => {
    const hit = overrides.find((o) => o.table === q.table && o.op === q.op);
    return { data: hit ? hit.data : [], error: null };
  };
}

function makeStep(): StepLike & { ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
      ids.push(id);
      return await fn();
    },
  };
}

function makeSendStub(): ReturnType<typeof vi.fn<typeof sendImessageReply>> {
  return vi.fn<typeof sendImessageReply>().mockResolvedValue(undefined);
}

function makeDeps(
  recorded: RecordedQuery[],
  respond: Responder,
  send = makeSendStub(),
  capture = vi.fn<(message: string) => void>(),
) {
  return {
    deps: {
      db: makeDb(recorded, respond),
      sendImessageReplyImpl: send,
      captureMessageImpl: capture,
      now: (): Date => NOW,
    },
    send,
    capture,
  };
}

// ---------------------------------------------------------------------------
// Tests — registration
// ---------------------------------------------------------------------------

describe("agentRunWatchdogCron registration", () => {
  it("exposes the expected id", () => {
    expect(agentRunWatchdogCron.id()).toBe(AGENT_RUN_WATCHDOG_FN_ID);
    expect(AGENT_RUN_WATCHDOG_FN_ID).toBe("agent-run-watchdog");
  });

  it("runs on the every-2-minutes cron", () => {
    const triggers = agentRunWatchdogCron.opts.triggers ?? [];
    const crons = triggers
      .map((t) => ("cron" in t ? t.cron : null))
      .filter(Boolean);
    expect(crons).toContain(AGENT_RUN_WATCHDOG_CRON);
    expect(AGENT_RUN_WATCHDOG_CRON).toBe("*/2 * * * *");
  });
});

// ---------------------------------------------------------------------------
// Tests — sweep shape
// ---------------------------------------------------------------------------

describe("runAgentRunWatchdog", () => {
  it("runs every bucket in its own step, in order", async () => {
    const step = makeStep();
    const { deps } = makeDeps([], respondWith());

    const out = await runAgentRunWatchdog({ step, deps });

    expect(step.ids).toEqual([
      "fail-stale-heartbeats",
      "fail-never-started",
      "notify-failed-imessage",
      "flag-stuck-committing",
      "flag-stuck-sending",
    ]);
    expect(out).toEqual({
      heartbeatStaleFailed: 0,
      neverStartedFailed: 0,
      errorNotified: 0,
      stuckCommitting: 0,
      stuckSending: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — bucket 1: stale heartbeats
// ---------------------------------------------------------------------------

describe("runAgentRunWatchdog stale heartbeats", () => {
  it("flips stale running runs to failed(heartbeat_stale) via a conditional update", async () => {
    const recorded: RecordedQuery[] = [];
    const failedRun = {
      id: "r1",
      organization_id: "org-1",
      chat_id: "chat-1",
      turn_id: "turn-1",
    };
    const { deps } = makeDeps(recorded, (query) => ({
      data:
        query.table === "agent_runs" &&
        query.op === "update" &&
        query.patch?.["error"] === "heartbeat_stale"
          ? [failedRun]
          : [],
      error: null,
    }));
    const persistFailure = vi.fn().mockResolvedValue(undefined);

    const out = await runAgentRunWatchdog({
      step: makeStep(),
      deps: {
        ...deps,
        persistCanonicalAssistantTurnImpl: persistFailure,
      },
    });

    expect(out.heartbeatStaleFailed).toBe(1);
    const sweep = recorded.find(
      (q) => q.op === "update" && q.patch?.["error"] === "heartbeat_stale",
    );
    expect(sweep).toBeDefined();
    expect(sweep!.table).toBe("agent_runs");
    expect(sweep!.patch).toMatchObject({
      status: "failed",
      error: "heartbeat_stale",
      reply_text: expect.stringContaining("couldn't finish this request"),
      finished_at: NOW.toISOString(),
    });
    // Idempotent fence + staleness live in the WHERE clause.
    expect(sweep!.filters).toContainEqual(["eq", "status", "running"]);
    expect(sweep!.filters).toContainEqual([
      "lt",
      "heartbeat_at",
      HEARTBEAT_CUTOFF,
    ]);
    expect(persistFailure).toHaveBeenCalledWith(
      expect.anything(),
      failedRun,
      expect.stringContaining("couldn't finish this request"),
    );
  });

  it("leaves fresh heartbeats untouched — the 90s cutoff excludes them", async () => {
    // The DB enforces freshness via `heartbeat_at < now-90s`; a fresh
    // run simply matches no row. Assert the cutoff is exact and the
    // sweep reports zero.
    const recorded: RecordedQuery[] = [];
    const { deps } = makeDeps(recorded, respondWith());

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.heartbeatStaleFailed).toBe(0);
    const sweep = recorded.find(
      (q) => q.op === "update" && q.patch?.["error"] === "heartbeat_stale",
    );
    expect(sweep!.filters).toContainEqual([
      "lt",
      "heartbeat_at",
      HEARTBEAT_CUTOFF,
    ]);
    // No unconditional update could have touched a fresh row.
    const unconditional = recorded.filter(
      (q) => q.op === "update" && q.filters.length === 0,
    );
    expect(unconditional).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — bucket 2: never started
// ---------------------------------------------------------------------------

describe("runAgentRunWatchdog never started", () => {
  it("fails queued runs older than 10 minutes", async () => {
    const recorded: RecordedQuery[] = [];
    const failedRun = {
      id: "r2",
      organization_id: "org-1",
      chat_id: "chat-1",
      turn_id: "turn-2",
    };
    const { deps } = makeDeps(recorded, (query) => ({
      data:
        query.table === "agent_runs" &&
        query.op === "update" &&
        query.patch?.["error"] === "never_started"
          ? [failedRun]
          : [],
      error: null,
    }));
    const persistFailure = vi.fn().mockResolvedValue(undefined);

    const out = await runAgentRunWatchdog({
      step: makeStep(),
      deps: {
        ...deps,
        persistCanonicalAssistantTurnImpl: persistFailure,
      },
    });

    const sweep = recorded.find(
      (q) => q.op === "update" && q.patch?.["error"] === "never_started",
    );
    expect(sweep).toBeDefined();
    expect(sweep!.patch).toMatchObject({
      status: "failed",
      reply_text: expect.stringContaining("couldn't finish this request"),
    });
    expect(sweep!.filters).toContainEqual(["eq", "status", "queued"]);
    expect(sweep!.filters).toContainEqual(["lt", "created_at", QUEUED_CUTOFF]);
    expect(out.neverStartedFailed).toBe(1);
    expect(persistFailure).toHaveBeenCalledWith(
      expect.anything(),
      failedRun,
      expect.stringContaining("couldn't finish this request"),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests — bucket 3: one-shot apology
// ---------------------------------------------------------------------------

describe("runAgentRunWatchdog failed-run notification", () => {
  const failedRun = {
    id: "r9",
    organization_id: "org-1",
    reply_to_e164: E164,
  };

  it("sends the apology once and stamps error_notified_at with a null-guard", async () => {
    const recorded: RecordedQuery[] = [];
    const { deps, send } = makeDeps(
      recorded,
      respondWith([{ table: "agent_runs", op: "select", data: [failedRun] }]),
    );

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.errorNotified).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      organizationId: "org-1",
      toE164: E164,
      text: WATCHDOG_APOLOGY,
      idempotencyKey: "agent-run:r9:apology",
    });

    const stamp = recorded.find(
      (q) => q.op === "update" && q.patch?.["error_notified_at"] !== undefined,
    );
    expect(stamp).toBeDefined();
    expect(stamp!.table).toBe("agent_runs");
    expect(stamp!.filters).toContainEqual(["eq", "id", "r9"]);
    // Null-guard: a concurrent sweep that already stamped wins.
    expect(stamp!.filters).toContainEqual(["is", "error_notified_at", null]);
  });

  it("does not notify again once error_notified_at is stamped", async () => {
    // After the stamp, the row no longer matches the IS NULL filter —
    // the select comes back empty and no send fires.
    const recorded: RecordedQuery[] = [];
    const { deps, send } = makeDeps(recorded, respondWith());

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.errorNotified).toBe(0);
    expect(send).not.toHaveBeenCalled();
    const notifySelect = recorded.find(
      (q) =>
        q.table === "agent_runs" &&
        q.op === "select" &&
        q.filters.some(([kind, col]) => kind === "eq" && col === "surface"),
    );
    expect(notifySelect).toBeDefined();
    expect(notifySelect!.filters).toContainEqual([
      "is",
      "error_notified_at",
      null,
    ]);
    expect(notifySelect!.filters).toContainEqual(["eq", "status", "failed"]);
    expect(notifySelect!.filters).toContainEqual(["eq", "surface", "imessage"]);
  });

  it("leaves the stamp null when the apology send fails (next sweep retries)", async () => {
    const recorded: RecordedQuery[] = [];
    const send = makeSendStub();
    send.mockRejectedValue(new Error("sendblue 503"));
    const { deps } = makeDeps(
      recorded,
      respondWith([{ table: "agent_runs", op: "select", data: [failedRun] }]),
      send,
    );

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.errorNotified).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const stamp = recorded.find(
      (q) => q.op === "update" && q.patch?.["error_notified_at"] !== undefined,
    );
    expect(stamp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — bucket 4: reconciliation visibility (read-only)
// ---------------------------------------------------------------------------

describe("runAgentRunWatchdog reconciliation flags", () => {
  it("logs + Sentry-flags stuck committing proposals without mutating them", async () => {
    const recorded: RecordedQuery[] = [];
    const { deps, capture } = makeDeps(
      recorded,
      respondWith([
        {
          table: "action_proposals",
          op: "select",
          data: [
            {
              id: "p1",
              organization_id: "org-1",
              action_type: "send_tenant_message",
            },
          ],
        },
      ]),
    );

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.stuckCommitting).toBe(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const message = capture.mock.calls[0]![0];
    expect(message).toContain("'committing'");
    expect(message).toContain("p1");

    const proposalQueries = recorded.filter(
      (q) => q.table === "action_proposals",
    );
    expect(proposalQueries).toHaveLength(1);
    expect(proposalQueries[0]!.op).toBe("select");
    expect(proposalQueries[0]!.filters).toContainEqual([
      "eq",
      "status",
      "committing",
    ]);
    expect(proposalQueries[0]!.filters).toContainEqual([
      "lt",
      "created_at",
      RECONCILE_CUTOFF,
    ]);
  });

  it("logs + Sentry-flags stuck sending messages without mutating them", async () => {
    const recorded: RecordedQuery[] = [];
    const { deps, capture } = makeDeps(
      recorded,
      respondWith([
        {
          table: "messages",
          op: "select",
          data: [{ id: "m1", organization_id: "org-1", conversation_id: "c1" }],
        },
      ]),
    );

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.stuckSending).toBe(1);
    expect(capture).toHaveBeenCalledTimes(1);
    const message = capture.mock.calls[0]![0];
    expect(message).toContain("'sending'");
    expect(message).toContain("m1");

    const messageQueries = recorded.filter((q) => q.table === "messages");
    expect(messageQueries).toHaveLength(1);
    expect(messageQueries[0]!.op).toBe("select");
    expect(messageQueries[0]!.filters).toContainEqual([
      "eq",
      "draft_status",
      "sending",
    ]);
  });

  it("stays quiet when nothing is stuck", async () => {
    const { deps, capture } = makeDeps([], respondWith());

    const out = await runAgentRunWatchdog({ step: makeStep(), deps });

    expect(out.stuckCommitting).toBe(0);
    expect(out.stuckSending).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });
});
