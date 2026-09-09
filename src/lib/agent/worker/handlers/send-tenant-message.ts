/**
 * Wave 6 — handler for `send_tenant_message`.
 *
 * Sends an outbound SMS to a tenant on behalf of the operator. The
 * dispatcher already cleared the gate (confidence ≥ 0.3 + commit-gate
 * policy = 'gated', autonomy = 0 → 'auto' decision when not blocked),
 * so this handler does the actual side-effect: fetch tenant phone,
 * fetch the org's odesa_phone_number, find-or-create the SMS
 * conversation, INSERT the messages row, then call sendWithFailover.
 *
 * Persistence shape:
 *   - INSERT messages row first with sent_at=null, draft_status='auto_sent'
 *     so we have a stable id even if the provider call fails.
 *   - On send success: UPDATE messages.sent_at + provider_message_id
 *     + provider (whichever provider actually delivered after failover).
 *     Also UPDATE conversations.last_message_at so the inbox surface
 *     reflects the new outbound activity.
 *   - On send failure: flip draft_status='pending_review' so the row
 *     surfaces in the inbox for the operator to retry by hand.
 *
 * Idempotency: if the same (organization_id, tenant_id, body) outbound
 * message was sent within the last 60 seconds we return the existing
 * row with `idempotent: true` rather than re-firing the provider. The
 * 60s window is intentionally tight — a real "send the same body twice"
 * intent (e.g. nudging the tenant after no reply) should land outside
 * the window. Picked over hashing because the natural key is human-
 * readable and trivial to verify in audit logs.
 *
 * Confidence:
 *   - 1.0 when tenantRef is a UUID we verify in-org.
 *   - 0.8 when tenantRef is a name resolving to a single tenant.
 *   - 0.5 on `send_failed` (we sent a row but provider rejected).
 *   - 0.2 with `error: 'ambiguous_tenant'` on multi-match.
 *   - 0.0 on tenant_not_found / missing-data errors.
 *
 * Stable error strings (for dispatcher narration):
 *   - 'tenant_not_found'
 *   - 'ambiguous_tenant'
 *   - 'tenant_missing_phone'
 *   - 'org_missing_phone'
 *   - 'conversation_failed'
 *   - 'insert_failed: <provider message>'
 *   - 'send_failed: <provider message>'
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

import { sendWithFailover } from "@/lib/messaging/send-with-failover";

import { resolveTenant } from "../resolve-refs";
import type { SendTenantMessagePayload } from "../types";
import type { HandlerArgs, HandlerResult } from "./index";

/** Window inside which a duplicate outbound is treated as idempotent. */
const IDEMPOTENCY_WINDOW_MS = 60_000;

