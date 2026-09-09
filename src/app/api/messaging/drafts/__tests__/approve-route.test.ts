/**
 * Unit tests for `POST /api/messaging/drafts/[id]/approve`.
 *
 * A2 invariant: approving a draft CAS-claims it
 * 'pending_review' → 'sending' via a conditional update before the
 * provider send. Two concurrent approves race on that claim — exactly
 * one wins and sends; the loser gets a 409 and zero provider calls.
 * Explicit provider failure persists rejected/failed evidence; the same
 * outbound intent is never blindly re-armed for retry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/messaging/send-with-failover", () => ({
  sendWithFailover: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";

import { POST } from "../[id]/approve/route";

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockSend = vi.mocked(sendWithFailover);

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

function stubServerClient(): void {
  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

interface ClaimResp {
  data: { id: string } | null;
  error: null | { message: string };
}

/**
 * Admin client stub. `messages` claims (update writing
 * draft_status='sending') consume the FIFO `claimQueue`; all other
 * message updates (revert / final promote) resolve `{ error: null }`
 * and are recorded in `updateLog`.
 */
function stubAdminClient(opts: {
  claimQueue: ClaimResp[];
  /** users row served to the caller lookup; defaults to an owner. */
  userRow?: Record<string, unknown>;
}): {
  updateLog: Array<Record<string, unknown>>;
} {
  const updateLog: Array<Record<string, unknown>> = [];

  const singleFor = (data: unknown) => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => ({ data, error: null })),
        maybeSingle: vi.fn(async () => ({ data, error: null })),
      })),
    })),
  });

  const from = vi.fn((table: string) => {
    if (table === "messages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: DRAFT_ID,
                organization_id: ORG_ID,
                conversation_id: CONV_ID,
                body: "draft body",
                draft_status: "pending_review",
                direction: "outbound",
              },
              error: null,
            })),
          })),
        })),
        update: vi.fn((values: Record<string, unknown>) => {
          updateLog.push(values);
          const isClaim = values.draft_status === "sending";
          const claimResp = isClaim
            ? (opts.claimQueue.shift() ?? { data: null, error: null })
            : null;
          // One chain object covers every update shape the route uses:
          //   claim:   .update().eq().eq().select().maybeSingle()
          //   revert:  await .update().eq().eq()
          //   promote: await .update().eq()
          const chain: Record<string, unknown> = {};
          chain.eq = vi.fn(() => chain);
          chain.select = vi.fn(() => chain);
          chain.maybeSingle = vi.fn(async () => claimResp);
          chain.then = (resolve: (v: unknown) => unknown) =>
            resolve({ data: null, error: null });
          return chain;
        }),
      };
    }
    if (table === "users") {
      return singleFor(
        opts.userRow ?? { organization_id: ORG_ID, role: "owner" },
      );
    }
    if (table === "conversations") {
      return singleFor({ tenant_id: TENANT_ID });
    }
    if (table === "tenants") {
      return singleFor({ phone_e164: "+15551111111" });
    }
    if (table === "organizations") {
      return singleFor({ odesa_phone_number: "+15550000000" });
    }
    if (table === "action_proposals") {
      // markConversationProposalCommitted: deep-chained select → no match.
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.filter = vi.fn(() => chain);
      chain.order = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      chain.update = vi.fn(() => chain);
      return chain;
    }
    throw new Error(`unexpected from(${table})`);
  });

  mockCreateAdminClient.mockReturnValue({
    from,
  } as unknown as ReturnType<typeof createAdminClient>);

  return { updateLog };
}

