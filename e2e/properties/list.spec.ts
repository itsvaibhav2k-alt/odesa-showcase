/**
 * Properties — `/properties` portfolio map/directory smoke (real Supabase data).
 *
 * The page is the `PropertyMall` workspace: a sticky `PortfolioHeader` over a
 * left rail of property rows and a map of property markers, with a map-variant
 * "Ask Odesa" bar in the footer. It is driven by `portfolio-queries` (live rows
 * scoped to the caller's org via RLS), NOT the deleted mock command center.
 *
 * The old mock-only assertions (5 facet tabs, a 4-row needs-attention panel, a
 * fixed 6-card oak/cedar/maple grid with At-risk/Leasing/Calm status text,
 * `/properties/oak` hrefs, ask-suggestion chips) target UI that no longer
 * renders here — those tests are removed (see coverage-ledger.md for where the
 * surviving behavior is covered).
 *
 * Asserts (against what the real page renders):
 *   - portfolio-header shows "Properties" + the LIVE property count
 *   - the rail renders one row per live property; both seeded properties render
 *     and deep-link by their real UUID; the map subhead echoes the live count
 *   - no console errors during load
 *
 * Expected counts are derived live from the DB via the service client — nothing
 * is hardcoded. Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  createAdmin,
  GALAXY_ORG_ID,
  OAKWOOD_PROPERTY_ID,
  SEVENTEENTH_PROPERTY_ID,
  type SeededOwner,
} from './helpers';
import { PROPERTIES } from '../fixtures/manifest';

/**
 * Benign Next.js / dev-overlay console noise that must not fail the
 * zero-console-errors assertion. Kept narrow so genuine runtime errors
 * still surface.
 */
function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

/** Live count of the signed-in org's properties (matches the header roll-up). */
async function countLiveProperties(): Promise<number> {
  const admin = createAdmin();
  const { count, error } = await admin
    .from('properties')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', GALAXY_ORG_ID);
  if (error) throw new Error('Failed to count properties: ' + error.message);
  return count ?? 0;
}

test.describe('properties: portfolio map/directory', () => {
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

  test('header renders the Properties title and live portfolio summary', async ({
    page,
  }) => {
    const propertyCount = await countLiveProperties();

    await page.goto('/properties');

    await expect(page.getByTestId('properties-page')).toBeVisible();

    const header = page.getByTestId('portfolio-header');
    await expect(header).toBeVisible();
    // Title (h1) + the live roll-up count in the meta line.
    await expect(header).toContainText('Properties');
    await expect(header).toContainText(`${propertyCount} properties`);
  });

  test('directory renders one rail row per live property, with seeded names and real hrefs', async ({
    page,
  }) => {
    const propertyCount = await countLiveProperties();

    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();

    // The left rail renders exactly one enterable row per live property.
    const railRows = page.locator('.property-rail-row');
    await expect(railRows).toHaveCount(propertyCount);

    // The map subhead reports the same live count.
    await expect(page.getByTestId('property-map-subhead')).toContainText(
      `${propertyCount} live`,
    );

    // Both seeded properties render and their cards deep-link by real UUID
    // (rail row + map marker share the href, so assert the first match).
    for (const seededId of [OAKWOOD_PROPERTY_ID, SEVENTEENTH_PROPERTY_ID]) {
      await expect(
        page.locator(`a[href="/properties/${seededId}"]`).first(),
      ).toBeVisible();
    }
    // Real seeded names (not the deleted mock "22 Oak St" copy).
    await expect(page.getByText(PROPERTIES[0].name).first()).toBeVisible();
    await expect(page.getByText(PROPERTIES[1].name).first()).toBeVisible();
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();
    // Let the client island settle so late errors are captured.
    await expect(page.getByTestId('ask-odesa-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
