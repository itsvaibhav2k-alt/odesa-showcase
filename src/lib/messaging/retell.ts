/**
 * Retell SMS messaging provider — Retell SMS unification (2026-07-09).
 *
 * Retell's SMS surface has TWO webhook families (research note):
 *   - `chat_inbound` (phone-number level): fires on the first tenant text
 *     with ONLY `{agent_id, from_number, to_number}` — no body, no chat id.
 *     Our route answers it with a metadata/dynamic-variables echo so later
 *     chat events can be correlated back to numbers + org.
 *   - Chat lifecycle events (agent level): `chat_started` / `chat_ended` /
 *     `chat_analyzed` with the full `chat` object (transcript in
 *     `message_with_tool_calls`). The chat object carries NO phone numbers —
 *     `resolveChatNumbers` reads them back out of the echoed metadata.
 *
 * Outbound sends go through `POST /create-sms-chat` against a dedicated
 * dispatch agent prompted to send `{{message_body}}` verbatim. There is no
 * custom-body field on the API — the send is LLM-mediated, so the returned
 * `chat_id` is the provider message id and ground truth is reconciled when
 * the dispatch chat's own lifecycle webhook lands.
 *
 * Signature scheme: the same `x-retell-signature` HMAC as voice —
 * `verifyRetellSignature` from the voice adapter is reused byte-for-byte,
 * with the same `RETELL_REQUIRE_SIGNATURE` fail-closed policy as
 * `retell-auth.ts`.
 */

import type { MessagingProvider, VerifyInboundRequest } from "./provider";
import type {
  InboundMessage,
  OutboundMessage,
  SendResult,
  VerifyResult,
} from "./types";
import { getMessagingMockState, recordMockSend } from "./test-hooks";
import { verifyRetellSignature } from "@/lib/voice/providers/retell-adapter";

const CREATE_SMS_CHAT_URL = "https://api.retellai.com/create-sms-chat";

// ---------------------------------------------------------------------------
// Webhook payload shapes (verified contract — docs.retellai.com)
// ---------------------------------------------------------------------------

/** One entry of `chat.message_with_tool_calls`, normalised defensively. */
export interface RetellChatMessage {
  messageId: string;
  role: "agent" | "user";
  body: string;
  /** ISO timestamp derived from `created_timestamp` (epoch ms). */
  sentAt: string;
}

/** The chat object carried by chat lifecycle webhook events. */
export interface RetellChat {
  chat_id: string;
  agent_id?: string;
  chat_type?: string;
  chat_status?: string;
  transcript?: string;
  message_with_tool_calls?: unknown[];
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
  start_timestamp?: number;
  end_timestamp?: number;
}

export type RetellSmsChatEventName =
  | "chat_started"
  | "chat_ended"
  | "chat_analyzed";

export type ParsedRetellSmsWebhook =
  | {
      kind: "chat_inbound";
      fromNumber: string;
      toNumber: string;
      agentId: string | null;
    }
  | { kind: "chat_event"; event: RetellSmsChatEventName; chat: RetellChat }
  | { kind: "ignored"; eventName: string };

