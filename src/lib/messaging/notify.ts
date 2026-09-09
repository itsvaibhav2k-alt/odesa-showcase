/**
 * High-level notification helpers. Wraps `sendWithFailover` with org +
 * recipient lookups so callers (Retell tools, rent cron, weekly
 * briefing cron) don't re-implement the boilerplate.
 *
 * Both helpers persist the resulting `messages` row so the Inbox
 * feed and draft-review surfaces see the outbound on next paint.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { inngest } from '@/lib/inngest/client';
import {
  NOTIFY_LANDLORD_DEFERRED_EVENT,
  type NotifyLandlordDeferredEventData,
} from '@/lib/inngest/events';
import { sendWithFailover } from './send-with-failover';
import { resolveOwnerNotifyDeferral } from './quiet-hours';

export interface NotifyResult {
  ok: boolean;
  conversationId: string | null;
  messageId: string | null;
  provider: 'linq' | 'twilio' | 'retell' | null;
  failedOver: boolean;
  error: string | null;
  /** Set when quiet hours held the SMS back for morning delivery. */
  deferredUntil?: string | null;
}

export async function notifyLandlord({
  db,
  organizationId,
  body,
  urgent = false,
  retellArtifactKey = null,
  assertOwnership,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  body: string;
  /**
   * Bypass quiet hours. Reserve for human-in-the-loop moments (a live
   * Retell call escalating an emergency) and for the deferred-delivery
   * Inngest function itself — never for cron-time alerts.
   */
  urgent?: boolean;
  retellArtifactKey?: string | null;
  assertOwnership?: () => Promise<void>;
}): Promise<NotifyResult> {
  const { data: org } = await db
    .from('organizations')
    .select('odesa_phone_number, timezone')
    .eq('id', organizationId)
    .single();
  if (!org?.odesa_phone_number) {
    return failure('organization has no odesa_phone_number');
  }

  if (!urgent) {
    const deliverAt = resolveOwnerNotifyDeferral(
      new Date(),
      org.timezone ?? '',
    );
    if (deliverAt !== null) {
      const data: NotifyLandlordDeferredEventData = {
        organizationId,
        body,
        deliverAt,
      };
      try {
        await assertOwnership?.();
        await inngest.send({ name: NOTIFY_LANDLORD_DEFERRED_EVENT, data });
      } catch (err) {
        // Deferral is best-effort comfort; losing the alert entirely is
        // worse than a 4am text. Fall through to immediate delivery.
        console.error(
          `[notify] deferred-event send failed, delivering immediately: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return sendLandlordNow({ db, organizationId, org, body, retellArtifactKey, assertOwnership });
      }
      return {
        ok: true,
        conversationId: null,
        messageId: null,
        provider: null,
        failedOver: false,
        error: null,
        deferredUntil: deliverAt,
      };
    }
  }

  return sendLandlordNow({ db, organizationId, org, body, retellArtifactKey, assertOwnership });
}

async function sendLandlordNow({
  db,
  organizationId,
  org,
  body,
  retellArtifactKey,
  assertOwnership,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  org: { odesa_phone_number: string | null };
  body: string;
  retellArtifactKey: string | null;
  assertOwnership?: () => Promise<void>;
}): Promise<NotifyResult> {
  const messageKey = retellArtifactKey ? `${retellArtifactKey}:message` : null;
  if (messageKey) {
    const { data: prior } = await db.from('messages')
      .select('id, conversation_id, draft_status, provider')
      .eq('retell_artifact_key', messageKey).maybeSingle();
    if (prior) {
      if (prior.draft_status === 'auto_sent') {
        return { ok: true, conversationId: prior.conversation_id, messageId: prior.id,
          provider: prior.provider as NotifyResult['provider'], failedOver: false, error: null };
      }
      return { ok: false, conversationId: prior.conversation_id, messageId: prior.id,
        provider: prior.provider as NotifyResult['provider'], failedOver: false,
        error: prior.draft_status === 'sending'
          ? 'provider outcome pending reconciliation; refusing duplicate send'
          : 'previous provider send failed; owner review required' };
    }
  }
  if (!org.odesa_phone_number) {
    return failure('organization has no odesa_phone_number');
  }

  const { data: owner } = await db
    .from('users')
    .select('phone_e164')
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .not('phone_e164', 'is', null)
    .limit(1)
    .maybeSingle();
  if (!owner?.phone_e164) {
    return failure('no owner with phone_e164 on organization');
  }

  return send({
    db,
    organizationId,
    tenantId: null,
    fromE164: org.odesa_phone_number,
    toE164: owner.phone_e164,
    body,
    channel: 'sms',
    summary: `[LANDLORD ALERT] ${body.slice(0, 120)}`,
    retellArtifactKey,
    assertOwnership,
  });
}

export async function notifyTenant({
  db,
  organizationId,
  tenantId,
  body,
  retellArtifactKey = null,
  assertOwnership,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  tenantId: string;
  body: string;
  retellArtifactKey?: string | null;
  assertOwnership?: () => Promise<void>;
}): Promise<NotifyResult> {
  const { data: org } = await db
    .from('organizations')
    .select('odesa_phone_number')
    .eq('id', organizationId)
    .single();
  if (!org?.odesa_phone_number) {
    return failure('organization has no odesa_phone_number');
  }

  const { data: tenant } = await db
    .from('tenants')
    .select('phone_e164')
    .eq('id', tenantId)
    .single();
  if (!tenant?.phone_e164) {
    return failure('tenant has no phone_e164');
  }

  return send({
    db,
    organizationId,
    tenantId,
    fromE164: org.odesa_phone_number,
    toE164: tenant.phone_e164,
    body,
    channel: 'sms',
    summary: `[AUTO] ${body.slice(0, 120)}`,
    retellArtifactKey,
    assertOwnership,
  });
}

async function send({
  db,
  organizationId,
  tenantId,
  fromE164,
  toE164,
  body,
  channel,
  summary,
  retellArtifactKey,
  assertOwnership,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  tenantId: string | null;
  fromE164: string;
  toE164: string;
  body: string;
  channel: Database['public']['Enums']['conversation_channel'] extends infer E ? E : never;
  summary: string;
  retellArtifactKey: string | null;
  assertOwnership?: () => Promise<void>;
}): Promise<NotifyResult> {
  // Insert-before-send (mirrors sendOwnerMessageAction in
  // inbox/actions.ts): the conversation + 'sending' message row is the
  // durable record of outbound intent. A crash after the provider call
  // can then never produce a delivered SMS with zero trace — at worst
  // we have a row stuck at 'sending' to reconcile.
  const conversationKey = retellArtifactKey ? `${retellArtifactKey}:conversation` : null;
  const messageKey = retellArtifactKey ? `${retellArtifactKey}:message` : null;
  if (messageKey) {
    const { data: prior } = await db.from('messages')
      .select('id, conversation_id, draft_status, provider')
      .eq('retell_artifact_key', messageKey).maybeSingle();
    if (prior) {
      if (prior.draft_status === 'auto_sent') {
        return { ok: true, conversationId: prior.conversation_id, messageId: prior.id,
          provider: prior.provider as NotifyResult['provider'], failedOver: false, error: null };
      }
      return { ok: false, conversationId: prior.conversation_id, messageId: prior.id,
        provider: prior.provider as NotifyResult['provider'], failedOver: false,
        error: prior.draft_status === 'sending'
          ? 'provider outcome pending reconciliation; refusing duplicate send'
          : 'previous provider send failed; owner review required' };
    }
  }
  let { data: conv } = conversationKey
    ? await db.from('conversations').select('id').eq('retell_artifact_key', conversationKey).maybeSingle()
    : { data: null };
  if (!conv) {
    await assertOwnership?.();
    ({ data: conv } = await db
    .from('conversations')
    .insert({
      organization_id: organizationId,
      tenant_id: tenantId,
      channel: channel as 'sms' | 'voice' | 'imessage',
      status: 'open',
      summary,
      last_message_at: new Date().toISOString(),
      retell_artifact_key: conversationKey,
    })
    .select('id')
    .single());
  }

  if (!conv) return failure('conversation insert failed');

  await assertOwnership?.();
  const { data: msg } = await db
    .from('messages')
    .insert({
      organization_id: organizationId,
      conversation_id: conv.id,
      direction: 'outbound',
      // Placeholder until the provider acks; promoted below.
      provider: 'linq',
      body,
      draft_status: 'sending',
      sent_at: null,
      retell_artifact_key: messageKey,
    })
    .select('id')
    .single();

  if (!msg) return failure('message insert failed');

  await assertOwnership?.();
  const result = await sendWithFailover(organizationId, {
    fromE164,
    toE164,
    body,
    messageId: msg.id,
    idempotencyKey: `message:${msg.id}`,
  });

  if (!result.ok) {
    // Explicit provider failure is durable evidence, not a second approval
    // artifact. Suppressed and ambiguous/in-flight outcomes remain
    // reconciliation-only and cannot be blindly re-armed.
    if (result.status === 'failed' || result.status === undefined) {
      const { error: demoteErr } = await db
        .from('messages')
        .update({
          draft_status: 'rejected',
          delivery_status: 'failed',
          delivery_error: 'All providers rejected the send',
        })
        .eq('id', msg.id);
      if (demoteErr) {
        console.error(
          `[notify] failed to persist message ${msg.id} provider failure: ${demoteErr.message}`,
        );
      }
    }
    return {
      ok: false,
      conversationId: conv.id,
      messageId: msg.id,
      provider: null,
      failedOver: false,
      error: result.status === 'suppressed'
        ? 'Recipient has opted out of messaging'
        : result.status === 'ambiguous' || result.status === 'in_flight'
          ? 'Delivery outcome requires reconciliation; message was not retried'
          : result.errors.map((e) => e.error).join('; '),
    };
  }

  const promotion = {
    draft_status: 'auto_sent' as const,
    sent_at: new Date().toISOString(),
    provider: result.provider,
    provider_message_id: result.providerMessageId,
  };
  let { error: promoteErr } = await db
    .from('messages')
    .update(promotion)
    .eq('id', msg.id);
  if (promoteErr) {
    // The SMS already went out — retry the bookkeeping once, then log
    // loudly: a row stuck at 'sending' after a real send must be
    // reconciled by hand, never re-sent.
    ({ error: promoteErr } = await db
      .from('messages')
      .update(promotion)
      .eq('id', msg.id));
  }
  if (promoteErr) {
    console.error(
      `[notify] CRITICAL: provider send succeeded (provider=${result.provider}, provider_message_id=${result.providerMessageId}) but message ${msg.id} could not be promoted from 'sending': ${promoteErr.message}`,
    );
  }

  if (promoteErr) {
    return {
      ok: false, conversationId: conv.id, messageId: msg.id,
      provider: result.provider, failedOver: result.failedOver,
      error: 'provider accepted send but durable delivery state could not be verified; refusing resend',
    };
  }

  return {
    ok: true,
    conversationId: conv.id,
    messageId: msg.id,
    provider: result.provider,
    failedOver: result.failedOver,
    error: null,
  };
}

function failure(error: string): NotifyResult {
  return {
    ok: false,
    conversationId: null,
    messageId: null,
    provider: null,
    failedOver: false,
    error,
  };
}
