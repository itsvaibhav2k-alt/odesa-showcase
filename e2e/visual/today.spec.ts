/**
 * Today re-baseline — Wave 8.
 *
 * Sidebar v4 (Wave 2) introduced a 200px chrome change. The Today
 * visual baselines were re-captured at bc82ad7 — this spec adds a
 * supplementary 1440×900 snapshot specifically for Wave 8 to keep the
 * comprehensive-suite baselines in one place and to make any chrome
 * drift visible without rerunning the entire Today visual suite.
 *
 * The original Today visual specs in `e2e/today/today-visual.spec.ts`
 * are unchanged and remain the canonical Today baseline. This spec
 * exists alongside the Inbox visual suite so a Wave 8 re-run can
 * confirm "nothing on Today drifted while we were redesigning Inbox".
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator('[data-section="topbar"] [data-freshness]'),
    page.locator('[data-dynamic-time]'),
  ];
}

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });
}

test.describe('today re-baseline (post-sidebar-v4)', () => {
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

  test('default state at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, { email: owner.email, password: owner.password });
    await expect(page.locator('[data-section="owner-review"]')).toBeVisible();
    await waitForFonts(page);

    await expect(page).toHaveScreenshot('today-wave8-default-1440x900.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      mask: dynamicMasks(page),
    });
  });
});
