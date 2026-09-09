/**
 * Today v2 — visual regression baselines.
 *
 * Captures pixel baselines for the Quiet Operator Console across the
 * interactive states (default, row-selected, second-row-selected,
 * cleared) at two viewports (1440×900 and 1280×800). Diffs tolerate
 * `maxDiffPixelRatio: 0.005`.
 *
 * Baselines live under `e2e/today/today-visual.spec.ts-snapshots/`.
 *
 * ── DEFERRED IN WAVE 2 (data-truth pass) ────────────────────────────
 * These pixel assertions are intentionally skipped. The Today page now
 * renders LIVE Galaxy data — rows keyed by DB id, with date-relative
 * rent/work-order timestamps ("3d ago", "Apr 21") derived from the
 * current date — instead of the retired deterministic mock. Full-page
 * pixel diffs are therefore non-deterministic across dates (the row copy
 * and the unmasked timestamp column shift as the seed's relative cycles
 * roll), and the design team has flagged these baselines as "stale until
 * design sign-off" (see `today-operator.spec.ts` header).
 *
 * The selectors below are migrated to the live generic-row contract
 * (no leak/vendor labels), so once the design is signed off this suite
 * can be unskipped and re-baselined with `--update-snapshots` cleanly —
 * masking the row timestamp column at that point to keep the diff
 * deterministic. Functional + a11y coverage for these states lives in
 * `urgent-items.spec.ts` and `today-a11y.spec.ts`, which DO run.
 *
 * Implementation notes:
 *  - We wait on `document.fonts.ready` before screenshotting so the
 *    serif-display recommendation lines render with the real face.
 *  - Dynamic strings (the topbar "checked Nm ago" freshness line) are
 *    masked so they don't flake the diff.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

const VIEWPORTS: ReadonlyArray<{
  name: string;
  width: number;
  height: number;
}> = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
];

function queueRows(page: Page): Locator {
  return page.locator('[data-section="owner-review"] [data-queue-row]');
}

/**
 * Locators whose textual content is time-derived and therefore
 * non-deterministic across runs. The topbar "checked Nm ago" freshness
 * stamp is computed from `Date.now()` at request time.
 */
function dynamicTextMasks(page: Page): Locator[] {
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

test.describe('today v2: visual regression baselines', () => {
  // See the file header: deferred until design sign-off because the live
  // data-driven page makes full-page pixel diffs non-deterministic.
  test.skip(
    true,
    'today visual baselines deferred: live-data pixel diffs are non-deterministic across dates; awaiting design sign-off',
  );
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

  for (const viewport of VIEWPORTS) {
    test.describe(`viewport ${viewport.name}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });
        await signIn(page, { email: owner.email, password: owner.password });
        await expect(
          page.locator('[data-section="owner-review"]'),
        ).toBeVisible();
        await waitForFonts(page);
      });

      test('default state', async ({ page }) => {
        await expect(page).toHaveScreenshot(
          `today-default-${viewport.name}.png`,
          {
            fullPage: true,
            maxDiffPixelRatio: 0.005,
            mask: dynamicTextMasks(page),
          },
        );
      });

      test('row selected', async ({ page }) => {
        const row = queueRows(page).first();
        await row.click();
        await expect(row).toHaveAttribute('data-selected', 'true');
        await waitForFonts(page);

        await expect(page).toHaveScreenshot(
          `today-row-selected-${viewport.name}.png`,
          {
            fullPage: true,
            maxDiffPixelRatio: 0.005,
            mask: dynamicTextMasks(page),
          },
        );
      });

      test('second row selected', async ({ page }) => {
        const rows = queueRows(page);
        const count = await rows.count();
        test.skip(count < 2, 'needs at least two queue rows');
        const row = rows.nth(1);
        await row.click();
        await expect(row).toHaveAttribute('data-selected', 'true');
        await waitForFonts(page);

        await expect(page).toHaveScreenshot(
          `today-second-row-selected-${viewport.name}.png`,
          {
            fullPage: true,
            maxDiffPixelRatio: 0.005,
            mask: dynamicTextMasks(page),
          },
        );
      });

      test('cleared (selection then clear)', async ({ page }) => {
        const row = queueRows(page).first();
        await row.click();
        await expect(row).toHaveAttribute('data-selected', 'true');

        const clearBtn = page
          .locator('[data-section="ask-odesa"] [data-clear-context]')
          .first();
        await clearBtn.click();
        await expect(row).toHaveAttribute('data-selected', 'false');
        await waitForFonts(page);

        await expect(page).toHaveScreenshot(
          `today-cleared-${viewport.name}.png`,
          {
            fullPage: true,
            maxDiffPixelRatio: 0.005,
            mask: dynamicTextMasks(page),
          },
        );
      });
    });
  }
});
