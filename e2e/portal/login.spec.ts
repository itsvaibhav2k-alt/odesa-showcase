/**
 * Tenant-portal login E2E (Wave 0 — the trust boundary).
 *
 * Covers:
 *   (a) full OTP login: phone → code (captured via the messaging mock) →
 *       redirect lands on /portal
 *   (b) wrong code: generic error shown, no portal cookie set
 *   (c) the portal cookie never grants staff routes (/today → staff /login)
 *   (d) a staff Supabase session never grants /portal (→ /portal/login)
 *
 * Fresh tenant (unique phone) provisioned per test; skipped when the
 * local Supabase stack is offline — same gating as e2e/today/helpers.ts.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  fetchPortalOtpCode,
  provisionPortalTenant,
  signInPortal,
  type SeededPortalTenant,
} from './helpers';
import { provisionGalaxyOwner, signIn, type SeededOwner } from '../today/helpers';

const PORTAL_COOKIE = 'odesa_portal';

test.describe('portal login', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let tenant: SeededPortalTenant | null = null;

  test.beforeEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.install();
    tenant = await provisionPortalTenant();
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (tenant) {
      await tenant.teardown().catch(() => {});
      tenant = null;
    }
  });

  test('full OTP login lands on /portal', async ({ page }) => {
    await signInPortal(page, tenant!.phoneE164);

    expect(new URL(page.url()).pathname).toBe('/portal');
    await expect(page.getByTestId('portal-home-page')).toBeVisible();

    // The session cookie exists and is scoped to /portal.
    const cookies = await page.context().cookies();
    const portalCookie = cookies.find((c) => c.name === PORTAL_COOKIE);
    expect(portalCookie).toBeTruthy();
    expect(portalCookie!.path).toBe('/portal');
    expect(portalCookie!.httpOnly).toBe(true);
  });

  test('wrong code shows generic error and sets no cookie', async ({
    page,
  }) => {
    await page.goto('/portal/login');
    await page.getByTestId('portal-phone-input').fill(tenant!.phoneE164);
    await page.getByTestId('portal-phone-submit').click();
    await expect(page.getByTestId('portal-code-input')).toBeVisible({
      timeout: 10_000,
    });

    // Derive a code guaranteed wrong (never submit a blind guess that
    // could collide with the real one).
    const realCode = await fetchPortalOtpCode(page.request, tenant!.phoneE164);
    const wrongCode = realCode === '000000' ? '000001' : '000000';

    await page.getByTestId('portal-code-input').fill(wrongCode);
    await page.getByTestId('portal-code-submit').click();

    const error = page.getByTestId('portal-code-error');
    await expect(error).toBeVisible({ timeout: 10_000 });
    // Generic copy — must not distinguish wrong code / unknown phone /
    // expired.
    await expect(error).toContainText(/invalid|expired/i);

    expect(new URL(page.url()).pathname).toBe('/portal/login');
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === PORTAL_COOKIE)).toBeUndefined();
  });

  test('portal cookie never grants staff routes', async ({ page }) => {
    await signInPortal(page, tenant!.phoneE164);

    // The real cookie is path=/portal so the browser never sends it to
    // /today; also plant a path=/ copy to prove the staff middleware
    // branch ignores it even when presented.
    const cookies = await page.context().cookies();
    const portalCookie = cookies.find((c) => c.name === PORTAL_COOKIE);
    expect(portalCookie).toBeTruthy();
    const origin = new URL(page.url()).origin;
    await page.context().addCookies([
      {
        name: PORTAL_COOKIE,
        value: portalCookie!.value,
        // url alone yields path=/ (Playwright rejects url+path together)
        url: origin,
      },
    ]);

    await page.goto('/today');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('staff session never grants /portal', async ({ page }) => {
    let owner: SeededOwner | null = null;
    try {
      owner = await provisionGalaxyOwner();
      await signIn(page, { email: owner.email, password: owner.password });

      await page.goto('/portal');
      await page.waitForURL(/\/portal\/login/, { timeout: 15_000 });
      expect(new URL(page.url()).pathname).toBe('/portal/login');
      await expect(page.getByTestId('portal-login-page')).toBeVisible();
    } finally {
      await owner?.teardown().catch(() => {});
    }
  });
});
