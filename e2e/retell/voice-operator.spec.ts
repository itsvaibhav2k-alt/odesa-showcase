/**
 * Voice Operator V1 — the six demo call flows, end-to-end at API level.
 *
 * Each flow drives the real call lifecycle against a running server:
 * webhook call_started → report_intents (the policy brain) → tool calls →
 * webhook call_ended, then asserts the DB artifacts (voice_calls outcome,
 * inbox conversation + message, work orders, voice_call_review proposals)
 * and the safety invariants the plan demands: unknown callers leak nothing,
 * no fabricated payment dates, risky SMS drafts instead of sending, and no
 * forbidden content ever auto-sends.
 *
 * Requires the local Supabase stack + Galaxy seed (skips otherwise), same
 * as tool-endpoints.spec.ts. Self-cleaning: every row created is deleted.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

import { HAVE_SUPABASE, createAdmin, provisionGalaxyOwner } from '../today/helpers';
import { createMessagingMockHarness } from '../mocks/messaging-mock';
import { signWebhookPost } from './signed-webhook';

const RETELL_KEY = process.env.RETELL_API_KEY ?? 'retell-dev-test-key';
const GALAXY_ORG_PHONE = '+15715550101';
const GALAXY_TENANT_PHONE = '+15715550201'; // Marcus Alvarez (seeded)
const GALAXY_VENDOR_PHONE = '+15715550301'; // Beltway Plumbing (seeded)
const GHOST_PHONE = '+15715559999'; // unseeded
const OWNER_PHONE = '+15715550901'; // pinned onto the provisioned owner user

const HEADERS = { authorization: `Bearer ${RETELL_KEY}` };
const RUN = Date.now();

/** Bodies that must never appear in an auto-sent outbound message. */
const FORBIDDEN_AUTO_SENT = /evict|waive|payment plan|you're scheduled|you are scheduled/i;

interface Cleanup {
  callIds: string[];
  conversationIds: string[];
  workOrderIds: string[];
  proposalIds: string[];
}

function cleanupBucket(): Cleanup {
  return { callIds: [], conversationIds: [], workOrderIds: [], proposalIds: [] };
}

async function sweep(c: Cleanup): Promise<void> {
  const admin = createAdmin();
  for (const id of c.proposalIds) {
    await admin.from('action_proposals').delete().eq('id', id);
  }
  for (const id of c.conversationIds) {
    await admin.from('messages').delete().eq('conversation_id', id);
    await admin.from('conversations').delete().eq('id', id);
  }
  for (const id of c.workOrderIds) {
    await admin.from('work_orders').delete().eq('id', id);
  }
  for (const id of c.callIds) {
    await admin.from('messages').delete().like('retell_artifact_key', `${id}%`);
    await admin.from('action_proposals').delete().like('retell_artifact_key', `${id}%`);
    await admin.from('work_orders').delete().like('retell_artifact_key', `${id}%`);
    await admin.from('conversations').delete().like('retell_artifact_key', `${id}%`);
    await admin.from('retell_tool_invocations').delete().eq('call_id', id);
    await admin.from('voice_calls').delete().eq('retell_call_id', id);
  }
}

async function webhook(
  request: APIRequestContext,
  event: 'call_started' | 'call_ended',
  call: Record<string, unknown>,
) {
  // Signed like the real provider — required when RETELL_REQUIRE_SIGNATURE
  // is on. Send the signed raw body verbatim, never re-serialized.
  const signed = signWebhookPost({ event, call });
  const res = await request.post('/api/retell/webhook', {
    headers: signed.headers,
    data: signed.body,
  });
  return res;
}

async function tool(
  request: APIRequestContext,
  name: string,
  data: Record<string, unknown>,
) {
  return request.post(`/api/retell/tools/${name}`, { headers: HEADERS, data });
}

/**
 * Assert the auto-sent outbound messages of a conversation carry no
 * forbidden content (the artifact message is direction 'inbound', so this
 * checks real tenant-facing sends only).
 */
