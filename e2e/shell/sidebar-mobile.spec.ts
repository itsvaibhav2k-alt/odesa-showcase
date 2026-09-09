/**
 * Mobile sidebar Sheet — Wave 8.
 *
 * At 375×800, the TopBar surfaces a hamburger toggle that opens a left
 * Sheet containing the same Sidebar. Clicking any nav link closes the
 * Sheet and changes the route.
 */
import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  provisionGalaxyUser,
  signIn,
  type SeededOwner,
} from '../today/helpers';

test.describe('shell sidebar — mobile', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('hamburger opens Sheet; nav click closes it and routes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/today');

    // Hamburger visible at mobile width.
    const hamburger = page.getByTestId('mobile-menu-toggle');
    await expect(hamburger).toBeVisible();

    await hamburger.click();

    // The Sheet renders a second sidebar instance — strict-mode-safe by
    // scoping under the Sheet container (`[role="dialog"]`).
    const sheet = page.locator('[role="dialog"]');
    await expect(sheet).toBeVisible();
    const sheetInboxLink = sheet.getByTestId('sidebar-link-inbox');
    await expect(sheetInboxLink).toBeVisible();
    await sheetInboxLink.click();

    await page.waitForURL(/\/inbox/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/inbox/);
    // Sheet closes once a link is clicked.
    await expect(sheet).toHaveCount(0, { timeout: 5_000 });
  });
});

test.describe('VA shell sidebar — mobile', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  test('mobile sheet carries the VA shift hierarchy', async ({ page }) => {
    const va = await provisionGalaxyUser('va');
    try {
      await page.setViewportSize({ width: 375, height: 800 });
      await signIn(page, { email: va.email, password: va.password });

      const queueRail = page.locator('[data-section="queue-rail-grid"]');
      await expect(queueRail).toBeVisible();
      expect(
        await queueRail.evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);
      const handlingGrid = page.locator('.today-handling-grid');
      await expect(handlingGrid).toBeVisible();
      expect(
        await handlingGrid.evaluate((element) =>
          getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
        ),
      ).toBe(1);

      await page.getByTestId('mobile-menu-toggle').click();

      const sheet = page.locator('[role="dialog"]');
      await expect(sheet.getByTestId('user-role-label')).toHaveText(
        'Operations Assistant',
      );
      await expect(sheet.getByTestId('sidebar-link-my-shift')).toBeVisible();
      await expect(sheet.getByTestId('sidebar-link-work-inbox')).toBeVisible();
      await expect(sheet.getByTestId('sidebar-link-owner-queue')).toHaveCount(
        0,
      );
    } finally {
      await va.teardown();
    }
  });
});
