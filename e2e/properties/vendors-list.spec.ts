/**
 * Vendors list + detail — `/vendors` and `/vendors/[vendorId]` E2E.
 *
 * Re-authored against the REAL, RLS-scoped pages (page.tsx + queries.ts). The
 * directory renders one row per seeded Galaxy vendor (ordered by name); each
 * row's `slug` is the vendor's real UUID, so the detail route is
 * `/vendors/<uuid>`. Work-order rows carry the WO's real UUID and link to
 * `/work-orders/<uuid>`.
 *
 * Seeded Galaxy vendors (supabase/seed.sql, mirrored in fixtures/manifest.ts):
 *   - Beltway Plumbing Co   (plumbing, acceptance 0.920) — 1 completed WO (704)
 *   - Capital HVAC Services (hvac,     acceptance 0.870) — 1 assigned WO
 *   - Handyman Hank LLC      (general,  acceptance 0.960) — 1 in-progress WO
 *
 * The status pill has no curated-status column: it is HONESTLY derived from
 * each vendor's OPEN work-order lifecycle (queries.ts `deriveVendorPill`).
 * Given the seed above:
 *   - Beltway  → "No open jobs"   (its only WO, 704, is completed → 0 open)
 *   - Handyman → "Active"         (1 open in-progress WO, no reassign/await chip)
 *   - Capital  → "Awaiting reply" (1 assigned WO, no vendor response yet)
 *
 * Asserts (against the page's TESTID contract):
 *   LIST (/vendors):
 *   - all seeded vendor directory rows present (count live-derived from DB)
 *   - Beltway row links to /vendors/<beltwayId> and navigates on click
 *   - rows show trade + status text
 *   - no console errors during list load
 *
 *   DETAIL (/vendors/<beltwayId>):
 *   - vendor-detail-page testid + "Beltway Plumbing Co" title present
 *   - the completed-faucet WO row is present and links to its work order
 *   - clicking the WO row NAVIGATES to work-orders detail
 *   - breadcrumb: Portfolio / Vendors / Beltway Plumbing Co
 *   - metrics strip shows live performance data (rating / on-time derived from
 *     acceptance_rate)
 *   - no console errors during detail load
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  GALAXY_ORG_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import {
  BELTWAY_PLUMBING_VENDOR_ID,
  CAPITAL_HVAC_VENDOR_ID,
  HANDYMAN_HANK_VENDOR_ID,
  WO_COMPLETED_FAUCET_ID,
} from '../fixtures/manifest';

/** The three seeded Galaxy vendor UUIDs (rows keyed by these). */
const VENDOR_IDS = [
  BELTWAY_PLUMBING_VENDOR_ID,
  CAPITAL_HVAC_VENDOR_ID,
  HANDYMAN_HANK_VENDOR_ID,
] as const;

const BELTWAY_HREF = `/vendors/${BELTWAY_PLUMBING_VENDOR_ID}`;
const FAUCET_WO_HREF = `/work-orders/${WO_COMPLETED_FAUCET_ID}`;

