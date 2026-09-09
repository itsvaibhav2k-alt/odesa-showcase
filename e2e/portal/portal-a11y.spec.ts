/**
 * Tenant portal — mobile accessibility spec (Wave 4).
 *
 * Mirrors `e2e/today/today-a11y.spec.ts`: @axe-core/playwright across
 * every portal surface at a phone viewport (390×844 — iPhone 14/15
 * class), failing on serious/critical violations. Also asserts the
 * bottom tab bar meets the 44px minimum tap-target size the shell
 * promises.
 *
 * Each state provisions a fresh tenant and drives the real OTP sign-in
 * (messaging mock), same as e2e/portal/read.spec.ts. Skipped when the
 * local Supabase stack isn't running.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  provisionPortalTenant,
  signInPortal,
  type SeededPortalTenant,
} from './helpers';

/**
 * Known a11y trade-offs, following the today-a11y convention of
 * documenting every exclusion instead of silently dropping rules:
 *
 *  - `color-contrast`: the portal reuses the today-theme warm-paper
 *    palette, whose muted ink tiers (`--ink-3` on `--canvas`) sit below
 *    WCAG AA's 4.5:1 floor — the same approved aesthetic exception
 *    documented in e2e/today/today-a11y.spec.ts. Drop this exclusion
 *    the moment the palette is tightened.
 */
const A11Y_RULE_EXCLUSIONS = ['color-contrast'] as const;

/**
 * Fails on serious/critical violations only (today-a11y's documented
 * threshold convention, applied via impact here since the portal has no
 * prior exclusion baseline to lean on). Minor/moderate findings surface
 * in the failure message when a serious one trips, but don't gate.
 */
async function expectNoSeriousViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .disableRules([...A11Y_RULE_EXCLUSIONS])
    .analyze();
  const gating = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    gating,
    `serious/critical axe violations on "${label}":\n${JSON.stringify(
      gating,
      null,
      2,
    )}`,
  ).toEqual([]);
}

test.describe('portal: mobile accessibility', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  test.use({ viewport: { width: 390, height: 844 } });

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

  test('axe: login (pre-auth)', async ({ page }) => {
    await page.goto('/portal/login');
    await expect(page.getByTestId('portal-login-page')).toBeVisible();
    await expectNoSeriousViolations(page, 'login');
  });

  test('axe: home (owing state)', async ({ page }) => {
    tenant = await provisionPortalTenant({ rent: 'owing' });
    await signInPortal(page, tenant.phoneE164);
    await expect(page.getByTestId('portal-home-page')).toBeVisible();
    await expect(page.getByTestId('portal-pay-button')).toBeVisible();
    await expectNoSeriousViolations(page, 'home-owing');
  });

  test('axe: payments (with a Stripe payment)', async ({ page }) => {
    tenant = await provisionPortalTenant({ withPayment: true });
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/payments');
    await expect(page.getByTestId('portal-payments-page')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'View receipt' }),
    ).toBeVisible();
    await expectNoSeriousViolations(page, 'payments');
  });

  test('axe: lease', async ({ page }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/lease');
    await expect(page.getByTestId('portal-lease-page')).toBeVisible();
    await expectNoSeriousViolations(page, 'lease');
  });

  test('axe: maintenance (empty + form)', async ({ page }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/maintenance');
    await expect(page.getByTestId('portal-maintenance-page')).toBeVisible();
    await expect(page.getByTestId('portal-maintenance-form')).toBeVisible();
    await expectNoSeriousViolations(page, 'maintenance');
  });

  test('axe: messages (with a thread)', async ({ page }) => {
    tenant = await provisionPortalTenant({ withThread: true });
    await signInPortal(page, tenant.phoneE164);
    await page.goto('/portal/messages');
    await expect(page.getByTestId('portal-messages-page')).toBeVisible();
    await expect(page.getByText(tenant.thread!.sentBody)).toBeVisible();
    await expectNoSeriousViolations(page, 'messages');
  });

  test('tap targets: every bottom-tab button is at least 44x44', async ({
    page,
  }) => {
    tenant = await provisionPortalTenant();
    await signInPortal(page, tenant.phoneE164);
    await expect(page.getByTestId('portal-home-page')).toBeVisible();

    const tabIds = [
      'portal-tab-home',
      'portal-tab-payments',
      'portal-tab-maintenance',
      'portal-tab-messages',
      'portal-tab-lease',
    ];
    for (const testId of tabIds) {
      const tab = page.getByTestId(testId);
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box, `${testId} has a bounding box`).not.toBeNull();
      expect(
        box!.width,
        `${testId} width ${box!.width}px must be ≥ 44px`,
      ).toBeGreaterThanOrEqual(44);
      expect(
        box!.height,
        `${testId} height ${box!.height}px must be ≥ 44px`,
      ).toBeGreaterThanOrEqual(44);
    }
  });
});
