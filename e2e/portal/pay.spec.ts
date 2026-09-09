/**
 * Tenant-portal pay flow E2E (Wave 2).
 *
 * Covers the home-page Pay button (owing + paid-up states), the honest
 * failure path when Stripe is not configured (no key in the local e2e
 * env — no crash, friendly copy, zero rent_payments corruption), and the
 * PUBLIC checkout return pages, asserted with no portal session at all —
 * which also pins the fix for the pre-existing SMS payment bounce
 * (success/cancel used to target the nonexistent /embed/* routes).
 *
 * There is NO Stripe mock in this repo (searched e2e/, src/lib/test-hooks,
 * env files; e2e/financials/stripe-reconciliation.spec.ts exercises the
 * webhook-side RPC directly against Postgres, never the Checkout API), so
 * the real redirect-to-Stripe assertion stays skipped below rather than
 * inventing a mock in this wave.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  createAdmin,
  provisionPortalTenant,
  signInPortal,
  type SeededPortalTenant,
} from './helpers';

const STRIPE_CONFIGURED = Boolean(process.env.STRIPE_SECRET_KEY);

test.describe('portal pay flow', () => {
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

  test('home shows the Pay button with the owed amount', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'owing' });
    await signInPortal(page, tenant.phoneE164);

    const payButton = page.getByTestId('portal-pay-button');
    await expect(payButton).toBeVisible();
    await expect(payButton).toHaveText('Pay $1,500');
    await expect(payButton).toBeEnabled();
  });

  test('clicking Pay without Stripe keys fails friendly — no crash, no stray rows', async ({
    page,
  }) => {
    test.skip(
      STRIPE_CONFIGURED,
      'STRIPE_SECRET_KEY is set — this test pins the honest no-key failure path',
    );
    tenant = await provisionPortalTenant({ rent: 'owing' });
    await signInPortal(page, tenant.phoneE164);

    await page.getByTestId('portal-pay-button').click();

    // Consumer copy from src/lib/portal/pay.ts, never the machine error.
    // Scoped testid — bare getByRole('alert') also matches Next's route
    // announcer div and trips strict mode.
    const alert = page.getByTestId('portal-pay-error');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/couldn't open the payment page/i);
    await expect(alert).not.toContainText(/stripe/i);

    // Still on the home page, not an error boundary.
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByTestId('portal-home-page')).toBeVisible();

    // The mint failed before any insert — no pending rent_payments row
    // may exist for this cycle.
    const admin = createAdmin();
    const { data: rows, error } = await admin
      .from('rent_payments')
      .select('id')
      .eq('rent_event_id', tenant.rentEventId);
    expect(error).toBeNull();
    expect(rows ?? []).toHaveLength(0);
  });

  // No Stripe mock exists in this repo and Wave 2 does not invent one —
  // unskip once a Checkout-API test double lands (needs STRIPE_SECRET_KEY
  // + intercepting the hosted-checkout redirect).
  test.skip('clicking Pay redirects to Stripe hosted checkout', async () => {});

  test('a paid-up tenant sees no Pay button', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'paid' });
    await signInPortal(page, tenant.phoneE164);

    await expect(page.getByTestId('portal-home-page')).toBeVisible();
    await expect(page.getByText(/all set for/i)).toBeVisible();
    await expect(page.getByTestId('portal-pay-button')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Public checkout return pages — deliberately NO sign-in and NO Supabase
// gate: Stripe (or an SMS-link payer with no portal session) lands here
// cookieless, and the pages must render tenant-free content anyway.
// ---------------------------------------------------------------------------

test.describe('payment return pages (public, no session)', () => {
  test('/portal/payment-success renders without any cookies', async ({
    page,
  }) => {
    await page.goto('/portal/payment-success?session_id=cs_test_e2e');
    await expect(
      page.getByTestId('portal-payment-success-page'),
    ).toBeVisible();
    await expect(page.getByText(/payment received/i)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'See your payments' }),
    ).toHaveAttribute('href', '/portal/payments');
  });

  test('/portal/payment-cancel renders without any cookies', async ({
    page,
  }) => {
    await page.goto('/portal/payment-cancel');
    await expect(
      page.getByTestId('portal-payment-cancel-page'),
    ).toBeVisible();
    await expect(page.getByText('Nothing was charged.')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to your portal' }),
    ).toHaveAttribute('href', '/portal');
  });
});
