/**
 * Cross-property meta-insight spec — v1.5 verification gate #4.
 *
 * The monthly Opus loop scans memory_facts + proposals across every
 * property in an org, finds patterns affecting ≥2 properties, and
 * emits a `meta_insights` row with `affected_property_ids` listing
 * each property the pattern touches.
 *
 * Acceptance:
 *   - Seed a fixture with 5 properties, each carrying a fact whose
 *     content shares a discriminator (e.g. a specific vendor name).
 *   - Trigger meta-learning (POST `/api/agent/meta-learning/run`).
 *   - Anthropic mock scripts an Opus tool-use reply that emits one
 *     meta_insight covering all 5 property_ids.
 *   - Assert exactly one new meta_insight row exists with all 5 ids.
 *   - Assert the briefing card renders the insight (UI gate — owned
 *     by ui-eng, but the spec touches the rendered DOM via testid).
 *
 * Mock-state-sensitive: must run with --workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyV15,
  seedExtraFact,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  toolUseReply,
} from '../mocks/anthropic-mock';

test.describe('agent: cross-property meta-insight', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 5 });

    // Seed a shared vendor across every property so the meta loop has
    // something to discover.
    for (const prop of fixture.properties) {
      await seedExtraFact({
        organizationId: fixture.organizationId,
        propertyId: prop.id,
        factType: 'vendor_relationship',
        content: {
          vendor_name: 'Acme HVAC',
          acceptance_rate: 0.95,
          dispatch_count: 12,
        },
      });
    }

    const propertyIds = fixture.properties.map((p) => p.id);
    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: [
        {
          matchActionType: 'meta_learning',
          reply: toolUseReply('record_meta_insight', {
            pattern_type: 'vendor_portfolio_winner',
            affected_property_ids: propertyIds,
            insight: 'Acme HVAC clears 95% acceptance across all 5 properties.',
            recommended_action: {
              action: 'mark_as_preferred',
              vendor_name: 'Acme HVAC',
            },
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
    'emits one meta_insight covering all 5 property ids',
    async ({ request }) => {
      const triggerResp = await request.post('/api/agent/meta-learning/run', {
        data: { organizationId: fixture.organizationId },
      });
      expect(triggerResp.status()).toBe(200);

      const admin = createAdmin();
      const { data: insights } = await admin
        .from('meta_insights')
        .select('id, pattern_type, affected_property_ids, insight')
        .eq('organization_id', fixture.organizationId);

      expect(insights ?? []).toHaveLength(1);
      const insight = (insights ?? [])[0]!;
      expect(insight.pattern_type).toBe('vendor_portfolio_winner');
      const seededIds = fixture.properties.map((p) => p.id).sort();
      const recordedIds = (insight.affected_property_ids ?? []).slice().sort();
      expect(recordedIds).toEqual(seededIds);
    },
  );

  test.fixme(
    'briefing card renders the insight on the dashboard',
    async ({ page }) => {
      // Sign-in via the v1.5 owner credentials, navigate to dashboard,
      // assert the meta-insight briefing card is visible. UI testids
      // owned by ui-eng (task #7).
      await page.goto('/login');
      await page.getByTestId('login-email').fill(fixture.owner.email);
      await page.getByTestId('login-password').fill(fixture.owner.password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/today/);
      await expect(
        page.getByTestId('meta-insight-card-vendor_portfolio_winner'),
      ).toBeVisible();
    },
  );
});
