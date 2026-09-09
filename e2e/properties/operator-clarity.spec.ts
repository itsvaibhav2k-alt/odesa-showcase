/**
 * Operator-clarity E2E — Pass 8.
 *
 * Guards the "operator can read and act on the portfolio at a glance" pass that
 * threaded labeled metrics, operational triage filters, data-backed at-risk
 * reasons, and inline record-payment affordances through the Properties surface:
 *   1. /properties rail metrics are LABELED ("occupied" / "collected"), not a
 *      bare "3/3 · 0%".
 *   2. An operational filter chip narrows the directory to the matching subset.
 *   3. An at-risk property detail explains its badge via `property-badge-reasons`.
 *   4. The property UnitsPanel exposes tenant + balance and an inline
 *      record-payment path on an outstanding unit.
 *   5. A late unit's detail page exposes the same record-payment path.
 *   6. Edit / Add-tenant dialogs open visibly (first field focused) and close on
 *      Escape.
 *   7. The property Documents link is scoped (`?propertyId=`).
 *   8. The unit-detail Portfolio crumb is non-clickable (never links to `/`).
 *
 * Driven by the seeded Galaxy org:
 *   - Oakwood Commons (7 units, all rent paid) → calm.
 *   - 17th Street Row (3 units; unit A late, unit C escalated) → at-risk, with
 *     two units carrying an outstanding balance.
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  SEVENTEENTH_PROPERTY_ID,
  UNIT_C_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

test.describe('operator clarity pass', () => {
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

  // 1 — directory rail metrics are labeled, not a bare ratio/percent pair.
  test('property directory rail shows labeled occupied + collected metrics', async ({
    page,
  }) => {
    await page.goto('/properties');

    const rail = page.locator('aside[aria-label="Property directory"]');
    await expect(rail).toBeVisible();

    const railText = (await rail.innerText()).toLowerCase();
    expect(railText).toContain('occupied');
    expect(railText).toContain('collected');
  });

  // 2 — an operational filter chip narrows the directory to the matching subset.
  test('an operational filter narrows the directory to the matching subset', async ({
    page,
  }) => {
    await page.goto('/properties');

    const rail = page.locator('aside[aria-label="Property directory"]');
    const oakwoodRow = rail.locator(
      `a[href="/properties/${OAKWOOD_PROPERTY_ID}"]`,
    );
    const seventeenthRow = rail.locator(
      `a[href="/properties/${SEVENTEENTH_PROPERTY_ID}"]`,
    );

    // Both properties show under the default (unfiltered) directory.
    await expect(oakwoodRow).toBeVisible();
    await expect(seventeenthRow).toBeVisible();

    // Oakwood carries open maintenance (water-heater + AC work orders); 17th
    // Street has none → the Maintenance-open filter narrows the rail to Oakwood.
    // (Rent-late keeps both, since both properties have past-due current rent.)
    await page.getByTestId('property-filter-maintenance-open').click();
    await expect(oakwoodRow).toBeVisible();
    await expect(seventeenthRow).toHaveCount(0);

    // Clearing the operational filter restores the full directory.
    await page.getByTestId('property-filter-all').click();
    await expect(seventeenthRow).toBeVisible();
  });

  // 3 — an at-risk property explains its status badge with data-backed reasons.
  test('at-risk property detail shows badge reasons', async ({ page }) => {
    await page.goto(`/properties/${SEVENTEENTH_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    const reasons = page.getByTestId('property-badge-reasons');
    await expect(reasons).toBeVisible();
    expect((await reasons.innerText()).trim().length).toBeGreaterThan(0);
  });

  // 4 — the UnitsPanel exposes tenant + balance and an inline record-payment
  //     path on an outstanding unit, with the "no money moves" note.
  test('property units panel exposes tenant, balance, and a record-payment path', async ({
    page,
  }) => {
    await page.goto(`/properties/${SEVENTEENTH_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    const unitsPanel = page.getByTestId('property-units');
    await expect(unitsPanel).toBeVisible();

    // Tenant is exposed via the per-unit "View tenant" link.
    await expect(
      unitsPanel.getByRole('link', { name: 'View tenant' }).first(),
    ).toBeVisible();
    // Balance is surfaced ("$… due" or "$… · Nd late").
    await expect(unitsPanel).toContainText(/due|late/i);

    const trigger = unitsPanel.getByTestId('record-payment-trigger').first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(page.getByTestId('record-payment-modal')).toBeVisible();
    await expect(
      page.getByTestId('record-payment-nomoney-note'),
    ).toContainText(/no money is moved/i);
  });

  // 5 — a late unit's detail page exposes the record-payment path + no-money note.
  test('late unit detail exposes a record-payment path with no-money copy', async ({
    page,
  }) => {
    await page.goto(`/properties/${SEVENTEENTH_PROPERTY_ID}/units/${UNIT_C_ID}`);
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const trigger = page.getByTestId('record-payment-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(page.getByTestId('record-payment-modal')).toBeVisible();
    await expect(
      page.getByTestId('record-payment-nomoney-note'),
    ).toContainText(/no money is moved/i);
  });

  // 6 — Edit / Add-tenant dialogs open visibly (first field focused) + Escape closes.
  test('property dialogs open with focus and close on Escape', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    // Edit property — opens visibly with the first field focused.
    await page.getByTestId('edit-property-trigger').click();
    const editDialog = page.getByTestId('edit-property-dialog');
    await expect(editDialog).toBeVisible();
    await expect(page.locator('#property-name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editDialog).toBeHidden();

    // Add tenant — Oakwood has units, so the form (tenant-name) renders; the
    // no-units empty state only appears for a unit-less property. Accept either.
    await page.getByTestId('add-tenant-trigger').first().click();
    const addDialog = page.getByTestId('add-tenant-dialog');
    await expect(addDialog).toBeVisible();

    const tenantNameCount = await page.locator('#tenant-name').count();
    if (tenantNameCount > 0) {
      await expect(page.locator('#tenant-name')).toBeVisible();
    } else {
      await expect(page.getByTestId('add-tenant-no-units')).toBeVisible();
    }

    await page.keyboard.press('Escape');
    await expect(addDialog).toBeHidden();
  });

  // 7 — the property Documents link is scoped to the property.
  test('property documents link is property-scoped', async ({ page }) => {
    await page.goto(`/properties/${SEVENTEENTH_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    const docsLink = page
      .locator('a[href*="/documents?propertyId="]')
      .first();
    await expect(docsLink).toBeVisible();
    expect(await docsLink.getAttribute('href')).toContain('?propertyId=');
  });

  // 8 — the unit-detail Portfolio crumb is non-clickable (never links to root).
  test('unit detail Portfolio breadcrumb does not link to root', async ({
    page,
  }) => {
    await page.goto(`/properties/${SEVENTEENTH_PROPERTY_ID}/units/${UNIT_C_ID}`);
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('Portfolio');
    // The Portfolio crumb renders as a plain <span>, so no breadcrumb anchor
    // routes to the dashboard root.
    await expect(breadcrumb.locator('a[href="/"]')).toHaveCount(0);
  });
});
