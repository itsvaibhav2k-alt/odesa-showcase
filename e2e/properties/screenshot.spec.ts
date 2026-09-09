/**
 * Properties — visual artifact capture (NOT pixel-diff regression).
 *
 * Captures full-page screenshots of the live, authed /properties command
 * center at three viewports, plus a screenshot of the approved static
 * mockup, so a human can eyeball implementation fidelity against the
 * locked design. These are artifacts, not assertions — nothing here
 * compares pixels.
 *
 * Artifacts land in `test-results/`:
 *   - properties-implemented-1280.png   (1280×800, authed)
 *   - properties-implemented-900.png     (900×900, authed)
 *   - properties-implemented-390.png     (390×800, authed)
 *   - properties-reference.png           (1440×900, file:// mockup)
 *
 * The authed shots are gated on HAVE_SUPABASE (they need a signed-in
 * Galaxy owner). The file:// reference shot needs no backend and runs
 * unconditionally.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

const REFERENCE_MOCKUP_URL =
  'file:///Users/vaibhav/Downloads/odesa-properties4.html';

const IMPLEMENTED_VIEWPORTS: ReadonlyArray<{
  label: string;
  width: number;
  height: number;
}> = [
  { label: '1280', width: 1280, height: 800 },
  { label: '900', width: 900, height: 900 },
  { label: '390', width: 390, height: 800 },
];

test.describe('properties: implemented page artifacts', () => {
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

  for (const vp of IMPLEMENTED_VIEWPORTS) {
    test(`capture /properties at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/properties');
      await expect(page.getByTestId('properties-page')).toBeVisible();

      // Wait for the real fonts so the serif display + mono numerals
      // render in their final faces, not a mid-frame fallback.
      await page.evaluate(() => document.fonts.ready);

      await page.screenshot({
        path: `test-results/properties-implemented-${vp.label}.png`,
        fullPage: true,
      });
    });
  }
});

test.describe('properties: reference mockup artifact', () => {
  test('capture the approved static mockup at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(REFERENCE_MOCKUP_URL);
    await page.evaluate(() => document.fonts.ready);

    await page.screenshot({
      path: 'test-results/properties-reference.png',
      fullPage: true,
    });
  });
});
