/**
 * Messaging worker: ambiguous classification spec.
 *
 * When an inbound SMS is genuinely ambiguous (e.g. "fix it asap"), the
 * property worker must:
 *   - propose a clarifying outbound (action_type='send_sms')
 *   - flag the conversation as needing a follow-up classification
 *   - record the ambiguity in reasoning
 *
 * Acceptance:
 *   - Send an inbound SMS with ambiguous body via `/api/messaging/
 *     inbound/linq`.
 *   - Anthropic mock returns a tool_use reply with a clarifying
 *     question.
 *   - Assert the resulting action_proposal has action_type='send_sms'
 *     AND reasoning mentions ambiguity.
 *   - Assert no work order was created (the ambiguity prevents the
 *     auto-dispatch path).
 *
 * Mock-state-sensitive — workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyV15,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  toolUseReply,
} from '../mocks/anthropic-mock';
import { LINQ_TEST_SECRET } from './helpers';

test.describe('messaging worker: ambiguous classification', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });
    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: [
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('send_sms', {
            body: 'Could you tell me which room and what specifically is broken?',
            reason: 'ambiguous_input',
          }),
        },
      ],
    });
  });

  test.afterEach(async ({ request }) => {
    const mock = createAnthropicMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test.fixme(
    'ambiguous inbound generates a clarifying send_sms proposal',
    async ({ request }) => {
      // Wire the messaging fixture's odesa phone to fixture[0]'s
      // organisation; pre-existing helper would normally do this — we
      // POST directly to the inbound webhook here using fixture data.
      const resp = await request.post('/api/messaging/inbound/linq', {
        headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
        data: {
          message_id: `linq-ambig-${Date.now()}`,
          from: '+15551234567',
          to: '+15559999999',
          text: 'fix it asap',
        },
      });
      expect(resp.status()).toBe(200);

      const admin = createAdmin();
      const { data: proposals } = await admin
        .from('action_proposals')
        .select('id, action_type, reasoning')
        .eq('organization_id', fixture.organizationId)
        .order('created_at', { ascending: false })
        .limit(1);
      const last = (proposals ?? [])[0];
      expect(last?.action_type).toBe('send_sms');
      expect(last?.reasoning).toMatch(/ambig|unclear|clarif/i);
    },
  );

  test.fixme(
    'ambiguous inbound does not create a work order',
    async ({ request }) => {
      await request.post('/api/messaging/inbound/linq', {
        headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
        data: {
          message_id: `linq-ambig-2-${Date.now()}`,
          from: '+15551234567',
          to: '+15559999999',
          text: 'fix it asap',
        },
      });
      const admin = createAdmin();
      const { data: wos } = await admin
        .from('work_orders')
        .select('id')
        .eq('organization_id', fixture.organizationId);
      expect(wos ?? []).toHaveLength(0);
    },
  );
});
