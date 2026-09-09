/**
 * Per-event tick runner. Loads one rent_event, applies the state
 * machine, writes the resulting status back, and returns the chosen
 * side effect (tenant-facing or landlord-facing) for the caller to
 * dispatch.
 *
 * Actual SMS delivery is deferred to Phase 6-late / Phase 8 once Agent
 * L's `sendWithFailover` merges — this module emits a pending_review
 * draft message for each tenant-facing side effect so the family/VA
 * can approve or edit before anything goes out.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, RentEventStatus } from '@/types/database';
import { advanceRentEvent, daysBetween, type RentSideEffect } from './state-machine';
import { notifyLandlord } from '@/lib/messaging/notify';

export interface TickResult {
  rentEventId: string;
  previous: RentEventStatus;
  next: RentEventStatus;
  sideEffect: RentSideEffect | null;
  changed: boolean;
}

export async function tickRentEvent({
  db,
  rentEventId,
  today,
}: {
  db: SupabaseClient<Database>;
  rentEventId: string;
  today: string; // ISO YYYY-MM-DD
}): Promise<TickResult> {
  const { data: event, error } = await db
    .from('rent_events')
    .select('id, status, due_date, amount_due, amount_paid, lease_id, organization_id')
    .eq('id', rentEventId)
    .single();
  if (error || !event) {
    throw new Error(`rent_event load failed: ${error?.message ?? 'not found'}`);
  }

  const daysUntilDue = event.due_date
    ? daysBetween(today, event.due_date)
    : 0;

  const result = advanceRentEvent({
    current: event.status,
    daysUntilDue,
    amountDue: Number(event.amount_due),
    amountPaid: Number(event.amount_paid ?? 0),
  });

  if (result.changed) {
    await db
      .from('rent_events')
      .update({ status: result.next })
      .eq('id', event.id);

    if (result.sideEffect === 'escalate_to_landlord') {
      const tenantName = await loadTenantName(db, event.lease_id);
      await notifyLandlord({
        db,
        organizationId: event.organization_id,
        body: `[RENT 7+ DAYS LATE] ${tenantName} hasn't paid. Outstanding: $${Number(event.amount_due) - Number(event.amount_paid ?? 0)}.`,
      });
    } else if (result.sideEffect) {
      await enqueueTenantDraft({
        db,
        organizationId: event.organization_id,
        leaseId: event.lease_id,
        sideEffect: result.sideEffect,
      });
    }
  }

  return {
    rentEventId: event.id,
    previous: event.status,
    next: result.next,
    sideEffect: result.sideEffect,
    changed: result.changed,
  };
}

async function enqueueTenantDraft({
  db,
  organizationId,
  leaseId,
  sideEffect,
}: {
  db: SupabaseClient<Database>;
  organizationId: string;
  leaseId: string;
  sideEffect: RentSideEffect;
}): Promise<void> {
  const { data: lease } = await db
    .from('leases')
    .select('tenant_id')
    .eq('id', leaseId)
    .single();
  if (!lease) return;

  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('tenant_id', lease.tenant_id)
    .eq('channel', 'sms')
    .eq('status', 'open')
    .maybeSingle();

  let conversationId = existing?.id ?? null;
  if (!conversationId) {
    const { data: created } = await db
      .from('conversations')
      .insert({
        organization_id: organizationId,
        tenant_id: lease.tenant_id,
        channel: 'sms',
        status: 'open',
        summary: `[RENT AUTOMATION] ${sideEffect}`,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    conversationId = created?.id ?? null;
  }
  if (!conversationId) return;

  const body = draftBody(sideEffect);
  await db.from('messages').insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    direction: 'outbound',
    provider: 'linq',
    body,
    draft_status: 'pending_review',
  });
}

async function loadTenantName(
  db: SupabaseClient<Database>,
  leaseId: string,
): Promise<string> {
  const { data: lease } = await db
    .from('leases')
    .select('tenant_id')
    .eq('id', leaseId)
    .maybeSingle();
  if (!lease?.tenant_id) return 'Unknown tenant';
  const { data: tenant } = await db
    .from('tenants')
    .select('full_name')
    .eq('id', lease.tenant_id)
    .maybeSingle();
  return tenant?.full_name ?? 'Unknown tenant';
}

function draftBody(sideEffect: RentSideEffect): string {
  switch (sideEffect) {
    case 'send_reminder':
      return 'Hi — a friendly reminder that your rent is due in a few days. Let me know if anything comes up.';
    case 'send_due_notice':
      return 'Hi — your rent is due today. Paying online is fastest; reply here if you need anything.';
    case 'send_late_1_followup':
      return 'Hi — rent landed late this cycle. If you can send it today, we can avoid the late fee kicking in.';
    case 'send_late_3_followup':
      return "Hi — it's been a few days and rent is still outstanding. Let's talk before the late fee steps up.";
    case 'send_late_7_followup':
      return "Hi — rent is now a week late. Please reply so we can sort this out before it escalates.";
    default:
      return 'Hi — Odesa checking in on your account.';
  }
}