async function assertNoForbiddenAutoSends(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const admin = createAdmin();
  const { data: msgs } = await admin
    .from('messages')
    .select('body, draft_status, direction')
    .in('conversation_id', conversationIds)
    .eq('direction', 'outbound')
    .eq('draft_status', 'auto_sent');
  for (const m of msgs ?? []) {
    expect(m.body ?? '').not.toMatch(FORBIDDEN_AUTO_SENT);
  }
}

test.describe.serial('voice operator call flows', () => {
  test.skip(!HAVE_SUPABASE, 'requires local Supabase env (SUPABASE_URL etc.)');

  test.beforeEach(async ({ request }) => {
    await createMessagingMockHarness(request).install();
  });

  test.afterEach(async ({ request }) => {
    await createMessagingMockHarness(request).uninstall().catch(() => {});
  });

  test('F1 — tenant maintenance call creates a work order and a call artifact', async ({
    request,
  }) => {
    const c = cleanupBucket();
    const callId = `voice-e2e-${RUN}-f1`;
    c.callIds.push(callId);
    try {
      const started = await webhook(request, 'call_started', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(started.status()).toBe(200);
      const startedBody = await started.json();
      // Verified tenant gets privacy-granted dynamic variables.
      expect(startedBody.retell_llm_dynamic_variables.caller_name).toContain('Marcus');
      expect(startedBody.retell_llm_dynamic_variables.ledger_status_line).toMatch(
        /ledger currently shows|ledger has no rent entries/,
      );

      const reported = await tool(request, 'report_intents', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: { intents: ['maintenance_request'] },
      });
      expect(reported.status()).toBe(200);
      const plan = await reported.json();
      expect(plan.caller_kind).toBe('verified_tenant');
      // Emergency screen comes first for maintenance intake.
      expect(plan.next_question).toMatch(/flooding|electrical danger/i);
      expect(plan.allowed_tools).toContain('create_work_order');

      const wo = await tool(request, 'create_work_order', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: {
          description: 'Kitchen sink leaking, contained under the sink',
          category: 'plumbing',
          urgency: 'routine',
        },
      });
      expect(wo.status()).toBe(200);
      const woBody = await wo.json();
      c.workOrderIds.push(woBody.work_order_id);

      const sms = await tool(request, 'send_sms_followup', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: { body: 'We received your request. A work order was created.' },
      });
      expect(sms.status()).toBe(200);
      const smsBody = await sms.json();
      c.conversationIds.push(smsBody.conversation_id);
      // Safe allow-shape body must not be demoted by the classifier.
      expect(smsBody.drafted ?? false).toBe(false);

      const ended = await webhook(request, 'call_ended', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        transcript:
          'Tenant: My kitchen sink is leaking. Agent: Is there any active flooding? Tenant: No, contained.',
      });
      expect(ended.status()).toBe(200);
      const endedBody = await ended.json();
      c.conversationIds.push(endedBody.conversation_id);
      if (endedBody.proposal_id) c.proposalIds.push(endedBody.proposal_id);
      expect(endedBody.outcome_summary).toBeTruthy();

      const admin = createAdmin();
      const { data: call } = await admin
        .from('voice_calls')
        .select('status, outcome, summary, conversation_id')
        .eq('retell_call_id', callId)
        .single();
      expect(call?.status).toBe('completed');
      expect(call?.conversation_id).toBe(endedBody.conversation_id);
      const outcome = call?.outcome as {
        intentsHandled: string[];
        autonomousActions: Array<{ action: string; ids?: Record<string, string> }>;
      };
      expect(outcome.intentsHandled).toContain('maintenance_request');
      expect(
        outcome.autonomousActions.some(
          (a) => a.action === 'create_work_order' && a.ids?.work_order === woBody.work_order_id,
        ),
      ).toBe(true);

      const { data: conv } = await admin
        .from('conversations')
        .select('channel, summary')
        .eq('id', endedBody.conversation_id)
        .single();
      expect(conv?.channel).toBe('voice');

      await assertNoForbiddenAutoSends(c.conversationIds);
    } finally {
      await sweep(c);
    }
  });

  test('F2 — payment dispute stays ledger-honest and queues owner review', async ({
    request,
  }) => {
    const c = cleanupBucket();
    const callId = `voice-e2e-${RUN}-f2`;
    c.callIds.push(callId);
    try {
      await webhook(request, 'call_started', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });

      const reported = await tool(request, 'report_intents', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: {
          intents: ['payment_dispute'],
          facts: { paymentClaim: { claimed: true, method: 'zelle' } },
        },
      });
      const plan = await reported.json();
      expect(plan.honesty_hints.join(' ')).toMatch(/ledger currently shows/i);

      const rent = await tool(request, 'get_rent_status', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(rent.status()).toBe(200);
      const rentBody = await rent.json();
      // The honesty fix: no fabricated payment timestamp, ever.
      expect(rentBody.last_payment_date).toBeNull();
      expect(rentBody.ledger_status_phrase).toMatch(/ledger currently shows/i);

      const sms = await tool(request, 'send_sms_followup', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: { body: 'Please reply with payment confirmation or a screenshot.' },
      });
      const smsBody = await sms.json();
      c.conversationIds.push(smsBody.conversation_id);
      expect(smsBody.drafted ?? false).toBe(false);

      const ended = await webhook(request, 'call_ended', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        transcript:
          'Tenant: I already paid my rent through Zelle but it still says I am late.',
      });
      const endedBody = await ended.json();
      c.conversationIds.push(endedBody.conversation_id);
      // Payment-claim conflict is a risk flag on a property-resolved call →
      // a voice_call_review proposal must exist.
      expect(endedBody.proposal_id).toBeTruthy();
      c.proposalIds.push(endedBody.proposal_id);

      const admin = createAdmin();
      const { data: proposal } = await admin
        .from('action_proposals')
        .select('action_type, gate_decision, status, payload')
        .eq('id', endedBody.proposal_id)
        .single();
      expect(proposal?.action_type).toBe('voice_call_review');
      expect(proposal?.gate_decision).toBe('review');
      expect(proposal?.status).toBe('proposed');
      const payload = proposal?.payload as { riskFlags: string[] };
      expect(payload.riskFlags.length).toBeGreaterThan(0);

      // No response in this flow carried a payment date claim.
      expect(JSON.stringify(rentBody)).not.toMatch(/payment cleared/i);
      await assertNoForbiddenAutoSends(c.conversationIds);
    } finally {
      await sweep(c);
    }
  });

  test('F3 — multi-topic call handles three intents in one session', async ({
    request,
  }) => {
    const c = cleanupBucket();
    const callId = `voice-e2e-${RUN}-f3`;
    c.callIds.push(callId);
    try {
      await webhook(request, 'call_started', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });

      const reported = await tool(request, 'report_intents', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: {
          intents: ['maintenance_request', 'payment_dispute', 'access_permission'],
          facts: {
            paymentClaim: { claimed: true, method: 'zelle' },
            availability: 'tomorrow morning only, out of town Friday',
          },
        },
      });
      const plan = await reported.json();
      expect(plan.intents_acknowledged).toEqual(
        expect.arrayContaining(['maintenance_request', 'payment_dispute', 'access_permission']),
      );
      expect(plan.allowed_tools).toContain('create_work_order');
      expect(plan.allowed_tools).toContain('send_sms_followup');

      const wo = await tool(request, 'create_work_order', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: {
          description: 'Dishwasher stopped draining yesterday',
          category: 'appliances',
          urgency: 'routine',
        },
      });
      const woBody = await wo.json();
      c.workOrderIds.push(woBody.work_order_id);

      const sms = await tool(request, 'send_sms_followup', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: { body: 'Please reply with payment confirmation or a screenshot.' },
      });
      const smsBody = await sms.json();
      c.conversationIds.push(smsBody.conversation_id);

      const ended = await webhook(request, 'call_ended', {
        call_id: callId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        transcript:
          'Tenant: My dishwasher stopped draining yesterday. Also I paid rent through Zelle but it still says I am late, and I am out of town Friday so maintenance can only come tomorrow morning.',
      });
      const endedBody = await ended.json();
      c.conversationIds.push(endedBody.conversation_id);
      if (endedBody.proposal_id) c.proposalIds.push(endedBody.proposal_id);

      const admin = createAdmin();
      const { data: call } = await admin
        .from('voice_calls')
        .select('outcome')
        .eq('retell_call_id', callId)
        .single();
      const outcome = call?.outcome as { intentsHandled: string[] };
      expect(outcome.intentsHandled.length).toBeGreaterThanOrEqual(3);

      // No appointment promise anywhere in what was auto-sent.
      await assertNoForbiddenAutoSends(c.conversationIds);
    } finally {
      await sweep(c);
    }
  });

  test('F4 — unknown caller gets zero private data and no proposal', async ({
    request,
  }) => {
    const c = cleanupBucket();
    const callId = `voice-e2e-${RUN}-f4`;
    c.callIds.push(callId);
    const responses: string[] = [];
    try {
      const started = await webhook(request, 'call_started', {
        call_id: callId,
        from_number: GHOST_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      const startedBody = await started.json();
      responses.push(JSON.stringify(startedBody));
      // The first disclosure channel must be EMPTY for unknown callers.
      expect(startedBody.retell_llm_dynamic_variables).toEqual({});

      const reported = await tool(request, 'report_intents', {
        call_id: callId,
        from_number: GHOST_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: {
          intents: ['unknown_general'],
          facts: { callerStatedReason: 'calling about the apartment' },
        },
      });
      const plan = await reported.json();
      responses.push(JSON.stringify(plan));
      expect(plan.caller_kind).toBe('unknown_caller');
      expect(plan.allowed_tools).not.toContain('get_rent_status');
      expect(plan.allowed_tools).not.toContain('create_work_order');

      // Direct probe: ledger access stays 404 for an unresolved tenant.
      const rent = await tool(request, 'get_rent_status', {
        call_id: callId,
        from_number: GHOST_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(rent.status()).toBe(404);
      responses.push(JSON.stringify(await rent.json()));

      const ended = await webhook(request, 'call_ended', {
        call_id: callId,
        from_number: GHOST_PHONE,
        to_number: GALAXY_ORG_PHONE,
        transcript: 'Caller: Hi, I am calling about the apartment.',
      });
      const endedBody = await ended.json();
      responses.push(JSON.stringify(endedBody));
      c.conversationIds.push(endedBody.conversation_id);
      // No property → the NOT NULL guard forbids a proposal.
      expect(endedBody.proposal_id).toBeNull();

      const admin = createAdmin();
      const { data: conv } = await admin
        .from('conversations')
        .select('channel, status, tenant_id')
        .eq('id', endedBody.conversation_id)
        .single();
      expect(conv?.channel).toBe('voice');
      expect(conv?.tenant_id).toBeNull();

      // The whole flow leaked no seeded-tenant identity or balances.
      const all = responses.join(' ');
      expect(all).not.toMatch(/Marcus|Alvarez/);
      expect(all).not.toMatch(/\$\d/);
    } finally {
      await sweep(c);
    }
  });

  test('F5 — owner briefing is owner-only; risky reminder drafts, never sends', async ({
    request,
  }) => {
    const c = cleanupBucket();
    const callId = `voice-e2e-${RUN}-f5`;
    c.callIds.push(callId);
    const owner = await provisionGalaxyOwner();
    const admin = createAdmin();
    try {
      const { error: pinErr } = await admin
        .from('users')
        .update({ phone_e164: OWNER_PHONE })
        .eq('id', owner.userId);
      expect(pinErr).toBeNull();

      const briefing = await tool(request, 'get_owner_briefing', {
        call_id: callId,
        from_number: OWNER_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(briefing.status()).toBe(200);
      const briefingBody = await briefing.json();
      for (const key of [
        'late_rent',
        'open_work_orders',
        'pending_approvals',
        'open_conversations',
        'calls_today',
      ]) {
        expect(typeof briefingBody[key]).toBe('number');
      }
      expect(briefingBody.autonomy_tier).toBe(0);

      // Tenants are refused the owner briefing.
      const denied = await tool(request, 'get_owner_briefing', {
        call_id: `${callId}-tenant`,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(denied.status()).toBe(403);

      // A sensitive rent reminder must demote to a pending_review draft.
      const draftCallId = `voice-e2e-${RUN}-f5-draft`;
      c.callIds.push(draftCallId);
      const sms = await tool(request, 'send_sms_followup', {
        call_id: draftCallId,
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
        args: {
          body: 'Reminder: your rent is late, please arrange a payment plan with us.',
        },
      });
      expect(sms.status()).toBe(200);
      const smsBody = await sms.json();
      c.conversationIds.push(smsBody.conversation_id);
      expect(smsBody.sent).toBe(false);
      expect(smsBody.drafted).toBe(true);

      const { data: msg } = await admin
        .from('messages')
        .select('draft_status')
        .eq('id', smsBody.message_id)
        .single();
      expect(msg?.draft_status).toBe('pending_review');
      const { data: draftProposals } = await admin
        .from('action_proposals')
        .select('id')
        .eq('action_type', 'draft_sms_reply')
        .contains('routing', { conversationId: smsBody.conversation_id });
      for (const p of draftProposals ?? []) c.proposalIds.push(p.id);
    } finally {
      await admin.from('users').update({ phone_e164: null }).eq('id', owner.userId);
      await sweep(c);
      await owner.teardown();
    }
  });

  test('F6 — vendor gets job context only, never tenant financials', async ({
    request,
  }) => {
    const c = cleanupBucket();
    const callId = `voice-e2e-${RUN}-f6`;
    c.callIds.push(callId);
    const admin = createAdmin();
    try {
      // Ensure Beltway Plumbing has one assigned job to talk about.
      const { data: vendor } = await admin
        .from('vendors')
        .select('id, organization_id')
        .eq('phone_e164', GALAXY_VENDOR_PHONE)
        .single();
      expect(vendor).toBeTruthy();
      const { data: unit } = await admin
        .from('units')
        .select('id')
        .eq('organization_id', vendor!.organization_id)
        .limit(1)
        .single();
      const { data: wo, error: woErr } = await admin
        .from('work_orders')
        .insert({
          organization_id: vendor!.organization_id,
          unit_id: unit!.id,
          vendor_id: vendor!.id,
          category: 'plumbing',
          urgency: 'routine',
          status: 'assigned',
          description: 'voice-e2e vendor job',
        })
        .select('id')
        .single();
      expect(woErr).toBeNull();
      c.workOrderIds.push(wo!.id);

      const jobs = await tool(request, 'get_vendor_jobs', {
        call_id: callId,
        from_number: GALAXY_VENDOR_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(jobs.status()).toBe(200);
      const jobsBody = await jobs.json();
      const mine = (jobsBody.jobs as Array<Record<string, unknown>>).find(
        (j) => j.work_order_id === wo!.id,
      );
      expect(mine).toBeTruthy();
      // Job context only: no tenant identity, no financials.
      const jobJson = JSON.stringify(jobsBody);
      expect(jobJson).not.toMatch(/Marcus|Alvarez|rent|balance/i);
      expect(jobsBody.autonomy_tier).toBe(0);

      // Non-vendors are refused.
      const denied = await tool(request, 'get_vendor_jobs', {
        call_id: `${callId}-ghost`,
        from_number: GHOST_PHONE,
        to_number: GALAXY_ORG_PHONE,
      });
      expect(denied.status()).toBe(403);
    } finally {
      await sweep(c);
    }
  });
});
