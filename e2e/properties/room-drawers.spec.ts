/**
 * Property Interior room drawers — `/properties/[id]?room=<key>` E2E.
 *
 * The six former tab sub-pages (units, appliances, vendors, maintenance,
 * payments, rulebook) now fold into the interior overview as URL-synced
 * right-side Sheet drawers. This spec asserts the integration contract:
 *
 *   - `?room=<key>` opens the matching drawer (data-room + serif title)
 *   - a garbage `?room=` value opens no drawer
 *   - the "Property cabinet" row opens the records drawers
 *   - legacy tab URLs 30x-redirect into the `?room=` drawer
 *   - legacy `?unit=` deep links pass through to `?room=units&unit=`
 *   - the units → unit-drawer stack: row click merges `room=units&unit=`,
 *     and closing the unit drawer returns to `?room=units`
 *   - a nested dialog (Add appliance) opens above the sheet and Esc closes
 *     only the dialog, leaving the room drawer open
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

const OAK = OAKWOOD_PROPERTY_ID;

test.describe('properties: interior room drawers', () => {
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

  test('?room=payments opens the Rent desk drawer', async ({ page }) => {
    await page.goto(`/properties/${OAK}?room=payments`);

    const drawer = page.getByTestId('room-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-room', 'payments');
    await expect(drawer).toContainText('Rent desk');
  });

  test('a garbage ?room= value opens no drawer', async ({ page }) => {
    await page.goto(`/properties/${OAK}?room=not-a-real-room`);

    await expect(page.getByTestId('property-detail-page')).toBeVisible();
    await expect(page.getByTestId('room-drawer')).toHaveCount(0);
  });

  test('the Property cabinet row opens the Appliance shelf drawer', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAK}`);

    const cabinet = page.getByTestId('room-cabinet');
    await expect(cabinet).toBeVisible();

    await cabinet.getByRole('link', { name: /appliance shelf/i }).click();

    const drawer = page.getByTestId('room-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-room', 'appliances');
    await expect(page).toHaveURL(/[?&]room=appliances/);
  });

  test('legacy /payments URL redirects into the ?room=payments drawer', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAK}/payments`);

    await expect(page).toHaveURL(/[?&]room=payments/);
    const drawer = page.getByTestId('room-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute('data-room', 'payments');
  });

  test('legacy /units?unit= deep link passes through to ?room=units&unit=', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAK}/units?unit=${UNIT_101_ID}`);

    await expect(page).toHaveURL(/[?&]room=units/);
    await expect(page).toHaveURL(new RegExp(`[?&]unit=${UNIT_101_ID}`));
    // ?unit= takes precedence: the unit drawer shows, not the units room.
    await expect(page.getByTestId('unit-detail-drawer')).toBeVisible();
  });

  test('units room → unit drawer stack: row click merges params, close returns to ?room=units', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAK}?room=units`);

    const unitsDrawer = page.getByTestId('room-drawer');
    await expect(unitsDrawer).toHaveAttribute('data-room', 'units');

    // Click the seeded unit's row — merges room=units + unit=<id> and pushes.
    await page.getByTestId(`units-table-row-${UNIT_101_ID}-label`).click();

    await expect(page).toHaveURL(/[?&]room=units/);
    await expect(page).toHaveURL(new RegExp(`[?&]unit=${UNIT_101_ID}`));
    const unitDrawer = page.getByTestId('unit-detail-drawer');
    await expect(unitDrawer).toBeVisible();

    // Close the unit drawer → canonical return to the units room (?room=units).
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/[?&]room=units/);
    await expect(page).not.toHaveURL(/[?&]unit=/);
    await expect(page.getByTestId('room-drawer')).toHaveAttribute(
      'data-room',
      'units',
    );
  });

  test('nested Add appliance dialog opens above the sheet; Esc closes only the dialog', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAK}?room=appliances`);

    const drawer = page.getByTestId('room-drawer');
    await expect(drawer).toBeVisible();

    await page.getByTestId('add-appliance-trigger').click();
    await expect(page.getByTestId('add-appliance-dialog')).toBeVisible();

    // First Escape closes the nested dialog only — the room drawer stays open.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-appliance-dialog')).toHaveCount(0);
    await expect(drawer).toBeVisible();
  });
});
