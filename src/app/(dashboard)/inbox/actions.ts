"use server";

/**
 * `/inbox` server actions — wave 3.
 *
 * Thin wrappers used by the inbox client UI. Each action:
 *
 *   1. Verifies the caller is signed in via `createServerClient()`
 *      (auth-aware, RLS-bound).
 *   2. Looks up the caller's organization id from `users` so we can
 *      enforce the cross-org check before touching admin-client paths.
 *   3. Dispatches to either:
 *        - the messages-drafts approve/reject/edit flow (replicates
 *          the auth gate + send pattern from the existing route at
 *          `app/api/messaging/drafts/[id]/approve/route.ts`), or
 *        - `proposal-mutations.ts` for the `action_proposals` flow.
 *   4. Calls `revalidatePath('/inbox')` on success so the server
 *      component refetches the buckets.
 *
 * All actions return a uniform `{ ok: boolean, data?, error? }` shape
 * so the client context can switch on `ok` without parsing strings.
 */
import { revalidatePath } from "next/cache";

import { can, FORBIDDEN_MESSAGE } from "@/lib/authz/policy";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";
import { lookupCanonicalProposalForMessage } from "@/lib/messaging/canonical-draft";
import {
  commitProposal,
  editProposal,
  rejectProposal,
} from "@/lib/inbox/proposal-mutations";
import { getDraftDetail } from "@/lib/inbox/draft-queries";
import {
  getConversation,
  type ConversationDetail,
} from "@/lib/inbox/conversation-queries";
import { callMetaLlm, SYNTHESIS_PROPOSER_MODEL } from "@/lib/agent/meta/llm";

import type { DraftDetail } from "@/components/inbox/types";
import type { DraftSource } from "@/lib/inbox/draft-queries";

export interface ActionOk<T = undefined> {
  ok: true;
  data?: T;
}

export interface ActionErr {
  ok: false;
  error: string;
}

export type ActionResult<T = undefined> = ActionOk<T> | ActionErr;

interface AuthContext {
  userId: string;
  organizationId: string;
  /** users.role of the caller; send gates fail closed on null/unknown. */
  role: string | null;
}

async function requireAuthContext(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Unauthorized" };
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("users")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();
  if (!row?.organization_id) {
    return { ok: false, error: "User has no organization" };
  }
  return {
    ok: true,
    ctx: {
      userId: user.id,
      organizationId: row.organization_id,
      role: row.role ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export async function approveDraftAction(
  source: DraftSource,
  id: string,
): Promise<ActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Approving a draft SENDS a tenant-facing message (both sources) —
  // owner-only, checked BEFORE any write. Draft editing stays available for
  // preparation; approving or rejecting is an owner decision.
  if (!can(auth.ctx.role, "approve_tenant_message")) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  if (source === "message") {
    const result = await approveMessageDraft(auth.ctx, id);
    if (result.ok) revalidatePath("/inbox");
    return result;
  }

  const admin = createAdminClient();
  const result = await commitProposal(
    admin,
    id,
    auth.ctx.userId,
    auth.ctx.organizationId,
    { kind: "user", role: auth.ctx.role },
  );
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/inbox");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

export async function rejectDraftAction(
  source: DraftSource,
  id: string,
): Promise<ActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!can(auth.ctx.role, "approve_tenant_message")) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  if (source === "message") {
    const result = await rejectMessageDraft(auth.ctx, id);
    if (result.ok) revalidatePath("/inbox");
    return result;
  }

  const admin = createAdminClient();
  const result = await rejectProposal(
    admin,
    id,
    auth.ctx.userId,
    auth.ctx.organizationId,
  );
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/inbox");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function editDraftAction(
  source: DraftSource,
  id: string,
  body: string,
): Promise<ActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === "va") {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false, error: "Body must be 1-2000 characters" };
  }

  if (source === "message") {
    const result = await editMessageDraft(auth.ctx, id, trimmed);
    if (result.ok) revalidatePath("/inbox");
    return result;
  }

  const admin = createAdminClient();
  const result = await editProposal(
    admin,
    id,
    auth.ctx.userId,
    auth.ctx.organizationId,
    trimmed,
  );
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/inbox");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Detail loader (no mutation, no revalidate)
// ---------------------------------------------------------------------------

