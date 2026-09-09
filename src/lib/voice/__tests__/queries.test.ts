import { describe, expect, it, vi } from "vitest";

import { countActivity, deriveCallReview, listVoiceCalls } from "../queries";

const canonicalOutcome = {
  oneSentence: "Verified tenant call — outcome recorded.",
  callerKind: "verified_tenant",
  callerPhone: "+15555550100",
  intentsHandled: [],
  recordsCreated: [],
  autonomousActions: [],
  approvalsNeeded: [],
  smsSent: [],
  smsDrafted: [],
  unresolved: [],
  riskFlags: [],
  endedAt: "2026-07-09T12:02:00.000Z",
};

const completedClean = {
  status: "completed",
  outcome: canonicalOutcome,
};
const completedNeedsApproval = {
  status: "completed",
  outcome: { ...canonicalOutcome, approvalsNeeded: ["voice_call_review"] },
};
const active = { status: "active", outcome: null };

/** Zero baseline for the full VoiceCallActivity shape — keeps toEqual exact yet readable. */
const ZERO = {
  callsToday: 0,
  resolvedAutomatically: 0,
  needsReview: 0,
  awaitingApproval: 0,
  actionsTaken: 0,
  recordsCreated: 0,
};

describe("countActivity", () => {
  it("should return zeros when there are no rows", () => {
    expect(countActivity([])).toEqual(ZERO);
  });

  it("should split completed calls by needs-review", () => {
    expect(
      countActivity([completedClean, completedNeedsApproval, completedClean]),
    ).toEqual({
      ...ZERO,
      callsToday: 3,
      resolvedAutomatically: 2,
      needsReview: 1,
      awaitingApproval: 1,
    });
  });

  it("should count active calls (null outcome) only in callsToday", () => {
    expect(countActivity([active, completedClean])).toEqual({
      ...ZERO,
      callsToday: 2,
      resolvedAutomatically: 1,
    });
  });

  it("should not count a completed call with null outcome as resolved", () => {
    expect(countActivity([{ status: "completed", outcome: null }])).toEqual({
      ...ZERO,
      callsToday: 1,
    });
  });

  it("should sum honest actionsTaken and recordsCreated across calls", () => {
    const rows = [
      {
        status: "completed",
        outcome: {
          ...canonicalOutcome,
          autonomousActions: [
            {
              action: "create_work_order",
              at: "2026-07-09T12:01:00.000Z",
              tier: 1,
              outcome: "executed",
              ids: { work_order: "wo-1" },
            },
            {
              action: "send_safe_confirmation_sms",
              at: "2026-07-09T12:01:30.000Z",
              tier: 2,
              outcome: "executed",
              ids: { message: "m-1" },
            },
          ],
          recordsCreated: [
            { kind: "work_order", id: "wo-1" },
            { kind: "message", id: "m-1" },
          ],
        },
      },
    ];
    expect(countActivity(rows)).toEqual({
      ...ZERO,
      callsToday: 1,
      resolvedAutomatically: 1,
      actionsTaken: 2,
      recordsCreated: 2,
    });
  });

  it("should tolerate malformed outcome jsonb shapes", () => {
    const rows = [
      // Semantics change (intentional): a string outcome no longer parses as a
      // record, so it is NOT counted as resolved — it renders "Outcome
      // unavailable". Previously this counted toward resolvedAutomatically.
      { status: "completed", outcome: "garbage" },
      // A partial object with a wrong-typed field is not a compiled artifact.
      { status: "completed", outcome: { approvalsNeeded: "nope" } },
      // Non-completed status with approvals still needs review (rollup gate).
      { status: "failed", outcome: { approvalsNeeded: ["x"] } },
    ];
    expect(countActivity(rows)).toEqual({
      ...ZERO,
      callsToday: 3,
      needsReview: 1,
      awaitingApproval: 1,
    });
  });
});

