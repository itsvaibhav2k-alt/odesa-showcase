/**
 * Shared messaging types — Phase 4.
 *
 * Everything provider-agnostic that crosses module boundaries lives
 * here. Provider-specific shapes stay inside `linq.ts` / `twilio.ts`
 * and are normalized to these types before leaving those modules.
 */

import type {
  MessageDraftStatus,
  MessagingProviderChoice,
  MessageProvider,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Re-exports (so consumers can import from one place)
// ---------------------------------------------------------------------------

export type { MessageDraftStatus, MessagingProviderChoice, MessageProvider };

/**
 * Which provider a call is destined for (or came from). Widened to
 * include `'retell'` (2026-07-09 Retell SMS unification) via the
 * `messaging_provider_choice` enum in `@/types/database`.
 */
export type ProviderChoice = MessagingProviderChoice;

/** Normalised inbound message shape — provider-agnostic. */
export interface InboundMessage {
  /** Caller-ID in E.164, e.g. `+15715550201`. */
  fromE164: string;
  /** Receiving Odesa number in E.164. */
  toE164: string;
  /** The tenant's text body. Trimmed. */
  body: string;
  /** Provider-supplied message id for dedup. May be absent in legacy replays. */
  providerMessageId?: string;
  /** Which wire-level provider delivered this message. */
  provider: ProviderChoice;
  /** ISO timestamp the provider says the tenant sent. */
  receivedAt: string;
  /** Provider-authored occurrence time; absent means ordering is ambiguous. */
  providerOccurredAt?: string;
}

/** Outbound message payload handed to a `MessagingProvider.send()`. */
export interface OutboundMessage {
  /** Destination in E.164. */
  toE164: string;
  /** Odesa number in E.164 to send from. */
  fromE164: string;
  /** Text body. */
  body: string;
  /**
   * Correlation ids echoed back on provider webhooks (Retell only —
   * `create-sms-chat` metadata). `organizationId` is enriched by
   * `sendWithFailover`; `messageId` is the draft `messages.id` when the
   * caller threads it, letting the dispatch-chat webhook reconcile onto
   * the existing row. Linq/Twilio ignore these.
   */
  organizationId?: string;
  messageId?: string;
  /** Stable application identifier reused across retries. */
  idempotencyKey?: string;
}

export type OutboundDispatchMessage = OutboundMessage & {
  idempotencyKey: string;
};

/** Successful send result. */
export interface SendSuccess {
  ok: true;
  provider: ProviderChoice;
  providerMessageId: string;
}

/** Failed send result — callers decide whether to fail over. */
export interface SendFailure {
  ok: false;
  provider: ProviderChoice;
  error: string;
  /** Ambiguous means the request may have reached the provider. Never fail over. */
  certainty?: "definitive" | "ambiguous";
}

export type SendResult = SendSuccess | SendFailure;

/** Result of verifying a webhook signature. */
export type VerifyResult = { ok: true } | { ok: false; reason: string };
