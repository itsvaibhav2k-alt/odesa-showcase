/**
 * Tenant portal — visual regression baselines (Wave 4).
 *
 * Phone viewport (390×844) full-page screenshots of every portal
 * surface: login (pre-auth), home in both rent states, payments, lease,
 * maintenance empty state, and messages. Baselines live under
 * `e2e/__snapshots__/` and are (re)generated with `--update-snapshots`.
 *
 * Determinism (mirrors e2e/today/today-visual.spec.ts):
 *  - `document.fonts.ready` awaited so Fraunces titles render with the
 *    real face; `toHaveScreenshot` already disables CSS animations and
 *    hides the caret; `reducedMotion: 'reduce'` is emulated per the
 *    house pattern for anything animation-gated on the media query.
 *  - Fixture data is deterministic (rent $1,500, due the 1st, seeded
 *    copy) EXCEPT the provisioned property/unit name — the address line
 *    embeds a per-run timestamp, so every element rendering it is
 *    masked. The tenant first name ("Portal") and org phone are stable.
 *  - The payments paid-date renders the run date and changes daily — it
 *    is masked (paidDateMask). The home/payments month copy ("August",
 *    "due on August 1") shifts only at month rollover, the same cadence
 *    on which the seed's rent cycles regenerate — re-baseline monthly
 *    with --update-snapshots alongside the seed reset.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  provisionPortalTenant,
  signInPortal,
  type SeededPortalTenant,
} from './helpers';

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });
}

/** Every element rendering the per-run provisioned address line. */
function perRunMasks(page: Page, tenant: SeededPortalTenant): Locator[] {
  return [page.getByText(tenant.addressLine, { exact: true })];
}

/**
 * The Stripe payment row renders `paid_at` (the run date) as
 * "August 6, 2026" — it changes DAILY, so it must be masked or the
 * payments baseline goes stale overnight. Mirrors the page's formatDay
 * (en-US long month + day + year, UTC).
 */
function paidDateMask(page: Page): Locator {
  const today = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return page.getByText(today, { exact: true });
}

async function screenshot(
  page: Page,
  name: string,
  mask: Locator[] = [],
): Promise<void> {
  await waitForFonts(page);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask,
  });
}

test.describe('portal: visual baselines', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  test.use({ viewport: { width: 390, height: 844 } });

  let tenant: SeededPortalTenant | null = null;

  test.beforeEach(async ({ page, request }) => {
    await createMessagingMockHarness(request).install();
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test.afterEach(async ({ request }) => {
    await createMessagingMockHarness(request).uninstall().catch(() => {});
    if (tenant) {
      await tenant.teardown().catch(() => {});
      tenant = null;
    }
  });

  test('login', async ({ page }) => {
    await page.goto('/portal/login');
    await expect(page.getByTestId('portal-phone-input')).toBeVisible();
    await screenshot(page, 'portal-login-390x844.png');
  });

  test('home — owing', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'owing' });
    await signInPortal(page, tenant.phoneE164);
    await expect(page.getByTestId('portal-pay-button')).toBeVisible();
    await screenshot(
      page,
      'portal-home-owing-390x844.png',
      perRunMasks(page, tenant),
    );
  });

  test('home — paid', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'paid' });
    await signInPortal(page, tenant.phoneE164);
    await expect(
      page.getByTestId('portal-home-page').getByText(/all set for/i),
    ).toBeVisible();
    await screenshot(
      page,
      'portal-home-paid-390x844.png',
      perRunMasks(page, tenant),
    );
  });

  test('payments', async ({ page }) => {
    tenant = await provisionPortalTenant({ withPayment: true });
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/payments');
    await expect(
      page.getByRole('link', { name: 'View receipt' }),
    ).toBeVisible();
    await screenshot(page, 'portal-payments-390x844.png', [paidDateMask(page)]);
  });

  test('lease', async ({ page }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/lease');
    await expect(page.getByTestId('portal-lease-page')).toBeVisible();
    await screenshot(
      page,
      'portal-lease-390x844.png',
      perRunMasks(page, tenant),
    );
  });

  test('maintenance — empty', async ({ page }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/maintenance');
    await expect(page.getByTestId('portal-maintenance-empty')).toBeVisible();
    await screenshot(page, 'portal-maintenance-empty-390x844.png');
  });

  test('messages', async ({ page }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/messages');
    await expect(page.getByTestId('portal-messages-page')).toBeVisible();
    await expect(page.getByTestId('portal-text-us')).toBeVisible();
    await screenshot(page, 'portal-messages-390x844.png');
  });
});