const CHAT_EVENTS = new Set<string>([
  "chat_started",
  "chat_ended",
  "chat_analyzed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Discriminate a Retell SMS webhook body. Never throws; anything that is
 * not a recognisable `chat_inbound` or `sms_chat` lifecycle event comes
 * back as `{kind:'ignored'}` so the route can 200 without retry storms.
 * Voice `call_*` events (mispointed webhooks) are ignored here — voice
 * parsing stays in `parseRetellWebhookPayload` untouched.
 */
export function parseRetellSmsWebhook(body: unknown): ParsedRetellSmsWebhook {
  if (!isRecord(body)) return { kind: "ignored", eventName: "non_object" };
  const event = asString(body.event) ?? "missing_event";

  if (event === "chat_inbound") {
    const fromNumber = asString(body.from_number);
    const toNumber = asString(body.to_number);
    if (!fromNumber || !toNumber) {
      return { kind: "ignored", eventName: "chat_inbound_missing_numbers" };
    }
    return {
      kind: "chat_inbound",
      fromNumber,
      toNumber,
      agentId: asString(body.agent_id),
    };
  }

  if (CHAT_EVENTS.has(event)) {
    const chat = body.chat;
    if (!isRecord(chat) || !asString(chat.chat_id)) {
      return { kind: "ignored", eventName: `${event}_missing_chat` };
    }
    // SMS chats only — web/voice chats are someone else's pipeline.
    if (chat.chat_type !== "sms_chat") {
      return { kind: "ignored", eventName: `${event}_non_sms_chat` };
    }
    return {
      kind: "chat_event",
      event: event as RetellSmsChatEventName,
      chat: chat as unknown as RetellChat,
    };
  }

  return { kind: "ignored", eventName: event };
}

/** Numbers (+ optional correlation ids) recovered from the metadata echo. */
export interface ResolvedChatNumbers {
  /** The tenant's number in E.164. */
  fromNumber: string;
  /** The Odesa number in E.164. */
  toNumber: string;
  organizationId: string | null;
  /** Draft `messages.id` when this chat is a dispatch send. */
  messageId: string | null;
}

/**
 * Recover the phone numbers we echoed into `metadata.odesa` (from the
 * `chat_inbound` response or the `create-sms-chat` body), falling back to
 * the `odesa_*` dynamic variables. Returns null when the chat carries no
 * echo — the caller must skip rather than guess org/tenant.
 */
export function resolveChatNumbers(
  chat: RetellChat,
): ResolvedChatNumbers | null {
  const sources: Array<Record<string, unknown>> = [];
  if (isRecord(chat.metadata) && isRecord(chat.metadata.odesa)) {
    sources.push(chat.metadata.odesa);
  }
  const dyn = chat.retell_llm_dynamic_variables;
  if (isRecord(dyn)) {
    sources.push({
      from_number: dyn.odesa_from_number,
      to_number: dyn.odesa_to_number,
      organization_id: dyn.odesa_organization_id,
      message_id: dyn.odesa_message_id,
    });
  }
  for (const source of sources) {
    const fromNumber = asString(source.from_number);
    const toNumber = asString(source.to_number);
    if (fromNumber && toNumber) {
      return {
        fromNumber,
        toNumber,
        organizationId: asString(source.organization_id),
        messageId: asString(source.message_id),
      };
    }
  }
  return null;
}

/**
 * Normalise `chat.message_with_tool_calls` into text turns. Entries
 * without a stable `message_id`, a known role, or a non-empty text body
 * (e.g. media-only MMS variants, tool invocations) are skipped — text
 * still lands, attachments are deferred (no storage schema invented).
 */
export function extractChatMessages(chat: RetellChat): RetellChatMessage[] {
  const raw = Array.isArray(chat.message_with_tool_calls)
    ? chat.message_with_tool_calls
    : [];
  const out: RetellChatMessage[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const messageId = asString(entry.message_id);
    const role = entry.role;
    const body = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!messageId || (role !== "agent" && role !== "user") || !body) continue;
    const ts =
      typeof entry.created_timestamp === "number"
        ? entry.created_timestamp
        : null;
    out.push({
      messageId,
      role,
      body,
      sentAt: ts ? new Date(ts).toISOString() : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * Tenant (`role:'user'`) turns as pipeline-ready `InboundMessage`s.
 * `providerMessageId = message_id` keeps dedup stable across the
 * chat_ended → chat_analyzed transcript replay.
 */
export function extractInboundSmsMessages(
  chat: RetellChat,
  numbers: Pick<ResolvedChatNumbers, "fromNumber" | "toNumber">,
): InboundMessage[] {
  return extractChatMessages(chat)
    .filter((m) => m.role === "user")
    .map(
      (m): InboundMessage => ({
        fromE164: numbers.fromNumber,
        toE164: numbers.toNumber,
        body: m.body,
        providerMessageId: m.messageId,
        provider: "retell",
        receivedAt: m.sentAt,
        providerOccurredAt: m.sentAt,
      }),
    );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class RetellSmsProvider implements MessagingProvider {
  readonly name = "retell" as const;

  /**
   * Same signature-first, fail-closed policy as
   * `verifyRetellWebhookAuth` (retell-auth.ts), minus the bearer
   * fallback's NextRequest coupling: signature present → HMAC verify;
   * absent + RETELL_REQUIRE_SIGNATURE → reject; absent + enforcement
   * off → accept a matching `Authorization: Bearer` header only.
   */
  verifyInbound(req: VerifyInboundRequest): VerifyResult {
    const apiKey = process.env.RETELL_API_KEY ?? "";
    const signature = req.headers["x-retell-signature"];
    if (signature) {
      if (!apiKey || !verifyRetellSignature(req.rawBody, signature, apiKey)) {
        return { ok: false, reason: "Signature mismatch" };
      }
      return { ok: true };
    }
    const requireSignature =
      process.env.RETELL_REQUIRE_SIGNATURE === "1" ||
      process.env.RETELL_REQUIRE_SIGNATURE === "true";
    if (requireSignature) {
      return { ok: false, reason: "Missing signature" };
    }
    if (apiKey && req.headers["authorization"] === `Bearer ${apiKey}`) {
      return { ok: true };
    }
    return { ok: false, reason: "Missing signature" };
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    // Test-only short-circuit — the messaging mock guarantees no real
    // SMS ever leaves a test run. Production never installs it.
    const mock = getMessagingMockState();
    if (mock) {
      if (mock.shouldTimeoutAfterAccept.retell) {
        recordMockSend("retell", msg);
        return {
          ok: false,
          provider: this.name,
          error: "retell mock ambiguous timeout",
          certainty: "ambiguous",
        };
      }
      if (mock.shouldFail.retell) {
        return {
          ok: false,
          provider: this.name,
          error: "retell mock forced failure",
        };
      }
      const providerMessageId = recordMockSend("retell", msg);
      return { ok: true, provider: this.name, providerMessageId };
    }

    const apiKey = process.env.RETELL_API_KEY;
    const dispatchAgentId = process.env.RETELL_SMS_DISPATCH_AGENT_ID;
    if (!apiKey || !dispatchAgentId) {
      return {
        ok: false,
        provider: this.name,
        error: "RETELL_API_KEY / RETELL_SMS_DISPATCH_AGENT_ID not set",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(CREATE_SMS_CHAT_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(msg.idempotencyKey
            ? { "Idempotency-Key": msg.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({
          from_number: msg.fromE164,
          to_number: msg.toE164,
          override_agent_id: dispatchAgentId,
          // The dispatch agent's prompt sends {{message_body}} verbatim.
          retell_llm_dynamic_variables: { message_body: msg.body },
          // Metadata echo, oriented like our INBOUND convention (from =
          // tenant, to = Odesa number) so `resolveChatNumbers` reads the
          // dispatch chat's lifecycle webhooks the same way as inbound
          // chats, and the route can reconcile onto the draft row.
          metadata: {
            odesa: {
              from_number: msg.toE164,
              to_number: msg.fromE164,
              ...(msg.organizationId
                ? { organization_id: msg.organizationId }
                : {}),
              ...(msg.messageId ? { message_id: msg.messageId } : {}),
            },
          },
        }),
      });

      clearTimeout(timer);

      if (res.ok) {
        const json = (await res.json()) as { chat_id?: string };
        if (!json.chat_id) {
          return {
            ok: false,
            provider: this.name,
            error: "Retell 200 missing chat_id",
          };
        }
        return {
          ok: true,
          provider: this.name,
          providerMessageId: json.chat_id,
        };
      }

      const text = await res.text().catch(() => "");
      return {
        ok: false,
        provider: this.name,
        error: `Retell ${res.status}: ${text.slice(0, 200)}`,
        certainty: res.status >= 500 ? "ambiguous" : "definitive",
      };
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        provider: this.name,
        error: `Retell fetch failed: ${message}`,
        certainty: "ambiguous",
      };
    }
  }
}
