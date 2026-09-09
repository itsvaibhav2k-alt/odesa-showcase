/**
 * Inbound message pipeline — Phase 4.
 *
 * Responsibilities (pure-ish; side-effects isolated to Supabase):
 *   1. Resolve the `organizations` row from the Odesa-side phone (the
 *      `to` in the webhook payload) via `odesa_phone_number`.
 *   2. Resolve or create the `tenants` row by `(organization_id, phone_e164)`.
 *   3. Resolve or create an OPEN `conversations` row of channel='sms'
 *      for that tenant.
 *   4. Persist the inbound message (direction='inbound', draft_status
 *      irrelevant for inbound — stored as 'auto_sent' which is the
 *      table default and a reasonable neutral for inbound rows).
 *   5. Fetch the last N turns of history for the Claude draft call.
 *   6. Call `generateDraft()` to get the assistant's suggested reply.
 *   7. Keep worker-authored drafts in their canonical `action_proposals`
 *      artifact. Only deterministic fallback drafts use the legacy
 *      `messages(draft_status='pending_review')` path.
 *   8. Return the review artifact id so the caller can deep-link to it.
 *
 * The caller (route handler) is responsible for signature verification
 * and payload normalisation. This module takes an already-normalised
 * `InboundMessage` so the same code handles both Linq and Twilio.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import {
  generateDraftForTenant,
  type ConversationHistoryTurn,
} from "./claude-draft";
import type { InboundMessage, ProviderChoice } from "./types";
import { applyInboundConsentCommand, parseConsentCommand } from "./consent";

type AdminClient = ReturnType<typeof createAdminClient>;

const HISTORY_WINDOW = 10;

export interface HandleInboundResult {
  ok: true;
  duplicate?: false;
  conversationId: string;
  inboundMessageId: string;
  draftMessageId: string;
  draftBody: string;
  /** Present for canonical worker proposals; omitted for legacy message drafts. */
  draftSource?: "proposal";
}

/**
 * The provider retried a webhook we already processed (same
 * `(provider, provider_message_id)` inbound row). The webhook must
 * still 2xx — a 5xx makes the provider keep retrying — but no new rows
 * were written and draft generation was skipped entirely.
 */
export interface HandleInboundDuplicate {
  ok: true;
  duplicate: true;
  conversationId: string;
  inboundMessageId: string;
}

export interface HandleInboundError {
  ok: false;
  error: string;
}

/**
 * Ingest-only mode result (`{skipDraft: true}` — Retell SMS): the
 * inbound row landed but `generateDraftForTenant` was never called,
 * because the Retell chat agent already answered the tenant directly.
 */
export interface HandleInboundDraftSkipped {
  ok: true;
  duplicate?: false;
  draftSkipped: true;
  conversationId: string;
  inboundMessageId: string;
  consentCommand?: "stop" | "start" | "help";
  consentState?: "unknown" | "opted_in" | "suppressed";
}

export type HandleInboundReturn =
  | HandleInboundResult
  | HandleInboundDraftSkipped
  | HandleInboundDuplicate
  | HandleInboundError;

export type HandleInboundIngestReturn =
  | HandleInboundDraftSkipped
  | HandleInboundDuplicate
  | HandleInboundError;

export interface HandleInboundOptions {
  /** Persist the inbound but never generate a review draft. */
  skipDraft: true;
}

/**
 * Persist the inbound + generate + persist the draft, all via the
 * admin client because webhook callers are unauthenticated.
 *
 * Overloaded so existing callers keep the exact draft-bearing union
 * while `{skipDraft: true}` callers get the distinct ingest-only union
 * (no loosened `draftMessageId`).
 */
