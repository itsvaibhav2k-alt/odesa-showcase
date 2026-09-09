/**
 * Synthesis 3-phase spec — v1.5 verification gate #3.
 *
 * The weekly Sonnet synthesis loop runs three prompts in order:
 *   1. proposer  — propose a new derived fact from observed activity.
 *   2. adversary — find evidence the proposed fact is wrong.
 *   3. judge     — decide merge / supersede / reject.
 *
 * Acceptance:
 *   - Seed memory_facts + proposals on one property.
 *   - Trigger synthesis. Anthropic mock scripts proposer/adversary/judge
 *     replies in FIFO order via `synthesisReplyTriple()`.
 *   - Assert all three prompts called in order (recorded actionType
 *     sequence == ['synthesize_proposer', 'synthesize_adversary',
 *     'synthesize_judge']).
 *   - Assert the merge/supersede action is reflected in memory_facts:
 *     either a new derived fact or a superseded_at on the obsoleted
 *     fact.
 *
 * Mock-state-sensitive: must run with --workers=1.
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
  synthesisReplyTriple,
} from '../mocks/anthropic-mock';

test.describe('agent: synthesis 3-phase loop', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });
    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: synthesisReplyTriple({
        proposed: {
          factType: 'derived_rule',
          content: { rule: 'Dispatch HVAC preemptively when forecast > 90F' },
        },
        adversaryFinding:
          'Pattern observed only on units with single-stage HVAC; not generalisable.',
        judge: 'merge',
      }) as never,
    });
  });

  test.afterEach(async ({ request }) => {
    const mock = createAnthropicMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test.fixme('proposer → adversary → judge called in order', async ({
    request,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    const triggerResp = await request.post('/api/agent/synthesis/run', {
      data: { propertyId },
    });
    expect(triggerResp.status()).toBe(200);

    const mock = createAnthropicMockHarness(request);
    const recorded = await mock.getRecorded();
    const sequence = recorded
      .map((c) => c.actionType)
      .filter((a): a is string => Boolean(a));
    expect(sequence.indexOf('synthesize_proposer')).toBeLessThan(
      sequence.indexOf('synthesize_adversary'),
    );
    expect(sequence.indexOf('synthesize_adversary')).toBeLessThan(
      sequence.indexOf('synthesize_judge'),
    );
  });

  test.fixme('judge:merge appends a new derived fact', async () => {
    const admin = createAdmin();
    const propertyId = fixture.properties[0]!.id;
    const { data: facts } = await admin
      .from('memory_facts')
      .select('id, fact_type, source')
      .eq('property_id', propertyId)
      .eq('source', 'derived');
    expect((facts ?? []).length).toBeGreaterThanOrEqual(1);
  });

  test.fixme(
    'judge:supersede sets superseded_at on the obsoleted fact',
    async ({ request }) => {
      // Re-script the judge for supersede.
      const mock = createAnthropicMockHarness(request);
      await mock.setScripts(
        synthesisReplyTriple({
          proposed: {
            factType: 'derived_rule',
            content: { rule: 'Updated rule' },
          },
          adversaryFinding: 'Supports update.',
          judge: 'supersede',
        }) as never,
      );
      // Trigger a second synthesis run; assert at least one fact has
      // superseded_at set after.
      const propertyId = fixture.properties[0]!.id;
      await request.post('/api/agent/synthesis/run', {
        data: { propertyId },
      });
      const admin = createAdmin();
      const { data: superseded } = await admin
        .from('memory_facts')
        .select('id, superseded_at')
        .eq('property_id', propertyId)
        .not('superseded_at', 'is', null);
      expect((superseded ?? []).length).toBeGreaterThanOrEqual(1);
    },
  );
});
