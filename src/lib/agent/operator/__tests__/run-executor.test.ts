/**
 * Unit tests for the agent_runs executor.
 *
 * Test plan (Phase B brief):
 *   - duplicate delivery: claim misses (no queued row) → skipped, no dispatch
 *   - happy path (web): claim → drive → fenced finalize done with reply_text
 *   - fence: finalize finds no 'running' row (watchdog won) → superseded,
 *     never overwrites the watchdog's verdict
 *   - error path: dispatcher throws → fenced update to failed + error
 *   - iMessage error path: ONE apology sent + error_notified_at stamped
 *   - iMessage happy path: composed reply sent to reply_to_e164, typing
 *     loop stopped
 */

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import type { DispatcherEvent } from "@/lib/agent/operator/types";
import type {
  runOperatorDispatcher,
  RunOperatorDispatcherArgs,
} from "@/lib/agent/operator/dispatcher";
import type {
  sendImessageReply,
  startTypingLoop,
} from "@/lib/agent/operator/imessage";
import {
  executeAgentRun,
  parsePropertyHint,
  type AgentRunRow,
} from "../run-executor";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN = "00000000-0000-0000-0000-000000000100";
const ORG = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const CHAT = "00000000-0000-0000-0000-000000000003";
const TURN = "turn_test_abc123";
const E164 = "+15555550100";

