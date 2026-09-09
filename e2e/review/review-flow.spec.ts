/**
 * Owner Review flow — E2E.
 *
 * Asserts the Today "Owner Review" queue's Review button navigates to a
 * rendered `/review/[kind]/[id]` surface for every kind present, and that a
 * status-transition action (conversation "Mark resolved") persists and removes
 * the row from Today. The transition assertion is provider-independent (it does
 * not depend on a live messaging provider). Skipped when the local Supabase
 * stack isn't configured — matches the env-gating in the today specs.
 */

import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, provisionGalaxyOwner, signIn, type SeededOwner } from '../today/helpers';

test.describe('owner review flow', () => {
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

  test('every Review button navigates to a rendered /review page', async ({ page }) => {
    await page.goto('/today');

    const reviewLinks = page.locator('[data-section="owner-review"] [data-action="review"]');
    const count = await reviewLinks.count();
    expect(count, 'at least one Owner Review row').toBeGreaterThan(0);

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = await reviewLinks.nth(i).getAttribute('href');
      expect(href, `row ${i} Review href`).toMatch(
        /^\/review\/(rent|conversation|work_order)\//,
      );
      hrefs.push(href as string);
    }

    // Visit each distinct kind once and assert the review surface renders.
    const seenKinds = new Set<string>();
    for (const href of hrefs) {
      const kind = href.split('/')[2];
      if (seenKinds.has(kind)) continue;
      seenKinds.add(kind);

      await page.goto(href);
      const root = page.getByTestId('review-page');
      await expect(root).toBeVisible({ timeout: 30_000 });
      await expect(root).toHaveAttribute('data-review-kind', kind);
    }
  });

  test('resolving a conversation persists and removes it from Today', async ({ page }) => {
    await page.goto('/today');

    const convLink = page
      .locator('[data-section="owner-review"] [data-action="review"][href^="/review/conversation/"]')
      .first();

    if ((await convLink.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No conversation row in the queue this run — conversation transition skipped (render + nav still covered by the first test).',
      });
      test.skip();
      return;
    }

    const href = (await convLink.getAttribute('href')) as string;
    const convId = href.split('/')[3];

    await convLink.click();
    await expect(page.getByTestId('review-page')).toBeVisible();

    await page.locator('[data-action="mark-resolved"]').click();
    await expect(page.getByTestId('review-handled')).toBeVisible({ timeout: 15_000 });

    await page.goto('/today');
    await expect(
      page.locator(`[data-section="owner-review"] [href="/review/conversation/${convId}"]`),
    ).toHaveCount(0);
  });
});
