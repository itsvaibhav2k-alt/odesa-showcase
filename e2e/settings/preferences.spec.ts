/**
 * Settings — Landlord Preferences section (spec §11.4 section 3).
 *
 * Preference saving is not connected to a backing store yet, so the
 * controls must not fake success. This spec asserts the honest state:
 *  - All three toggles render their current defaults
 *  - All three toggles are disabled (no fake "Saved" round-trip)
 *  - The "Preference saving is not connected yet" copy is visible
 *  - The contact-hours pickers are disabled
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signInAndOpenSettings,
  type SeededOwner,
} from './helpers';

test.describe('settings: landlord preferences', () => {
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

  test('renders all three toggles with the correct defaults', async ({ page }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    const section = page.getByTestId('settings-preferences-section');
    await expect(section).toBeVisible();

    // Default ON: call for emergencies
    await expect(page.getByTestId('settings-pref-emergencies')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Default OFF: high-value WO text
    await expect(
      page.getByTestId('settings-pref-high-value-wos'),
    ).toHaveAttribute('aria-checked', 'false');
    // Default OFF: draft late-fee notices for owner review
    await expect(
      page.getByTestId('settings-pref-auto-late-fees'),
    ).toHaveAttribute('aria-checked', 'false');
  });

  test('toggles are disabled and the not-connected copy is visible', async ({
    page,
  }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    // No control may fake a save — every toggle is disabled.
    await expect(page.getByTestId('settings-pref-emergencies')).toBeDisabled();
    await expect(
      page.getByTestId('settings-pref-high-value-wos'),
    ).toBeDisabled();
    await expect(
      page.getByTestId('settings-pref-auto-late-fees'),
    ).toBeDisabled();

    // The honest copy is visible instead of a "Saved" badge.
    await expect(
      page.getByTestId('settings-pref-not-connected'),
    ).toContainText(/Preference saving is not connected/i);

    // No optimistic-save badge is rendered anywhere in the card.
    await expect(
      page
        .getByTestId('settings-preferences-section')
        .locator('[data-testid^="optimistic-save-"]'),
    ).toHaveCount(0);
  });

  test('contact-hours pickers are disabled', async ({ page }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    const from = page.getByTestId('settings-pref-contact-from');
    await expect(from).toBeVisible();
    await expect(from).toBeDisabled();

    const to = page.getByTestId('settings-pref-contact-to');
    await expect(to).toBeVisible();
    await expect(to).toBeDisabled();
  });
});