export async function handleInbound(
  msg: InboundMessage,
): Promise<HandleInboundReturn>;
export async function handleInbound(
  msg: InboundMessage,
  options: HandleInboundOptions,
): Promise<HandleInboundIngestReturn>;
export async function handleInbound(
  msg: InboundMessage,
  options?: HandleInboundOptions,
): Promise<HandleInboundReturn | HandleInboundIngestReturn> {
  const admin = createAdminClient();

  // Provider webhooks retry on timeout. If this provider message id has
  // already been stored, skip the entire pipeline — especially draft
  // generation — and ack with the existing ids so the provider stops.
  if (msg.providerMessageId) {
    const existing = await findExistingInbound(
      admin,
      msg.provider,
      msg.providerMessageId,
    );
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        conversationId: existing.conversation_id,
        inboundMessageId: existing.id,
      };
    }
  }

  const org = await resolveOrgByOdesaNumber(admin, msg.toE164);
  if (!org) {
    return {
      ok: false,
      error: `No organization found for Odesa number ${msg.toE164}`,
    };
  }

  // Consent commands are applied before any reply drafting. The database
  // transition locks the same recipient row used by the final dispatch
  // claim, so STOP cannot be bypassed by approval/failover call sites.
  const consentCommand = parseConsentCommand(msg.body);
  const consentResult = consentCommand
    ? await applyInboundConsentCommand(org.id, msg, consentCommand)
    : null;

  const tenant = await upsertTenant(admin, org.id, msg.fromE164);
  if (!tenant) return { ok: false, error: "Tenant upsert failed" };

  const conversation = await findOrCreateOpenConversation(
    admin,
    org.id,
    tenant.id,
  );
  if (!conversation) {
    return { ok: false, error: "Conversation upsert failed" };
  }

  const inserted = await insertInboundMessage(
    admin,
    org.id,
    conversation.id,
    msg,
  );
  if (inserted.kind === "failed") {
    return { ok: false, error: "Inbound insert failed" };
  }
  if (inserted.kind === "duplicate") {
    // A concurrent retry won the insert race (23505 on the partial
    // unique index). Surface the duplicate marker — never a 500.
    return {
      ok: true,
      duplicate: true,
      conversationId: inserted.existing?.conversation_id ?? conversation.id,
      inboundMessageId: inserted.existing?.id ?? "",
    };
  }
  const inboundRow = { id: inserted.id };

  // Refresh last_message_at so the Inbox feed orders correctly.
  await admin
    .from("conversations")
    .update({ last_message_at: msg.receivedAt })
    .eq("id", conversation.id);

  if (options?.skipDraft || consentCommand) {
    return {
      ok: true,
      draftSkipped: true,
      conversationId: conversation.id,
      inboundMessageId: inboundRow.id,
      ...(consentCommand && consentResult
        ? { consentCommand, consentState: consentResult.state }
        : {}),
    };
  }

  const history = await loadHistory(admin, conversation.id);
  const draftResult = await generateDraftForTenant({
    admin,
    tenantId: tenant.id,
    conversationId: conversation.id,
    history,
    latestInbound: msg.body,
  });

  // Legacy compatibility: current review-first worker drafts never set this
  // flag. Keep the guard for older/custom draft providers so an already-sent
  // outbound row is never duplicated.
  if (draftResult.autoCommitted) {
    const sent = await loadLatestAutoSentMessage(admin, conversation.id);
    return {
      ok: true,
      conversationId: conversation.id,
      inboundMessageId: inboundRow.id,
      draftMessageId: sent?.id ?? inboundRow.id,
      draftBody: draftResult.body,
    };
  }

  // A worker draft has already been persisted as the canonical Owner Queue
  // proposal by generateDraftForTenant. Do not mint a second independently
  // approvable messages row: two ledgers could otherwise send the same model
  // output twice. Legacy deterministic fallbacks still use messages below.
  if (draftResult.fromWorker) {
    const proposalId = draftResult.proposal?.id;
    if (!proposalId) {
      return { ok: false, error: "Worker draft proposal missing id" };
    }
    return {
      ok: true,
      conversationId: conversation.id,
      inboundMessageId: inboundRow.id,
      draftMessageId: proposalId,
      draftBody: draftResult.body,
      draftSource: "proposal",
    };
  }

  const draftRow = await insertDraftMessage(
    admin,
    org.id,
    conversation.id,
    msg.provider,
    draftResult.body,
  );
  if (!draftRow) return { ok: false, error: "Draft insert failed" };

  return {
    ok: true,
    conversationId: conversation.id,
    inboundMessageId: inboundRow.id,
    draftMessageId: draftRow.id,
    draftBody: draftResult.body,
  };
}

