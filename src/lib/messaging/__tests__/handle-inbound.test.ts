/**
 * Unit tests for handleInbound's webhook dedup behavior (Phase A1).
 *
 * Mocks the admin client (table-keyed response queues, mirroring the
 * mock-supabase pattern in handle-operator-inbound.test.ts) and the
 * claude-draft module so the dedup pipeline is the only thing
 * exercised:
 *   - existing (provider, provider_message_id, inbound) row → early
 *     duplicate return, draft generation skipped entirely
 *   - 23505 on the inbound insert (concurrent retry race) → re-select,
 *     duplicate marker, never ok:false (the webhook must 2xx)
 *   - missing providerMessageId → no dedup pre-check, normal flow
 *   - providerMessageId present but unseen → normal flow
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleInbound } from "../handle-inbound";
import type { InboundMessage } from "../types";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("../claude-draft", () => ({
  generateDraftForTenant: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { generateDraftForTenant } from "../claude-draft";

const mockCreateAdmin = vi.mocked(createAdminClient);
const mockGenerateDraft = vi.mocked(generateDraftForTenant);

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    fromE164: "+15555550100",
    toE164: "+15551234567",
    body: "hi, my sink is leaking",
    provider: "linq",
    receivedAt: "2026-06-10T00:00:00Z",
    providerMessageId: "pm-1",
    ...overrides,
  };
}

interface StubResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/**
 * Build a stub admin client backed by per-table response queues. Every
 * builder method returns the same chain; each terminal call
 * (maybeSingle / single / direct await) consumes the next queued
 * response for that table, in call order. Throws when a table runs dry
 * so a missing stub fails loudly instead of hanging.
 */
function makeAdmin(
  queues: Record<string, StubResponse[]>,
): SupabaseClient<Database> {
  const makeChain = (table: string): Record<string, unknown> => {
    const next = (): StubResponse => {
      const queue = queues[table];
      if (!queue || queue.length === 0) {
        throw new Error(`No stub response queued for table "${table}"`);
      }
      return queue.shift()!;
    };
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "eq",
      "order",
      "limit",
    ]) {
      chain[method] = vi.fn(() => chain);
    }
    chain["maybeSingle"] = vi.fn(async () => next());
    chain["single"] = vi.fn(async () => next());
    chain["then"] = (resolve: (value: StubResponse) => unknown) =>
      Promise.resolve(next()).then(resolve);
    return chain;
  };
  const from = vi.fn((table: string) => makeChain(table));
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateDraft.mockResolvedValue({
    body: "draft body",
    autoCommitted: false,
  } as Awaited<ReturnType<typeof generateDraftForTenant>>);
});