function makeRun(overrides: Partial<AgentRunRow> = {}): AgentRunRow {
  return {
    id: RUN,
    organization_id: ORG,
    user_id: USER,
    chat_id: CHAT,
    turn_id: TURN,
    surface: "web",
    channel: "web",
    message: "how is rent collection going?",
    property_hint: null,
    reply_to_e164: null,
    status: "running",
    started_at: "2026-06-10T10:00:00.000Z",
    finished_at: null,
    heartbeat_at: "2026-06-10T10:00:00.000Z",
    error: null,
    error_notified_at: null,
    reply_text: null,
    created_at: "2026-06-10T09:59:59.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// db stub — records update patches + filters; maybeSingle pops a queue
// ---------------------------------------------------------------------------

interface RecordedUpdate {
  patch: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

interface DbState {
  /** Rows the next `.select().maybeSingle()` terminations return, in order. */
  maybeSingleQueue: Array<AgentRunRow | null>;
  /** Every UPDATE that terminated (maybeSingle or thenable), in order. */
  updates: RecordedUpdate[];
  /** Optional errors returned by successive maybeSingle terminals. */
  maybeSingleErrors?: Array<{ message: string } | null>;
  /** Customer-visible assistant bodies projected by the executor. */
  assistantBodies?: string[];
}

function makeDb(state: DbState): SupabaseClient<Database> {
  return {
    from: vi.fn((table: string) => {
      if (table === "operator_chat_turns") {
        const projectionBuilder: Record<string, unknown> = {};
        projectionBuilder.update = (patch: Record<string, unknown>) => {
          if (typeof patch["body"] === "string") {
            state.assistantBodies?.push(patch["body"]);
          }
          return projectionBuilder;
        };
        projectionBuilder.insert = (row: Record<string, unknown>) => {
          if (typeof row["body"] === "string") {
            state.assistantBodies?.push(row["body"]);
          }
          return Promise.resolve({ data: null, error: null });
        };
        projectionBuilder.eq = () => projectionBuilder;
        projectionBuilder.select = () => projectionBuilder;
        projectionBuilder.maybeSingle = async () => ({
          data: { id: "assistant-turn" },
          error: null,
        });
        return projectionBuilder;
      }
      let pendingPatch: Record<string, unknown> | null = null;
      const filters: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {};

      builder.update = (patch: Record<string, unknown>) => {
        pendingPatch = patch;
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      };
      builder.select = () => builder;
      builder.maybeSingle = async () => {
        if (pendingPatch) {
          state.updates.push({ patch: pendingPatch, filters: [...filters] });
          pendingPatch = null;
        }
        const next = state.maybeSingleQueue.shift() ?? null;
        const error = state.maybeSingleErrors?.shift() ?? null;
        return { data: next, error };
      };
      // Awaiting an update chain without .select() terminates here
      // (heartbeat bump + error_notified_at stamp).
      builder.then = (
        fulfilled?: (v: { data: null; error: null }) => unknown,
      ) => {
        if (pendingPatch) {
          state.updates.push({ patch: pendingPatch, filters: [...filters] });
          pendingPatch = null;
        }
        const result = { data: null, error: null } as const;
        return Promise.resolve(fulfilled ? fulfilled(result) : result);
      };
      return builder;
    }),
  } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// dispatcher stubs
// ---------------------------------------------------------------------------

function makeDispatcher(
  events: DispatcherEvent[],
  capture: RunOperatorDispatcherArgs[],
): typeof runOperatorDispatcher {
  return async function* dispatcherStub(
    args: RunOperatorDispatcherArgs,
  ): AsyncGenerator<DispatcherEvent> {
    capture.push(args);
    for (const event of events) {
      yield event;
    }
  };
}

function makeThrowingDispatcher(
  capture: RunOperatorDispatcherArgs[],
  message: string,
): typeof runOperatorDispatcher {
  return async function* throwingStub(
    args: RunOperatorDispatcherArgs,
  ): AsyncGenerator<DispatcherEvent> {
    capture.push(args);
    yield { type: "say.delta", text: "partial " };
    throw new Error(message);
  };
}

/**
 * Dispatcher stub that yields its events, then outlives the executor's
 * timeout before completing normally — mirrors the real dispatcher,
 * which swallows the abort as a tool.error event and never throws.
 */
function makeSlowDispatcher(
  events: DispatcherEvent[],
  capture: RunOperatorDispatcherArgs[],
  delayMs: number,
): typeof runOperatorDispatcher {
  return async function* slowStub(
    args: RunOperatorDispatcherArgs,
  ): AsyncGenerator<DispatcherEvent> {
    capture.push(args);
    for (const event of events) {
      yield event;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  };
}

function makeHungDispatcher(
  capture: RunOperatorDispatcherArgs[],
): typeof runOperatorDispatcher {
  return async function* hungStub(
    args: RunOperatorDispatcherArgs,
  ): AsyncGenerator<DispatcherEvent> {
    capture.push(args);
    await new Promise<never>(() => undefined);
    yield { type: "done", turnId: TURN };
  };
}

function makeSendStub(): ReturnType<typeof vi.fn<typeof sendImessageReply>> {
  return vi.fn<typeof sendImessageReply>().mockResolvedValue(undefined);
}

const HAPPY_EVENTS: DispatcherEvent[] = [
  { type: "say.delta", text: "All three tenants are paid up." },
  { type: "done", turnId: TURN },
];

function reviewProposalEvent(): DispatcherEvent {
  return {
    type: "proposal.review_required",
    proposal: {
      id: "proposal-private-id",
      organizationId: ORG,
      propertyId: "property-private-id",
      workerModel: "dispatcher-direct",
      action_type: "update_rent",
      payload: {
        leaseRef: { tenantName: "Dana Reed" },
        rentAmount: 1900,
      },
      editDiff: null,
      routing: null,
      reasoning: "Prepared from the owner's request",
      confidence: 0.9,
      context_fact_ids: [],
      gate_decision: "review",
      status: "proposed",
      createdAt: "2026-08-07T12:00:00.000Z",
    },
    reviewUrl: "/owner-queue?proposal=proposal-private-id",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeAgentRun", () => {
  it("skips when the claim finds no queued row (duplicate delivery)", async () => {
    const state: DbState = { maybeSingleQueue: [null], updates: [] };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(HAPPY_EVENTS, captured),
      sendImessageReplyImpl: send,
    });

    expect(out).toEqual({ kind: "skipped", reason: "not_claimed" });
    expect(captured).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].patch).toMatchObject({ status: "running" });
    expect(state.updates[0].filters).toEqual([
      ["id", RUN],
      ["status", "queued"],
    ]);
  });

  it("claims, drives the dispatcher with the row turn_id, and finalizes done", async () => {
    const run = makeRun();
    const state: DbState = {
      maybeSingleQueue: [run, makeRun({ status: "done" })],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(HAPPY_EVENTS, captured),
      sendImessageReplyImpl: send,
    });

    expect(out).toEqual({
      kind: "done",
      runId: RUN,
      replyText: "All three tenants are paid up.",
    });

    // Dispatcher received the run row's pre-minted turn id + abort signal.
    expect(captured).toHaveLength(1);
    expect(captured[0].turnId).toBe(TURN);
    expect(captured[0].chatId).toBe(CHAT);
    expect(captured[0].message).toBe(run.message);
    expect(captured[0].signal).toBeInstanceOf(AbortSignal);

    // Web surface: no Sendblue send.
    expect(send).not.toHaveBeenCalled();

    // Claim then fenced finalize.
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0].patch).toMatchObject({ status: "running" });
    expect(state.updates[1].patch).toMatchObject({
      status: "done",
      reply_text: "All three tenants are paid up.",
    });
    expect(state.updates[1].patch["finished_at"]).toBeTruthy();
    expect(state.updates[1].filters).toEqual([
      ["id", RUN],
      ["status", "running"],
    ]);
  });

  it("replaces a false model success claim with the deterministic review outcome", async () => {
    const state: DbState = {
      maybeSingleQueue: [makeRun(), makeRun({ status: "done" })],
      updates: [],
    };

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(
        [
          { type: "say.delta", text: "I changed Dana's rent." },
          reviewProposalEvent(),
          { type: "done", turnId: TURN },
        ],
        [],
      ),
      sendImessageReplyImpl: makeSendStub(),
    });

    expect(out).toMatchObject({ kind: "done", runId: RUN });
    if (out.kind !== "done") throw new Error("run did not complete");
    expect(out.replyText).toContain("No consequential action was completed");
    expect(out.replyText).toContain(
      "Rent change for Dana Reed to $1,900/month — needs review: /owner-queue",
    );
    expect(out.replyText).not.toContain("I changed Dana's rent");
    expect(out.replyText).not.toContain("proposal-private-id");
    expect(state.updates[1].patch["reply_text"]).toBe(out.replyText);
  });

  it("no-ops the finalize when the watchdog already failed the run (fence)", async () => {
    const state: DbState = {
      maybeSingleQueue: [makeRun(), null],
      updates: [],
      assistantBodies: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(HAPPY_EVENTS, captured),
      sendImessageReplyImpl: makeSendStub(),
    });

    expect(out).toEqual({ kind: "superseded", runId: RUN });
    // Claim + fenced finalize attempt only — no failed-path write that
    // would clobber the watchdog's verdict.
    expect(state.updates).toHaveLength(2);
    expect(state.updates[1].patch).toMatchObject({ status: "done" });
    expect(
      state.updates.filter((u) => u.patch["status"] === "failed"),
    ).toHaveLength(0);
    expect(state.assistantBodies).toEqual([]);
  });

  it("stamps failed + error via the fence when the dispatcher throws (web: no apology)", async () => {
    const state: DbState = {
      maybeSingleQueue: [
        makeRun(),
        makeRun({ status: "failed", error: "boom" }),
      ],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeThrowingDispatcher(captured, "boom"),
      sendImessageReplyImpl: send,
    });

    expect(out).toEqual({ kind: "failed", runId: RUN, error: "boom" });
    expect(send).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(2);
    expect(state.updates[1].patch).toMatchObject({
      status: "failed",
      error: "boom",
    });
    expect(state.updates[1].filters).toEqual([
      ["id", RUN],
      ["status", "running"],
    ]);
  });

  it("treats a dispatcher tool.error event as durable failure, never done", async () => {
    const state: DbState = {
      maybeSingleQueue: [
        makeRun(),
        makeRun({ status: "failed", error: "dispatcher_error" }),
      ],
      updates: [],
    };

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(
        [
          { type: "say.delta", text: "I started checking. " },
          {
            type: "tool.error",
            name: "provider",
            message: "model unavailable",
          },
          { type: "done", turnId: TURN },
        ],
        [],
      ),
      sendImessageReplyImpl: makeSendStub(),
    });

    expect(out).toEqual({
      kind: "failed",
      runId: RUN,
      error: "dispatcher_error: provider: model unavailable",
    });
    expect(state.updates[1].patch).toMatchObject({
      status: "failed",
      error: "dispatcher_error: provider: model unavailable",
    });
    expect(
      state.updates.filter((update) => update.patch["status"] === "done"),
    ).toHaveLength(0);
  });

  it("fails a provider stream that ends without a rendered outcome", async () => {
    const state: DbState = {
      maybeSingleQueue: [makeRun(), makeRun({ status: "failed" })],
      updates: [],
    };

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(
        [{ type: "done", turnId: TURN }],
        [],
      ),
      sendImessageReplyImpl: makeSendStub(),
    });

    expect(out).toEqual({
      kind: "failed",
      runId: RUN,
      error: "empty_dispatcher_reply",
    });
    expect(state.updates[1].patch).toMatchObject({
      status: "failed",
      error: "empty_dispatcher_reply",
      reply_text: expect.stringContaining("couldn't finish this request"),
    });
  });

  it("sends ONE apology and stamps error_notified_at on iMessage failure", async () => {
    const imessageRun = makeRun({
      surface: "imessage",
      channel: "imessage",
      reply_to_e164: E164,
    });
    const state: DbState = {
      maybeSingleQueue: [
        imessageRun,
        makeRun({
          surface: "imessage",
          channel: "imessage",
          reply_to_e164: E164,
          status: "failed",
          error: "boom",
          error_notified_at: null,
        }),
      ],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();
    const stopTyping = vi.fn();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeThrowingDispatcher(captured, "boom"),
      sendImessageReplyImpl: send,
      startTypingLoopImpl: vi
        .fn<typeof startTypingLoop>()
        .mockReturnValue(stopTyping),
    });

    expect(out).toEqual({ kind: "failed", runId: RUN, error: "boom" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        toE164: E164,
        text: expect.stringContaining("mind resending"),
      }),
    );
    expect(stopTyping).toHaveBeenCalled();

    // claim → fenced fail → error_notified_at stamp.
    expect(state.updates).toHaveLength(3);
    expect(state.updates[1].patch).toMatchObject({ status: "failed" });
    expect(state.updates[2].patch["error_notified_at"]).toBeTruthy();
  });

  it("does not apologize when the failure fence misses (watchdog owns notification)", async () => {
    const imessageRun = makeRun({
      surface: "imessage",
      channel: "imessage",
      reply_to_e164: E164,
    });
    const state: DbState = {
      // claim succeeds; the fenced fail-update returns no row.
      maybeSingleQueue: [imessageRun, null],
      updates: [],
    };
    const send = makeSendStub();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeThrowingDispatcher([], "boom"),
      sendImessageReplyImpl: send,
      startTypingLoopImpl: vi
        .fn<typeof startTypingLoop>()
        .mockReturnValue(vi.fn()),
    });

    expect(out).toEqual({ kind: "superseded", runId: RUN });
    expect(send).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(2);
  });

  it("surfaces a failed-row write error instead of claiming durable failure", async () => {
    const state: DbState = {
      maybeSingleQueue: [makeRun(), makeRun({ status: "failed" })],
      maybeSingleErrors: [null, { message: "database unavailable" }],
      updates: [],
    };

    await expect(
      executeAgentRun(RUN, {
        db: makeDb(state),
        runDispatcherImpl: makeThrowingDispatcher([], "model unavailable"),
        sendImessageReplyImpl: makeSendStub(),
      }),
    ).rejects.toThrow(/failure finalize failed.*database unavailable/i);
  });

  it("reports completed internal records honestly when a later tool fails", async () => {
    const base = reviewProposalEvent();
    if (base.type !== "proposal.review_required") {
      throw new Error("proposal fixture malformed");
    }
    const state: DbState = {
      maybeSingleQueue: [makeRun(), makeRun({ status: "failed" })],
      updates: [],
    };

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(
        [
          {
            type: "proposal.committed",
            proposal: {
              ...base.proposal,
              action_type: "log_maintenance_ticket",
              payload: {
                unitRef: { unitLabel: "2B" },
                summary: "Leaking faucet",
                severity: "low",
              },
              gate_decision: "auto",
              status: "committed",
            },
          },
          { type: "tool.error", name: "provider", message: "stream failed" },
          { type: "done", turnId: TURN },
        ],
        [],
      ),
      sendImessageReplyImpl: makeSendStub(),
    });

    expect(out).toMatchObject({ kind: "failed" });
    const failurePatch = state.updates.find(
      (update) => update.patch["status"] === "failed",
    );
    expect(failurePatch?.patch["reply_text"]).toEqual(
      expect.stringContaining("completed records listed below were saved"),
    );
    expect(failurePatch?.patch["reply_text"]).not.toEqual(
      expect.stringContaining("No action is shown as completed"),
    );
  });

  it("finalizes failed (timeout_4m) with reply_text persisted when the run times out", async () => {
    const state: DbState = {
      maybeSingleQueue: [
        makeRun(),
        makeRun({ status: "failed", error: "timeout_4m" }),
      ],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeSlowDispatcher(
        [{ type: "say.delta", text: "Partial work so far." }],
        captured,
        40,
      ),
      sendImessageReplyImpl: send,
      timeoutMs: 5,
    });

    expect(out).toEqual({ kind: "failed", runId: RUN, error: "timeout_4m" });
    // The dispatcher saw the abort signal fire.
    expect(captured[0].signal?.aborted).toBe(true);
    // Web surface: no apology send.
    expect(send).not.toHaveBeenCalled();

    // Claim → fenced fail with the partial reply persisted; never 'done'.
    expect(state.updates).toHaveLength(2);
    expect(state.updates[1].patch).toMatchObject({
      status: "failed",
      error: "timeout_4m",
      reply_text: expect.stringContaining("couldn't finish this request"),
    });
    expect(state.updates[1].filters).toEqual([
      ["id", RUN],
      ["status", "running"],
    ]);
    expect(
      state.updates.filter((u) => u.patch["status"] === "done"),
    ).toHaveLength(0);
  });

  it("hard-times out a provider iterator whose next call never settles", async () => {
    const state: DbState = {
      maybeSingleQueue: [
        makeRun(),
        makeRun({ status: "failed", error: "timeout_4m" }),
      ],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeHungDispatcher(captured),
      sendImessageReplyImpl: makeSendStub(),
      timeoutMs: 5,
    });

    expect(out).toEqual({ kind: "failed", runId: RUN, error: "timeout_4m" });
    expect(captured[0].signal?.aborted).toBe(true);
    expect(state.updates[1].patch).toMatchObject({
      status: "failed",
      error: "timeout_4m",
      reply_text: expect.stringContaining("No action is shown as completed"),
    });
  });

  it("sends the apology (not the partial reply) when an iMessage run times out", async () => {
    const imessageRun = makeRun({
      surface: "imessage",
      channel: "imessage",
      reply_to_e164: E164,
    });
    const state: DbState = {
      maybeSingleQueue: [
        imessageRun,
        makeRun({
          surface: "imessage",
          channel: "imessage",
          reply_to_e164: E164,
          status: "failed",
          error: "timeout_4m",
          error_notified_at: null,
        }),
      ],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();
    const stopTyping = vi.fn();

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeSlowDispatcher(
        [{ type: "say.delta", text: "Partial work so far." }],
        captured,
        40,
      ),
      sendImessageReplyImpl: send,
      startTypingLoopImpl: vi
        .fn<typeof startTypingLoop>()
        .mockReturnValue(stopTyping),
      timeoutMs: 5,
    });

    expect(out).toEqual({ kind: "failed", runId: RUN, error: "timeout_4m" });
    expect(stopTyping).toHaveBeenCalled();
    // ONE send: the apology — the half-finished reply never goes out.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        toE164: E164,
        text: expect.stringContaining("mind resending"),
      }),
    );

    // claim → fenced fail (reply_text persisted) → error_notified_at stamp.
    expect(state.updates).toHaveLength(3);
    expect(state.updates[1].patch).toMatchObject({
      status: "failed",
      error: "timeout_4m",
      reply_text: expect.stringContaining("couldn't finish this request"),
    });
    expect(state.updates[2].patch["error_notified_at"]).toBeTruthy();
  });

  it("sends the composed reply to reply_to_e164 on the iMessage happy path", async () => {
    const imessageRun = makeRun({
      surface: "imessage",
      channel: "imessage",
      reply_to_e164: E164,
    });
    const state: DbState = {
      maybeSingleQueue: [imessageRun, makeRun({ status: "done" })],
      updates: [],
    };
    const captured: RunOperatorDispatcherArgs[] = [];
    const send = makeSendStub();
    const stopTyping = vi.fn();
    const startTyping = vi
      .fn<typeof startTypingLoop>()
      .mockReturnValue(stopTyping);

    const out = await executeAgentRun(RUN, {
      db: makeDb(state),
      runDispatcherImpl: makeDispatcher(HAPPY_EVENTS, captured),
      sendImessageReplyImpl: send,
      startTypingLoopImpl: startTyping,
    });

    expect(out.kind).toBe("done");
    expect(startTyping).toHaveBeenCalledWith({
      organizationId: ORG,
      toE164: E164,
    });
    expect(stopTyping).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      organizationId: ORG,
      toE164: E164,
      text: "All three tenants are paid up.",
      idempotencyKey: `agent-run:${RUN}:final`,
    });
    // sendInline is wired for the ack MCP on iMessage.
    expect(captured[0].sendInline).toBeTypeOf("function");
  });
});

describe("parsePropertyHint", () => {
  it("parses a valid {id, name} snapshot", () => {
    expect(parsePropertyHint({ id: "p1", name: "Vaba House" })).toEqual({
      id: "p1",
      name: "Vaba House",
    });
  });

  it("returns undefined for null / malformed shapes", () => {
    expect(parsePropertyHint(null)).toBeUndefined();
    expect(parsePropertyHint("vaba")).toBeUndefined();
    expect(parsePropertyHint(["p1"])).toBeUndefined();
    expect(parsePropertyHint({ id: "p1" })).toBeUndefined();
    expect(parsePropertyHint({ id: "", name: "Vaba" })).toBeUndefined();
  });
});