async function loadLatestAutoSentMessage(
  admin: AdminClient,
  conversationId: string,
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("draft_status", "auto_sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Resolve (org, tenant, open sms conversation) for a number pair without
 * ingesting anything — the Retell inbound route needs a conversation for
 * agent-authored outbound rows even when a chat carried no tenant turns.
 * Reuses the exact same helpers as the ingest pipeline above.
 */
export async function resolveConversationForNumbers(
  admin: AdminClient,
  fromE164: string,
  toE164: string,
): Promise<{ organizationId: string; conversationId: string } | null> {
  const org = await resolveOrgByOdesaNumber(admin, toE164);
  if (!org) return null;
  const tenant = await upsertTenant(admin, org.id, fromE164);
  if (!tenant) return null;
  const conversation = await findOrCreateOpenConversation(
    admin,
    org.id,
    tenant.id,
  );
  if (!conversation) return null;
  return { organizationId: org.id, conversationId: conversation.id };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function resolveOrgByOdesaNumber(
  admin: AdminClient,
  toE164: string,
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from("organizations")
    .select("id")
    .eq("odesa_phone_number", toE164)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function upsertTenant(
  admin: AdminClient,
  organizationId: string,
  phoneE164: string,
): Promise<{ id: string } | null> {
  const { data: existing } = await admin
    .from("tenants")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (existing) return existing;

  const insert: Database["public"]["Tables"]["tenants"]["Insert"] = {
    organization_id: organizationId,
    full_name: `Unknown ${phoneE164}`,
    phone_e164: phoneE164,
  };
  const { data: inserted, error } = await admin
    .from("tenants")
    .insert(insert)
    .select("id")
    .single();
  if (error || !inserted) return null;
  return inserted;
}

async function findOrCreateOpenConversation(
  admin: AdminClient,
  organizationId: string,
  tenantId: string,
): Promise<{ id: string } | null> {
  const { data: open } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("tenant_id", tenantId)
    .eq("channel", "sms")
    .eq("status", "open")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (open) return open;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      tenant_id: tenantId,
      channel: "sms",
      status: "open",
    })
    .select("id")
    .single();
  if (error || !created) return null;
  return created;
}

interface ExistingInboundRow {
  id: string;
  conversation_id: string;
}

type InsertInboundOutcome =
  | { kind: "inserted"; id: string }
  | { kind: "duplicate"; existing: ExistingInboundRow | null }
  | { kind: "failed" };

async function findExistingInbound(
  admin: AdminClient,
  provider: ProviderChoice,
  providerMessageId: string,
): Promise<ExistingInboundRow | null> {
  const { data } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("provider", provider)
    .eq("provider_message_id", providerMessageId)
    .eq("direction", "inbound")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function insertInboundMessage(
  admin: AdminClient,
  organizationId: string,
  conversationId: string,
  msg: InboundMessage,
): Promise<InsertInboundOutcome> {
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      direction: "inbound",
      provider: msg.provider,
      body: msg.body,
      draft_status: "auto_sent",
      sent_at: msg.receivedAt,
      provider_message_id: msg.providerMessageId ?? null,
      delivery_status: "delivered",
      delivered_at: msg.receivedAt,
      delivery_status_updated_at: msg.receivedAt,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = unique violation on uq_messages_inbound_provider_msg —
    // a concurrent webhook retry inserted the row between our dedup
    // pre-check and this insert. Re-select the winner so the caller can
    // return the duplicate marker (the webhook must 2xx, never 500).
    if (error.code === "23505" && msg.providerMessageId) {
      const existing = await findExistingInbound(
        admin,
        msg.provider,
        msg.providerMessageId,
      );
      return { kind: "duplicate", existing };
    }
    return { kind: "failed" };
  }
  if (!data) return { kind: "failed" };
  return { kind: "inserted", id: data.id };
}

async function insertDraftMessage(
  admin: AdminClient,
  organizationId: string,
  conversationId: string,
  provider: ProviderChoice,
  body: string,
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      direction: "outbound",
      provider,
      body,
      draft_status: "pending_review",
      sent_at: null,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data;
}

async function loadHistory(
  admin: AdminClient,
  conversationId: string,
): Promise<ConversationHistoryTurn[]> {
  const { data } = await admin
    .from("messages")
    .select("direction, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_WINDOW);
  if (!data) return [];
  return data
    .filter((r) => r.body != null && r.body.length > 0)
    .map(
      (r): ConversationHistoryTurn => ({
        role: r.direction === "inbound" ? "tenant" : "assistant",
        body: r.body as string,
      }),
    );
}