export async function handleSendTenantMessage(
  args: HandlerArgs<SendTenantMessagePayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  // 1. Resolve tenantRef → tenant id + name + phone.
  const refResult = await resolveTenantRef(admin, organizationId, payload);
  if (!refResult.ok) {
    return {
      ok: false,
      error:
        refResult.reason === "ambiguous"
          ? "ambiguous_tenant"
          : "tenant_not_found",
      confidence: refResult.reason === "ambiguous" ? 0.2 : 0,
    };
  }
  const tenantId = refResult.id;
  const refConfidence = refResult.byId ? 1.0 : 0.8;

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, full_name, phone_e164")
    .eq("organization_id", organizationId)
    .eq("id", tenantId)
    .limit(1)
    .maybeSingle();

  if (tenantErr || !tenant) {
    return { ok: false, error: "tenant_not_found", confidence: 0 };
  }
  if (!tenant.phone_e164) {
    return { ok: false, error: "tenant_missing_phone", confidence: 0 };
  }

  // 2. Fetch the org's outbound number + primary provider choice.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, odesa_phone_number, messaging_primary")
    .eq("id", organizationId)
    .limit(1)
    .maybeSingle();

  if (orgErr || !org) {
    return { ok: false, error: "org_missing_phone", confidence: 0 };
  }
  if (!org.odesa_phone_number) {
    return { ok: false, error: "org_missing_phone", confidence: 0 };
  }

  // 3. Find or create the SMS conversation for this tenant.
  const conversationId = await findOrCreateConversation(
    admin,
    organizationId,
    tenantId,
  );
  if (conversationId === null) {
    return { ok: false, error: "conversation_failed", confidence: 0 };
  }

  // 4. Idempotency check — same body to same tenant in the window?
  const sinceIso = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
  const { data: dupes } = await admin
    .from("messages")
    .select("id, sent_at, provider_message_id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .eq("body", payload.body)
    .gte("created_at", sinceIso)
    .limit(1);

  if (dupes && dupes.length > 0) {
    const existing = dupes[0];
    return {
      ok: true,
      data: {
        messageId: existing.id,
        tenantPhone: tenant.phone_e164,
        conversationId,
        full_name: tenant.full_name,
      },
      confidence: refConfidence,
      reasoning:
        `Skipped duplicate send to ${tenant.full_name} ` +
        `(same body within ${IDEMPOTENCY_WINDOW_MS / 1000}s).`,
      idempotent: true,
    };
  }

  // 5. Insert the messages row first so we have a stable id even if
  // sendWithFailover fails. We optimistically tag it 'auto_sent' since
  // the gate already approved this commit; on failure we flip the
  // status to 'pending_review' below.
  const provider = org.messaging_primary ?? "linq";
  const { data: inserted, error: insertErr } = await admin
    .from("messages")
    .insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      direction: "outbound",
      provider,
      body: payload.body,
      draft_status: "auto_sent",
      sent_at: null,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: `insert_failed: ${insertErr?.message ?? "unknown"}`,
      confidence: 0,
    };
  }

  // 6. Fire the actual outbound send.
  const sendResult = await sendWithFailover(organizationId, {
    toE164: tenant.phone_e164,
    fromE164: org.odesa_phone_number,
    body: payload.body,
    messageId: inserted.id,
    idempotencyKey: `message:${inserted.id}`,
  });

  if (!sendResult.ok) {
    if (sendResult.status === "failed" || sendResult.status === undefined) {
      await admin
        .from("messages")
        .update({ draft_status: "pending_review" })
        .eq("organization_id", organizationId)
        .eq("id", inserted.id);
    }

    const firstErr = sendResult.errors[0]?.error ?? "unknown";
    return {
      ok: false,
      error: `send_failed: ${firstErr}`,
      confidence: 0.5,
    };
  }

  // 7. Promote the row to delivered + bump the conversation timestamp.
  const nowIso = new Date().toISOString();
  await admin
    .from("messages")
    .update({
      sent_at: nowIso,
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
    })
    .eq("organization_id", organizationId)
    .eq("id", inserted.id);

  await admin
    .from("conversations")
    .update({ last_message_at: nowIso })
    .eq("organization_id", organizationId)
    .eq("id", conversationId);

  return {
    ok: true,
    data: {
      messageId: inserted.id,
      tenantPhone: tenant.phone_e164,
      conversationId,
      full_name: tenant.full_name,
    },
    confidence: refConfidence,
    reasoning: `Sent message to ${tenant.full_name} via ${sendResult.provider}.`,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RefOk {
  ok: true;
  id: string;
  byId: boolean;
}
interface RefErr {
  ok: false;
  reason: "not_found" | "ambiguous";
}
type RefResult = RefOk | RefErr;

async function resolveTenantRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: SendTenantMessagePayload,
): Promise<RefResult> {
  const ref = payload.tenantRef;

  if ("tenantId" in ref) {
    const { data, error } = await admin
      .from("tenants")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", ref.tenantId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: "not_found" };
    return { ok: true, id: data.id, byId: true };
  }

  const result = await resolveTenant(admin, organizationId, ref.tenantName);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}

/**
 * Find an open SMS conversation for this tenant or create a new one.
 * Mirrors the logic in `src/lib/rent/tick.ts` so two code paths
 * (rent automation + agentic dispatcher) share conversation rows.
 */
async function findOrCreateConversation(
  admin: SupabaseClient<Database>,
  organizationId: string,
  tenantId: string,
): Promise<string | null> {
  const { data: existing } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("tenant_id", tenantId)
    .eq("channel", "sms")
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await admin
    .from("conversations")
    .insert({
      organization_id: organizationId,
      tenant_id: tenantId,
      channel: "sms",
      status: "open",
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !created) return null;
  return created.id;
}
