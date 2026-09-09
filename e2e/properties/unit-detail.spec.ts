/**
 * Unit brief — `/properties/[id]/units/[unitId]` E2E (real Supabase data).
 *
 * Re-authored against the live unit-detail page (which reads real rows via
 * `getUnitBrief`). Uses the seeded Oakwood Commons property + Unit 101, leased
 * to Marcus Alvarez (occupied, paid-current, one open emergency work order).
 *
 * Asserts the real page renders faithfully:
 *   - breadcrumb: … / Oakwood Commons / Unit 101
 *   - title "Unit 101" + "Current" badge (Marcus is paid-current)
 *   - attention section present with real rows (no mock next-action callout —
 *     the real page never sets `nextAction`)
 *   - tenant context card shows "Marcus Alvarez" with "View tenant"
 *     (data-testid="unit-tenant-link") linking to /tenants/<marcus>; clicking
 *     navigates there. "Draft reminder" is a distinct action
 *     (data-testid="unit-tenant-reminder").
 *   - appliances section renders its real empty state (no appliances seeded)
 *   - the single real maintenance row links to /work-orders/<uuid>; clicking it
 *     opens that work-order brief
 *   - "Unit details" collapse toggles to reveal and hide its contents
 *   - ask chip hands off to /assistant with unit context preserved
 *   - no console errors during load
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import {
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  MARCUS_TENANT_ID,
  WO_OPEN_EMERGENCY_ID,
} from '../fixtures/manifest';

/** Route for Unit 101 under Oakwood Commons. */
const UNIT_ROUTE = `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`;

/**
 * Display work-order id the product derives from the real UUID
 * (`WO-${id.slice(0,4).toUpperCase()}`) — backs the ticket row's testid.
 */
const WO_DISPLAY = `WO-${WO_OPEN_EMERGENCY_ID.slice(0, 4).toUpperCase()}`;

/**
 * Benign console noise that must not fail the zero-console-errors assertion.
 */
