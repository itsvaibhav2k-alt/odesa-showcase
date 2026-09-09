/**
 * Retell tool endpoints — Phase 5 scaffold.
 *
 * Each test hits one of the 7 tool routes directly (bypassing UI),
 * asserting the response shape and DB side effects. Requests carry Retell's
 * raw-body HMAC signature. All tests use the Galaxy
 * seed's fixed org/tenant UUIDs; no test writes to cross-org rows.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import { HAVE_SUPABASE, createAdmin, provisionGalaxyOwner } from '../today/helpers';
import { createMessagingMockHarness } from '../mocks/messaging-mock';
import { signWebhookPost } from './signed-webhook';

const GALAXY_ORG_PHONE = '+15715550101';
const GALAXY_TENANT_PHONE = '+15715550201';
const GALAXY_TENANT_ID = '55555555-5555-5555-5555-555555555501';
const GHOST_PHONE = '+15715559999';
const RUN = Date.now();

async function postSignedTool(
  request: APIRequestContext,
  name: string,
  payload: unknown,
) {
  const signed = signWebhookPost(payload);
  return request.post(`/api/retell/tools/${name}`, {
    headers: signed.headers,
    data: signed.body,
  });
}

test.describe.serial('retell tool endpoints', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: Awaited<ReturnType<typeof provisionGalaxyOwner>> | null = null;
  test.beforeEach(async ({ request }) => {
    await createMessagingMockHarness(request).install();
    owner = await provisionGalaxyOwner();
    await createAdmin().from('users').update({ phone_e164: '+15715550991' }).eq('id', owner.userId);
  });

  test.afterEach(async ({ request }) => {
    await createMessagingMockHarness(request).uninstall().catch(() => {});
    await owner?.teardown();
    owner = null;
  });

  test('lookup_tenant_by_phone returns seeded Galaxy tenant', async ({ request }) => {
    const res = await postSignedTool(request, 'lookup_tenant_by_phone', {
      call_id: 'test-call-1',
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.not_found).toBe(false);
    expect(body.tenant_id).toBe(GALAXY_TENANT_ID);
    expect(body.full_name).toBe('Marcus Alvarez');
    expect(body.unit_label).toBeTruthy();
    expect(body.property_name).toBeTruthy();
  });

  test('lookup_tenant_by_phone returns not_found for unseeded phone', async ({ request }) => {
    const res = await postSignedTool(request, 'lookup_tenant_by_phone', {
      from_number: GHOST_PHONE,
      to_number: GALAXY_ORG_PHONE,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.not_found).toBe(true);
  });

  test('rejects requests without a Retell signature', async ({ request }) => {
    const res = await request.post('/api/retell/tools/lookup_tenant_by_phone', {
      data: {
        from_number: GALAXY_TENANT_PHONE,
        to_number: GALAXY_ORG_PHONE,
      },
    });
    expect(res.status()).toBe(401);
  });

  test('get_rent_status returns current cycle for Galaxy tenant', async ({ request }) => {
    const res = await postSignedTool(request, 'get_rent_status', {
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.rent_amount).toBe('number');
    expect(body.rent_amount).toBeGreaterThan(0);
    expect(['pending', 'reminder_sent', 'due_sent', 'late_1', 'late_3', 'late_7', 'paid', 'escalated', 'plan_agreed', 'unknown']).toContain(body.current_status);
  });

  test('get_lease_details returns active lease shape', async ({ request }) => {
    const res = await postSignedTool(request, 'get_lease_details', {
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.rent_due_day).toBeGreaterThanOrEqual(1);
    expect(body.rent_due_day).toBeLessThanOrEqual(31);
    expect(body.status).toBe('active');
    expect(body.rent_amount).toBeGreaterThan(0);
  });

  test('create_work_order inserts a shadow-queued WO', async ({ request }) => {
    const res = await postSignedTool(request, 'create_work_order', {
      call_id: `test-call-wo-${RUN}`,
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
      args: {
        description: 'Kitchen sink clogged, water backs up when using the disposal',
        category: 'plumbing',
        urgency: 'routine',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.work_order_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.shadow_queued).toBe(true);

    const admin = createAdmin();
    const { data: wo } = await admin
      .from('work_orders')
      .select('category, urgency, status, status_timeline')
      .eq('id', body.work_order_id)
      .single();
    expect(wo?.category).toBe('plumbing');
    expect(wo?.urgency).toBe('routine');
    expect(wo?.status).toBe('open');

    // Cleanup
    await admin.from('work_orders').delete().eq('id', body.work_order_id);
    await admin.from('retell_tool_invocations').delete().eq('call_id', `test-call-wo-${RUN}`);
  });

  test('escalate_to_landlord marks conversation escalated', async ({ request }) => {
    const admin = createAdmin();
    const res = await postSignedTool(request, 'escalate_to_landlord', {
      call_id: `test-call-escalate-${RUN}`,
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
      args: {
        reason: 'active water leak in ceiling above kitchen',
        urgency: 'emergency',
        category: 'water_leak',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.escalated).toBe(body.landlord_sms_sent === true);
    expect(body.escalation_recorded ?? true).toBe(true);
    expect(body).toHaveProperty('landlord_sms_sent');

    const { data: conv } = await admin
      .from('conversations')
      .select('status, summary')
      .eq('id', body.conversation_id)
      .single();
    expect(conv?.status).toBe('escalated');
    expect(conv?.summary).toContain('ESCALATION');

    await admin.from('messages').delete().like('retell_artifact_key', `test-call-escalate-${RUN}%`);
    await admin.from('conversations').delete().like('retell_artifact_key', `test-call-escalate-${RUN}%`);
    await admin.from('retell_tool_invocations').delete().eq('call_id', `test-call-escalate-${RUN}`);
  });

  test('schedule_callback logs a conversation', async ({ request }) => {
    const res = await postSignedTool(request, 'schedule_callback', {
      call_id: `test-call-callback-${RUN}`,
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
      args: {
        preferred_time: 'tomorrow afternoon',
        topic: 'asking about renewing the lease',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.callback_scheduled).toBe(true);

    const admin = createAdmin();
    const { data: conv } = await admin
      .from('conversations')
      .select('summary')
      .eq('id', body.conversation_id)
      .single();
    expect(conv?.summary).toContain('CALLBACK REQUESTED');

    await admin.from('conversations').delete().eq('id', body.conversation_id);
    await admin.from('retell_tool_invocations').delete().eq('call_id', `test-call-callback-${RUN}`);
  });

  test('send_sms_followup attempts the send via failover', async ({ request }) => {
    const res = await postSignedTool(request, 'send_sms_followup', {
      call_id: `test-call-sms-${RUN}`,
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
      args: {
        body: 'We received your request and will follow up.',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sent');
    expect(body.conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.message_id).toMatch(/^[0-9a-f-]{36}$/);

    const admin = createAdmin();
    const { data: msg } = await admin
      .from('messages')
      .select('draft_status, direction, provider, body')
      .eq('id', body.message_id)
      .single();
    expect(msg?.direction).toBe('outbound');
    expect(msg?.draft_status).toBe('auto_sent');

    await admin.from('messages').delete().eq('id', body.message_id);
    await admin.from('action_proposals').delete().like('retell_artifact_key', `test-call-sms-${RUN}%`);
    await admin.from('conversations').delete().eq('id', body.conversation_id);
    await admin.from('retell_tool_invocations').delete().eq('call_id', `test-call-sms-${RUN}`);
  });

  test('provider failure returns 502 and persists terminal failure evidence', async ({ request }) => {
    const callId = `test-call-sms-failure-${RUN}`;
    const mock = createMessagingMockHarness(request);
    await mock.shouldFail('linq', true);
    await mock.shouldFail('twilio', true);
    const res = await postSignedTool(request, 'send_sms_followup', {
      call_id: callId,
      from_number: GALAXY_TENANT_PHONE,
      to_number: GALAXY_ORG_PHONE,
      args: { body: 'We received your request and will follow up.' },
    });
    expect(res.status()).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ sent: false, retryable: true });
    const admin = createAdmin();
    const { data: invocation } = await admin.from('retell_tool_invocations')
      .select('status, http_status, retryable, evidence').eq('call_id', callId).single();
    expect(invocation).toMatchObject({ status: 'failed', http_status: 502, retryable: true });
    expect(invocation?.evidence).toMatchObject({ message_id: body.message_id });
    await admin.from('messages').delete().like('retell_artifact_key', `${callId}%`);
    await admin.from('conversations').delete().like('retell_artifact_key', `${callId}%`);
    await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
  });
});
