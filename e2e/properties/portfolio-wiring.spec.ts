/**
 * Portfolio wiring — cross-page navigation E2E.
 *
 * Verifies the connections between the command center, list routes, and detail
 * pages that are each built independently but must link correctly:
 *
 *   1. Portfolio tab bar "Tenants" tab -> /tenants (navigates)
 *   2. /open-items breadcrumb -> /properties (portfolio round-trip)
 *   3. A work order's "View vendor" link -> /vendors/<vendorId> (navigates)
 *   4. Sidebar "Tenants" nav item links to /tenants (real link, not coming-soon)
 *
 * No console errors on any of these pages.
 *
 * Wave 0 migration: routes/ids retargeted to canonical seed fixtures.
 * The work-order "View vendor" link only renders when the WO has a vendor
 * assigned, so the cross-page vendor test targets the completed-faucet WO
 * (assigned to Beltway Plumbing Co), not the open-emergency WO (unassigned).
 * The plain work-order console-load test uses the open-emergency WO.
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  BELTWAY_PLUMBING_VENDOR_ID,
  WO_COMPLETED_FAUCET_ID,
  WO_OPEN_EMERGENCY_ID,
} from '../fixtures/manifest';
import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('portfolio wiring: cross-page navigation', () => {
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

  // ---------------------------------------------------------------------------
  // 1. Portfolio tab bar Tenants tab -> /tenants
  //
  // The /properties map command center has no tab bar; the portfolio tab bar
  // (ListPageTabs) renders on the list routes via ListPageShell. Its Tenants
  // tab is the real `list-tab-tenants` <Link> to /tenants — asserted here from
  // a sibling list route (/vendors), where the tab is an inactive live link.
  // (The mock `portfolio-tab-tenants` command-center tab no longer exists.)
  // ---------------------------------------------------------------------------

  test('portfolio tab bar Tenants tab is a real link pointing to /tenants', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.getByTestId('vendors-page')).toBeVisible();

    const tenantsTab = page.getByTestId('list-tab-tenants');
    await expect(tenantsTab).toBeVisible();

    // The tab must be an anchor (navigating <Link>), not a button
    await expect(tenantsTab).toHaveAttribute('href', '/tenants');
  });

  test('portfolio tab bar Tenants tab click navigates to /tenants', async ({ page }) => {
    await page.goto('/vendors');
    await expect(page.getByTestId('vendors-page')).toBeVisible();

    const tenantsTab = page.getByTestId('list-tab-tenants');
    await tenantsTab.click();

    await page.waitForURL(/\/tenants/);
    expect(page.url()).toContain('/tenants');

    // Confirm the tenants page has rendered
    await expect(page.getByTestId('tenants-page')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 2. /open-items <-> /properties breadcrumb round-trip
  //
  // The mock "View all open items" panel (NeedsAttentionPanel, testid
  // `view-all-open-items`) was removed from the product and is now unused, so
  // nothing forward-links to /open-items. The real surviving wiring between
  // /open-items and the portfolio is the DetailGlobalBar breadcrumb:
  // /open-items -> Portfolio (/properties). Assert that real link + navigation.
  // ---------------------------------------------------------------------------

  test('/open-items breadcrumb links back to /properties', async ({ page }) => {
    await page.goto('/open-items');
    await expect(page.getByTestId('open-items-page')).toBeVisible();

    const portfolioCrumb = page.getByRole('link', { name: 'Portfolio' });
    await expect(portfolioCrumb).toBeVisible();
    await expect(portfolioCrumb).toHaveAttribute('href', '/properties');
  });

  test('/open-items breadcrumb click navigates to /properties', async ({ page }) => {
    await page.goto('/open-items');
    await expect(page.getByTestId('open-items-page')).toBeVisible();

    const portfolioCrumb = page.getByRole('link', { name: 'Portfolio' });
    await portfolioCrumb.click();

    await page.waitForURL(/\/properties/);
    expect(page.url()).toContain('/properties');

    await expect(page.getByTestId('properties-page')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 3. Work order "View vendor" -> /vendors/<Beltway Plumbing id>
  //
  // The vendor CtxCard only renders a "View vendor" link when the work order
  // has a vendor assigned. WO_COMPLETED_FAUCET_ID is the seeded WO assigned to
  // Beltway Plumbing Co, so its card wires the action href to that vendor's
  // real detail route.
  // ---------------------------------------------------------------------------

  const beltwayHref = `/vendors/${BELTWAY_PLUMBING_VENDOR_ID}`;

  test('work-order "View vendor" link points to Beltway Plumbing', async ({ page }) => {
    await page.goto(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    // The Vendor CtxCard's "View vendor" action has its href wired to the
    // assigned vendor's real /vendors/<uuid> route.
    const viewVendorLink = page.getByRole('link', { name: 'View vendor' });
    await expect(viewVendorLink).toBeVisible();
    await expect(viewVendorLink).toHaveAttribute('href', beltwayHref);
  });

  test('work-order "View vendor" click navigates to the Beltway Plumbing detail page', async ({
    page,
  }) => {
    await page.goto(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    const viewVendorLink = page.getByRole('link', { name: 'View vendor' });
    await viewVendorLink.click();

    await page.waitForURL(new RegExp(`/vendors/${BELTWAY_PLUMBING_VENDOR_ID}`));
    expect(page.url()).toContain(beltwayHref);

    await expect(page.getByTestId('vendor-detail-page')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 4. Sidebar "Tenants" nav item — real link, not disabled / coming-soon
  // ---------------------------------------------------------------------------

  test('sidebar Tenants link is an enabled nav link pointing to /tenants', async ({ page }) => {
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();

    const tenantsLink = page.getByTestId('sidebar-link-tenants');
    await expect(tenantsLink).toBeVisible();

    // Must be an <a> tag (not a disabled <span> coming-soon element)
    await expect(tenantsLink).toHaveAttribute('href', '/tenants');

    // Must not carry aria-disabled (which the comingSoon path sets)
    await expect(tenantsLink).not.toHaveAttribute('aria-disabled');
  });

  test('sidebar Tenants link click navigates to /tenants', async ({ page }) => {
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();

    const tenantsLink = page.getByTestId('sidebar-link-tenants');
    await tenantsLink.click();

    await page.waitForURL(/\/tenants/);
    expect(page.url()).toContain('/tenants');

    await expect(page.getByTestId('tenants-page')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // 5. No console errors on each linked page
  // ---------------------------------------------------------------------------

  test('no console errors on /properties', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();

    expect(errors, `console errors on /properties:\n${errors.join('\n')}`).toEqual([]);
  });

  test('no console errors on /tenants', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/tenants');
    await expect(page.getByTestId('tenants-page')).toBeVisible();

    expect(errors, `console errors on /tenants:\n${errors.join('\n')}`).toEqual([]);
  });

  test('no console errors on /open-items', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/open-items');
    await expect(page.getByTestId('open-items-page')).toBeVisible();

    expect(errors, `console errors on /open-items:\n${errors.join('\n')}`).toEqual([]);
  });

  test('no console errors on the work-order page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    const woPath = `/work-orders/${WO_OPEN_EMERGENCY_ID}`;
    await page.goto(woPath);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    expect(errors, `console errors on ${woPath}:\n${errors.join('\n')}`).toEqual([]);
  });
});
