import { expect, test, type APIRequestContext } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import { HAVE_SUPABASE, createAdmin, provisionGalaxyOwner } from '../today/helpers';
import { deriveIdempotencyKey } from '@/lib/agent/retell-auth';

const FROM = '+15715550201';
const TO = '+15715550101';
const HEADERS = { authorization: `Bearer ${process.env.RETELL_API_KEY ?? 'retell-dev-test-key'}` };

async function post55(
  request: APIRequestContext,
  toolName: string,
  callId: string,
  args: Record<string, unknown>,
) {
  const responses = await Promise.all(
    Array.from({ length: 55 }, () =>
      request.post(`/api/retell/tools/${toolName}`, {
        headers: HEADERS,
        data: { call_id: callId, from_number: FROM, to_number: TO, args },
      }),
    ),
  );
  expect(new Set(responses.map((response) => response.status()))).toEqual(new Set([200]));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
  return bodies[0] as Record<string, unknown>;
}

test.describe.serial('Retell durable tool concurrency', () => {
  test.skip(!HAVE_SUPABASE, 'requires isolated local Supabase');

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

  for (const scenario of [
    {
      tool: 'create_work_order',
      args: { description: 'Wave 3 concurrent kitchen leak', category: 'plumbing', urgency: 'routine' },
      idField: 'work_order_id',
      table: 'work_orders',
    },
    {
      tool: 'schedule_callback',
      args: { preferred_time: 'tomorrow afternoon', topic: 'lease renewal question' },
      idField: 'conversation_id',
      table: 'conversations',
    },
    {
      tool: 'create_followup_sms_draft',
      args: { body: 'Please review the proposed payment plan.', reason: 'payment plan requires review' },
      idField: 'message_id',
      table: 'messages',
    },
    {
      tool: 'send_sms_followup',
      args: { body: 'Your rent is late; please agree to a payment plan.' },
      idField: 'message_id',
      table: 'messages',
    },
    {
      tool: 'escalate_to_landlord',
      args: { reason: 'active water leak', urgency: 'emergency', category: 'water_leak' },
      idField: 'conversation_id',
      table: 'conversations',
    },
    {
      tool: 'confirm_emergency',
      args: { utterance: 'Water is flooding the kitchen.' },
      idField: null,
      table: null,
    },
  ] as const) {
    test(`55 concurrent ${scenario.tool} retries create one invocation and replay the canonical result`, async ({ request }) => {
      const admin = createAdmin();
      const callId = `retell-tool-${scenario.tool}-${Date.now()}`;
      try {
        const body = await post55(request, scenario.tool, callId, scenario.args);
        const { count: invocationCount } = await admin
          .from('retell_tool_invocations')
          .select('*', { count: 'exact', head: true })
          .eq('call_id', callId)
          .eq('tool_name', scenario.tool);
        expect(invocationCount).toBe(1);

        if (scenario.idField && scenario.table) {
          const id = body[scenario.idField];
          expect(id).toBeTruthy();
          const { count } = await admin
            .from(scenario.table)
            .select('*', { count: 'exact', head: true })
            .eq('id', id as string);
          expect(count).toBe(1);
        }

        if (scenario.tool === 'escalate_to_landlord') {
          expect((await createMessagingMockHarness(request).getRecorded()).length).toBe(1);
        }
      } finally {
        await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
        await admin.from('messages').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('action_proposals').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('work_orders').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('conversations').delete().like('retell_artifact_key', `${callId}%`);
        await admin.from('voice_calls').delete().eq('retell_call_id', callId);
        const [{ count: invocationRows }, { count: conversations }, { count: messages }, { count: proposals }, { count: workOrders }] = await Promise.all([
          admin.from('retell_tool_invocations').select('*', { count: 'exact', head: true }).eq('call_id', callId),
          admin.from('conversations').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
          admin.from('messages').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
          admin.from('action_proposals').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
          admin.from('work_orders').select('*', { count: 'exact', head: true }).like('retell_artifact_key', `${callId}%`),
        ]);
        expect({ invocationRows, conversations, messages, proposals, workOrders }).toEqual({
          invocationRows: 0, conversations: 0, messages: 0, proposals: 0, workOrders: 0,
        });
      }
    });
  }

  test('expired interrupted winner is taken over and recovers its unique artifact', async ({ request }) => {
    const admin = createAdmin();
    const callId = `retell-crash-recovery-${Date.now()}`;
    const toolCallId = 'interrupted-winner';
    const args = { description: 'Recovered leak artifact', category: 'plumbing', urgency: 'routine' };
    const hash = deriveIdempotencyKey(callId, 'create_work_order', args);
    const artifactKey = `${callId}:create_work_order:${toolCallId}`;
    try {
      const { data: first, error } = await admin.rpc('claim_retell_tool_invocation', {
        p_organization_id: owner!.organizationId, p_call_id: callId,
        p_tool_name: 'create_work_order', p_idempotency_key: toolCallId, p_request_hash: hash,
      });
      expect(error).toBeNull();
      const staleOwner = first as { claimed: boolean; id: string; claim_token: string; claim_generation: number };
      expect(staleOwner.claimed).toBe(true);
      const { data: lease } = await admin.from('leases').select('tenant_id, unit_id')
        .eq('tenant_id', '55555555-5555-5555-5555-555555555501').eq('status', 'active').single();
      const { data: artifact } = await admin.from('work_orders').insert({
        organization_id: owner!.organizationId, tenant_id: lease!.tenant_id, unit_id: lease!.unit_id,
        category: 'plumbing', urgency: 'routine', status: 'open', description: args.description,
        status_timeline: [], retell_artifact_key: artifactKey,
      }).select('id').single();
      await admin.from('retell_tool_invocations').update({ lease_expires_at: new Date(Date.now() - 1_000).toISOString() }).eq('call_id', callId);

      const response = await request.post('/api/retell/tools/create_work_order', {
        headers: HEADERS,
        data: { call_id: callId, tool_call_id: toolCallId, from_number: FROM, to_number: TO, args },
      });
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ work_order_id: artifact!.id, status: 'open' });
      const { data: invocation } = await admin.from('retell_tool_invocations')
        .select('status, attempt_count, canonical_result').eq('call_id', callId).single();
      expect(invocation).toMatchObject({ status: 'completed', attempt_count: 2 });
      const staleCompletion = await admin.rpc('complete_retell_tool_invocation', {
        p_invocation_id: staleOwner.id, p_claim_token: staleOwner.claim_token,
        p_claim_generation: staleOwner.claim_generation, p_status: 'completed',
        p_canonical_result: { work_order_id: 'stale-duplicate' }, p_http_status: 200,
      });
      expect(staleCompletion.error?.message).toMatch(/stale Retell invocation ownership fence/i);
      const { count } = await admin.from('work_orders').select('*', { count: 'exact', head: true }).eq('retell_artifact_key', artifactKey);
      expect(count).toBe(1);
    } finally {
      await admin.from('work_orders').delete().eq('retell_artifact_key', artifactKey);
      await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
    }
  });

  test('a slow live winner renews its lease beyond the original lease window', async () => {
    const admin = createAdmin();
    const callId = `retell-slow-lease-${Date.now()}`;
    try {
      const claimArgs = { p_organization_id: owner!.organizationId, p_call_id: callId,
        p_tool_name: 'create_work_order', p_idempotency_key: 'slow', p_request_hash: 'slow' };
      const { data: first } = await admin.rpc('claim_retell_tool_invocation', claimArgs);
      const owned = first as { id: string; claim_token: string; claim_generation: number };
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect((await admin.rpc('renew_retell_tool_invocation_lease', {
        p_invocation_id: owned.id, p_claim_token: owned.claim_token,
        p_claim_generation: owned.claim_generation,
      })).data).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const { data: contender } = await admin.rpc('claim_retell_tool_invocation', claimArgs);
      expect(contender).toMatchObject({ claimed: false, status: 'processing' });
    } finally {
      await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
    }
  });
});
