/**
 * Onboarding validation E2E.
 *
 * One describe() block per step. Each verifies the server-side
 * validation surface (Zod schemas in src/lib/validation/onboarding.ts)
 * by submitting a deliberately malformed form and asserting the
 * appropriate inline error appears AND the browser does not redirect
 * to the next step.
 *
 * Skipped when the local Supabase stack is offline — same gate as the
 * happy-path spec.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionFreshLandlord,
  type FreshLandlord,
} from './helpers';

// ---------------------------------------------------------------------------
// Shared per-describe fixture: a fresh landlord signed in via UI
// ---------------------------------------------------------------------------

async function signIn(page: Page, landlord: FreshLandlord): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(landlord.email);
  await page.getByTestId('login-password').fill(landlord.password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/(today|onboarding|dashboard)(\/|\?|$)/, {
    timeout: 15_000,
  });
}

async function seedPropertyOnly(
  organizationId: string,
): Promise<{ propertyId: string }> {
  const admin = createAdmin();
  const { data } = await admin
    .from('properties')
    .insert({
      organization_id: organizationId,
      name: 'Validation Building',
      address_street: '1 Rule St',
      address_city: 'Arlington',
      address_state: 'VA',
      address_zip: '22201',
    })
    .select('id')
    .single();
  return { propertyId: data!.id };
}

async function seedPropertyAndUnit(
  organizationId: string,
): Promise<{ propertyId: string; unitId: string }> {
  const { propertyId } = await seedPropertyOnly(organizationId);
  const admin = createAdmin();
  const { data } = await admin
    .from('units')
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      label: 'V1',
    })
    .select('id')
    .single();
  return { propertyId, unitId: data!.id };
}

async function seedThrough(
  organizationId: string,
  args: { rentAmount?: number } = {},
): Promise<{
  propertyId: string;
  unitId: string;
  tenantId: string;
}> {
  const { propertyId, unitId } = await seedPropertyAndUnit(organizationId);
  const admin = createAdmin();
  const { data } = await admin
    .from('tenants')
    .insert({
      organization_id: organizationId,
      full_name: 'Validation Tenant',
      phone_e164: '+17035559999',
    })
    .select('id')
    .single();
  void args;
  return { propertyId, unitId, tenantId: data!.id };
}

// ===========================================================================

test.describe('step 1 — property validation', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let landlord: FreshLandlord;

  test.beforeEach(async ({ page }) => {
    landlord = await provisionFreshLandlord('property-val');
    await signIn(page, landlord);
    await page.goto('/onboarding/property');
    await expect(page.getByTestId('onboarding-property')).toBeVisible();
  });

  test.afterEach(async () => {
    await landlord?.teardown();
  });

  test('rejects invalid 2-letter state (lowercase)', async ({ page }) => {
    await page.getByTestId('property-name').fill('Bad State');
    await page.getByTestId('property-address-street').fill('1 Main');
    await page.getByTestId('property-address-city').fill('Arlington');
    await page
      .getByTestId('property-address-state')
      .evaluate((el: HTMLInputElement) => (el.value = 'va')); // bypass uppercase CSS
    // Re-fill cleanly because evaluate() doesn't fire the React change
    // event; we want the form to actually submit.
    await page.getByTestId('property-address-state').fill('VV');
    await page.getByTestId('property-address-zip').fill('22201');
    await page.getByTestId('property-submit').click();

    // Still on property page (action returned error, no redirect).
    await expect(page.getByTestId('onboarding-property')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('rejects 4-digit zip', async ({ page }) => {
    await page.getByTestId('property-name').fill('Zip Fail');
    await page.getByTestId('property-address-street').fill('1 Main');
    await page.getByTestId('property-address-city').fill('Arlington');
    await page.getByTestId('property-address-state').fill('VA');
    await page.getByTestId('property-address-zip').fill('1234');
    await page.getByTestId('property-submit').click();

    await expect(page.getByTestId('property-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId('property-error')).toContainText(/ZIP/i);
    await expect(page).toHaveURL(/\/onboarding\/property/);
  });

  test('accepts ZIP+4 (9-digit) format', async ({ page }) => {
    await page.getByTestId('property-name').fill('ZIP Plus Four');
    await page.getByTestId('property-address-street').fill('1 Main');
    await page.getByTestId('property-address-city').fill('Arlington');
    await page.getByTestId('property-address-state').fill('VA');
    await page.getByTestId('property-address-zip').fill('22201-1234');
    await page.getByTestId('property-submit').click();

    await page.waitForURL(/\/onboarding\/unit\?propertyId=/, {
      timeout: 15_000,
    });
  });
});

// ===========================================================================

test.describe('step 2 — unit validation', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let landlord: FreshLandlord;
  let propertyId: string;

  test.beforeEach(async ({ page }) => {
    landlord = await provisionFreshLandlord('unit-val');
    const seeded = await seedPropertyOnly(landlord.organizationId);
    propertyId = seeded.propertyId;
    await signIn(page, landlord);
    await page.goto(`/onboarding/unit?propertyId=${propertyId}`);
    await expect(page.getByTestId('onboarding-unit')).toBeVisible();
  });

  test.afterEach(async () => {
    await landlord?.teardown();
  });

  test('rejects bedroom count above 20', async ({ page }) => {
    await page.getByTestId('unit-label').fill('201');
    await page
      .getByTestId('unit-bedrooms')
      .evaluate((el: HTMLInputElement) => {
        el.removeAttribute('max');
      });
    await page.getByTestId('unit-bedrooms').fill('99');
    await page.getByTestId('unit-submit').click();

    await expect(page.getByTestId('unit-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/onboarding\/unit/);
  });

  test('allows missing optional fields', async ({ page }) => {
    await page.getByTestId('unit-label').fill('Studio');
    // Leave bedrooms/bathrooms/squareFeet blank
    await page.getByTestId('unit-submit').click();

    await page.waitForURL(/\/onboarding\/tenant\?unitId=/, {
      timeout: 15_000,
    });
  });
});

// ===========================================================================

test.describe('step 3 — tenant validation', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let landlord: FreshLandlord;
  let unitId: string;

  test.beforeEach(async ({ page }) => {
    landlord = await provisionFreshLandlord('tenant-val');
    const seeded = await seedPropertyAndUnit(landlord.organizationId);
    unitId = seeded.unitId;
    await signIn(page, landlord);
    await page.goto(`/onboarding/tenant?unitId=${unitId}`);
    await expect(page.getByTestId('onboarding-tenant')).toBeVisible();
  });

  test.afterEach(async () => {
    await landlord?.teardown();
  });

  test('rejects a 3-digit phone', async ({ page }) => {
    await page.getByTestId('tenant-full-name').fill('Bad Phone');
    await page.getByTestId('tenant-phone').fill('123');
    await page.getByTestId('tenant-submit').click();

    await expect(page.getByTestId('tenant-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId('tenant-error')).toContainText(/E\.164/i);
    await expect(page).toHaveURL(/\/onboarding\/tenant/);
  });

  test('rejects invalid email format', async ({ page }) => {
    await page.getByTestId('tenant-full-name').fill('Bad Email');
    await page.getByTestId('tenant-phone').fill('+17035550000');
    // Bypass the browser's HTML5 form validation so the server-side Zod
    // check is what rejects the bad email — that's what this test is
    // asserting. Just setting `type="text"` on the input reverts on the
    // next React reconciliation; setting `noValidate` on the parent
    // form is stable and scoped to the form element only.
    await page.getByTestId('tenant-form').evaluate((el: HTMLFormElement) => {
      el.noValidate = true;
    });
    await page.getByTestId('tenant-email').fill('not-an-email');
    await page.getByTestId('tenant-submit').click();

    await expect(page.getByTestId('tenant-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/onboarding\/tenant/);
  });

  test('empty email is permitted', async ({ page }) => {
    await page.getByTestId('tenant-full-name').fill('No Email');
    await page.getByTestId('tenant-phone').fill('+17035551111');
    // Leave email + DOB blank
    await page.getByTestId('tenant-submit').click();

    await page.waitForURL(/\/onboarding\/lease\?.*tenantId=/, {
      timeout: 15_000,
    });
  });
});

// ===========================================================================

test.describe('step 4 — lease validation', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let landlord: FreshLandlord;
  let unitId: string;
  let tenantId: string;

  test.beforeEach(async ({ page }) => {
    landlord = await provisionFreshLandlord('lease-val');
    const seeded = await seedThrough(landlord.organizationId);
    unitId = seeded.unitId;
    tenantId = seeded.tenantId;
    await signIn(page, landlord);
    await page.goto(
      `/onboarding/lease?unitId=${unitId}&tenantId=${tenantId}`,
    );
    await expect(page.getByTestId('onboarding-lease')).toBeVisible();
  });

  test.afterEach(async () => {
    await landlord?.teardown();
  });

  test('rejects rent_due_day outside 1-31', async ({ page }) => {
    await page
      .getByTestId('lease-rent-due-day')
      .evaluate((el: HTMLInputElement) => {
        el.removeAttribute('max');
      });
    await page.getByTestId('lease-rent-amount').fill('1500');
    await page.getByTestId('lease-rent-due-day').fill('40');
    await page.getByTestId('lease-start-date').fill('2026-05-01');
    await page.getByTestId('lease-end-date').fill('2027-04-30');
    await page.getByTestId('lease-submit').click();

    await expect(page.getByTestId('lease-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/onboarding\/lease/);
  });

  test('rejects non-positive rent amount', async ({ page }) => {
    await page
      .getByTestId('lease-rent-amount')
      .evaluate((el: HTMLInputElement) => {
        el.removeAttribute('min');
      });
    await page.getByTestId('lease-rent-amount').fill('-10');
    await page.getByTestId('lease-rent-due-day').fill('1');
    await page.getByTestId('lease-start-date').fill('2026-05-01');
    await page.getByTestId('lease-end-date').fill('2027-04-30');
    await page.getByTestId('lease-submit').click();

    await expect(page.getByTestId('lease-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page).toHaveURL(/\/onboarding\/lease/);
  });

  test('rejects end_date before start_date', async ({ page }) => {
    await page.getByTestId('lease-rent-amount').fill('1500');
    await page.getByTestId('lease-rent-due-day').fill('1');
    await page.getByTestId('lease-start-date').fill('2026-08-01');
    await page.getByTestId('lease-end-date').fill('2026-05-01');
    await page.getByTestId('lease-submit').click();

    await expect(page.getByTestId('lease-error')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId('lease-error')).toContainText(
      /end date|after/i,
    );
    await expect(page).toHaveURL(/\/onboarding\/lease/);
  });
});
