/**
 * Settings — Preferred Vendors section (spec §11.4 section 2).
 *
 * Exercises the core vendor CRUD + optimistic-save UX:
 *  - The seeded Galaxy vendors render with category / name / phone /
 *    last-dispatched / acceptance columns
 *  - Inline "Add vendor" row creates a new vendor + flashes the Saved
 *    badge, which disappears again
 *  - Clicking a row swaps it into inline-edit, submitting writes the
 *    update and flashes the Saved badge
 *  - Delete uses two-click confirm: first click arms, second click
 *    removes the row
 *
 * Skipped when Supabase env is unavailable.
 */

import { expect, test } from '@playwright/test';

import {
  createAdmin,
  GALAXY_ORG_ID,
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  SEEDED_VENDOR_IDS,
  signInAndOpenSettings,
  type SeededOwner,
} from './helpers';

test.describe('settings: preferred vendors', () => {
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
    // Restore seeded vendors in case a previous run left extras behind.
    const admin = createAdmin();
    await admin
      .from('vendors')
      .delete()
      .eq('organization_id', GALAXY_ORG_ID)
      .not('id', 'in', `(${Object.values(SEEDED_VENDOR_IDS).map((id) => `"${id}"`).join(',')})`);
  });

  test('renders the seeded vendor table rows', async ({ page }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    const section = page.getByTestId('settings-vendors-section');
    await expect(section).toBeVisible();

    const table = page.getByTestId('settings-vendors-table');
    await expect(table).toBeVisible();

    // All three seeded vendors render.
    for (const id of Object.values(SEEDED_VENDOR_IDS)) {
      await expect(page.getByTestId(`settings-vendor-row-${id}`)).toBeVisible();
    }

    // Spot check a row's contents.
    await expect(
      page.getByTestId(`settings-vendor-name-${SEEDED_VENDOR_IDS.plumbing}`),
    ).toContainText('Beltway Plumbing Co');
    await expect(
      page.getByTestId(`settings-vendor-phone-${SEEDED_VENDOR_IDS.plumbing}`),
    ).toContainText('+15715550301');
  });

  test('creates a vendor via inline "Add vendor" row, Saved badge appears + fades', async ({
    page,
  }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    await page.getByTestId('settings-vendor-add-button').click();
    await expect(page.getByTestId('settings-vendor-add-row')).toBeVisible();

    // Pick a non-seeded category so we can filter the DB assertion.
    await page
      .getByTestId('settings-vendor-new-category')
      .selectOption('electrical');
    await page.getByTestId('settings-vendor-new-name').fill('Voltage Brothers');
    await page
      .getByTestId('settings-vendor-new-phone')
      .fill('+15715559999');

    await page.getByTestId('settings-vendor-new-submit').click();

    // The add row collapses.
    await expect(page.getByTestId('settings-vendor-add-row')).toHaveCount(0);

    // Server-side write — confirm a new vendor exists for the org.
    const admin = createAdmin();
    const start = Date.now();
    let foundId: string | null = null;
    while (Date.now() - start < 5_000) {
      const { data } = await admin
        .from('vendors')
        .select('id, name, category, phone_e164')
        .eq('organization_id', GALAXY_ORG_ID)
        .eq('name', 'Voltage Brothers');
      if (data && data.length > 0) {
        foundId = data[0].id;
        expect(data[0].category).toBe('electrical');
        expect(data[0].phone_e164).toBe('+15715559999');
        break;
      }
      await page.waitForTimeout(150);
    }
    expect(foundId).not.toBeNull();

    // Saved badge appears and then fades away within ~3s.
    const badge = page.getByTestId(`optimistic-save-vendor-${foundId}`);
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveAttribute('data-state', 'saved', { timeout: 5_000 });

    // After the 2s hold + 120ms fade, the badge opacity drops to 0 and
    // then the parent clears the row-state entry (~2.2s) which detaches
    // the badge entirely. Either terminal state is correct — accept both
    // so the assertion doesn't race the 200ms gap between fade and
    // unmount.
    await expect
      .poll(
        async () => {
          const count = await badge.count();
          if (count === 0) return 'detached';
          const style = (await badge.getAttribute('style')) ?? '';
          if (/opacity:\s*0/.test(style)) return 'faded';
          return style || 'present';
        },
        { timeout: 6_000 },
      )
      .toMatch(/^(faded|detached)$/);
  });

  test('inline-edits an existing vendor + flashes Saved', async ({ page }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    const row = page.getByTestId(
      `settings-vendor-row-${SEEDED_VENDOR_IDS.general}`,
    );
    await expect(row).toBeVisible();
    await row.click();

    const form = page.getByTestId(
      `settings-vendor-edit-${SEEDED_VENDOR_IDS.general}`,
    );
    await expect(form).toBeVisible();

    const nameInput = page.getByTestId(
      `settings-vendor-edit-${SEEDED_VENDOR_IDS.general}-name`,
    );
    await nameInput.fill('Handyman Hank (updated)');
    await page
      .getByTestId(`settings-vendor-edit-${SEEDED_VENDOR_IDS.general}-submit`)
      .click();

    // Name in the row updates optimistically.
    await expect(
      page.getByTestId(`settings-vendor-name-${SEEDED_VENDOR_IDS.general}`),
    ).toContainText('Handyman Hank (updated)');

    // Saved badge renders next to the row.
    const badge = page.getByTestId(
      `optimistic-save-vendor-${SEEDED_VENDOR_IDS.general}`,
    );
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toHaveAttribute('data-state', 'saved', {
      timeout: 5_000,
    });

    // Revert for idempotency across runs.
    const admin = createAdmin();
    await admin
      .from('vendors')
      .update({ name: 'Handyman Hank LLC' })
      .eq('id', SEEDED_VENDOR_IDS.general);
  });

  test('deletes a vendor via two-click confirm', async ({ page }) => {
    // Seed a throwaway vendor so we never delete a permanent seeded row.
    const admin = createAdmin();
    const { data: inserted, error: insertErr } = await admin
      .from('vendors')
      .insert({
        organization_id: GALAXY_ORG_ID,
        name: 'Throwaway Vendor',
        category: 'cleaning',
        phone_e164: '+15715550000',
      })
      .select('id')
      .single();
    expect(insertErr).toBeNull();
    const throwawayId = inserted!.id;

    try {
      await signInAndOpenSettings(page, {
        email: owner.email,
        password: owner.password,
      });

      const row = page.getByTestId(`settings-vendor-row-${throwawayId}`);
      await expect(row).toBeVisible();

      // First click arms the confirm.
      await page.getByTestId(`settings-vendor-delete-${throwawayId}`).click();
      await expect(
        page.getByTestId(`settings-vendor-delete-confirm-${throwawayId}`),
      ).toBeVisible();

      // Second click within 2s removes the row.
      await page
        .getByTestId(`settings-vendor-delete-confirm-${throwawayId}`)
        .click();
      await expect(
        page.getByTestId(`settings-vendor-row-${throwawayId}`),
      ).toHaveCount(0, { timeout: 5_000 });

      // DB side — poll for the server-action round-trip to complete.
      // The optimistic UI removal races the server call (fired inside
      // startTransition), so an immediate admin.select could see the
      // row still present even though the client already dropped it.
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from('vendors')
              .select('id')
              .eq('id', throwawayId);
            return (data ?? []).length;
          },
          { timeout: 10_000 },
        )
        .toBe(0);
    } finally {
      // Belt-and-suspenders: attempt cleanup even if assertions failed.
      await admin.from('vendors').delete().eq('id', throwawayId);
    }
  });
});