describe("handleInbound", () => {
  describe("dedup pre-check", () => {
    it("should return duplicate with existing ids and skip draft generation when the provider message id is already stored", async () => {
      const admin = makeAdmin({
        messages: [
          { data: { id: "m-1", conversation_id: "c-1" }, error: null },
        ],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(inbound());

      expect(res).toEqual({
        ok: true,
        duplicate: true,
        conversationId: "c-1",
        inboundMessageId: "m-1",
      });
      expect(mockGenerateDraft).not.toHaveBeenCalled();
      // Pipeline never reached org resolution.
      expect(vi.mocked(admin.from)).not.toHaveBeenCalledWith("organizations");
    });

    it("should skip the pre-check entirely when providerMessageId is absent", async () => {
      const admin = makeAdmin({
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [
          { data: { id: "c-1" }, error: null },
          { data: null, error: null },
        ],
        messages: [
          { data: { id: "m-1" }, error: null },
          { data: [], error: null },
          { data: { id: "d-1" }, error: null },
        ],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(
        inbound({ providerMessageId: undefined }),
      );

      expect(res).toEqual({
        ok: true,
        conversationId: "c-1",
        inboundMessageId: "m-1",
        draftMessageId: "d-1",
        draftBody: "draft body",
      });
      expect(mockGenerateDraft).toHaveBeenCalledOnce();
      // First table touched is organizations — no dedup select ran.
      expect(vi.mocked(admin.from).mock.calls[0]![0]).toBe("organizations");
    });

    it("should process normally when providerMessageId is present but unseen", async () => {
      const admin = makeAdmin({
        messages: [
          { data: null, error: null },
          { data: { id: "m-1" }, error: null },
          { data: [], error: null },
          { data: { id: "d-1" }, error: null },
        ],
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [
          { data: { id: "c-1" }, error: null },
          { data: null, error: null },
        ],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(inbound());

      expect(res.ok).toBe(true);
      if (res.ok && !res.duplicate && "draftMessageId" in res) {
        expect(res.draftMessageId).toBe("d-1");
      }
      expect(mockGenerateDraft).toHaveBeenCalledOnce();
    });

    it("keeps a worker draft as one canonical proposal and creates no parallel message draft", async () => {
      mockGenerateDraft.mockResolvedValueOnce({
        body: "Grounded worker draft",
        fromWorker: true,
        autoCommitted: false,
        proposal: {
          id: "proposal-1",
          organizationId: "org-1",
          propertyId: "property-1",
          workerModel: "hosted-haiku",
          action_type: "draft_sms_reply",
          payload: { body: "Grounded worker draft", tone: "warm" },
          reasoning: "Tenant asked for an update",
          confidence: 0.9,
          context_fact_ids: [],
          routing: null,
          gate_decision: "review",
          status: "proposed",
          createdAt: "2026-06-10T00:00:01Z",
        },
      });
      const admin = makeAdmin({
        messages: [
          { data: null, error: null }, // dedup lookup
          { data: { id: "m-1" }, error: null }, // inbound insert
          { data: [], error: null }, // history
        ],
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [
          { data: { id: "c-1" }, error: null },
          { data: null, error: null },
        ],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const result = await handleInbound(inbound());

      expect(result).toEqual({
        ok: true,
        conversationId: "c-1",
        inboundMessageId: "m-1",
        draftMessageId: "proposal-1",
        draftBody: "Grounded worker draft",
        draftSource: "proposal",
      });
      // Exactly three message-table operations above. A fourth would be the
      // duplicate pending_review artifact this invariant forbids.
      const fromCalls = vi.mocked(admin.from).mock.calls as unknown as Array<
        [string]
      >;
      expect(fromCalls.filter(([table]) => table === "messages")).toHaveLength(3);
    });
  });

  describe("skipDraft (Retell ingest-only mode)", () => {
    it("should persist the inbound and return draftSkipped without ever generating a draft", async () => {
      const admin = makeAdmin({
        messages: [
          { data: null, error: null },
          { data: { id: "m-1" }, error: null },
        ],
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [
          { data: { id: "c-1" }, error: null },
          { data: null, error: null },
        ],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(
        inbound({ provider: "retell", providerMessageId: "msg_user_1" }),
        { skipDraft: true },
      );

      expect(res).toEqual({
        ok: true,
        draftSkipped: true,
        conversationId: "c-1",
        inboundMessageId: "m-1",
      });
      expect(mockGenerateDraft).not.toHaveBeenCalled();
    });

    it("should still dedup provider retries in skipDraft mode", async () => {
      const admin = makeAdmin({
        messages: [
          { data: { id: "m-1", conversation_id: "c-1" }, error: null },
        ],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(
        inbound({ provider: "retell", providerMessageId: "msg_user_1" }),
        { skipDraft: true },
      );

      expect(res).toEqual({
        ok: true,
        duplicate: true,
        conversationId: "c-1",
        inboundMessageId: "m-1",
      });
      expect(mockGenerateDraft).not.toHaveBeenCalled();
    });
  });

  describe("insert race (23505)", () => {
    it("should re-select and return the duplicate marker when the insert hits 23505", async () => {
      const admin = makeAdmin({
        messages: [
          { data: null, error: null },
          { data: null, error: { code: "23505", message: "duplicate key" } },
          { data: { id: "m-1", conversation_id: "c-1" }, error: null },
        ],
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [{ data: { id: "c-1" }, error: null }],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(inbound());

      expect(res).toEqual({
        ok: true,
        duplicate: true,
        conversationId: "c-1",
        inboundMessageId: "m-1",
      });
      expect(mockGenerateDraft).not.toHaveBeenCalled();
    });

    it("should still return ok:true duplicate (never an error) when the post-23505 re-select misses", async () => {
      const admin = makeAdmin({
        messages: [
          { data: null, error: null },
          { data: null, error: { code: "23505", message: "duplicate key" } },
          { data: null, error: null },
        ],
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [{ data: { id: "c-1" }, error: null }],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(inbound());

      expect(res.ok).toBe(true);
      if (res.ok) expect(res.duplicate).toBe(true);
      expect(mockGenerateDraft).not.toHaveBeenCalled();
    });

    it("should return ok:false when the insert fails with a non-duplicate error", async () => {
      const admin = makeAdmin({
        messages: [
          { data: null, error: null },
          {
            data: null,
            error: { code: "57014", message: "statement timeout" },
          },
        ],
        organizations: [{ data: { id: "org-1" }, error: null }],
        tenants: [{ data: { id: "t-1" }, error: null }],
        conversations: [{ data: { id: "c-1" }, error: null }],
      });
      mockCreateAdmin.mockReturnValue(admin);

      const res = await handleInbound(inbound());

      expect(res).toEqual({ ok: false, error: "Inbound insert failed" });
      expect(mockGenerateDraft).not.toHaveBeenCalled();
    });
  });
});
