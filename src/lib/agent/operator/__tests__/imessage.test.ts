/**
 * Unit tests for the operator iMessage helpers.
 *
 * `stripMarkdown` and `chunk` are pure — they're exercised directly.
 * `sendImessageReply` and `startTypingLoop` route through the
 * `MessagingProvider` abstraction; we mock `getPrimaryProvider` to
 * intercept sends without touching the real provider plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chunk,
  sendImessageReply,
  startTypingLoop,
  stripMarkdown,
} from "../imessage";
import type { MessagingProvider } from "@/lib/messaging/provider";
import type { OutboundMessage, SendResult } from "@/lib/messaging/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/messaging/provider", () => ({
  getPrimaryProvider: vi.fn(),
}));
vi.mock("@/lib/messaging/send-with-failover", () => ({
  sendWithFailover: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

import { getPrimaryProvider } from "@/lib/messaging/provider";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";

const mockGetPrimaryProvider = vi.mocked(getPrimaryProvider);
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockSend = vi.mocked(sendWithFailover);

function makeProvider(overrides: Partial<MessagingProvider> = {}): {
  provider: MessagingProvider;
  send: ReturnType<typeof vi.fn>;
  sendTypingIndicator: ReturnType<typeof vi.fn>;
} {
  const providerSend = vi.fn(
    async (msg: OutboundMessage): Promise<SendResult> => ({
      ok: true,
      provider: "linq",
      providerMessageId: `mock-${msg.body.length}`,
    }),
  );
  const sendTypingIndicator = vi.fn(async () => undefined);
  const provider: MessagingProvider = {
    name: "linq",
    verifyInbound: () => ({ ok: true }),
    send: providerSend,
    sendTypingIndicator,
    ...overrides,
  };
  return { provider, send: mockSend, sendTypingIndicator };
}

function stubAdminWithOrg(
  phone: string | null,
  assistantName: string | null = "Odesa",
): void {
  const single = vi.fn(async () => ({
    data:
      phone === null
        ? null
        : {
            odesa_phone_number: phone,
            assistant_name: assistantName,
          },
    error: phone === null ? { message: "no row" } : null,
  }));
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  // The cast is local; the helper only ever calls .from(...).select(...).eq(...).single()
  mockCreateAdminClient.mockReturnValue({
    from,
  } as unknown as ReturnType<typeof createAdminClient>);
}

// Backwards-compatible alias the existing tests use; keeps phone-only
// callers from re-touching the tooling for the assistant_name addition.
function stubAdminWithPhone(phone: string | null): void {
  stubAdminWithOrg(phone, "Odesa");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({
    ok: true,
    provider: "linq",
    providerMessageId: "mock-boundary",
    attempted: ["linq"],
    failedOver: false,
  });
  stubAdminWithPhone("+15551234567");
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// stripMarkdown
// ---------------------------------------------------------------------------

describe("stripMarkdown", () => {
  it("should strip bold markers when text uses **bold**", () => {
    expect(stripMarkdown("hello **world**!")).toBe("hello world!");
  });

  it("should strip italic markers when text uses *italic*", () => {
    expect(stripMarkdown("this is *cool*")).toBe("this is cool");
  });

  it("should strip backticks when text uses `inline code`", () => {
    expect(stripMarkdown("run `npm test` first")).toBe("run npm test first");
  });

  it("should strip fenced code blocks while preserving inner content", () => {
    const input = "see:\n```ts\nconst x = 1;\n```\ndone";
    expect(stripMarkdown(input)).toBe("see:\nconst x = 1;\n\ndone");
  });

  it("should strip h1/h2/h3 leading hashes", () => {
    expect(stripMarkdown("# Title\n## Sub\n### Smaller")).toBe(
      "Title\nSub\nSmaller",
    );
  });

  it('should rewrite a single link as "text (url)"', () => {
    expect(stripMarkdown("see [docs](https://example.com)")).toBe(
      "see docs (https://example.com)",
    );
  });

  it("should rewrite multiple links in one paragraph", () => {
    const input = "check [one](https://a.test) or [two](https://b.test) now";
    expect(stripMarkdown(input)).toBe(
      "check one (https://a.test) or two (https://b.test) now",
    );
  });

  it("should handle a mixed paragraph (bold + link + code)", () => {
    const input = "**Note:** run `npm test` then visit [docs](https://x.test)";
    expect(stripMarkdown(input)).toBe(
      "Note: run npm test then visit docs (https://x.test)",
    );
  });

  it("should trim surrounding whitespace", () => {
    expect(stripMarkdown("  hello  ")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// chunk
// ---------------------------------------------------------------------------

describe("chunk", () => {
  it("should return a single chunk for a short message", () => {
    expect(chunk("short message")).toEqual(["short message"]);
  });

  it("should return one chunk when length is exactly 2900", () => {
    const text = "a".repeat(2900);
    expect(chunk(text)).toEqual([text]);
  });

  it("should split into two chunks when length is 2901 with no newlines", () => {
    const text = "a".repeat(2901);
    const result = chunk(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.join("")).toBe(text);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(2900);
    }
  });

  it("should produce ~5 chunks for a 5x-size body", () => {
    const line = "word ".repeat(20).trim();
    const lines: string[] = [];
    let total = 0;
    while (total < 2900 * 5) {
      lines.push(line);
      total += line.length + 1;
    }
    const text = lines.join("\n");
    const result = chunk(text);
    expect(result.length).toBeGreaterThanOrEqual(5);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(2900);
    }
  });

  it("should chunk on size when text has no newlines and exceeds size", () => {
    const text = "x".repeat(7000);
    const result = chunk(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result.join("")).toBe(text);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(2900);
    }
  });

  it("should preserve line boundaries when possible", () => {
    const lines = Array.from(
      { length: 10 },
      (_, i) => `line ${i}: ${"x".repeat(500)}`,
    );
    const text = lines.join("\n");
    const result = chunk(text, 1200);
    for (const part of result) {
      expect(part.length).toBeLessThanOrEqual(1200);
    }
    // Joining with `\n` reproduces the input — never split mid-line at this size.
    expect(result.join("\n")).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// sendImessageReply
// ---------------------------------------------------------------------------

describe("sendImessageReply", () => {
  it("should call provider.send once for a short reply", async () => {
    const { provider, send } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    await sendImessageReply({
      organizationId: "org-1",
      toE164: "+15555550100",
      text: "hi there",
      idempotencyKey: "test-reply",
    });

    expect(send).toHaveBeenCalledTimes(1);
    // Operator hot path no longer signs every reply — the operator is
    // texting their own AI, signing reads bot-y. See sendImessageReply.
    expect(send).toHaveBeenCalledWith("org-1", {
      toE164: "+15555550100",
      fromE164: "+15551234567",
      body: "hi there",
      idempotencyKey: expect.stringMatching(/^test-reply:/),
    });
  });

  it("should strip markdown before sending", async () => {
    const { provider, send } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    await sendImessageReply({
      organizationId: "org-1",
      toE164: "+15555550100",
      text: "**bold** and `code`",
      idempotencyKey: "test-reply",
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].body).toBe("bold and code");
  });

  it("should call provider.send N times for a long message", async () => {
    const { provider, send } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);
    const lines = Array.from(
      { length: 30 },
      (_, i) => `line ${i}: ${"x".repeat(200)}`,
    );
    const text = lines.join("\n");

    await sendImessageReply({
      organizationId: "org-1",
      toE164: "+15555550100",
      text,
      idempotencyKey: "test-reply",
    });

    expect(send.mock.calls.length).toBeGreaterThan(1);
    const reconstructed = send.mock.calls.map((c) => c[1].body).join("\n");
    // No sign-off appended on operator path — chunks should reassemble
    // back to the original text directly.
    expect(reconstructed).toBe(text);
  });

  it("should log and continue when one chunk send fails", async () => {
    const { provider, send } = makeProvider();
    let callCount = 0;
    send.mockImplementation(async (_orgId, msg) => {
      callCount += 1;
      if (callCount === 2) {
        return {
          ok: false,
          status: "failed",
          attempted: ["linq"],
          errors: [{ provider: "linq", error: "simulated failure" }],
        };
      }
      return {
        ok: true,
        provider: "linq",
        providerMessageId: `mock-${msg.body.length}-${callCount}`,
        attempted: ["linq"],
        failedOver: false,
      };
    });
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const lines = Array.from(
      { length: 20 },
      (_, i) => `line ${i}: ${"x".repeat(300)}`,
    );
    const text = lines.join("\n");

    await expect(
      sendImessageReply({
        organizationId: "org-1",
        toE164: "+15555550100",
        text,
        idempotencyKey: "test-reply",
      }),
    ).resolves.toBeUndefined();

    expect(send.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("should drop the reply and log when org has no odesa_phone_number", async () => {
    stubAdminWithPhone(null);
    const { provider, send } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await sendImessageReply({
      organizationId: "org-1",
      toE164: "+15555550100",
      text: "hi",
      idempotencyKey: "test-reply",
    });

    expect(send).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("should no-op silently when stripped text is empty", async () => {
    const { provider, send } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    await sendImessageReply({
      organizationId: "org-1",
      toE164: "+15555550100",
      text: "   ",
      idempotencyKey: "test-reply",
    });

    expect(send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// startTypingLoop
// ---------------------------------------------------------------------------

describe("startTypingLoop", () => {
  it("should fire sendTypingIndicator immediately on first call", async () => {
    vi.useFakeTimers();
    const { provider, sendTypingIndicator } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const stop = startTypingLoop({
      organizationId: "org-1",
      toE164: "+15555550100",
      intervalMs: 60_000,
    });

    // Flush the immediate-fire microtask chain (no timer advance needed).
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendTypingIndicator).toHaveBeenCalledTimes(1);
    expect(sendTypingIndicator).toHaveBeenCalledWith("+15555550100");

    stop();
  });

  it("should fire on the configured interval and stop when stop() is called", async () => {
    vi.useFakeTimers();
    const { provider, sendTypingIndicator } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const stop = startTypingLoop({
      organizationId: "org-1",
      toE164: "+15555550100",
      intervalMs: 1000,
    });

    // Drain the immediate-fire microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initialCalls = sendTypingIndicator.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendTypingIndicator.mock.calls.length).toBe(initialCalls + 1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sendTypingIndicator.mock.calls.length).toBe(initialCalls + 2);

    stop();
    const callsAfterStop = sendTypingIndicator.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sendTypingIndicator.mock.calls.length).toBe(callsAfterStop);
  });

  it("should return a stop function that clears the interval", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { provider } = makeProvider();
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const stop = startTypingLoop({
      organizationId: "org-1",
      toE164: "+15555550100",
    });
    await vi.runOnlyPendingTimersAsync();
    stop();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("should be a no-op when provider does not implement sendTypingIndicator", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider({ sendTypingIndicator: undefined });
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const stop = startTypingLoop({
      organizationId: "org-1",
      toE164: "+15555550100",
      intervalMs: 1000,
    });

    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(5000);
    // Should not throw, and stop() should be safe to call.
    expect(() => stop()).not.toThrow();
  });

  it("should swallow errors thrown by sendTypingIndicator", async () => {
    vi.useFakeTimers();
    const { provider, sendTypingIndicator } = makeProvider();
    sendTypingIndicator.mockRejectedValue(new Error("network down"));
    mockGetPrimaryProvider.mockResolvedValue(provider);

    const stop = startTypingLoop({
      organizationId: "org-1",
      toE164: "+15555550100",
      intervalMs: 1000,
    });

    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(1000);
    // Each tick swallows; no unhandled rejection.
    expect(sendTypingIndicator).toHaveBeenCalled();
    stop();
  });
});
