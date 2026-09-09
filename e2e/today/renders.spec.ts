/**
 * Today v2 — render spec for the Quiet Operator Console scaffold (PR-2).
 *
 * Mounts `/today` for a seeded Galaxy owner and asserts that each of
 * the six structural sections of the redesigned page is present with
 * its expected data-section anchors and child counts. PR-2 wires
 * hardcoded mock rows; PR-3 will wire real data + interactions.
 *
 * Skipped when the local Supabase stack is unavailable.
 *
 * Sections asserted:
 *   - [data-section="topbar"]       → "Today" title
 *   - [data-section="briefing"]     → eyebrow + serif sentence + [data-orbit]
 *   - [data-section="owner-review"] → exactly 5 [data-queue-row]
 *                                     each with [data-queue-status] chip
 *   - [data-section="watching"]     → exactly 5 [data-watch-item]
 *   - [data-section="handling"]     → exactly 4 [data-handling-cell]
 *                                     + [data-radial-wash]
 *   - [data-section="ask-odesa"]    → 4 [data-suggestion-chip] + "TRY"
 *
 * Plus a coarse tabular-numerals check: > 20 `.num` elements on the page.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

test.describe('today v2: scaffold renders all sections', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('topbar renders the Today title', async ({ page }) => {
    const topbar = page.locator('[data-section="topbar"]');
    await expect(topbar).toBeVisible();
    await expect(topbar).toContainText('Today');
  });

  test('briefing renders eyebrow, serif sentence, and orbit SVG', async ({
    page,
  }) => {
    const briefing = page.locator('[data-section="briefing"]');
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText(/odesa briefing/i);
    await expect(briefing.locator('[data-orbit]')).toBeVisible();
  });

  test('owner-review shows live queue rows, each with a status chip', async ({
    page,
  }) => {
    const ownerReview = page.locator('[data-section="owner-review"]');
    await expect(ownerReview).toBeVisible();

    const rows = ownerReview.locator('[data-queue-row]');
    const rowCount = await rows.count();

    // `getUrgentItems(5)` caps the live queue at 5; a seeded Galaxy org
    // surfaces between 1 and 5 urgent rows depending on the date (late-rent
    // cycles are date-relative). Assert the real query contract — 1..5 live
    // rows — not the retired mock's hard-coded 5.
    expect(rowCount).toBeGreaterThanOrEqual(1);
    expect(rowCount).toBeLessThanOrEqual(5);

    // Each row exposes a status chip with one of the five families.
    const statuses = await rows
      .locator('[data-queue-status]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-queue-status')),
      );
    expect(statuses).toHaveLength(rowCount);
    for (const status of statuses) {
      expect(status).toMatch(/^(review|draft|waiting|escalated|resolved)$/);
    }
  });

  test('watching rail shows exactly 5 items', async ({ page }) => {
    const watching = page.locator('[data-section="watching"]');
    await expect(watching).toBeVisible();
    await expect(watching.locator('[data-watch-item]')).toHaveCount(5);
  });

  test('handling panel shows exactly 4 cells and the radial wash', async ({
    page,
  }) => {
    const handling = page.locator('[data-section="handling"]');
    await expect(handling).toBeVisible();
    await expect(handling.locator('[data-handling-cell]')).toHaveCount(4);
    await expect(handling.locator('[data-radial-wash]')).toHaveCount(1);
  });

  test('ask-odesa shows TRY eyebrow and 4 default suggestion chips', async ({
    page,
  }) => {
    const ask = page.locator('[data-section="ask-odesa"]');
    await expect(ask).toBeVisible();
    await expect(ask.locator('[data-ask-eyebrow]')).toContainText('TRY');
    await expect(ask.locator('[data-suggestion-chip]')).toHaveCount(4);
  });

  test('numbers carry the .num class (tabular-numerals coverage)', async ({
    page,
  }) => {
    // Coarse check — the page is dense with figures (money, times,
    // counts, unit IDs, dates). The PR-1 `.num` utility must wrap them
    // all; > 20 hits is a reasonable floor for the scaffolded page.
    await expect(page.locator('.num').first()).toBeVisible();
    const count = await page.locator('.num').count();
    expect(count).toBeGreaterThan(20);
  });
});
