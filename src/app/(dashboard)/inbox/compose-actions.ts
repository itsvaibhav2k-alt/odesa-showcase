'use server';

/**
 * Compose-to-tenant server action — owner-initiated conversations.
 *
 * Backs the "Message" button on the tenant brief and the "Compose"
 * affordance on `/inbox`. Flow:
 *
 *   1. Auth gate (same SSR-client + `users` lookup pattern as
 *      `actions.ts` — kept local so the shared file stays untouched).
 *   2. Validate the tenant: exists, belongs to the caller's org, and
 *      has a `phone_e164` BEFORE any rows are written — a recipient we
 *      cannot text must never leave an orphan conversation behind.
 *   3. `findOrCreateOpenConversation` — reuse the tenant's existing
 *      OPEN sms thread when present, else create one (same resolver
 *      shape as the inbound pipeline).
 *   4. Delegate the send to `sendOwnerMessageAction`, reusing its
 *      insert-before-send + promote machinery untouched. On provider
 *      failure that path leaves the message row at `pending_review`,
 *      so a failed compose is visible in the inbox queue — never
 *      silently dropped.
 */
import { revalidatePath } from 'next/cache';

import { can, FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { findOrCreateOpenConversation } from '@/lib/inbox/compose';

import { sendOwnerMessageAction, type ActionResult } from './actions';

export interface ComposeSendData {
  conversationId: string;
  messageId: string;
}

/**
 * Send an owner-composed message to a tenant, creating the conversation
 * when the tenant has no open one.
 *
 * @param tenantId - `tenants.id` UUID of the recipient.
 * @param body     - Message body (1-2000 chars after trim).
 * @returns `{ ok: true, data: { conversationId, messageId } }` on a
 *   provider-acked send; `{ ok: false, error }` otherwise. A provider
 *   failure leaves the message row at `pending_review` in the (found or
 *   created) conversation, visible for retry from `/inbox`.
 */
export async function composeToTenantAction(
  tenantId: string,
  body: string,
): Promise<ActionResult<ComposeSendData>> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const admin = createAdminClient();
  const { data: caller } = await admin
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!caller?.organization_id) {
    return { ok: false, error: 'User has no organization' };
  }
  const organizationId = caller.organization_id;

  // Compose SENDS a tenant-facing message — owner-only, checked BEFORE the
  // conversation find-or-CREATE (the first possible write on this path).
  if (!can(caller.role, 'approve_tenant_message')) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) {
    return { ok: false, error: 'Body must be 1-2000 characters' };
  }

  // Validate the recipient before touching `conversations` so a bad
  // tenant id / missing phone never leaves an empty thread behind.
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, organization_id, phone_e164')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return { ok: false, error: 'Tenant not found' };
  if (tenant.organization_id !== organizationId) {
    return { ok: false, error: 'Forbidden' };
  }
  if (!tenant.phone_e164) {
    return { ok: false, error: 'Tenant missing phone_e164' };
  }

  const conversation = await findOrCreateOpenConversation(
    admin,
    organizationId,
    tenantId,
  );
  if (!conversation) {
    return { ok: false, error: 'Failed to resolve conversation' };
  }

  // Reuse the existing owner-send rail untouched: insert-before-send,
  // promote to 'sent_by_human' on ack, demote to 'pending_review' on
  // provider failure (the row stays visible for retry).
  const result = await sendOwnerMessageAction(conversation.id, trimmed);
  if (!result.ok) {
    // Surface the conversation in /inbox even on failure — the pending
    // row lives there now.
    revalidatePath('/inbox');
    return result;
  }

  revalidatePath('/inbox');
  revalidatePath(`/tenants/${tenantId}`);

  // A successful send must carry the message id — a missing payload means
  // the contract broke upstream; surface it instead of degrading silently.
  if (!result.data?.messageId) {
    return { ok: false, error: 'Send recorded without a message id' };
  }

  return {
    ok: true,
    data: {
      conversationId: conversation.id,
      messageId: result.data.messageId,
    },
  };
}
