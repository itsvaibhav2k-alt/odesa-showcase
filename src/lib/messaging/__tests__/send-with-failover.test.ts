/**
 * Unit tests for sendWithFailover's provider orchestration, including
 * the primary-only mode introduced for Retell (no fallback partner —
 * a failed Retell send must never reroute through a legacy channel).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MessagingProvider } from "../provider";
import type { ProviderChoice, SendResult } from "../types";

// Full module mock — sendWithFailover only consumes these three, and
// skipping importOriginal keeps the supabase admin client out of scope.
vi.mock("../provider", () => ({
  getPrimaryProviderChoice: vi.fn(),
  getProvider: vi.fn(),
  getOppositeProvider: vi.fn(),
}));

vi.mock("../dispatch-store", () => ({
  claimOutboundDispatch: vi.fn(),
  leaseOutboundAttempt: vi.fn(),
  beginOutboundAttempt: vi.fn(),
  recordDispatchAccepted: vi.fn(),
  recordDispatchFailure: vi.fn(),
}));

import {
  getPrimaryProviderChoice,
  getProvider,
  getOppositeProvider,
} from "../provider";
import { sendWithFailover } from "../send-with-failover";
import {
  claimOutboundDispatch,
  leaseOutboundAttempt,
  beginOutboundAttempt,
  recordDispatchAccepted,
  recordDispatchFailure,
} from "../dispatch-store";

const mockChoice = vi.mocked(getPrimaryProviderChoice);
const mockGetProvider = vi.mocked(getProvider);
const mockGetOpposite = vi.mocked(getOppositeProvider);
const mockClaim = vi.mocked(claimOutboundDispatch);
const mockLease = vi.mocked(leaseOutboundAttempt);
const mockBegin = vi.mocked(beginOutboundAttempt);
const mockAccepted = vi.mocked(recordDispatchAccepted);
const mockFailure = vi.mocked(recordDispatchFailure);

const ORG_ID = "org-1";
const MSG = {
  toE164: "+15551111111",
  fromE164: "+15550000000",
  body: "hi",
  messageId: "message-1",
  idempotencyKey: "message:message-1",
};

function fakeProvider(
  name: ProviderChoice,
  result: SendResult,
): MessagingProvider {
  return {
    name,
    verifyInbound: vi.fn(() => ({ ok: true as const })),
    send: vi.fn(async () => result),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClaim.mockResolvedValue({ kind: "claimed", dispatchId: "dispatch-1" });
  mockLease.mockResolvedValue({
    kind: "leased",
    attemptId: "attempt-1",
    leaseToken: "lease-1",
  });
  mockBegin.mockResolvedValue(true);
  mockAccepted.mockResolvedValue(undefined);
  mockFailure.mockResolvedValue(undefined);
});

describe("sendWithFailover", () => {
  it("should return the primary result without touching the fallback on success", async () => {
    const primary = fakeProvider("linq", {
      ok: true,
      provider: "linq",
      providerMessageId: "pm-1",
    });
    const fallback = fakeProvider("twilio", {
      ok: true,
      provider: "twilio",
      providerMessageId: "pm-2",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(fallback);

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toEqual({
      ok: true,
      provider: "linq",
      providerMessageId: "pm-1",
      attempted: ["linq"],
      failedOver: false,
    });
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it("should fail over to the partner when the primary fails", async () => {
    const primary = fakeProvider("linq", {
      ok: false,
      provider: "linq",
      error: "down",
    });
    const fallback = fakeProvider("twilio", {
      ok: true,
      provider: "twilio",
      providerMessageId: "pm-2",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(fallback);

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toMatchObject({
      ok: true,
      provider: "twilio",
      attempted: ["linq", "twilio"],
      failedOver: true,
    });
  });

  it("should fail cleanly with no fallback attempted when retell (primary-only) fails", async () => {
    const primary = fakeProvider("retell", {
      ok: false,
      provider: "retell",
      error: "RETELL_API_KEY / RETELL_SMS_DISPATCH_AGENT_ID not set",
    });
    mockChoice.mockResolvedValue("retell");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(null);

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toEqual({
      ok: false,
      status: "failed",
      attempted: ["retell"],
      errors: [
        {
          provider: "retell",
          error: "RETELL_API_KEY / RETELL_SMS_DISPATCH_AGENT_ID not set",
        },
      ],
    });
    expect(primary.send).toHaveBeenCalledTimes(1);
  });

  it("should thread the organizationId into the provider send for correlation metadata", async () => {
    const primary = fakeProvider("retell", {
      ok: true,
      provider: "retell",
      providerMessageId: "chat_1",
    });
    mockChoice.mockResolvedValue("retell");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(null);

    await sendWithFailover(ORG_ID, MSG);

    expect(primary.send).toHaveBeenCalledWith({
      ...MSG,
      organizationId: ORG_ID,
    });
  });

  it("suppresses at the shared boundary without touching any provider", async () => {
    const primary = fakeProvider("linq", {
      ok: true,
      provider: "linq",
      providerMessageId: "must-not-send",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(null);
    mockClaim.mockResolvedValue({
      kind: "suppressed",
      dispatchId: "dispatch-1",
    });

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toMatchObject({ ok: false, status: "suppressed" });
    expect(primary.send).not.toHaveBeenCalled();
  });

  it("replays accepted canonical state instead of sending again", async () => {
    const primary = fakeProvider("linq", {
      ok: true,
      provider: "linq",
      providerMessageId: "must-not-send",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(null);
    mockClaim.mockResolvedValue({
      kind: "replay",
      dispatchId: "dispatch-1",
      provider: "linq",
      providerMessageId: "pm-canonical",
    });

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toMatchObject({
      ok: true,
      provider: "linq",
      providerMessageId: "pm-canonical",
      replayed: true,
    });
    expect(primary.send).not.toHaveBeenCalled();
  });

  it("does not fail over or resend after an ambiguous provider timeout", async () => {
    const primary = fakeProvider("linq", {
      ok: false,
      provider: "linq",
      error: "timeout after request write",
      certainty: "ambiguous",
    });
    const fallback = fakeProvider("twilio", {
      ok: true,
      provider: "twilio",
      providerMessageId: "duplicate",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(fallback);

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toMatchObject({ ok: false, status: "ambiguous" });
    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(fallback.send).not.toHaveBeenCalled();
    expect(mockFailure).toHaveBeenCalledWith(
      "attempt-1",
      "ambiguous",
      "timeout after request write",
      false,
    );
  });

  it("re-checks suppression before failover and sends to zero fallback providers after STOP", async () => {
    const primary = fakeProvider("linq", {
      ok: false,
      provider: "linq",
      error: "definitive rejection",
      certainty: "definitive",
    });
    const fallback = fakeProvider("twilio", {
      ok: true,
      provider: "twilio",
      providerMessageId: "must-not-send",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(fallback);
    mockLease
      .mockResolvedValueOnce({
        kind: "leased",
        attemptId: "attempt-primary",
        leaseToken: "lease-primary",
      })
      .mockResolvedValueOnce({ kind: "suppressed" });

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toMatchObject({ ok: false, status: "suppressed" });
    expect(primary.send).toHaveBeenCalledTimes(1);
    expect(fallback.send).not.toHaveBeenCalled();
  });

  it("cancels a leased attempt when STOP wins before network handoff", async () => {
    const primary = fakeProvider("linq", {
      ok: true,
      provider: "linq",
      providerMessageId: "must-not-send",
    });
    mockChoice.mockResolvedValue("linq");
    mockGetProvider.mockReturnValue(primary);
    mockGetOpposite.mockReturnValue(null);
    mockBegin.mockResolvedValue(false);

    const result = await sendWithFailover(ORG_ID, MSG);

    expect(result).toMatchObject({ ok: false, status: "suppressed" });
    expect(mockLease).toHaveBeenCalledWith("dispatch-1", "linq");
    expect(mockBegin).toHaveBeenCalledWith("attempt-1", "lease-1");
    expect(primary.send).not.toHaveBeenCalled();
  });
});
