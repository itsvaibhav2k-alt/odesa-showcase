/**
 * Unit tests for `POST /api/messaging/inbound/retell`.
 *
 * Mirrors the approve-route pattern: vi.mock the admin client and the
 * pipeline modules, import POST, call it directly. No network, no real
 * SMS — auth, routing, ingest-without-draft, agent-row dedup, and the
 * dispatch-chat reconcile are all exercised against stubs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/agent/retell-auth", () => ({
  verifyRetellWebhookAuth: vi.fn(),
}));

vi.mock("@/lib/messaging/handle-inbound", () => ({
  handleInbound: vi.fn(),
  resolveConversationForNumbers: vi.fn(),
}));

vi.mock("@/lib/messaging/handle-operator-inbound", () => ({
  handleOperatorInbound: vi.fn(),
}));

vi.mock("@/lib/messaging/route-inbound", () => ({
  routeInbound: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyRetellWebhookAuth } from "@/lib/agent/retell-auth";
import {
  handleInbound,
  resolveConversationForNumbers,
} from "@/lib/messaging/handle-inbound";
import { handleOperatorInbound } from "@/lib/messaging/handle-operator-inbound";
import { routeInbound } from "@/lib/messaging/route-inbound";

import { POST } from "../retell/route";

const mockCreateAdmin = vi.mocked(createAdminClient);
const mockAuth = vi.mocked(verifyRetellWebhookAuth);
const mockHandleInbound = vi.mocked(handleInbound);
const mockResolveConversation = vi.mocked(resolveConversationForNumbers);
const mockOperatorInbound = vi.mocked(handleOperatorInbound);
const mockRouteInbound = vi.mocked(routeInbound);

const FROM = "+15555550101";
const TO = "+15555550100";
const ORG_ID = "org-1";
const CONV_ID = "c-1";

// ---------------------------------------------------------------------------
// Stub admin client: per-table response queues; empty queue → benign
// default ({data:null, error:null}) so only interesting responses need
// queueing. Every builder call is recorded for assertions.
// ---------------------------------------------------------------------------

interface StubResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

interface RecordedCall {
  table: string;
  method: string;
  args: unknown[];
}

function stubAdmin(queues: Record<string, StubResponse[]> = {}): {
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const makeChain = (table: string): Record<string, unknown> => {
    const next = (): StubResponse => {
      const queue = queues[table];
      return queue && queue.length > 0
        ? queue.shift()!
        : { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "limit",
    ]) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      });
    }
    chain["maybeSingle"] = vi.fn(async () => next());
    chain["then"] = (resolve: (value: StubResponse) => unknown) =>
      Promise.resolve(next()).then(resolve);
    return chain;
  };
  mockCreateAdmin.mockReturnValue({
    from: vi.fn((table: string) => makeChain(table)),
  } as unknown as ReturnType<typeof createAdminClient>);
  return { calls };
}

function post(body: unknown): ReturnType<typeof POST> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return POST({
    text: async () => raw,
    headers: new Headers(),
  } as unknown as NextRequest);
}

function authOk(): void {
  mockAuth.mockReturnValue({ ok: true });
}

function chatEvent(
  event: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event,
    chat: {
      chat_id: "chat_abc",
      chat_type: "sms_chat",
      metadata: {
        odesa: { from_number: FROM, to_number: TO, organization_id: ORG_ID },
      },
      message_with_tool_calls: [
        {
          message_id: "msg_user_1",
          role: "user",
          content: "my sink is leaking",
          created_timestamp: 1751980000000,
        },
        {
          message_id: "msg_agent_1",
          role: "agent",
          content: "Logging a ticket now.",
          created_timestamp: 1751980005000,
        },
      ],
      ...overrides,
    },
  };
}

function tenantIngestOk(conversationId = CONV_ID): void {
  mockRouteInbound.mockResolvedValue({
    kind: "tenant",
    organizationId: ORG_ID,
  });
  mockHandleInbound.mockResolvedValue({
    ok: true,
    draftSkipped: true,
    conversationId,
    inboundMessageId: "m-1",
  });
  mockResolveConversation.mockResolvedValue({
    organizationId: ORG_ID,
    conversationId,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/messaging/inbound/retell", () => {
  it("should return 401 without touching the pipeline when auth fails", async () => {
    mockAuth.mockReturnValue({
      ok: false,
      response: NextResponse.json(
        { error: "invalid signature" },
        { status: 401 },
      ),
    });
    stubAdmin();

    const res = await post(chatEvent("chat_ended"));

    expect(res.status).toBe(401);
    expect(mockRouteInbound).not.toHaveBeenCalled();
    expect(mockHandleInbound).not.toHaveBeenCalled();
  });

  it("should ack empty verification pings with 200", async () => {
    authOk();
    stubAdmin();
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, mode: "verification" });
  });

  it("should return 400 for invalid JSON", async () => {
    authOk();
    stubAdmin();
    const res = await post("not-json{");
    expect(res.status).toBe(400);
  });

  it("should 200-ignore unrecognized events (no retry storms)", async () => {
    authOk();
    stubAdmin();
    const res = await post({ event: "call_ended", call: {} });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored: boolean };
    expect(body.ignored).toBe(true);
    expect(mockRouteInbound).not.toHaveBeenCalled();
  });

  it("should answer chat_inbound with the metadata/dynamic-variables echo", async () => {
    authOk();
    stubAdmin({ organizations: [{ data: { id: ORG_ID }, error: null }] });

    const res = await post({
      event: "chat_inbound",
      agent_id: "agent_sms_1",
      from_number: FROM,
      to_number: TO,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      chat_inbound: {
        metadata: {
          odesa: { from_number: FROM, to_number: TO, organization_id: ORG_ID },
        },
        dynamic_variables: {
          odesa_from_number: FROM,
          odesa_to_number: TO,
          odesa_organization_id: ORG_ID,
        },
      },
    });
  });

  it("should answer chat_inbound for an unknown org with an empty 200", async () => {
    authOk();
    stubAdmin(); // organizations default → no row
    const res = await post({
      event: "chat_inbound",
      from_number: FROM,
      to_number: TO,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("should skip uncorrelatable chats with 200 and never guess org/tenant", async () => {
    authOk();
    stubAdmin();
    const res = await post(chatEvent("chat_ended", { metadata: {} }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { skipped: string } };
    expect(body.data.skipped).toBe("uncorrelatable_chat");
    expect(mockRouteInbound).not.toHaveBeenCalled();
    expect(mockHandleInbound).not.toHaveBeenCalled();
  });

  it("should skip unknown_org chats with 200", async () => {
    authOk();
    stubAdmin();
    mockRouteInbound.mockResolvedValue({ kind: "unknown_org" });
    const res = await post(chatEvent("chat_ended"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { skipped: string } };
    expect(body.data.skipped).toBe("unknown_org");
    expect(mockHandleInbound).not.toHaveBeenCalled();
  });

  it("should skip operator-origin chats WITHOUT calling handleOperatorInbound", async () => {
    authOk();
    stubAdmin();
    mockRouteInbound.mockResolvedValue({
      kind: "operator",
      user: { id: "u-1", organizationId: ORG_ID, phoneE164: FROM },
    });

    const res = await post(chatEvent("chat_ended"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { skipped: string } };
    expect(body.data.skipped).toBe("operator_legacy_channel");
    expect(mockOperatorInbound).not.toHaveBeenCalled();
    expect(mockHandleInbound).not.toHaveBeenCalled();
  });

  it("should ingest tenant turns without drafting and record agent turns as auto_sent rows", async () => {
    authOk();
    const { calls } = stubAdmin();
    tenantIngestOk();

    const res = await post(chatEvent("chat_ended"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, number>;
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      ingested: 1,
      duplicates: 0,
      agentInserted: 1,
      reconciled: 0,
    });

    // Tenant turn: ingest-only mode, correct InboundMessage.
    expect(mockHandleInbound).toHaveBeenCalledTimes(1);
    expect(mockHandleInbound).toHaveBeenCalledWith(
      {
        fromE164: FROM,
        toE164: TO,
        body: "my sink is leaking",
        providerMessageId: "msg_user_1",
        provider: "retell",
        receivedAt: new Date(1751980000000).toISOString(),
        providerOccurredAt: new Date(1751980000000).toISOString(),
      },
      { skipDraft: true },
    );

    // Agent turn: dedup claim first, then the outbound row.
    const claim = calls.find(
      (c) => c.table === "inbound_webhook_dedup" && c.method === "insert",
    );
    expect(claim?.args[0]).toEqual({
      provider: "retell",
      provider_message_id: "msg_agent_1",
    });
    const inserts = calls.filter(
      (c) => c.table === "messages" && c.method === "insert",
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.args[0]).toEqual({
      organization_id: ORG_ID,
      conversation_id: CONV_ID,
      direction: "outbound",
      provider: "retell",
      body: "Logging a ticket now.",
      draft_status: "auto_sent",
      sent_at: new Date(1751980005000).toISOString(),
      provider_message_id: "msg_agent_1",
    });
  });

  it("should be replay-safe: chat_ended then chat_analyzed yields exactly one inbound ingest and one agent row", async () => {
    authOk();
    const { calls } = stubAdmin({
      inbound_webhook_dedup: [
        { data: null, error: null },
        { data: null, error: { code: "23505", message: "duplicate key" } },
      ],
    });
    mockRouteInbound.mockResolvedValue({
      kind: "tenant",
      organizationId: ORG_ID,
    });
    mockResolveConversation.mockResolvedValue({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
    });
    mockHandleInbound
      .mockResolvedValueOnce({
        ok: true,
        draftSkipped: true,
        conversationId: CONV_ID,
        inboundMessageId: "m-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        duplicate: true,
        conversationId: CONV_ID,
        inboundMessageId: "m-1",
      });

    const first = await post(chatEvent("chat_ended"));
    const second = await post(chatEvent("chat_analyzed"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { data: Record<string, number> };
    const secondBody = (await second.json()) as {
      data: Record<string, number>;
    };
    expect(firstBody.data).toMatchObject({ ingested: 1, agentInserted: 1 });
    expect(secondBody.data).toMatchObject({
      ingested: 0,
      duplicates: 1,
      agentInserted: 0,
      agentDuplicates: 1,
    });

    const inserts = calls.filter(
      (c) => c.table === "messages" && c.method === "insert",
    );
    expect(inserts).toHaveLength(1);
  });

  it("should reconcile a dispatch chat onto the approved draft row via metadata message_id", async () => {
    authOk();
    const { calls } = stubAdmin({
      messages: [
        // findDispatchDraftRow: metadata message_id lookup hits the draft.
        { data: { id: "draft-1" }, error: null },
      ],
    });
    mockRouteInbound.mockResolvedValue({
      kind: "tenant",
      organizationId: ORG_ID,
    });
    mockResolveConversation.mockResolvedValue({
      organizationId: ORG_ID,
      conversationId: CONV_ID,
    });

    const res = await post(
      chatEvent("chat_ended", {
        chat_id: "chat_dispatch_1",
        metadata: {
          odesa: {
            from_number: FROM,
            to_number: TO,
            organization_id: ORG_ID,
            message_id: "draft-1",
          },
        },
        message_with_tool_calls: [
          {
            message_id: "msg_agent_9",
            role: "agent",
            content: "Your lease renewal is ready.",
            created_timestamp: 1751980010000,
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, number> };
    expect(body.data).toMatchObject({ reconciled: 1, agentInserted: 0 });

    // The draft row was UPDATED with the agent's actual message — no
    // duplicate outbound insert.
    const updates = calls.filter(
      (c) => c.table === "messages" && c.method === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args[0]).toEqual({
      body: "Your lease renewal is ready.",
      sent_at: new Date(1751980010000).toISOString(),
      provider: "retell",
      provider_message_id: "msg_agent_9",
    });
    const inserts = calls.filter(
      (c) => c.table === "messages" && c.method === "insert",
    );
    expect(inserts).toHaveLength(0);
  });

  it("should release the dedup claim when the agent-row insert fails, so the retry is not misread as a duplicate", async () => {
    authOk();
    const { calls } = stubAdmin({
      messages: [
        // findDispatchDraftRow chat_id lookup → no dispatch draft.
        { data: null, error: null },
        // Agent outbound insert blows up after the claim succeeded.
        { data: null, error: { message: "connection reset" } },
      ],
    });
    tenantIngestOk();

    const res = await post(chatEvent("chat_ended"));

    expect(res.status).toBe(500);
    const release = calls.find(
      (c) => c.table === "inbound_webhook_dedup" && c.method === "delete",
    );
    expect(release).toBeDefined();
  });

  it("should reconcile operator-destined dispatch chats onto the draft row before skipping", async () => {
    authOk();
    const { calls } = stubAdmin({
      messages: [{ data: { id: "draft-2" }, error: null }],
    });
    mockRouteInbound.mockResolvedValue({
      kind: "operator",
      user: { id: "u-1", organizationId: ORG_ID, phoneE164: FROM },
    });

    const res = await post(
      chatEvent("chat_ended", {
        chat_id: "chat_dispatch_2",
        metadata: {
          odesa: {
            from_number: FROM,
            to_number: TO,
            organization_id: ORG_ID,
            message_id: "draft-2",
          },
        },
        message_with_tool_calls: [
          {
            message_id: "msg_agent_op_1",
            role: "agent",
            content: "Rent report: all collected.",
            created_timestamp: 1751980020000,
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { skipped: string; reconciled: number };
    };
    expect(body.data.skipped).toBe("operator_legacy_channel");
    expect(body.data.reconciled).toBe(1);
    expect(mockOperatorInbound).not.toHaveBeenCalled();
    expect(mockHandleInbound).not.toHaveBeenCalled();

    const updates = calls.filter(
      (c) => c.table === "messages" && c.method === "update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args[0]).toMatchObject({
      body: "Rent report: all collected.",
      provider_message_id: "msg_agent_op_1",
    });
  });

  it("should return 500 when a tenant ingest fails so the provider retries", async () => {
    authOk();
    stubAdmin();
    mockRouteInbound.mockResolvedValue({
      kind: "tenant",
      organizationId: ORG_ID,
    });
    mockHandleInbound.mockResolvedValue({
      ok: false,
      error: "Inbound insert failed",
    });

    const res = await post(chatEvent("chat_ended"));

    expect(res.status).toBe(500);
  });
});