export async function loadDraftDetailAction(
  source: DraftSource,
  id: string,
): Promise<DraftDetail | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getDraftDetail(supabase, source, id);
}

// ---------------------------------------------------------------------------
// Wave 4 — conversation viewer + manual outlet
// ---------------------------------------------------------------------------

/**
 * Loads the full thread for one conversation (RLS-scoped via the SSR
 * client). Returns `null` for unauthenticated callers or invisible ids
 * so the client can degrade gracefully without leaking existence.
 */
export async function loadConversationAction(
  conversationId: string,
): Promise<ConversationDetail | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getConversation(supabase, conversationId);
}

/**
 * Owner-side compose: fires off an ad-hoc outbound message via
 * Sendblue. Inserts a `messages` row with `draft_status='sent_by_human'`
 * (the existing convention for owner-approved sends) and records the
 * provider message id on success. On all-providers-failed, marks the
 * row as failed evidence; the same outbound intent is never blindly re-armed.
 */
export async function sendOwnerMessageAction(
  conversationId: string,
  body: string,
): Promise<ActionResult<{ messageId: string }>> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Ad-hoc compose SENDS a tenant-facing message — owner-only, checked
  // BEFORE the outbound-intent insert. This is the shared root gate for
  // /inbox compose, /review reminders and replies, and tenant-brief sends.
  if (!can(auth.ctx.role, "approve_tenant_message")) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false, error: "Body must be 1-2000 characters" };
  }

  const admin = createAdminClient();

  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id, tenant_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversation not found" };
  if (conv.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }
  if (!conv.tenant_id) {
    return { ok: false, error: "Conversation has no tenant" };
  }

  const [{ data: tenant }, { data: org }] = await Promise.all([
    admin
      .from("tenants")
      .select("phone_e164")
      .eq("id", conv.tenant_id)
      .single(),
    admin
      .from("organizations")
      .select("odesa_phone_number, messaging_primary")
      .eq("id", conv.organization_id)
      .single(),
  ]);

  if (!tenant?.phone_e164) {
    return { ok: false, error: "Tenant missing phone_e164" };
  }
  if (!org?.odesa_phone_number) {
    return { ok: false, error: "Organization missing odesa_phone_number" };
  }

  const provider = (org.messaging_primary ?? "linq") as "linq" | "twilio";

  // Insert the row first as `sending` so we have a durable record of
  // outbound intent (and a stable id) before the provider call — this
  // row IS the claim, so a crash mid-send leaves a visible 'sending'
  // row to reconcile rather than a silent send. We promote to
  // `sent_by_human` after the provider acks.
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: conv.organization_id,
      conversation_id: conv.id,
      direction: "outbound",
      provider,
      body: trimmed,
      draft_status: "sending",
      sent_at: null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: "Failed to record outbound message" };
  }

  const sendResult = await sendWithFailover(conv.organization_id, {
    toE164: tenant.phone_e164,
    fromE164: org.odesa_phone_number,
    body: trimmed,
    messageId: inserted.id,
    idempotencyKey: `message:${inserted.id}`,
  });

  if (!sendResult.ok) {
    if (sendResult.status === "failed" || sendResult.status === undefined) {
      await admin
        .from("messages")
        .update({
          draft_status: "rejected",
          delivery_status: "failed",
          delivery_error: "All providers rejected the send",
        })
        .eq("id", inserted.id)
        .eq("draft_status", "sending");
    }
    return { ok: false, error: dispatchFailureMessage(sendResult.status) };
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("messages")
    .update({
      draft_status: "sent_by_human",
      sent_at: nowIso,
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
    })
    .eq("id", inserted.id);
  if (updateErr) {
    return { ok: false, error: "Failed to record send" };
  }

  await admin
    .from("conversations")
    .update({ last_message_at: nowIso })
    .eq("id", conv.id);

  revalidatePath("/inbox");
  return { ok: true, data: { messageId: inserted.id } };
}

