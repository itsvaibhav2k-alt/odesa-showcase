/**
 * Privacy Mode round-trip spec — v1.5 verification gate #6.
 *
 * When `org.privacy_mode='on_prem'` (or per-property override),
 * worker calls must route through the customer's Ollama host instead
 * of Anthropic. The plan also requires a UI health-check button that
 * pings the configured host and reports OK / fail.
 *
 * Acceptance:
 *   - Provision a fixture with privacy_mode='on_prem' on every
 *     property and `ollama_host=<mock baseUrl>`.
 *   - Stand up the Ollama mock server (scripted reply for the worker).
 *   - Trigger a worker spawn for one property.
 *   - Assert the Ollama mock recorded a `/api/chat` call.
 *   - Assert the Anthropic mock did NOT record any call (provider
 *     routing is exclusive in privacy mode).
 *   - Hit the health-check endpoint; assert it reports OK.
 *
 * Mock-state-sensitive: must run with --workers=1 (Anthropic mock state
 * is shared across the test process).
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyV15,
  setPropertyPrivacyMode,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import { createAnthropicMockHarness } from '../mocks/anthropic-mock';
import {
  ollamaTextReply,
  startOllamaMock,
  type OllamaMockHandle,
} from '../mocks/ollama-mock';

test.describe('privacy: on_prem routes through Ollama, not Anthropic', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;
  let ollama: OllamaMockHandle;

  test.beforeEach(async ({ request }) => {
    ollama = await startOllamaMock({
      scripts: [
        {
          matchModel: 'llama',
          reply: ollamaTextReply(
            JSON.stringify({
              action_type: 'draft_sms_reply',
              payload: {
                body: 'Acknowledged. Will dispatch a plumber within the hour.',
                tone: 'neutral',
              },
              reasoning: 'Tenant reports active leak; routine SMS confirmation.',
              confidence: 0.82,
              context_fact_ids: [],
            }),
          ),
        },
      ],
    });
    fixture = await provisionGalaxyV15({
      propertyCount: 1,
      privacyMode: 'on_prem',
      ollamaHost: ollama.ollamaHost,
    });
    // Belt-and-suspenders: ensure the property's ollama_host points
    // at the just-started mock (the fixture passed it but a previous
    // test could have flipped it).
    await setPropertyPrivacyMode(
      fixture.properties[0]!.id,
      'on_prem',
      ollama.ollamaHost,
    );

    const mock = createAnthropicMockHarness(request);
    await mock.install({ scripts: [] });
  });

  test.afterEach(async ({ request }) => {
    const mock = createAnthropicMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
    if (ollama) await ollama.stop();
  });

  test('worker spawn routes through Ollama and skips Anthropic', async ({
    request,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    const spawn = await request.post('/api/agent/worker/spawn', {
      data: {
        propertyId,
        actionType: 'draft_sms_reply',
        input: {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          tenant_phone: '+15551234567',
          inbound_text: 'leak under the kitchen sink',
        },
      },
    });
    expect(spawn.status()).toBe(200);

    const ollamaCalls = ollama.getRecordedCalls();
    expect(ollamaCalls.some((c) => c.path === '/api/chat')).toBe(true);

    const mock = createAnthropicMockHarness(request);
    const anthropicCalls = await mock.getRecorded();
    expect(anthropicCalls).toHaveLength(0);
  });

  test.fixme(
    'health-check endpoint reports OK against the live Ollama mock',
    async ({ request }) => {
      const propertyId = fixture.properties[0]!.id;
      const resp = await request.post('/api/agent/privacy/health-check', {
        data: { propertyId },
      });
      expect(resp.status()).toBe(200);
      const json = (await resp.json()) as {
        success: boolean;
        data: { ok: boolean; modelsAvailable: readonly string[] };
      };
      expect(json.data.ok).toBe(true);
      expect(json.data.modelsAvailable.length).toBeGreaterThan(0);
    },
  );

  test.fixme('health-check fails when Ollama host is unreachable', async ({
    request,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    // Point the property at a port where nothing is listening.
    await setPropertyPrivacyMode(propertyId, 'on_prem', 'http://127.0.0.1:1');
    const resp = await request.post('/api/agent/privacy/health-check', {
      data: { propertyId },
    });
    const json = (await resp.json()) as {
      success: boolean;
      data: { ok: boolean; error?: string };
    };
    expect(json.data.ok).toBe(false);
    expect(json.data.error?.length ?? 0).toBeGreaterThan(0);
  });
});
