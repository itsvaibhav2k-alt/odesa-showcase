/**
 * Empty-pool branch E2E — T2b (2026-05-17).
 *
 * Verifies that when `sendblue_number_pool` has no available rows,
 * the messaging onboarding step renders the waitlist message and does
 * NOT show a raw error blob or 500 page.
 *
 * The spec:
 *   1. Provisions a fresh landlord + seeds the required property/unit/tenant/
 *      lease rows so the messaging step is reachable.
 *   2. Ensures the number pool has zero available rows for the test
 *      (any existing available rows are temporarily marked 'retired' and
 *      restored in afterEach).
 *   3. Navigates to /onboarding/messaging and clicks "Assign a number".
 *   4. Asserts the waitlist message is shown and no 500 error is present.
 *
 * Skipped when Supabase is offline — same gate as the other onboarding specs.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionFreshLandlord,
  type FreshLandlord,
} from './helpers';
import { NO_AVAILABLE_NUMBERS_MESSAGE } from '../../src/app/(dashboard)/onboarding/messaging/constants';

test.describe('onboarding: empty pool → waitlist', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let landlord: FreshLandlord;
  /** Pool row IDs we temporarily set to 'retired' to drain the pool. */
  let drainedIds: string[] = [];

  test.beforeEach(async () => {
    landlord = await provisionFreshLandlord('emptypool');
    const admin = createAdmin();

    // Seed a minimal onboarding portfolio so the messaging step is reachable
    // (layout requires at least one lease to not redirect back to /onboarding).
    const { data: property } = await admin
      .from('properties')
      .insert({
        organization_id: landlord.organizationId,
        name: 'Empty Pool Building',
        address_street: '1 Pool St',
        address_city: 'Arlington',
        address_state: 'VA',
        address_zip: '22201',
      })
      .select('id')
      .single();

    const { data: unit } = await admin
      .from('units')
      .insert({
        organization_id: landlord.organizationId,
        property_id: property!.id,
        label: '101',
      })
      .select('id')
      .single();

    const { data: tenant } = await admin
      .from('tenants')
      .insert({
        organization_id: landlord.organizationId,
        full_name: 'Pool Tenant',
        phone_e164: '+17035550111',
      })
      .select('id')
      .single();

    await admin.from('leases').insert({
      organization_id: landlord.organizationId,
      unit_id: unit!.id,
      tenant_id: tenant!.id,
      rent_amount: 1500,
      rent_due_day: 1,
      status: 'active',
    });

    // Drain all available pool rows by temporarily setting them to 'retired'.
    // This simulates an empty pool without permanently destroying rows.
    const { data: available } = await admin
      .from('sendblue_number_pool')
      .select('id')
      .eq('status', 'available');

    drainedIds = (available ?? []).map((r) => r.id);

    if (drainedIds.length > 0) {
      await admin
        .from('sendblue_number_pool')
        .update({ status: 'retired' })
        .in('id', drainedIds);
    }
  });

  test.afterEach(async () => {
    const admin = createAdmin();

    // Restore drained pool rows.
    if (drainedIds.length > 0) {
      await admin
        .from('sendblue_number_pool')
        .update({ status: 'available' })
        .in('id', drainedIds);
      drainedIds = [];
    }

    // Tear down the landlord.
    if (landlord) {
      await landlord.teardown();
    }
  });

  test('shows waitlist message when pool is empty, no 500 or raw error', async ({
    page,
  }) => {
    // Sign in via the UI.
    await page.goto('/login');
    await page.getByTestId('login-email').fill(landlord.email);
    await page.getByTestId('login-password').fill(landlord.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/(today|onboarding|dashboard)(\/|\?|$)/, {
      timeout: 15_000,
    });

    // Navigate directly to the messaging step. The layout lets us land here
    // because we have a lease but no odesa_phone_number yet.
    await page.goto('/onboarding/messaging');
    await expect(page.getByTestId('messaging-form')).toBeVisible({
      timeout: 15_000,
    });

    // Assign number button must be visible (no number assigned yet).
    await expect(page.getByTestId('messaging-assign-button')).toBeVisible();

    // Click assign — pool is empty, should show waitlist message.
    await page.getByTestId('messaging-assign-button').click();

    // The error slot should appear with the waitlist copy.
    const errorEl = page.getByTestId('messaging-assign-error');
    await expect(errorEl).toBeVisible({ timeout: 10_000 });

    // Assert user-friendly waitlist language is shown.
    await expect(errorEl).toContainText("we've been added to the waitlist");

    // Assert the waitlist message matches the constant (case-insensitive partial match).
    const partial = "at capacity";
    await expect(errorEl).toContainText(partial, { ignoreCase: true });

    // Assert NO raw internal error strings leak through.
    const pageText = await page.innerText('body');
    expect(pageText).not.toMatch(/500/);
    expect(pageText).not.toMatch(/Internal Server Error/i);
    expect(pageText).not.toMatch(/empty_pool/);
    expect(pageText).not.toMatch(/NO_AVAILABLE_NUMBERS/);

    // Assert the page did not crash (no Next.js error overlay).
    await expect(page.locator('[data-nextjs-dialog]')).not.toBeVisible();
  });
});
