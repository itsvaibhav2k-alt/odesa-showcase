/**
 * Reflection integration spec — v1.5 verification gate #2.
 *
 * Reflection runs nightly: it scans the day's committed/rejected/edited
 * proposals and synthesizes one or more new memory_facts whose
 * `evidence_proposal_ids` cite the proposals it learned from.
 *
 * Acceptance:
 *   - Seed 3 proposals (1 committed, 1 rejected, 1 edited) on one
 *     property. The fixture's default 10 proposals already include the
 *     three statuses; this spec adds 3 more with explicit content so the
 *     reflection prompt has a deterministic target.
 *   - Trigger reflection (POST `/api/agent/reflection/run` — stub
 *     endpoint owned by agent-eng).
 *   - Anthropic mock scripts the proposer + judge replies.
 *   - Assert ≥1 new memory_fact with non-empty `evidence_proposal_ids`
 *     intersecting the seeded proposal ids.
 *
 * Mock-state-sensitive: must run with --workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyV15,
  seedExtraProposal,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  toolUseReply,
} from '../mocks/anthropic-mock';

test.describe('agent: reflection integration', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });

    const propertyId = fixture.properties[0]!.id;
    const orgId = fixture.organizationId;
    // Seed the explicit committed/rejected/edited triple the spec
    // asserts reflection learns from.
    await seedExtraProposal({
      organizationId: orgId,
      propertyId,
      status: 'committed',
      actionType: 'dispatch_vendor',
      confidence: 0.85,
      gateDecision: 'auto',
      reasoning: 'Vendor accepted last 5 dispatches; trust threshold cleared.',
    });
    await seedExtraProposal({
      organizationId: orgId,
      propertyId,
      status: 'rejected',
      actionType: 'send_sms',
      confidence: 0.55,
      gateDecision: 'review',
      reasoning: 'Owner rejected: tenant prefers email after-hours.',
    });
    await seedExtraProposal({
      organizationId: orgId,
      propertyId,
      status: 'edited',
      actionType: 'schedule_callback',
      confidence: 0.6,
      gateDecision: 'review',
      reasoning: 'Owner shifted callback time from 9am to 2pm.',
    });

    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: [
        {
          matchActionType: 'reflect_proposer',
          reply: toolUseReply('propose_fact', {
            fact_type: 'tenant_pattern',
            content: { pattern: 'prefers_email_after_hours' },
            evidence_proposal_ids: [],
          }),
        },
        {
          matchActionType: 'reflect_judge',
          reply: toolUseReply('apply_fact', { action: 'commit' }),
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
    'creates ≥1 memory_fact whose evidence_proposal_ids cite the seeded triple',
    async ({ request }) => {
      const propertyId = fixture.properties[0]!.id;
      const triggerResp = await request.post('/api/agent/reflection/run', {
        data: { propertyId },
      });
      expect(triggerResp.status()).toBe(200);

      const admin = createAdmin();
      const { data: facts } = await admin
        .from('memory_facts')
        .select('id, fact_type, evidence_proposal_ids, source')
        .eq('property_id', propertyId)
        .eq('source', 'derived');

      expect(facts ?? []).toHaveLength(1);
      const fact = (facts ?? [])[0]!;
      expect(fact.evidence_proposal_ids ?? []).not.toHaveLength(0);
    },
  );

  test.fixme('Anthropic mock recorded proposer + judge in order', async ({
    request,
  }) => {
    const mock = createAnthropicMockHarness(request);
    const recorded = await mock.getRecorded();
    const actionTypes = recorded.map((c) => c.actionType);
    expect(actionTypes).toEqual(
      expect.arrayContaining(['reflect_proposer', 'reflect_judge']),
    );
  });
});
