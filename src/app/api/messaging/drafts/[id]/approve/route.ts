/**
 * Draft approve route — Phase 4.
 *
 * Flow:
 *   1. Auth: require a signed-in user (RLS does the hard enforcement).
 *   2. Load the draft message. Reject if not `pending_review`.
 *   3. Load the associated conversation → tenant → phone_e164 for the
 *      destination, and the org's `odesa_phone_number` for the source.
 *   4. Call `sendWithFailover()` — on success, update the message row
 *      with `sent_at`, `draft_status='sent_by_human'`, and the real
 *      provider that accepted the message. Delivery is webhook-confirmed.
 *   5. Return the send result so the client can refresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { can, FORBIDDEN_MESSAGE } from "@/lib/authz/policy";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";
import { lookupCanonicalProposalForMessage } from "@/lib/messaging/canonical-draft";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  // Auth gate. We use createServerClient for session; the actual
  // reads/writes go through the admin client because we need to
  // update `provider` on the message row, which the RLS-enabled
  // authenticated client can also do, but the admin client is
  // simpler when loading multi-table data without extra joins.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const admin = createAdminClient();

  const { data: draft, error: draftErr } = await admin
    .from("messages")
    .select(
      "id, organization_id, conversation_id, body, draft_status, direction, retell_artifact_key",
    )
    .eq("id", id)
    .maybeSingle();

  if (draftErr || !draft) {
    return NextResponse.json(
      { success: false, error: "Draft not found" },
      { status: 404 },
    );
  }

  if (draft.draft_status !== "pending_review") {
    return NextResponse.json(
      {
        success: false,
        error: `Draft status is '${draft.draft_status}', expected 'pending_review'`,
      },
      { status: 409 },
    );
  }

  // Cross-org isolation: the authenticated caller must belong to the
  // draft's org. We re-read the signed-in user's org from users table.
  const { data: me } = await admin
    .from("users")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();
  if (!me || me.organization_id !== draft.organization_id) {
    return NextResponse.json(
      { success: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  // Approving a draft SENDS a tenant-facing message — owner-only. Fail
  // closed BEFORE the CAS claim (the first write on this path).
  if (!can(me.role, "approve_tenant_message")) {
    return NextResponse.json(
      { success: false, error: FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  const canonical = await lookupCanonicalProposalForMessage(
    admin,
    draft.retell_artifact_key,
    draft.organization_id,
  );
  if (!canonical.ok) {
    return NextResponse.json(
      { success: false, error: "Draft review status could not be verified. No action was taken" },
      { status: 503 },
    );
  }
  if (canonical.linked) {
    return NextResponse.json(
      { success: false, error: "This draft is reviewed in Owner Queue" },
      { status: 409 },
    );
  }

  // Resolve the destination phone (tenant) + source phone (org).
  const { data: conv } = await admin
    .from("conversations")
    .select("tenant_id")
    .eq("id", draft.conversation_id)
    .single();
  if (!conv?.tenant_id) {
    return NextResponse.json(
      { success: false, error: "Conversation has no tenant" },
      { status: 422 },
    );
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
    return NextResponse.json(
      { success: false, error: "Tenant missing phone_e164" },
      { status: 422 },
    );
  }
  if (!org?.odesa_phone_number) {
    return NextResponse.json(
      { success: false, error: "Organization missing odesa_phone_number" },
      { status: 422 },
    );
  }

  // CAS claim: 'pending_review' → 'sending'. The conditional update is
  // the concurrency boundary — two concurrent approve clicks race here
  // and exactly one wins; the loser gets a 409 instead of a duplicate
  // provider send.
  const { data: claimed, error: claimErr } = await admin
    .from("messages")
    .update({ draft_status: "sending", delivery_status: "approved" })
    .eq("id", id)
    .eq("draft_status", "pending_review")
    .select("id")
    .maybeSingle();

  if (claimErr || !claimed) {
    return NextResponse.json(
      { success: false, error: "Draft is already being sent" },
      { status: 409 },
    );
  }

  const result = await sendWithFailover(draft.organization_id, {
    toE164: tenant.phone_e164,
    fromE164: org.odesa_phone_number,
    body: draft.body ?? "",
    messageId: draft.id,
    idempotencyKey: `message:${draft.id}`,
  });

  if (!result.ok) {
    // Explicit failure is durable evidence; never blindly re-arm the same
    // outbound intent. Ambiguous/in-flight outcomes remain `sending` for
    // reconciliation because the provider may have accepted them.
    if (result.status === "failed" || result.status === undefined) {
      const { error: revertErr } = await admin
        .from("messages")
        .update({
          draft_status: "rejected",
          delivery_status: "failed",
          delivery_error: "All providers rejected the send",
        })
        .eq("id", id)
        .eq("draft_status", "sending");
      if (revertErr) {
        console.error(
          `[draft approve] failed to persist provider failure for draft ${id}: ${revertErr.message}`,
        );
      }
    }
    return NextResponse.json(
      {
        success: false,
        error:
          result.status === "suppressed"
            ? "Recipient has opted out; message suppressed"
            : result.status === "ambiguous" || result.status === "in_flight"
              ? "Provider outcome is being reconciled; message was not retried"
              : "All providers failed",
        attempted: result.attempted,
        errors: result.errors,
      },
      { status: result.status === "suppressed" ? 409 : 502 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("messages")
    .update({
      draft_status: "sent_by_human",
      sent_at: nowIso,
      provider: result.provider,
      provider_message_id: result.providerMessageId,
    })
    .eq("id", id);

  if (updateErr) {
    console.error(`[draft approve] update failed: ${updateErr.message}`);
    return NextResponse.json(
      { success: false, error: "Failed to record send" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      messageId: id,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      failedOver: result.failedOver,
      attempted: result.attempted,
      sentAt: nowIso,
    },
  });
}