describe("deriveCallReview", () => {
  it("should flag needs-review with approvals only", () => {
    expect(deriveCallReview("completed", { approvalsNeeded: ["p1"] })).toEqual({
      needsReview: true,
      resolvedAutomatically: false,
      approvalCount: 1,
      riskFlagCount: 0,
      unresolvedCount: 0,
      reviewReasons: ["1 review item for Owner Queue"],
      statusTone: "clay",
      statusLabel: "Needs review",
    });
  });

  it("should flag needs-review with risk flags only", () => {
    expect(
      deriveCallReview("completed", {
        riskFlags: ["payment_dispute", "upset_caller"],
      }),
    ).toEqual({
      needsReview: true,
      resolvedAutomatically: false,
      approvalCount: 0,
      riskFlagCount: 2,
      unresolvedCount: 0,
      reviewReasons: [
        "2 risk flags: Payment dispute, Caller needs careful follow-up",
      ],
      statusTone: "clay",
      statusLabel: "Needs review",
    });
  });

  it("should flag needs-review with both approvals and risk flags", () => {
    expect(
      deriveCallReview("completed", {
        approvalsNeeded: ["p1"],
        riskFlags: ["payment_dispute"],
      }),
    ).toEqual({
      needsReview: true,
      resolvedAutomatically: false,
      approvalCount: 1,
      riskFlagCount: 1,
      unresolvedCount: 0,
      reviewReasons: [
        "1 review item for Owner Queue",
        "1 risk flag: Payment dispute",
      ],
      statusTone: "clay",
      statusLabel: "Needs review",
    });
  });

  it("should NOT gate review on unresolved facts when canonical outcome evidence exists", () => {
    expect(
      deriveCallReview("completed", {
        ...canonicalOutcome,
        unresolved: ["availability", "callbackAfter"],
      }),
    ).toEqual({
      needsReview: false,
      resolvedAutomatically: true,
      approvalCount: 0,
      riskFlagCount: 0,
      unresolvedCount: 2,
      reviewReasons: [],
      statusTone: "green",
      statusLabel: "Outcome recorded",
    });
  });

  it("should mark an active call in progress", () => {
    expect(deriveCallReview("active", null)).toEqual({
      needsReview: false,
      resolvedAutomatically: false,
      approvalCount: 0,
      riskFlagCount: 0,
      unresolvedCount: 0,
      reviewReasons: [],
      statusTone: "neutral",
      statusLabel: "Call in progress",
    });
  });

  it("should mark a completed call with null outcome as unavailable, not resolved", () => {
    const review = deriveCallReview("completed", null);
    expect(review.resolvedAutomatically).toBe(false);
    expect(review.statusTone).toBe("neutral");
    expect(review.statusLabel).toBe("Outcome unavailable");
  });

  it("should resolve a completed clean call", () => {
    expect(deriveCallReview("completed", canonicalOutcome)).toEqual({
      needsReview: false,
      resolvedAutomatically: true,
      approvalCount: 0,
      riskFlagCount: 0,
      unresolvedCount: 0,
      reviewReasons: [],
      statusTone: "green",
      statusLabel: "Outcome recorded",
    });
  });

  it("should not treat an empty or partial object as completed outcome evidence", () => {
    for (const outcome of [{}, { approvalsNeeded: [], riskFlags: [] }]) {
      expect(deriveCallReview("completed", outcome)).toMatchObject({
        resolvedAutomatically: false,
        statusTone: "neutral",
        statusLabel: "Outcome unavailable",
      });
    }
  });

  it("should NOT resolve a completed call whose outcome is a malformed string", () => {
    // Intentional honest semantics: a string outcome is never green-resolved.
    expect(deriveCallReview("completed", "garbage")).toEqual({
      needsReview: false,
      resolvedAutomatically: false,
      approvalCount: 0,
      riskFlagCount: 0,
      unresolvedCount: 0,
      reviewReasons: [],
      statusTone: "neutral",
      statusLabel: "Outcome unavailable",
    });
  });
});

describe("listVoiceCalls", () => {
  it("fetches every register batch instead of silently stopping at 50 calls", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: `call-${String(index).padStart(3, "0")}`,
      retell_call_id: `retell-${index}`,
      caller_kind: "unknown_caller",
      from_number: "+15555550100",
      status: "completed",
      started_at: "2026-07-09T12:00:00.000Z",
      ended_at: "2026-07-09T12:02:00.000Z",
      summary: `Call ${index}`,
      transcript: null,
      outcome: { approvalsNeeded: [] },
      conversation_id: null,
      tenant_id: null,
      vendor_id: null,
      tenants: null,
      vendors: null,
    }));

    const range = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, to + 1),
      error: null,
    }));
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range,
    };
    const db = { from: vi.fn(() => query) };

    const calls = await listVoiceCalls(db as never);

    expect(calls).toHaveLength(501);
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining(
        "tenants!voice_calls_tenant_id_fkey(full_name)",
      ),
    );
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining("vendors!voice_calls_vendor_id_fkey(name)"),
    );
    expect(query.select).not.toHaveBeenCalledWith(
      expect.stringContaining("voice_calls_tenant_org_fkey"),
    );
    expect(query.select).not.toHaveBeenCalledWith(
      expect.stringContaining("voice_calls_vendor_org_fkey"),
    );
    expect(range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(range).toHaveBeenNthCalledWith(2, 500, 999);
  });
});
