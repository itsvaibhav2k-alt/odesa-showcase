/**
 * Tenant-portal read pages E2E (Wave 1).
 *
 * Fresh tenant provisioned + real OTP sign-in per test (Wave-0 flow via
 * the messaging mock). Covers home (paid + owing states), payments,
 * lease, messages (incl. the unapproved-draft exclusion invariant), and
 * bottom-tab navigation. Skipped when local Supabase is offline — same
 * gating as e2e/today/helpers.ts.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  provisionPortalTenant,
  signInPortal,
  type SeededPortalTenant,
} from './helpers';

test.describe('portal reads', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let tenant: SeededPortalTenant | null = null;

  test.beforeEach(async ({ request }) => {
    await createMessagingMockHarness(request).install();
  });

  test.afterEach(async ({ request }) => {
    await createMessagingMockHarness(request).uninstall().catch(() => {});
    if (tenant) {
      await tenant.teardown().catch(() => {});
      tenant = null;
    }
  });

  test('home shows the all-set state when rent is paid', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'paid' });
    await signInPortal(page, tenant.phoneE164);

    const home = page.getByTestId('portal-home-page');
    await expect(home).toBeVisible();
    await expect(home.getByText(/all set for/i)).toBeVisible();
    // Nothing owed → no balance figure inside the rent-standing hero and no Pay button.
    const standing = home.getByTestId('portal-rent-standing');
    await expect(standing.getByText('$1,500')).toHaveCount(0);
    await expect(home.getByText(/^Pay /)).toHaveCount(0);
  });

  test('home shows the balance when rent is owed', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'owing' });
    await signInPortal(page, tenant.phoneE164);

    const home = page.getByTestId('portal-home-page');
    await expect(home).toBeVisible();
    await expect(home.getByText(/You have a balance of \$1,500/)).toBeVisible();
    // The big .num figure + the Pay button both carry the amount.
    await expect(home.getByText('$1,500', { exact: true })).toBeVisible();
    // W2 swapped the Wave-1 placeholder Link for the real PayButton.
    await expect(
      home.getByRole('button', { name: 'Pay $1,500' }),
    ).toBeVisible();
  });

  test('payments lists the provisioned Stripe payment', async ({ page }) => {
    tenant = await provisionPortalTenant({ withPayment: true });
    await signInPortal(page, tenant.phoneE164);

    await page.goto('/portal/payments');
    const payments = page.getByTestId('portal-payments-page');
    await expect(payments).toBeVisible();
    await expect(payments.getByText('$1,500')).toBeVisible();
    const receipt = payments.getByRole('link', { name: 'View receipt' });
    await expect(receipt).toBeVisible();
    await expect(receipt).toHaveAttribute('target', '_blank');
  });

  test('lease shows rent amount and address', async ({ page }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);

    await page.goto('/portal/lease');
    const lease = page.getByTestId('portal-lease-page');
    await expect(lease).toBeVisible();
    await expect(lease.getByText('$1,500')).toBeVisible();
    await expect(lease.getByText(tenant.addressLine)).toBeVisible();
  });

  test('messages shows the thread but never the unapproved draft', async ({
    page,
  }) => {
    tenant = await provisionPortalTenant({ withThread: true });
    await signInPortal(page, tenant.phoneE164);

    await page.goto('/portal/messages');
    const messages = page.getByTestId('portal-messages-page');
    await expect(messages).toBeVisible();
    await expect(messages.getByText(tenant.thread!.sentBody)).toBeVisible();
    await expect(messages.getByText(tenant.thread!.inboundBody)).toBeVisible();
    // PRIVACY INVARIANT: the unapproved draft (sent_at null) never renders.
    await expect(page.getByText(tenant.thread!.draftBody)).toHaveCount(0);

    const textUs = page.getByTestId('portal-text-us');
    await expect(textUs).toBeVisible();
    await expect(textUs).toHaveAttribute('href', /^sms:/);
  });

  test('bottom tab bar navigates between home, payments, and messages', async ({
    page,
  }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await expect(page.getByTestId('portal-home-page')).toBeVisible();

    await page.getByTestId('portal-tab-payments').click();
    await expect(page.getByTestId('portal-payments-page')).toBeVisible();

    await page.getByTestId('portal-tab-messages').click();
    await expect(page.getByTestId('portal-messages-page')).toBeVisible();

    await page.getByTestId('portal-tab-home').click();
    await expect(page.getByTestId('portal-home-page')).toBeVisible();
  });
});