function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('properties: unit brief (Oakwood Commons · Unit 101)', () => {
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

  test('breadcrumb renders … / Oakwood Commons / Unit 101', async ({ page }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    // Scope to the breadcrumb nav (DetailGlobalBar renders <nav
    // aria-label="Breadcrumb">). The dashboard sidebar also renders a
    // <nav aria-label="Primary"> with its own "Properties" link, so a bare
    // getByRole('navigation') would be ambiguous (strict-mode violation).
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(nav).toContainText('Oakwood Commons');
    await expect(nav).toContainText('Unit 101');

    // The final "Unit 101" crumb is the current page (rendered as
    // <span aria-current="page">, not a link).
    await expect(nav.getByText('Unit 101', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // "Oakwood Commons" crumb links back to the property page.
    const propertyCrumb = nav.getByRole('link', { name: 'Oakwood Commons' });
    await expect(propertyCrumb).toHaveAttribute(
      'href',
      `/properties/${OAKWOOD_PROPERTY_ID}`,
    );

    // "Properties" crumb links back to /properties.
    const propertiescrumb = nav.getByRole('link', { name: 'Properties' });
    await expect(propertiescrumb).toHaveAttribute('href', '/properties');
  });

  test('title renders "Unit 101" with "Current" badge', async ({ page }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    // The page heading contains the unit label.
    await expect(page.getByRole('heading', { name: 'Unit 101' })).toBeVisible();

    // Marcus is paid-current, so the unit badge reads "Current"
    // (text-visible, never color-only).
    await expect(page.getByTestId('unit-detail-page')).toContainText('Current');
  });

  test('attention section is visible with real rows', async ({ page }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const pageEl = page.getByTestId('unit-detail-page');

    // Attention heading is present.
    await expect(pageEl).toContainText('What needs attention');

    // Unit 101 is current on rent with one open emergency work order, so the
    // real attention rows are "Lease healthy" and "Maintenance open".
    await expect(pageEl).toContainText('Lease healthy');
    await expect(pageEl).toContainText('Maintenance open');
  });

  test('tenant ctx card shows "Marcus Alvarez" with "View tenant" linking to the tenant record', async ({
    page,
  }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    // The tenant section has Marcus Alvarez's name.
    await expect(page.getByTestId('unit-detail-page')).toContainText(
      'Marcus Alvarez',
    );

    // The "View tenant" navigation link carries the correct href. The
    // duplicate-testid fix keeps this on the /tenants/ link only; the
    // "Draft reminder" action uses a distinct data-testid.
    const viewTenantLink = page.getByTestId('unit-tenant-link');
    await expect(viewTenantLink).toBeVisible();
    await expect(viewTenantLink).toHaveAttribute(
      'href',
      `/tenants/${MARCUS_TENANT_ID}`,
    );

    // The sibling "Draft reminder" action is a separate node — no shared testid.
    await expect(page.getByTestId('unit-tenant-reminder')).toBeVisible();
  });

  test('clicking "View tenant" navigates to the tenant record', async ({
    page,
  }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const viewTenantLink = page.getByTestId('unit-tenant-link');
    await expect(viewTenantLink).toBeVisible();

    await viewTenantLink.click();

    await page.waitForURL(`/tenants/${MARCUS_TENANT_ID}`, { timeout: 10_000 });
    // The tenant detail page should render.
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();
  });

  test('appliances section renders its real empty state', async ({ page }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const pageEl = page.getByTestId('unit-detail-page');

    // No appliances are seeded for any unit in v1, so the section renders its
    // honest empty state rather than the deleted mock water-heater row.
    await expect(pageEl).toContainText('Appliances');
    await expect(pageEl).toContainText('No appliances on file');
  });

  test('maintenance row links to the real work order', async ({ page }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    // Unit 101 has exactly one work order (the open emergency). Its ticket row
    // is keyed by the derived display id and links to the real work-order UUID.
    const woRow = page.getByTestId(`wo-row-${WO_DISPLAY}`);
    await expect(woRow).toBeVisible();

    const woLink = woRow.getByRole('link');
    await expect(woLink).toHaveAttribute(
      'href',
      `/work-orders/${WO_OPEN_EMERGENCY_ID}`,
    );
  });

  test('clicking the maintenance row opens the work-order brief', async ({
    page,
  }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const woRow = page.getByTestId(`wo-row-${WO_DISPLAY}`);
    await expect(woRow).toBeVisible();

    await woRow.getByRole('link').click();

    await page.waitForURL(`/work-orders/${WO_OPEN_EMERGENCY_ID}`, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('work-order-page')).toBeVisible();
  });

  test('"Unit details" collapse toggles to reveal and hide contents', async ({
    page,
  }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    // The collapse trigger button contains the "Unit details" label.
    const collapseBtn = page.getByRole('button', { name: /Unit details/i });
    await expect(collapseBtn).toBeVisible();

    // Initially collapsed — aria-expanded should be false.
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'false');

    // Content inside (the "Size" spec) should not be rendered yet.
    const sizeLabel = page.getByText('Size', { exact: true });
    await expect(sizeLabel).not.toBeVisible();

    // Click to open.
    await collapseBtn.click();
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');

    // After expanding, the specs/access content becomes visible.
    await expect(sizeLabel).toBeVisible();

    // Click again to collapse.
    await collapseBtn.click();
    await expect(collapseBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(sizeLabel).not.toBeVisible();
  });

  test('clicking an ask chip hands off to /assistant with unit context', async ({
    page,
  }) => {
    await page.goto(UNIT_ROUTE);

    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const firstChip = page.getByTestId('ask-bar-chip').first();
    const chipText = (await firstChip.textContent())?.trim() ?? '';
    expect(chipText.length).toBeGreaterThan(0);

    await firstChip.click();

    // The chip performs an explicit handoff to the global assistant, keeping
    // the unit scope in the query (never mirroring into a local input).
    await page.waitForURL(/\/assistant\?q=/, { timeout: 10_000 });
    const q = new URL(page.url()).searchParams.get('q') ?? '';
    expect(q).toContain('Unit 101');
    expect(q).toContain(chipText);
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto(UNIT_ROUTE);
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();
    // Let any deferred client work settle so late errors are captured.
    await expect(page.getByTestId('ask-odesa-bar-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
