/**
 * Interior detail pages — visual artifact capture (NOT pixel-diff regression).
 *
 * Captures full-page screenshots of all four implemented interior drill-down
 * pages at three viewports each. Artifacts are written to test-results/ and
 * are intended for human eyeball review of fidelity against the locked
 * mockups — nothing here compares pixels.
 *
 * Pages (canonical seeded routes):
 *   - /properties/<Oakwood>              -> detail-property-oakwood-{1280,900,390}.png
 *   - /properties/<Oakwood>/units/<101>  -> detail-unit-101-{1280,900,390}.png
 *   - /tenants/<Marcus>                  -> detail-tenant-marcus-{1280,900,390}.png
 *   - /work-orders/<open-emergency>      -> detail-wo-emergency-{1280,900,390}.png
 *
 * Modeled on e2e/properties/screenshot.spec.ts (same auth setup, same
 * HAVE_SUPABASE gate, same font-ready wait). All shots are gated on
 * HAVE_SUPABASE; the zip mockups are NOT referenced here per spec. These are
 * plain full-page artifact captures (page.screenshot to test-results/), NOT
 * toHaveScreenshot pixel-diff regressions — no baselines are involved.
 */

import { expect, test } from '@playwright/test';

import {
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  MARCUS_TENANT_ID,
  WO_OPEN_EMERGENCY_ID,
} from '../fixtures/manifest';
import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

// ---------------------------------------------------------------------------
// Viewport definitions
// ---------------------------------------------------------------------------

const VIEWPORTS: ReadonlyArray<{
  label: string;
  width: number;
  height: number;
}> = [
  { label: '1280', width: 1280, height: 800 },
  { label: '900', width: 900, height: 900 },
  { label: '390', width: 390, height: 800 },
] as const;

// ---------------------------------------------------------------------------
// Pages under test
// ---------------------------------------------------------------------------

interface PageSpec {
  route: string;
  /** Filename stem used in the output path: detail-<stem>-<viewport>.png */
  stem: string;
  /** data-testid of the top-level wrapper — awaited before screenshot. */
  testId: string;
}

const DETAIL_PAGES: readonly PageSpec[] = [
  {
    route: `/properties/${OAKWOOD_PROPERTY_ID}`,
    stem: 'property-oakwood',
    testId: 'property-detail-page',
  },
  {
    route: `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`,
    stem: 'unit-101',
    testId: 'unit-detail-page',
  },
  {
    route: `/tenants/${MARCUS_TENANT_ID}`,
    stem: 'tenant-marcus',
    testId: 'tenant-detail-page',
  },
  {
    route: `/work-orders/${WO_OPEN_EMERGENCY_ID}`,
    stem: 'wo-emergency',
    testId: 'work-order-page',
  },
] as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('detail pages: screenshot artifacts', () => {
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

  for (const spec of DETAIL_PAGES) {
    for (const vp of VIEWPORTS) {
      test(`capture ${spec.route} at ${vp.width}x${vp.height}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(spec.route);
        await expect(page.getByTestId(spec.testId)).toBeVisible();

        // Wait for fonts so Instrument Serif + IBM Plex render in their
        // final faces rather than a mid-frame fallback.
        await page.evaluate(() => document.fonts.ready);

        await page.screenshot({
          path: `test-results/detail-${spec.stem}-${vp.label}.png`,
          fullPage: true,
        });
      });
    }
  }
});