function post(): ReturnType<typeof POST> {
  return POST({} as NextRequest, { params: Promise.resolve({ id: DRAFT_ID }) });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/messaging/drafts/[id]/approve", () => {
  it.each([
    { organization_id: ORG_ID, role: "manager" },
    { organization_id: ORG_ID, role: "va" },
    { organization_id: ORG_ID },
  ])(
    "should 403 a non-owner ($role) without claiming or sending",
    async (userRow) => {
      stubServerClient();
      const { updateLog } = stubAdminClient({
        claimQueue: [{ data: { id: DRAFT_ID }, error: null }],
        userRow,
      });

      const res = await post();

      expect(res.status).toBe(403);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body).toEqual({ success: false, error: "Forbidden" });
      expect(mockSend).not.toHaveBeenCalled();
      expect(updateLog).toEqual([]);
    },
  );

  it("should send exactly once and 409 the loser when two approves race", async () => {
    stubServerClient();
    // First conditional claim wins the row; second matches nothing.
    stubAdminClient({
      claimQueue: [
        { data: { id: DRAFT_ID }, error: null },
        { data: null, error: null },
      ],
    });
    mockSend.mockResolvedValue({
      ok: true,
      provider: "linq",
      providerMessageId: "pm-1",
      attempted: ["linq"],
      failedOver: false,
    });

    const [resA, resB] = await Promise.all([post(), post()]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const loser = resA.status === 409 ? resA : resB;
    const body = (await loser.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("Draft is already being sent");
  });

  it("should persist failed evidence when all providers fail", async () => {
    stubServerClient();
    const { updateLog } = stubAdminClient({
      claimQueue: [{ data: { id: DRAFT_ID }, error: null }],
    });
    mockSend.mockResolvedValue({
      ok: false,
      attempted: ["linq", "twilio"],
      errors: [
        { provider: "linq", error: "down" },
        { provider: "twilio", error: "down" },
      ],
    });

    const res = await post();

    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      success: boolean;
      error: string;
      attempted: string[];
    };
    expect(body).toMatchObject({
      success: false,
      error: "All providers failed",
      attempted: ["linq", "twilio"],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(updateLog).toEqual([
      { draft_status: "sending", delivery_status: "approved" },
      {
        draft_status: "rejected",
        delivery_status: "failed",
        delivery_error: "All providers rejected the send",
      },
    ]);
  });

  // -------------------------------------------------------------------------
  // Retell primary (messaging_primary='retell') — primary-only, no fallback
  // -------------------------------------------------------------------------

  it("should send via retell with the org numbers and promote with the chat id when retell is primary", async () => {
    stubServerClient();
    const { updateLog } = stubAdminClient({
      claimQueue: [{ data: { id: DRAFT_ID }, error: null }],
    });
    mockSend.mockResolvedValue({
      ok: true,
      provider: "retell",
      providerMessageId: "chat_dispatch_1",
      attempted: ["retell"],
      failedOver: false,
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(ORG_ID, {
      toE164: "+15551111111",
      fromE164: "+15550000000",
      body: "draft body",
      messageId: DRAFT_ID,
      idempotencyKey: `message:${DRAFT_ID}`,
    });
    expect(updateLog[1]).toMatchObject({
      draft_status: "sent_by_human",
      provider: "retell",
      provider_message_id: "chat_dispatch_1",
    });
  });

  it("should fail cleanly, persist failure, and attempt no fallback when the retell key is missing", async () => {
    stubServerClient();
    const { updateLog } = stubAdminClient({
      claimQueue: [{ data: { id: DRAFT_ID }, error: null }],
    });
    mockSend.mockResolvedValue({
      ok: false,
      attempted: ["retell"],
      errors: [
        {
          provider: "retell",
          error: "RETELL_API_KEY / RETELL_SMS_DISPATCH_AGENT_ID not set",
        },
      ],
    });

    const res = await post();

    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      success: boolean;
      error: string;
      attempted: string[];
    };
    // Primary-only mode: retell has no fallback partner.
    expect(body).toMatchObject({
      success: false,
      error: "All providers failed",
      attempted: ["retell"],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(updateLog).toEqual([
      { draft_status: "sending", delivery_status: "approved" },
      {
        draft_status: "rejected",
        delivery_status: "failed",
        delivery_error: "All providers rejected the send",
      },
    ]);
  });

  it("should persist failed evidence when the retell API errors", async () => {
    stubServerClient();
    const { updateLog } = stubAdminClient({
      claimQueue: [{ data: { id: DRAFT_ID }, error: null }],
    });
    mockSend.mockResolvedValue({
      ok: false,
      attempted: ["retell"],
      errors: [{ provider: "retell", error: "Retell 500: upstream boom" }],
    });

    const res = await post();

    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      success: boolean;
      error: string;
      attempted: string[];
    };
    expect(body).toMatchObject({
      success: false,
      error: "All providers failed",
      attempted: ["retell"],
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(updateLog).toEqual([
      { draft_status: "sending", delivery_status: "approved" },
      {
        draft_status: "rejected",
        delivery_status: "failed",
        delivery_error: "All providers rejected the send",
      },
    ]);
  });

  it("should promote to sent_by_human with the provider id on success", async () => {
    stubServerClient();
    const { updateLog } = stubAdminClient({
      claimQueue: [{ data: { id: DRAFT_ID }, error: null }],
    });
    mockSend.mockResolvedValue({
      ok: true,
      provider: "twilio",
      providerMessageId: "pm-7",
      attempted: ["linq", "twilio"],
      failedOver: true,
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(updateLog[0]).toEqual({
      draft_status: "sending",
      delivery_status: "approved",
    });
    expect(updateLog[1]).toMatchObject({
      draft_status: "sent_by_human",
      provider: "twilio",
      provider_message_id: "pm-7",
    });
  });
});
