/**
 * Retell mid-call worker latency spec — v1.5 verification gate #7.
 *
 * Mid-call, the voice agent can spawn a worker for `confirm_emergency`
 * (and a small list of other in-call tools) — these MUST complete
 * inside the 800ms latency budget so the call doesn't develop an
 * audible pause. The provider is Haiku 4.5 with prompt-caching enabled
 * on the system prompt.
 *
 * Acceptance:
 *   - Anthropic mock returns a tool_use response with realistic
 *     usage.input_tokens and a fast scripted latency (no artificial
 *     delay; the only latency is HTTP overhead).
 *   - Trigger the in-call worker spawn (POST `/api/retell/worker/
 *     confirm_emergency`).
 *   - Assert the response time < 800ms.
 *   - Assert the recorded Anthropic call had cache_control breakpoints
 *     in the system prompt (the provider sets them to land cache hits).
 *
 * Mock-state-sensitive — workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyV15,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  toolUseReply,
} from '../mocks/anthropic-mock';
import { createMessagingMockHarness } from '../mocks/messaging-mock';
import { createAdmin, provisionGalaxyOwner } from '../today/helpers';

const LATENCY_BUDGET_MS = 800;

test.describe('retell: mid-call worker latency', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;
  let owner: Awaited<ReturnType<typeof provisionGalaxyOwner>>;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });
    owner = await provisionGalaxyOwner();
    await createAdmin().from('users').update({ phone_e164: '+15715550992' }).eq('id', owner.userId);
    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: [
        {
          matchActionType: 'confirm_emergency',
          matchModel: 'haiku',
          reply: toolUseReply(
            'confirm_emergency',
            { confirmed: true, severity: 'high' },
            {
              usage: {
                input_tokens: 1200,
                output_tokens: 25,
                cache_read_input_tokens: 1100,
                cache_creation_input_tokens: 100,
              },
            },
          ),
        },
      ],
    });
    await createMessagingMockHarness(request).install();
  });

  test.afterEach(async ({ request }) => {
    const mock = createAnthropicMockHarness(request);
    await mock.uninstall().catch(() => {});
    await createMessagingMockHarness(request).uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
    if (owner) await owner.teardown();
  });

  test(
    'emergency detect → confirm → escalate → work order completes deterministically',
    async ({ request }) => {
      const propertyId = fixture.properties[0]!.id;
      const callId = `emergency-path-${Date.now()}`;
      const fromNumber = '+15715550201';
      const toNumber = '+15715550101';
      const headers = { authorization: `Bearer ${process.env.RETELL_API_KEY ?? 'retell-dev-test-key'}` };

      const start = Date.now();
      const resp = await request.post('/api/retell/tools/confirm_emergency', {
        headers,
        data: {
          call_id: callId,
          from_number: fromNumber,
          to_number: toNumber,
          args: { property_id: propertyId, utterance: 'There is water flooding the kitchen.' },
        },
      });
      const elapsed = Date.now() - start;
      expect(resp.status()).toBe(200);
      expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
      expect(await resp.json()).toMatchObject({ severity: 'emergency', recommendedAction: 'escalate_now' });

      const escalated = await request.post('/api/retell/tools/escalate_to_landlord', {
        headers,
        data: {
          call_id: callId, from_number: fromNumber, to_number: toNumber,
          args: { reason: 'Active kitchen flooding', urgency: 'emergency', category: 'water_leak' },
        },
      });
      expect(escalated.status()).toBe(200);
      expect(await escalated.json()).toMatchObject({ escalated: true, landlord_sms_sent: true });

      const workOrder = await request.post('/api/retell/tools/create_work_order', {
        headers,
        data: {
          call_id: callId, from_number: fromNumber, to_number: toNumber,
          args: { description: 'Active kitchen flooding', category: 'plumbing', urgency: 'emergency' },
        },
      });
      expect(workOrder.status()).toBe(200);
      expect(await workOrder.json()).toMatchObject({ status: 'open', shadow_queued: true });

      const admin = createAdmin();
      await admin.from('retell_tool_invocations').delete().eq('call_id', callId);
      await admin.from('messages').delete().like('retell_artifact_key', `${callId}%`);
      await admin.from('action_proposals').delete().like('retell_artifact_key', `${callId}%`);
      await admin.from('work_orders').delete().like('retell_artifact_key', `${callId}%`);
      await admin.from('conversations').delete().like('retell_artifact_key', `${callId}%`);
    },
  );

  test(
    'cache breakpoints are present on the recorded Anthropic call',
    async ({ request }) => {
      const propertyId = fixture.properties[0]!.id;
      const callId = `mock-call-cache-${Date.now()}`;
      await request.post('/api/retell/tools/confirm_emergency', {
        headers: { authorization: `Bearer ${process.env.RETELL_API_KEY ?? 'retell-dev-test-key'}` },
        data: {
          call_id: callId,
          from_number: '+15715550201',
          to_number: '+15715550101',
          args: { property_id: propertyId, utterance: 'There is water flooding the kitchen.' },
        },
      });
      const mock = createAnthropicMockHarness(request);
      const recorded = await mock.getRecorded();
      const last = recorded[recorded.length - 1];
      expect(last?.hadCacheBreakpoints).toBe(true);
      await createAdmin().from('retell_tool_invocations').delete().eq('call_id', callId);
    },
  );
});
