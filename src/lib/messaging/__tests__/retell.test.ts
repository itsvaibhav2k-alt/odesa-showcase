/**
 * Unit tests for RetellSmsProvider and the pure Retell SMS webhook
 * helpers (parseRetellSmsWebhook / resolveChatNumbers /
 * extractInboundSmsMessages / extractChatMessages).
 *
 * No live Retell traffic anywhere: fetch is stubbed and the messaging
 * mock short-circuit is exercised explicitly.
 */

import crypto from "crypto";

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  RetellSmsProvider,
  parseRetellSmsWebhook,
  resolveChatNumbers,
  extractInboundSmsMessages,
  extractChatMessages,
  type RetellChat,
} from "../retell";
import {
  installMessagingMock,
  uninstallMessagingMock,
  setShouldFail,
} from "../test-hooks";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const API_KEY = "retell-test-key";
const DISPATCH_AGENT_ID = "agent_dispatch_123";

const MSG = {
  toE164: "+15555550199",
  fromE164: "+15555550100",
  body: "hello from odesa",
};

const NUMBERS = { fromNumber: "+15555550101", toNumber: "+15555550100" };

function chatFixture(overrides: Partial<RetellChat> = {}): RetellChat {
  return {
    chat_id: "chat_abc",
    agent_id: "agent_sms_1",
    chat_type: "sms_chat",
    chat_status: "ended",
    metadata: {
      odesa: {
        from_number: NUMBERS.fromNumber,
        to_number: NUMBERS.toNumber,
        organization_id: "org-1",
      },
    },
    message_with_tool_calls: [
      {
        message_id: "msg_user_1",
        role: "user",
        content: "  my sink is leaking  ",
        created_timestamp: 1751980000000,
      },
      {
        message_id: "msg_agent_1",
        role: "agent",
        content: "Sorry to hear that — logging a ticket now.",
        created_timestamp: 1751980005000,
      },
    ],
    ...overrides,
  };
}

