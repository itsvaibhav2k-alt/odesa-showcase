'use server';

/**
 * `/review` server actions.
 *
 * Each action auth-gates + cross-org checks (mirroring the inbox actions
 * pattern), mutates via the admin client, and `revalidatePath('/today')` so the
 * urgent queue reflects the change. Status transitions target existing enum
 * values only (no migration). Messaging sends reuse `sendOwnerMessageAction`.
 */

import { revalidatePath } from 'next/cache';

import { can, FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOwnerMessageAction } from '@/app/(dashboard)/inbox/actions';
import type { ReviewActionResult } from '@/lib/review/types';
import { transitionWorkOrderLifecycleAction } from '@/lib/work-orders/actions';

interface AuthCtx {
  userId: string;
  organizationId: string;
  /** users.role of the caller; sensitive gates fail closed on null/unknown. */
  role: string | null;
}

async function requireAuthContext(): Promise<
  { ok: true; ctx: AuthCtx } | { ok: false; error: string }
> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Unauthorized' };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!row?.organization_id) {
    return { ok: false, error: 'User has no organization' };
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

function revalidateReview(kind: string, id: string): void {
  revalidatePath('/today');
  revalidatePath(`/review/${kind}/${id}`);
}

// ---------------------------------------------------------------------
// Rent
// ---------------------------------------------------------------------

export async function decideRentReviewAction(
  rentEventId: string,
  decision: 'escalate' | 'arrange_plan',
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === 'va') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  // Agreeing a payment plan changes lease/payment terms. Keep the existing
  // internal escalation transition member-accessible, but fail closed before
  // any row read when a non-owner appears to arrange a plan.
  if (
    decision === 'arrange_plan' &&
    !can(auth.ctx.role, 'change_lease_terms')
  ) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('rent_events')
    .select('id, organization_id')
    .eq('id', rentEventId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Rent event not found' };
  if (row.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const nextStatus = decision === 'escalate' ? 'escalated' : 'plan_agreed';
  const { error } = await admin
    .from('rent_events')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', rentEventId);
  if (error) return { ok: false, error: 'Failed to update rent event' };

  revalidateReview('rent', rentEventId);
  return { ok: true, data: { status: nextStatus } };
}

/**
 * Sends a rent reminder by finding the tenant's most recent conversation
 * (via lease → tenant) and delegating to the inbox send path. Provider-gated:
 * returns an error when no conversation exists or the provider fails.
 */
export async function sendRentReminderAction(
  rentEventId: string,
  body: string,
): Promise<ReviewActionResult> {
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Tenant-facing send — owner-only, checked BEFORE any read/delegation.
  // (`sendOwnerMessageAction` re-checks; this keeps the surface fail-closed
  // on its own.)
  if (!can(auth.ctx.role, 'approve_tenant_message')) {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const { data: rent } = await admin
    .from('rent_events')
    .select('id, organization_id, lease_id')
    .eq('id', rentEventId)
    .maybeSingle();
  if (!rent) return { ok: false, error: 'Rent event not found' };
  if (rent.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const { data: lease } = await admin
    .from('leases')
    .select('tenant_id')
    .eq('id', rent.lease_id)
    .maybeSingle();
  if (!lease?.tenant_id) return { ok: false, error: 'Lease has no tenant' };

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('tenant_id', lease.tenant_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return { ok: false, error: 'No conversation to reply on yet' };

  const result = await sendOwnerMessageAction(conv.id, body);
  if (!result.ok) return result;

  revalidateReview('rent', rentEventId);
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------

export async function decideConversationReviewAction(
  conversationId: string,
  decision: 'resolve',
): Promise<ReviewActionResult> {
  void decision;
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === 'va') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('conversations')
    .select('id, organization_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Conversation not found' };
  if (row.organization_id !== auth.ctx.organizationId) {
    return { ok: false, error: 'Forbidden' };
  }

  const { error } = await admin
    .from('conversations')
    .update({ status: 'resolved', updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) return { ok: false, error: 'Failed to resolve conversation' };

  revalidateReview('conversation', conversationId);
  return { ok: true, data: { status: 'resolved' } };
}

export async function sendConversationReplyAction(
  conversationId: string,
  body: string,
): Promise<ReviewActionResult> {
  const result = await sendOwnerMessageAction(conversationId, body);
  if (!result.ok) return result;
  revalidateReview('conversation', conversationId);
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------
// Work order
// ---------------------------------------------------------------------

export async function decideWorkOrderReviewAction(
  workOrderId: string,
  decision: 'start',
): Promise<ReviewActionResult> {
  void decision;
  const auth = await requireAuthContext();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.ctx.role === 'va') {
    return { ok: false, error: FORBIDDEN_MESSAGE };
  }

  // Read the current lifecycle version (org-scoped) so the guarded, optimistically
  // locked lifecycle RPC can drive the 'start_work' transition honestly.
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('work_orders')
    .select('id, lifecycle_version')
    .eq('id', workOrderId)
    .eq('organization_id', auth.ctx.organizationId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Work order not found' };

  const result = await transitionWorkOrderLifecycleAction(workOrderId, {
    action: 'start_work',
    expectedVersion: row.lifecycle_version,
    requestId: crypto.randomUUID(),
  });
  // On !ok, surface the lifecycle action's honest error (e.g. invalid_transition
  // when the WO isn't assigned yet) instead of faking success.
  if (!result.ok) return { ok: false, error: result.error };

  revalidateReview('work_order', workOrderId);
  return { ok: true, data: { status: 'in_progress' } };
}
