/**
 * Property rulebook spec — v1.5 verification gate #10.
 *
 * The property page exposes a free-form rules_text editor (4k char
 * cap). Edits write to `properties.rules_text`, and the next worker
 * spawn for that property must include the new rule in the system
 * prompt context — verifiable by the worker's reasoning citing it.
 *
 * Acceptance:
 *   - Provision a fixture, navigate to the property page.
 *   - Edit the rulebook to add a unique sentinel rule (e.g.
 *     "Always confirm dispatch with tenant before 3pm.").
 *   - Save; assert optimistic Saved badge flashes.
 *   - Trigger a worker spawn (Anthropic mock captures the system
 *     prompt). Assert the rule string appears verbatim in the system
 *     prompt the mock recorded.
 *
 * Mock-state-sensitive (shared Anthropic mock state) — workers=1.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyV15,
  setPropertyRulesText,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';
import {
  createAnthropicMockHarness,
  workerOutputReply,
} from '../mocks/anthropic-mock';

test.describe('property: rulebook → worker context', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;
  const SENTINEL_RULE =
    'SENTINEL_RULE_2026_04: Always confirm dispatch with tenant before 3pm.';

  test.beforeEach(async ({ request }) => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });
    const mock = createAnthropicMockHarness(request);
    await mock.install({
      scripts: [
        {
          matchActionType: 'draft_sms_reply',
          reply: workerOutputReply('draft_sms_reply', {
            body: 'Acknowledged.',
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

  test('direct DB rulebook edit surfaces in the next worker system prompt', async ({
    request,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    await setPropertyRulesText(propertyId, SENTINEL_RULE);

    const spawnResp = await request.post('/api/agent/worker/spawn', {
      data: {
        propertyId,
        actionType: 'draft_sms_reply',
        input: {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          tenant_phone: '+15551234567',
          inbound_text: 'is the gym still open?',
        },
      },
    });
    expect(spawnResp.status()).toBe(200);

    const mock = createAnthropicMockHarness(request);
    const recorded = await mock.getRecorded();
    expect(recorded.length).toBeGreaterThan(0);
    const matched = recorded.some((c) =>
      c.systemPrompt.includes(SENTINEL_RULE),
    );
    expect(matched).toBe(true);
  });

  test.fixme(
    'UI rulebook edit lands in the next worker system prompt (cross-team)',
    async ({ page, request }) => {
      // Cross-team coverage: ui-eng's debounced auto-save + the worker
      // spawn pipeline. Kept .fixme until both ui-eng's optimistic-save
      // landing + integration-eng's pipeline-via-UI hooks are stable
      // enough for the round-trip assertion to be reliable.
      const propertyId = fixture.properties[0]!.id;

      await page.goto('/login');
      await page.getByTestId('login-email').fill(fixture.owner.email);
      await page.getByTestId('login-password').fill(fixture.owner.password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/today/);
      await page.goto(`/properties/${propertyId}`);
      await page.getByTestId('property-rulebook-textarea').fill(SENTINEL_RULE);
      await expect(
        page.getByTestId('optimistic-save-rulebook'),
      ).toHaveAttribute('data-state', 'saved');

      await request.post('/api/agent/worker/spawn', {
        data: {
          propertyId,
          actionType: 'draft_sms_reply',
          input: {
            conversation_id: '00000000-0000-0000-0000-000000000000',
            tenant_phone: '+15551234567',
            inbound_text: 'ping',
          },
        },
      });

      const mock = createAnthropicMockHarness(request);
      const recorded = await mock.getRecorded();
      const last = recorded[recorded.length - 1];
      expect(last?.systemPrompt ?? '').toContain(SENTINEL_RULE);
    },
  );
});

// =====================================================================
// UI persistence — owned by ui-eng (task #7).
//
// The worker-spawn coverage above lives behind .fixme until the worker
// API route lands. This block exercises the user-facing path the
// landlord touches in real life: type → debounced save → reload →
// rulebook still there.
// =====================================================================

test.describe('property: rulebook UI persistence', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;
  const SENTINEL = `UI_PERSIST_${Date.now()}: never schedule loud work after 9pm.`;

  test.beforeEach(async () => {
    fixture = await provisionGalaxyV15({
      propertyCount: 1,
      // Start from empty so we can prove the typed text replaces nothing.
      rulesText: '',
    });
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test('type → auto-save → reload → text persisted', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto(`/properties/${propertyId}`);
    await expect(page.getByTestId('property-rulebook-section')).toBeVisible();

    const textarea = page.getByTestId('property-rulebook-textarea');
    await textarea.fill(SENTINEL);

    // Counter reflects the new length immediately.
    await expect(page.getByTestId('property-rulebook-counter')).toHaveText(
      `${SENTINEL.length} / 4000`,
    );

    // Wait for the debounced auto-save to flush and the badge to settle.
    await expect(page.getByTestId('optimistic-save-rulebook')).toHaveAttribute(
      'data-state',
      'saved',
      { timeout: 5_000 },
    );

    // Reload — the rulebook reads from the DB, so anything that didn't
    // persist would come back blank.
    await page.reload();
    await expect(page.getByTestId('property-rulebook-textarea')).toHaveValue(
      SENTINEL,
    );
  });

  test('character counter switches to warning over 3800 chars', async ({
    page,
  }) => {
    const propertyId = fixture.properties[0]!.id;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto(`/properties/${propertyId}`);
    const textarea = page.getByTestId('property-rulebook-textarea');

    // 3900 chars — above the 3800 warn threshold, below the 4000 cap.
    const big = 'a'.repeat(3900);
    await textarea.fill(big);

    const counter = page.getByTestId('property-rulebook-counter');
    await expect(counter).toHaveText('3900 / 4000');

    const warningColor = await counter.evaluate(
      (el) => getComputedStyle(el).color,
    );
    // warning-600 = #C08835. Either the rgb() or the hex resolves; we
    // just assert it's not the idle ink-500 = #736F62.
    expect(warningColor).not.toBe('rgb(115, 111, 98)');
  });
});
