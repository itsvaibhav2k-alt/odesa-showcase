/**
 * Messaging worker: emergency confirmation spec.
 *
 * Inbound SMS containing emergency markers ("flooding", "fire", "no
 * heat") triggers the property worker to:
 *   1. Confirm with the tenant via outbound SMS.
 *   2. On confirmation, emit an `escalate_to_owner` proposal.
 *   3. Create a work_order with urgency='emergency'.
 *
 * Gating semantics — Option A (`gated_no_block`):
 *   - confidence ≥ 0.7 → gate_decision='auto' (still surfaces in the
 *     review feed for owner visibility, but does not block).
 *   - confidence <  0.7 → gate_decision='review' (blocks until owner
 *     approval). Never returns 'block' regardless of autonomy.
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

test.describe('messaging worker: emergency confirmation flow', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1, autonomyLevel: 0.9 });
    const mock = createAnthropicMockHarness(request);
    await mock.install({ scripts: [] });
  });

  test.afterEach(async ({ request }) => {
    const mock = createAnthropicMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test.fixme(
    'high-confidence emergency escalation gates AUTO (gated_no_block)',
    async ({ request }) => {
      const mock = createAnthropicMockHarness(request);
      await mock.setScripts([
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('confirm_emergency', {
            severity: 'high',
            body: 'Confirming — is water still flowing? Reply YES to dispatch.',
            confidence: 0.92,
          }),
        },
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('escalate_to_owner', {
            reason: 'tenant confirmed active flooding',
            severity: 'high',
            confidence: 0.92,
          }),
        },
      ]);

      const resp = await request.post('/api/messaging/inbound/linq', {
        headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
        data: {
          message_id: `linq-emerg-hi-${Date.now()}`,
          from: '+15551234567',
          to: '+15559999999',
          text: 'water is flooding the kitchen',
        },
      });
      expect(resp.status()).toBe(200);

      const admin = createAdmin();
      const { data: proposals } = await admin
        .from('action_proposals')
        .select('action_type, gate_decision, confidence')
        .eq('organization_id', fixture.organizationId)
        .eq('action_type', 'escalate_to_owner');
      expect(proposals ?? []).toHaveLength(1);
      const proposal = (proposals ?? [])[0]!;
      expect(proposal.gate_decision).toBe('auto');
      expect(Number(proposal.confidence)).toBeGreaterThanOrEqual(0.7);
    },
  );

  test.fixme(
    'low-confidence emergency escalation gates REVIEW (gated_no_block)',
    async ({ request }) => {
      const mock = createAnthropicMockHarness(request);
      await mock.setScripts([
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('confirm_emergency', {
            severity: 'medium',
            body: 'Could you describe what is happening?',
            confidence: 0.55,
          }),
        },
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('escalate_to_owner', {
            reason: 'unclear severity; flagging for owner triage',
            severity: 'medium',
            confidence: 0.55,
          }),
        },
      ]);

      const resp = await request.post('/api/messaging/inbound/linq', {
        headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
        data: {
          message_id: `linq-emerg-lo-${Date.now()}`,
          from: '+15551234567',
          to: '+15559999999',
          text: 'something is wrong with the heat',
        },
      });
      expect(resp.status()).toBe(200);

      const admin = createAdmin();
      const { data: proposals } = await admin
        .from('action_proposals')
        .select('action_type, gate_decision, confidence')
        .eq('organization_id', fixture.organizationId)
        .eq('action_type', 'escalate_to_owner');
      expect(proposals ?? []).toHaveLength(1);
      const proposal = (proposals ?? [])[0]!;
      expect(proposal.gate_decision).toBe('review');
      expect(Number(proposal.confidence)).toBeLessThan(0.7);
    },
  );

  test.fixme(
    'escalate_to_owner is never gated to BLOCK (Option A invariant)',
    async ({ request }) => {
      const mock = createAnthropicMockHarness(request);
      // Worst case: very low confidence. Option A still surfaces this
      // for owner review rather than dropping it on the floor.
      await mock.setScripts([
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('escalate_to_owner', {
            reason: 'extremely uncertain signal',
            severity: 'unknown',
            confidence: 0.1,
          }),
        },
      ]);

      await request.post('/api/messaging/inbound/linq', {
        headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
        data: {
          message_id: `linq-emerg-noblock-${Date.now()}`,
          from: '+15551234567',
          to: '+15559999999',
          text: 'help',
        },
      });

      const admin = createAdmin();
      const { data: proposals } = await admin
        .from('action_proposals')
        .select('gate_decision')
        .eq('organization_id', fixture.organizationId)
        .eq('action_type', 'escalate_to_owner');
      const decisions = (proposals ?? []).map((p) => p.gate_decision);
      expect(decisions).not.toContain('block');
    },
  );

  test.fixme(
    'emergency inbound creates a work_order with urgency=emergency',
    async ({ request }) => {
      const mock = createAnthropicMockHarness(request);
      await mock.setScripts([
        {
          matchActionType: 'classify_inbound',
          reply: toolUseReply('escalate_to_owner', {
            reason: 'tenant confirmed active flooding',
            severity: 'high',
            confidence: 0.9,
          }),
        },
      ]);
      await request.post('/api/messaging/inbound/linq', {
        headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
        data: {
          message_id: `linq-emerg-wo-${Date.now()}`,
          from: '+15551234567',
          to: '+15559999999',
          text: 'water is flooding the kitchen',
        },
      });

      const admin = createAdmin();
      const { data: wos } = await admin
        .from('work_orders')
        .select('id, urgency')
        .eq('organization_id', fixture.organizationId);
      const emergency = (wos ?? []).filter((w) => w.urgency === 'emergency');
      expect(emergency).toHaveLength(1);
    },
  );
});