function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('vendors: /vendors list page', () => {
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

  test('page shell renders with Vendors title', async ({ page }) => {
    await page.goto('/vendors');

    const shell = page.getByTestId('list-page-shell');
    await expect(shell).toBeVisible();
    // Scope to the title h1 so we don't also match the sidebar nav item, the
    // active tab, and the breadcrumb (all of which contain "Vendors").
    await expect(
      shell.getByRole('heading', { level: 1, name: 'Vendors' }),
    ).toBeVisible();
  });

  test('breadcrumb shows Portfolio / Vendors', async ({ page }) => {
    await page.goto('/vendors');

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });

    const portfolioLink = breadcrumb.getByRole('link', { name: 'Portfolio' });
    await expect(portfolioLink).toBeVisible();
    await expect(portfolioLink).toHaveAttribute('href', '/properties');

    // Current crumb scoped to the breadcrumb (sidebar item + active tab also
    // carry aria-current="page").
    const vendorsCurrent = breadcrumb.locator('[aria-current="page"]');
    await expect(vendorsCurrent).toContainText('Vendors');
  });

  test('tab bar: Vendors tab is active', async ({ page }) => {
    await page.goto('/vendors');

    const tabs = page.getByTestId('list-page-tabs');
    await expect(tabs).toBeVisible();

    const vendorsTab = page.getByTestId('list-tab-vendors');
    await expect(vendorsTab).toBeVisible();
    await expect(vendorsTab).toHaveAttribute('aria-current', 'page');
  });

  test('renders all seeded vendor directory rows', async ({ page }) => {
    await page.goto('/vendors');

    // Each seeded Galaxy vendor row is present, keyed by its real UUID slug.
    for (const id of VENDOR_IDS) {
      await expect(page.getByTestId(`vendor-dir-${id}`)).toBeVisible();
    }

    // Row count is live-derived from the DB (RLS scopes the page to Galaxy, so
    // count Galaxy's vendors via the service client) — no hardcoded totals.
    const admin = createAdmin();
    const { data: vendors } = await admin
      .from('vendors')
      .select('id')
      .eq('organization_id', GALAXY_ORG_ID);
    const expectedCount = vendors?.length ?? 0;

    const rows = page.getByTestId(/^vendor-dir-/);
    await expect(rows).toHaveCount(expectedCount);
  });

  test('Beltway Plumbing row links to its vendor detail page', async ({ page }) => {
    await page.goto('/vendors');

    const beltwayRow = page.getByTestId(`vendor-dir-${BELTWAY_PLUMBING_VENDOR_ID}`);
    await expect(beltwayRow).toBeVisible();
    await expect(beltwayRow).toContainText('Beltway Plumbing Co');

    const beltwayLink = beltwayRow.locator('a').first();
    await expect(beltwayLink).toHaveAttribute('href', BELTWAY_HREF);
  });

  test('clicking Beltway Plumbing row navigates to vendor detail page', async ({ page }) => {
    await page.goto('/vendors');

    const beltwayLink = page
      .getByTestId(`vendor-dir-${BELTWAY_PLUMBING_VENDOR_ID}`)
      .locator('a')
      .first();
    await expect(beltwayLink).toBeVisible();
    await beltwayLink.click();

    await page.waitForURL(new RegExp(`/vendors/${BELTWAY_PLUMBING_VENDOR_ID}`), {
      timeout: 10_000,
    });
    await expect(page.getByTestId('vendor-detail-page')).toBeVisible();
  });

  test('vendor directory shows rating, trade, and honestly-derived status text', async ({ page }) => {
    await page.goto('/vendors');

    // Beltway: plumbing trade + rating glyph. Its only WO (704) is completed,
    // so it has 0 OPEN work orders → the honest pill reads "No open jobs"
    // (NOT the old fake always-"Active"). This is the row that proves the
    // derivation isn't hard-coded.
    const beltwayRow = page.getByTestId(`vendor-dir-${BELTWAY_PLUMBING_VENDOR_ID}`);
    await expect(beltwayRow).toContainText('Plumbing');
    await expect(beltwayRow).toContainText('★');
    await expect(beltwayRow).toContainText('No open jobs');
    await expect(beltwayRow).not.toContainText('Active');

    // Handyman Hank: 1 open in-progress WO with no reassign/awaiting chip →
    // the generic-open pill reads "Active". Proves a vendor that genuinely has
    // open work derives "Active" honestly (not from a hard-coded column).
    const handymanRow = page.getByTestId(`vendor-dir-${HANDYMAN_HANK_VENDOR_ID}`);
    await expect(handymanRow).toContainText('Active');

    // Capital HVAC: trade label reflects its category.
    const capitalRow = page.getByTestId(`vendor-dir-${CAPITAL_HVAC_VENDOR_ID}`);
    await expect(capitalRow).toContainText('HVAC');
  });

  test('ask odesa bar is visible and accepts input', async ({ page }) => {
    await page.goto('/vendors');

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();
    await input.fill('show overdue vendors');
    await expect(input).toHaveValue('show overdue vendors');
  });

  test('no console errors during list load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/vendors');
    await expect(page.getByTestId('vendors-page')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('vendors: /vendors/[vendorId] detail page (Beltway Plumbing Co)', () => {
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

  test('vendor-detail-page testid and Beltway Plumbing Co title are visible', async ({
    page,
  }) => {
    await page.goto(BELTWAY_HREF);

    const detail = page.getByTestId('vendor-detail-page');
    await expect(detail).toBeVisible();
    // Title block h1 shows the vendor name (the breadcrumb's current crumb
    // also reads "Beltway Plumbing Co", so scope to the heading).
    await expect(
      detail.getByRole('heading', { level: 1, name: 'Beltway Plumbing Co' }),
    ).toBeVisible();
  });

  test('breadcrumb shows Portfolio / Vendors / Beltway Plumbing Co', async ({ page }) => {
    await page.goto(BELTWAY_HREF);

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });

    const portfolioLink = breadcrumb.getByRole('link', { name: 'Portfolio' });
    await expect(portfolioLink).toHaveAttribute('href', '/properties');

    // "Vendors" matches the sidebar nav link too — scope to the breadcrumb.
    const vendorsLink = breadcrumb.getByRole('link', { name: 'Vendors' });
    await expect(vendorsLink).toHaveAttribute('href', '/vendors');

    // Beltway Plumbing Co is the current (last) crumb
    const currentCrumb = breadcrumb.locator('[aria-current="page"]');
    await expect(currentCrumb).toContainText('Beltway Plumbing Co');
  });

  test('completed-faucet work-order row is visible and links to its work order', async ({
    page,
  }) => {
    await page.goto(BELTWAY_HREF);

    const woRow = page.getByTestId(`vendor-wo-${WO_COMPLETED_FAUCET_ID}`);
    await expect(woRow).toBeVisible();

    // Row shows the derived work-order title (category → "<Trade> work order")
    // and the work order's real id chip.
    await expect(woRow).toContainText('Plumbing work order');
    await expect(woRow).toContainText(WO_COMPLETED_FAUCET_ID);

    // The overlay link points to the work order's detail route.
    const woLink = woRow.locator('a').first();
    await expect(woLink).toHaveAttribute('href', FAUCET_WO_HREF);
  });

  test('clicking the work-order row navigates to work-order detail', async ({ page }) => {
    await page.goto(BELTWAY_HREF);

    const woLink = page
      .getByTestId(`vendor-wo-${WO_COMPLETED_FAUCET_ID}`)
      .locator('a')
      .first();
    await expect(woLink).toBeVisible();
    await woLink.click();

    await page.waitForURL(new RegExp(`/work-orders/${WO_COMPLETED_FAUCET_ID}`), {
      timeout: 10_000,
    });
    await expect(page.url()).toContain(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
  });

  test('metrics strip shows live Beltway performance data', async ({ page }) => {
    // Live-derive the expected rating/on-time from the vendor's acceptance_rate
    // (the real source the page maps into the metrics strip) — nothing hardcoded.
    const admin = createAdmin();
    const { data: vendor } = await admin
      .from('vendors')
      .select('acceptance_rate')
      .eq('id', BELTWAY_PLUMBING_VENDOR_ID)
      .single();
    const rate = Math.min(1, Math.max(0, Number(vendor?.acceptance_rate ?? 1)));
    const rating = (rate * 5).toFixed(1);
    const onTime = Math.round(rate * 100);

    await page.goto(BELTWAY_HREF);

    const detail = page.getByTestId('vendor-detail-page');
    // Metric labels the real page renders (no "Avg response" — schema has no
    // response-time source; "Acceptance" surfaces the real signal instead).
    await expect(detail).toContainText('Rating');
    await expect(detail).toContainText('Jobs');
    await expect(detail).toContainText('On-time');
    await expect(detail).toContainText('Acceptance');
    // Live-derived values.
    await expect(detail).toContainText(`${rating}★`);
    await expect(detail).toContainText(`${onTime}%`);
  });

  test('ask odesa bar is visible and accepts input', async ({ page }) => {
    await page.goto(BELTWAY_HREF);

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();
    await input.fill('check open work orders');
    await expect(input).toHaveValue('check open work orders');
  });

  test('no console errors during detail load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto(BELTWAY_HREF);
    await expect(page.getByTestId('vendor-detail-page')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
