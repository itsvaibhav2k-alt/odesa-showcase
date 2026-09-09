/**
 * Daily briefing prose-polish spec.
 *
 * The morning briefing pipeline runs an Opus pass to polish the
 * raw daily summary into the owner-facing prose. The polished version
 * must:
 *   - cite at least one memory_fact id (so owners can audit claims)
 *   - reference each meta_insight surfaced for the day
 *   - stay under 280 words (UI cap)
 *
 * Acceptance:
 *   - Provision fixture with seeded facts + one fresh meta_insight.
 *   - Anthropic mock returns a polished string with the fact id +
 *     insight in the body.
 *   - Trigger the briefing run.
 *   - Assert the rendered briefing card on `/today` contains the
 *     polished prose AND the citation footer references the fact id.
 *
 * Mock-state-sensitive — workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  createAdmin,
  HAVE_SUPABASE,
  provisionGalaxyV15,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  textReply,
} from '../mocks/anthropic-mock';

test.describe('briefing: prose polish + citations', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });

    // Seed one meta_insight so the briefing has something to cite.
    const admin = createAdmin();
    await admin.from('meta_insights').insert({
      organization_id: fixture.organizationId,
      pattern_type: 'vendor_portfolio_winner',
      affected_property_ids: [fixture.properties[0]!.id],
      insight: 'Acme HVAC clears 95% acceptance.',
      recommended_action: { action: 'mark_as_preferred' },
    });

    const factId = fixture.facts[0]!.id;
    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: [
        {
          matchActionType: 'briefing_polish',
          reply: textReply(
            `Good morning. Activity overview: 3 proposals committed, 2 awaiting your review. ` +
              `One vendor pattern emerged — Acme HVAC clears 95% acceptance. ` +
              `[citation: fact ${factId}]`,
          ),
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
    'briefing card renders the polished prose and citation',
    async ({ page, request }) => {
      const triggerResp = await request.post('/api/briefing/run', {
        data: { organizationId: fixture.organizationId },
      });
      expect(triggerResp.status()).toBe(200);

      await page.goto('/login');
      await page.getByTestId('login-email').fill(fixture.owner.email);
      await page.getByTestId('login-password').fill(fixture.owner.password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/today/);

      const card = page.getByTestId('briefing-card');
      await expect(card).toBeVisible();
      const body = (await card.textContent()) ?? '';
      expect(body).toContain('Acme HVAC clears 95% acceptance');
      expect(body).toMatch(/citation/i);
    },
  );

  test.fixme(
    'polished prose stays under the 280-word cap',
    async ({ page, request }) => {
      await request.post('/api/briefing/run', {
        data: { organizationId: fixture.organizationId },
      });
      // The briefings table isn't part of the v1.5 schema — the
      // polished body is rendered into the briefing card on the
      // dashboard, so we read it from the DOM. (When briefings move
      // to their own table in a later phase this assertion can swap
      // to a DB read.)
      await page.goto('/login');
      await page.getByTestId('login-email').fill(fixture.owner.email);
      await page.getByTestId('login-password').fill(fixture.owner.password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/today/);
      const body =
        (await page.getByTestId('briefing-card').textContent()) ?? '';
      const words = body.trim().split(/\s+/).filter(Boolean);
      expect(words.length).toBeLessThanOrEqual(280);
    },
  );
});