/**
 * Snooze a conversation until `untilIso`, or clear the snooze when `null`.
 * Snoozed threads drop out of the inbox "needs you" count and Today's Owner
 * Review queue until the snooze window passes, then resurface.
 */
export async function snoozeConversationAction(
  conversationId: string,
  untilIso: string | null,
): Promise<ActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === "va") {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversation not found" };
  if (conv.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }

  const { error } = await admin
    .from("conversations")
    .update({ snoozed_until: untilIso, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) return { ok: false, error: "Failed to snooze conversation" };

  revalidatePath("/inbox");
  revalidatePath("/today");
  return { ok: true };
}

/**
 * Mute or unmute a conversation. Muted threads never count toward "needs
 * you" or the urgent queue until the operator unmutes them.
 */
export async function muteConversationAction(
  conversationId: string,
  muted: boolean,
): Promise<ActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === "va") {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, organization_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return { ok: false, error: "Conversation not found" };
  if (conv.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }

  const { error } = await admin
    .from("conversations")
    .update({ muted, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) return { ok: false, error: "Failed to update mute state" };

  revalidatePath("/inbox");
  revalidatePath("/today");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal: messages-drafts auth-gated flows
//
// Replicates the logic in:
//   - src/app/api/messaging/drafts/[id]/approve/route.ts
//   - src/app/api/messaging/drafts/[id]/reject/route.ts
//   - src/app/api/messaging/drafts/[id]/edit/route.ts
// ---------------------------------------------------------------------------

async function approveMessageDraft(
  ctx: AuthContext,
  id: string,
): Promise<ActionResult> {
  const admin = createAdminClient();

  const { data: draft } = await admin
    .from("messages")
    .select(
      "id, organization_id, conversation_id, body, draft_status, retell_artifact_key",
    )
    .eq("id", id)
    .maybeSingle();

  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.organization_id !== ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }
  const canonical = await lookupCanonicalProposalForMessage(
    admin,
    draft.retell_artifact_key,
    ctx.organizationId,
  );
  if (!canonical.ok) {
    return { ok: false, error: "Draft review status could not be verified. No action was taken" };
  }
  if (canonical.linked) {
    return {
      ok: false,
      error: "This draft is reviewed in Owner Queue",
    };
  }
  if (draft.draft_status !== "pending_review") {
    return {
      ok: false,
      error: `Draft status is '${draft.draft_status}', expected 'pending_review'`,
    };
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("tenant_id")
    .eq("id", draft.conversation_id)
    .single();
  if (!conv?.tenant_id) {
    return { ok: false, error: "Conversation has no tenant" };
  }

  const [{ data: tenant }, { data: org }] = await Promise.all([
    admin
      .from("tenants")
      .select("phone_e164")
      .eq("id", conv.tenant_id)
      .single(),
    admin
      .from("organizations")
      .select("odesa_phone_number")
      .eq("id", draft.organization_id)
      .single(),
  ]);

  if (!tenant?.phone_e164) {
    return { ok: false, error: "Tenant missing phone_e164" };
  }
  if (!org?.odesa_phone_number) {
    return { ok: false, error: "Organization missing odesa_phone_number" };
  }

  // CAS claim: 'pending_review' → 'sending'. Two concurrent approves
  // race on this conditional update; exactly one wins, the other gets
  // a claim miss instead of a duplicate provider send.
  const { data: claimed, error: claimErr } = await admin
    .from("messages")
    .update({ draft_status: "sending", delivery_status: "approved" })
    .eq("id", id)
    .eq("draft_status", "pending_review")
    .select("id")
    .maybeSingle();

  if (claimErr || !claimed) {
    return { ok: false, error: "Draft is already being sent" };
  }

  const sendResult = await sendWithFailover(draft.organization_id, {
    toE164: tenant.phone_e164,
    fromE164: org.odesa_phone_number,
    body: draft.body ?? "",
    messageId: draft.id,
    idempotencyKey: `message:${draft.id}`,
  });

  if (!sendResult.ok) {
    if (sendResult.status === "failed" || sendResult.status === undefined) {
      await admin
        .from("messages")
        .update({
          draft_status: "rejected",
          delivery_status: "failed",
          delivery_error: "All providers rejected the send",
        })
        .eq("id", id)
        .eq("draft_status", "sending");
    }
    return { ok: false, error: dispatchFailureMessage(sendResult.status) };
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("messages")
    .update({
      draft_status: "sent_by_human",
      sent_at: nowIso,
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
    })
    .eq("id", id);

  if (updateErr) {
    return { ok: false, error: "Failed to record send" };
  }
  return { ok: true };
}

function dispatchFailureMessage(
  status: "failed" | "ambiguous" | "suppressed" | "in_flight" | undefined,
): string {
  if (status === "suppressed")
    return "Recipient has opted out; message suppressed";
  if (status === "ambiguous" || status === "in_flight") {
    return "Provider outcome is being reconciled; message was not retried";
  }
  return "All providers failed";
}

async function rejectMessageDraft(
  ctx: AuthContext,
  id: string,
): Promise<ActionResult> {
  const admin = createAdminClient();

  const { data: draft } = await admin
    .from("messages")
    .select("id, organization_id, draft_status, retell_artifact_key")
    .eq("id", id)
    .maybeSingle();

  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.organization_id !== ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }
  const canonical = await lookupCanonicalProposalForMessage(
    admin,
    draft.retell_artifact_key,
    ctx.organizationId,
  );
  if (!canonical.ok) {
    return { ok: false, error: "Draft review status could not be verified. No action was taken" };
  }
  if (canonical.linked) {
    return { ok: false, error: "This draft is reviewed in Owner Queue" };
  }
  if (draft.draft_status !== "pending_review") {
    return {
      ok: false,
      error: `Draft status is '${draft.draft_status}', expected 'pending_review'`,
    };
  }

  const { data: rejected, error } = await admin
    .from("messages")
    .update({ draft_status: "rejected" })
    .eq("id", id)
    .eq("draft_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Failed to reject draft" };
  if (!rejected) return { ok: false, error: "Draft changed before it could be rejected" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Wave 7 — Ask Odesa: regenerate the pending draft synchronously.
//
// Path 1 from `07-ask-odesa.md`: load the conversation + draft, prompt
// the meta LLM with the regenerate instruction, write the new body back
// to the pending draft row (preserving `pending_review` so the owner
// can still approve / reject / edit). Path 2 (queue-then-async) was
// rejected because `callMetaLlm` is reachable from the Node-runtime
// server-action context and Sonnet's p95 latency is comfortably under
// the 5-second budget.
// ---------------------------------------------------------------------------

/**
 * Regenerate the pending-review draft for a conversation given a
 * free-form instruction. Returns `{ ok: true }` on success; the
 * client should `loadConversationAction` to pick up the new body
 * (we also `revalidatePath('/inbox')` so server-side rerenders pick
 * up the new draft).
 *
 * @param draftId    - ID of the pending-review outbound `messages` row.
 * @param instruction - Operator-facing instruction (e.g. "soften it",
 *                      "draft a vendor follow-up"). Passed verbatim to
 *                      the synthesizer's user prompt.
 */
export async function regenerateDraftAction(
  draftId: string,
  instruction: string,
): Promise<ActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === "va") {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const trimmedInstruction = instruction.trim();
  if (trimmedInstruction.length === 0) {
    return { ok: false, error: "Instruction must not be empty" };
  }
  if (trimmedInstruction.length > 2000) {
    return { ok: false, error: "Instruction is too long" };
  }

  const admin = createAdminClient();

  // Confirm the draft exists, is still pending, and belongs to the
  // caller's organization before doing any LLM work.
  const { data: draft } = await admin
    .from("messages")
    .select(
      "id, organization_id, conversation_id, body, draft_status, retell_artifact_key",
    )
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }
  const canonical = await lookupCanonicalProposalForMessage(
    admin,
    draft.retell_artifact_key,
    auth.ctx.organizationId,
  );
  if (!canonical.ok) {
    return { ok: false, error: "Draft review status could not be verified. No action was taken" };
  }
  if (canonical.linked) {
    return { ok: false, error: "This draft is reviewed in Owner Queue" };
  }
  if (draft.draft_status !== "pending_review") {
    return {
      ok: false,
      error: `Draft status is '${draft.draft_status}', expected 'pending_review'`,
    };
  }

  // Pull the last ~20 messages on this conversation for grounding.
  const { data: history } = await admin
    .from("messages")
    .select("id, direction, body, created_at, draft_status")
    .eq("conversation_id", draft.conversation_id)
    .order("created_at", { ascending: true })
    .limit(40);

  const turns = (history ?? [])
    .filter((m) => m.draft_status !== "rejected" && m.id !== draftId)
    .slice(-20)
    .map((m) =>
      `${m.direction === "inbound" ? "Tenant" : "Odesa"}: ${
        m.body ?? ""
      }`.trim(),
    )
    .join("\n");

  const systemPrompt = [
    "You are Odesa, a calm, warm, concise SMS reply drafter for a",
    "small-portfolio property operator. Rewrite the pending draft per",
    "the operator instruction. Output a single JSON object with one",
    'key, "body", containing the new SMS body. No prose, no preamble.',
    "Keep it under 320 characters when possible.",
  ].join(" ");

  const userPrompt = [
    `Operator instruction: ${trimmedInstruction}`,
    "",
    `Current pending draft:\n${draft.body ?? ""}`,
    "",
    `Recent thread (chronological):\n${turns || "(no prior turns)"}`,
    "",
    'Return JSON: {"body": "<the new SMS draft>"}',
  ].join("\n");

  let newBody: string | null = null;
  try {
    const result = await callMetaLlm({
      phase: "synthesis-proposer",
      model: SYNTHESIS_PROPOSER_MODEL,
      systemPrompt,
      userPrompt,
      maxTokens: 1024,
      temperature: 0.3,
    });
    newBody = extractDraftBody(result.text);
  } catch {
    return { ok: false, error: "Regeneration failed" };
  }

  if (!newBody) {
    return { ok: false, error: "Regenerated draft was empty" };
  }

  const trimmed = newBody.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false, error: "Regenerated draft was out of range" };
  }

  const { data: regenerated, error: updateErr } = await admin
    .from("messages")
    .update({ body: trimmed })
    .eq("id", draftId)
    .eq("draft_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (updateErr) {
    return { ok: false, error: "Failed to update draft" };
  }
  if (!regenerated) {
    return { ok: false, error: "Draft changed before it could be regenerated" };
  }

  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * Pulls the `body` field out of a JSON-mode response. Forgiving:
 * accepts either a bare JSON object or one wrapped in prose / code
 * fences, mirroring `parseJsonStrict` in `meta/llm.ts`. Returns null
 * if no usable string body can be extracted.
 */
function extractDraftBody(raw: string): string | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { body?: unknown };
    const value = parsed.body;
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function editMessageDraft(
  ctx: AuthContext,
  id: string,
  body: string,
): Promise<ActionResult> {
  const admin = createAdminClient();

  const { data: draft } = await admin
    .from("messages")
    .select("id, organization_id, draft_status, retell_artifact_key")
    .eq("id", id)
    .maybeSingle();

  if (!draft) return { ok: false, error: "Draft not found" };
  if (draft.organization_id !== ctx.organizationId) {
    return { ok: false, error: "Forbidden" };
  }
  const canonical = await lookupCanonicalProposalForMessage(
    admin,
    draft.retell_artifact_key,
    ctx.organizationId,
  );
  if (!canonical.ok) {
    return { ok: false, error: "Draft review status could not be verified. No action was taken" };
  }
  if (canonical.linked) {
    return { ok: false, error: "This draft is reviewed in Owner Queue" };
  }
  if (draft.draft_status !== "pending_review") {
    return {
      ok: false,
      error: `Draft status is '${draft.draft_status}', expected 'pending_review'`,
    };
  }

  const { data: edited, error } = await admin
    .from("messages")
    .update({ body, draft_status: "pending_review" })
    .eq("id", id)
    .eq("draft_status", "pending_review")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Failed to update draft" };
  if (!edited) return { ok: false, error: "Draft changed before it could be edited" };
  return { ok: true };
}