function makeOkFetchResponse(json: unknown = {}) {
  return {
    status: 200,
    ok: true,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function makeErrFetchResponse(status: number, body: string) {
  return {
    status,
    ok: false,
    json: async () => ({}),
    text: async () => body,
  } as unknown as Response;
}

function signRetell(
  rawBody: string,
  apiKey: string,
  nowMs = Date.now(),
): string {
  const digest = crypto
    .createHmac("sha256", apiKey)
    .update(rawBody + String(nowMs))
    .digest("hex");
  return `v=${nowMs},d=${digest}`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  uninstallMessagingMock();
});

// ---------------------------------------------------------------------------
// parseRetellSmsWebhook
// ---------------------------------------------------------------------------

describe("parseRetellSmsWebhook", () => {
  it("should discriminate a chat_inbound event with numbers", () => {
    const parsed = parseRetellSmsWebhook({
      event: "chat_inbound",
      agent_id: "agent_sms_1",
      from_number: NUMBERS.fromNumber,
      to_number: NUMBERS.toNumber,
    });
    expect(parsed).toEqual({
      kind: "chat_inbound",
      fromNumber: NUMBERS.fromNumber,
      toNumber: NUMBERS.toNumber,
      agentId: "agent_sms_1",
    });
  });

  it("should ignore a chat_inbound event missing from/to numbers", () => {
    const parsed = parseRetellSmsWebhook({
      event: "chat_inbound",
      from_number: NUMBERS.fromNumber,
    });
    expect(parsed.kind).toBe("ignored");
  });

  it("should discriminate sms_chat lifecycle events", () => {
    for (const event of ["chat_started", "chat_ended", "chat_analyzed"]) {
      const parsed = parseRetellSmsWebhook({ event, chat: chatFixture() });
      expect(parsed.kind).toBe("chat_event");
      if (parsed.kind === "chat_event") {
        expect(parsed.event).toBe(event);
        expect(parsed.chat.chat_id).toBe("chat_abc");
      }
    }
  });

  it("should ignore non-sms chat lifecycle events", () => {
    const parsed = parseRetellSmsWebhook({
      event: "chat_ended",
      chat: chatFixture({ chat_type: "web_chat" }),
    });
    expect(parsed.kind).toBe("ignored");
  });

  it("should ignore unknown events, voice events, and junk payloads", () => {
    expect(parseRetellSmsWebhook({ event: "call_ended", call: {} }).kind).toBe(
      "ignored",
    );
    expect(parseRetellSmsWebhook({ event: "something_new" }).kind).toBe(
      "ignored",
    );
    expect(parseRetellSmsWebhook("not an object").kind).toBe("ignored");
    expect(parseRetellSmsWebhook(null).kind).toBe("ignored");
    expect(parseRetellSmsWebhook({ event: "chat_ended" }).kind).toBe("ignored");
  });
});

// ---------------------------------------------------------------------------
// resolveChatNumbers
// ---------------------------------------------------------------------------

describe("resolveChatNumbers", () => {
  it("should read numbers, org, and message id from the metadata echo", () => {
    const chat = chatFixture({
      metadata: {
        odesa: {
          from_number: NUMBERS.fromNumber,
          to_number: NUMBERS.toNumber,
          organization_id: "org-1",
          message_id: "draft-1",
        },
      },
    });
    expect(resolveChatNumbers(chat)).toEqual({
      fromNumber: NUMBERS.fromNumber,
      toNumber: NUMBERS.toNumber,
      organizationId: "org-1",
      messageId: "draft-1",
    });
  });

  it("should fall back to odesa_* dynamic variables when metadata is absent", () => {
    const chat = chatFixture({
      metadata: undefined,
      retell_llm_dynamic_variables: {
        odesa_from_number: NUMBERS.fromNumber,
        odesa_to_number: NUMBERS.toNumber,
        odesa_organization_id: "org-1",
      },
    });
    expect(resolveChatNumbers(chat)).toEqual({
      fromNumber: NUMBERS.fromNumber,
      toNumber: NUMBERS.toNumber,
      organizationId: "org-1",
      messageId: null,
    });
  });

  it("should return null when no echo is present (never guess org/tenant)", () => {
    expect(resolveChatNumbers(chatFixture({ metadata: {} }))).toBeNull();
    expect(
      resolveChatNumbers(
        chatFixture({
          metadata: { odesa: { from_number: NUMBERS.fromNumber } },
        }),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractInboundSmsMessages / extractChatMessages
// ---------------------------------------------------------------------------

describe("extractInboundSmsMessages", () => {
  it("should map user turns to InboundMessages with stable dedup ids", () => {
    const result = extractInboundSmsMessages(chatFixture(), NUMBERS);
    expect(result).toEqual([
      {
        fromE164: NUMBERS.fromNumber,
        toE164: NUMBERS.toNumber,
        body: "my sink is leaking",
        providerMessageId: "msg_user_1",
        provider: "retell",
        receivedAt: new Date(1751980000000).toISOString(),
        providerOccurredAt: new Date(1751980000000).toISOString(),
      },
    ]);
    // Same transcript replayed (chat_ended → chat_analyzed) yields the
    // same providerMessageId — dedup stays stable.
    expect(extractInboundSmsMessages(chatFixture(), NUMBERS)).toEqual(result);
  });

  it("should skip malformed, media-only, and id-less entries without crashing", () => {
    const chat = chatFixture({
      message_with_tool_calls: [
        { message_id: "msg_1", role: "user", content: "text lands" },
        // MMS/media variant: no text content — attachment storage deferred.
        {
          message_id: "msg_2",
          role: "user",
          content: "",
          attachments: ["https://x/img.jpg"],
        },
        { message_id: "msg_3", role: "user" },
        { role: "user", content: "no id → no stable dedup key" },
        {
          message_id: "msg_4",
          role: "tool_call_invocation",
          content: "tool noise",
        },
        "garbage",
        null,
      ],
    });
    const result = extractInboundSmsMessages(chat, NUMBERS);
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe("text lands");
  });

  it("should return an empty list when the chat carries no messages", () => {
    expect(
      extractInboundSmsMessages(
        chatFixture({ message_with_tool_calls: undefined }),
        NUMBERS,
      ),
    ).toEqual([]);
  });
});

describe("extractChatMessages", () => {
  it("should keep agent turns with role, body, and timestamp", () => {
    const turns = extractChatMessages(chatFixture());
    expect(turns).toHaveLength(2);
    expect(turns[1]).toEqual({
      messageId: "msg_agent_1",
      role: "agent",
      body: "Sorry to hear that — logging a ticket now.",
      sentAt: new Date(1751980005000).toISOString(),
    });
  });
});

// ---------------------------------------------------------------------------
// RetellSmsProvider.verifyInbound
// ---------------------------------------------------------------------------

describe("RetellSmsProvider", () => {
  describe("verifyInbound", () => {
    const RAW = '{"event":"chat_ended"}';
    const provider = new RetellSmsProvider();

    it("should accept a valid x-retell-signature HMAC", () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      const result = provider.verifyInbound({
        url: "http://localhost/api/messaging/inbound/retell",
        rawBody: RAW,
        headers: { "x-retell-signature": signRetell(RAW, API_KEY) },
      });
      expect(result).toEqual({ ok: true });
    });

    it("should reject a signature computed with the wrong key", () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      const result = provider.verifyInbound({
        url: "http://localhost/api/messaging/inbound/retell",
        rawBody: RAW,
        headers: { "x-retell-signature": signRetell(RAW, "wrong-key") },
      });
      expect(result.ok).toBe(false);
    });

    it("should fail closed when the signature is missing and enforcement is on", () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      vi.stubEnv("RETELL_REQUIRE_SIGNATURE", "1");
      const result = provider.verifyInbound({
        url: "http://localhost/api/messaging/inbound/retell",
        rawBody: RAW,
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(result.ok).toBe(false);
    });

    it("should allow the bearer fallback only when enforcement is off", () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      vi.stubEnv("RETELL_REQUIRE_SIGNATURE", "");
      const ok = provider.verifyInbound({
        url: "http://localhost/api/messaging/inbound/retell",
        rawBody: RAW,
        headers: { authorization: `Bearer ${API_KEY}` },
      });
      expect(ok).toEqual({ ok: true });

      const bad = provider.verifyInbound({
        url: "http://localhost/api/messaging/inbound/retell",
        rawBody: RAW,
        headers: {},
      });
      expect(bad.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // send
  // -------------------------------------------------------------------------

  describe("send", () => {
    it("should record through the messaging mock without calling fetch", async () => {
      installMessagingMock();
      const fetchSpy = vi.spyOn(global, "fetch");
      const provider = new RetellSmsProvider();
      const result = await provider.send(MSG);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe("retell");
        expect(result.providerMessageId).toMatch(/retell-mock-/);
      }
    });

    it("should honour the mock shouldFail toggle", async () => {
      installMessagingMock();
      setShouldFail("retell", true);
      const provider = new RetellSmsProvider();
      const result = await provider.send(MSG);
      expect(result.ok).toBe(false);
    });

    it("should fail cleanly without fetch when the API key or dispatch agent is missing", async () => {
      // Pin the vars empty — an ambient dev shell exporting them would
      // otherwise turn this into a live POST to api.retellai.com.
      vi.stubEnv("RETELL_API_KEY", "");
      vi.stubEnv("RETELL_SMS_DISPATCH_AGENT_ID", "");
      const fetchSpy = vi.spyOn(global, "fetch");
      const provider = new RetellSmsProvider();
      const result = await provider.send(MSG);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          "RETELL_API_KEY / RETELL_SMS_DISPATCH_AGENT_ID not set",
        );
      }
    });

    it("should POST create-sms-chat with dispatch agent, verbatim body variable, and metadata echo", async () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      vi.stubEnv("RETELL_SMS_DISPATCH_AGENT_ID", DISPATCH_AGENT_ID);
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValue(makeOkFetchResponse({ chat_id: "chat_new_1" }));
      const provider = new RetellSmsProvider();
      const result = await provider.send({
        ...MSG,
        organizationId: "org-1",
        messageId: "draft-1",
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.retellai.com/create-sms-chat");
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
      expect(JSON.parse(init.body as string)).toEqual({
        from_number: MSG.fromE164,
        to_number: MSG.toE164,
        override_agent_id: DISPATCH_AGENT_ID,
        retell_llm_dynamic_variables: { message_body: MSG.body },
        metadata: {
          odesa: {
            // Inverted on purpose: inbound orientation (from = tenant).
            from_number: MSG.toE164,
            to_number: MSG.fromE164,
            organization_id: "org-1",
            message_id: "draft-1",
          },
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe("retell");
        expect(result.providerMessageId).toBe("chat_new_1");
      }
    });

    it("should fail when a 200 response has no chat_id", async () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      vi.stubEnv("RETELL_SMS_DISPATCH_AGENT_ID", DISPATCH_AGENT_ID);
      vi.spyOn(global, "fetch").mockResolvedValue(makeOkFetchResponse({}));
      const result = await new RetellSmsProvider().send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Retell 200 missing chat_id");
    });

    it("should surface API errors with status and body", async () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      vi.stubEnv("RETELL_SMS_DISPATCH_AGENT_ID", DISPATCH_AGENT_ID);
      vi.spyOn(global, "fetch").mockResolvedValue(
        makeErrFetchResponse(422, "number not A2P approved"),
      );
      const result = await new RetellSmsProvider().send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toBe("Retell 422: number not A2P approved");
    });

    it("should surface thrown fetch errors as clean failures", async () => {
      vi.stubEnv("RETELL_API_KEY", API_KEY);
      vi.stubEnv("RETELL_SMS_DISPATCH_AGENT_ID", DISPATCH_AGENT_ID);
      vi.spyOn(global, "fetch").mockRejectedValueOnce(
        new Error("ECONNREFUSED"),
      );
      const result = await new RetellSmsProvider().send(MSG);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toBe("Retell fetch failed: ECONNREFUSED");
    });
  });
});
