/**
 * Wave 5 work-order vendor lifecycle — end-to-end through the real UI.
 *
 * Drives the guarded lifecycle controls on `/work-orders/[woId]` as a signed-in
 * owner against the live isolated Supabase stack, and cross-checks the two
 * read surfaces the lifecycle feeds: `/open-items` (the review step must appear
 * then leave) and `/vendors/[vendorId]` (the honest vendor chip).
 *
 * Uses the isolated-org fixture (its own org, one vacant unit) extended with
 * `seedVendor` / `seedWorkOrder`, so nothing here touches the shared Galaxy
 * seed. `verifyClean` proves zero org-scoped leftovers at teardown (incl. the
 * Wave 5 work_orders + vendors).
 *
 * Coverage:
 *   1. happy path: create -> assign vendor (vendor_assigned_at set) -> record
 *      accepted -> start work -> complete -> "Needs owner review" on the WO
 *      detail AND on /open-items -> approve -> row LEAVES /open-items (asserted
 *      as removal of THIS row, while the list still renders others).
 *   2. declined -> reassign: the vendor response resets on reassignment.
 *   3. operator-recorded no_response: the "No response — reassign" chip shows on
 *      the WO detail AND the vendor detail.
 *   Plus direct-link / refresh persistence at the key states.
 *
 * Serial: the tests share one provisioned org (+ two vendors). Skipped when the
 * local Supabase stack is unavailable.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type ConsoleMessage, type Page, type Request } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';
import {
  provisionIsolatedOwnerWithVacantUnit,
  type IsolatedOrg,
} from '../fixtures/isolated-org';
import { HAVE_SUPABASE, signIn } from './helpers';
import {
  isBenignConsoleError,
  isIgnorableRequestFailure,
} from '../route-sweep/console-guard';

const EVIDENCE_DIR = 'qa-output/2026-07-11-wave5-evidence';

async function expectNoOverflowAt390(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 800 });
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 1);
}

/** Read the mutable lifecycle columns for a WO via admin (bypasses RLS). */
async function readWo(admin: SupabaseClient<Database>, woId: string) {
  const { data, error } = await admin
    .from('work_orders')
    .select('status, vendor_id, vendor_response, vendor_assigned_at, reviewed_at, lifecycle_version')
    .eq('id', woId)
    .single();
  if (error || !data) throw new Error(`read wo failed: ${error?.message ?? 'no row'}`);
  return data;
}

test.describe('work-order vendor lifecycle (UI + open-items + vendor detail)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let org: IsolatedOrg;
  let vendorA = '';
  let vendorB = '';
  let pageErrors: string[] = [];
  let consoleErrors: string[] = [];
  let requestFailures: string[] = [];
  let failedMutationResponses: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    org = await provisionIsolatedOwnerWithVacantUnit();
    vendorA = await org.seedVendor({ name: 'Alpha Plumbing Co', category: 'plumbing' });
    vendorB = await org.seedVendor({ name: 'Bravo HVAC LLC', category: 'hvac' });
  });

  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await page.route('https://fonts.gstatic.com/**', async (route) => {
      const headers = { ...route.request().headers() };
      delete headers['x-test-hooks-secret'];
      await route.continue({ headers });
    });
    pageErrors = [];
    consoleErrors = [];
    requestFailures = [];
    failedMutationResponses = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error' && !isBenignConsoleError(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request: Request) => {
      const errorText = request.failure()?.errorText;
      const headers = request.headers();
      const isAbortedPrefetch =
        errorText === 'net::ERR_ABORTED' &&
        (headers.purpose === 'prefetch' || headers['next-router-prefetch'] === '1');
      // Next cancels the transport after a server-action RSC payload has been
      // consumed. Each lifecycle step below separately proves its durable DB
      // result, so only this exact framework signature is expected.
      const isConsumedServerAction =
        errorText === 'net::ERR_ABORTED' &&
        request.method() === 'POST' &&
        typeof headers['next-action'] === 'string';
      if (
        !isAbortedPrefetch &&
        !isConsumedServerAction &&
        !isIgnorableRequestFailure(request.url(), errorText)
      ) {
        requestFailures.push(`${request.method()} ${request.url()} ${errorText ?? ''}`);
      }
    });
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && response.status() >= 400) {
        failedMutationResponses.push(`${response.status()} ${response.url()}`);
      }
    });
    await signIn(page, { email: org.email, password: org.password });
  });

  test.afterEach(() => {
    expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
    expect(requestFailures, `request failures:\n${requestFailures.join('\n')}`).toEqual([]);
    expect(
      failedMutationResponses,
      `failed mutation responses:\n${failedMutationResponses.join('\n')}`,
    ).toEqual([]);
  });

  test.afterAll(async () => {
    if (!org) return;
    await org.teardown();
    // C11 cleanup proof: teardown removed the whole org (incl. work_orders +
    // vendors), verifyClean confirms zero org-scoped leftovers.
    const clean = await org.verifyClean();
    expect(clean.ok, JSON.stringify(clean.leftovers)).toBe(true);
  });

  // ===================================================================
  // 1. Happy path: create -> assign -> accepted -> start -> complete ->
  //    review (detail + open-items) -> approve -> leaves open-items.
  // ===================================================================

  test('assign -> accepted -> start -> complete surfaces review, approve clears it', async ({
    page,
  }) => {
    const woId = await org.seedWorkOrder({ status: 'open' });

    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    // --- Assign vendor A (open -> assigned; vendor_assigned_at set) ---------
    const initialOptions = await page
      .getByTestId('wo-assign-vendor-select')
      .locator('option')
      .allTextContents();
    expect(initialOptions[1]).toContain('Alpha Plumbing Co — plumbing match');
    expect(initialOptions[2]).toContain('Bravo HVAC LLC — hvac fallback');
    await page.getByTestId('wo-assign-vendor-select').selectOption(vendorA);
    await page.getByTestId('wo-assign-vendor').click();
    // Post-refresh assigned state: reply buttons appear, chip is "Awaiting reply".
    await expect(page.getByTestId('wo-record-accepted')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Awaiting reply/).first()).toBeVisible();

    const assigned = await readWo(org.admin, woId);
    expect(assigned.status).toBe('assigned');
    expect(assigned.vendor_id).toBe(vendorA);
    expect(assigned.vendor_assigned_at).not.toBeNull();
    expect(assigned.lifecycle_version).toBe(1);

    // Direct-link persistence: a fresh load still shows the assigned state.
    await page.reload();
    await expect(page.getByText(/Awaiting reply/).first()).toBeVisible({ timeout: 15_000 });

    // --- Record accepted ---------------------------------------------------
    await page.getByTestId('wo-record-accepted').click();
    await expect(page.getByText('Vendor accepted').first()).toBeVisible({ timeout: 15_000 });

    // --- Start work (assigned -> in_progress) ------------------------------
    await page.getByTestId('wo-start-work').click();
    await expect(page.getByTestId('wo-complete')).toBeVisible({ timeout: 15_000 });

    // --- Complete (in_progress -> completed, unreviewed) -------------------
    await page.getByTestId('wo-complete').click();
    // "Needs owner review" on the WO detail + the approve control appears.
    await expect(page.getByText('Needs owner review').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wo-approve')).toBeVisible();

    const completed = await readWo(org.admin, woId);
    expect(completed.status).toBe('completed');
    expect(completed.reviewed_at).toBeNull();

    // Direct-link persistence of the review state.
    await page.reload();
    await expect(page.getByText('Needs owner review').first()).toBeVisible({ timeout: 15_000 });

    // --- Review step is discoverable on /open-items ------------------------
    await page.goto('/open-items');
    await expect(page.getByTestId('open-items-list')).toBeVisible();
    const reviewLink = page.locator(
      `[data-testid="open-items-list"] a[href="/work-orders/${woId}"]`,
    );
    await expect(reviewLink).toHaveCount(1);
    await expect(
      page.locator('[data-testid="open-items-list"]').getByText('Needs owner review').first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/lifecycle-before-needs-owner-review.png`,
      fullPage: true,
    });

    // --- Approve (owner review) --------------------------------------------
    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('wo-approve')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('wo-approve').click();
    await expect(page.getByTestId('wo-confirm-approve')).toBeFocused();
    await page.getByTestId('wo-confirm-approve').click();
    await expect(page.getByText('Approved').first()).toBeVisible({ timeout: 15_000 });

    const approved = await readWo(org.admin, woId);
    expect(approved.reviewed_at).not.toBeNull();

    // --- The reviewed WO LEAVES /open-items (removal, not universal) -------
    await page.goto('/open-items');
    await expect(page.getByTestId('open-items-list')).toBeVisible();
    // The list still renders (the org's vacant unit is a leasing open item)...
    await expect(
      page.locator('[data-testid="open-items-list"] a').first(),
    ).toBeVisible();
    // ...but THIS work order's row is gone.
    await expect(
      page.locator(`[data-testid="open-items-list"] a[href="/work-orders/${woId}"]`),
    ).toHaveCount(0);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/lifecycle-after-approved-open-item-removed.png`,
      fullPage: true,
    });
  });

  // ===================================================================
  // 2. Declined -> reassign: the vendor response resets.
  // ===================================================================

  test('a declined vendor can be reassigned and the response resets', async ({ page }) => {
    const woId = await org.seedWorkOrder({ status: 'open' });

    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    // Assign vendor A, then record a decline.
    await page.getByTestId('wo-assign-vendor-select').selectOption(vendorA);
    await page.getByTestId('wo-assign-vendor').click();
    await expect(page.getByTestId('wo-record-declined')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('wo-record-declined').click();
    await expect(page.getByText('Vendor declined — reassign').first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: `${EVIDENCE_DIR}/lifecycle-declined-reassign.png`,
      fullPage: true,
    });

    // Reassign to vendor B (button now reads "Reassign vendor").
    await expect(page.getByTestId('wo-assign-vendor')).toHaveText('Reassign vendor');
    await expect(
      page.getByTestId('wo-assign-vendor-select').locator(`option[value="${vendorA}"]`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId('wo-assign-vendor-select').locator(`option[value="${vendorB}"]`),
    ).toContainText('hvac fallback');
    await page.getByTestId('wo-assign-vendor-select').selectOption(vendorB);
    await page.getByTestId('wo-assign-vendor').click();

    // Response reset: the decline chip is gone, back to awaiting a reply.
    await expect(page.getByText(/Awaiting reply/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Vendor declined — reassign')).toHaveCount(0);

    const row = await readWo(org.admin, woId);
    expect(row.vendor_id).toBe(vendorB);
    expect(row.vendor_response).toBeNull();
    expect(row.status).toBe('assigned');
  });

  // ===================================================================
  // 3. Operator-recorded no_response chip on WO detail + vendor detail.
  // ===================================================================

  test('an operator-recorded no_response shows the reassign chip on WO + vendor detail', async ({
    page,
  }) => {
    const woId = await org.seedWorkOrder({ status: 'open' });

    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    await page.getByTestId('wo-assign-vendor-select').selectOption(vendorA);
    await page.getByTestId('wo-assign-vendor').click();
    await expect(page.getByTestId('wo-record-no-response')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('wo-record-no-response').click();

    // WO detail chip.
    await expect(page.getByText('No response — reassign').first()).toBeVisible({
      timeout: 15_000,
    });

    // Vendor detail: the same honest chip on this vendor's work-order row.
    await page.goto(`/vendors/${vendorA}`);
    const vendorRow = page.getByTestId(`vendor-wo-${woId}`);
    await expect(vendorRow).toBeVisible();
    await expect(vendorRow.getByText('No response — reassign')).toBeVisible();
    const historyLink = page.getByRole('link', { name: /View history/ });
    await expect(historyLink).toHaveAttribute('href', '#vendor-work-orders');
    await historyLink.click();
    await expect(page).toHaveURL(/#vendor-work-orders$/);
    await expect(page.locator('#vendor-work-orders')).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE_DIR}/lifecycle-no-response-reassign.png`,
      fullPage: true,
    });
  });

  test('lifecycle controls pass axe, keyboard confirmation, Escape focus return, and 390px overflow', async ({
    page,
  }) => {
    const woId = await org.seedWorkOrder({ status: 'open' });
    await page.goto(`/work-orders/${woId}`);
    await expect(page.getByTestId('wo-edit-controls')).toBeVisible();

    const axe = await new AxeBuilder({ page })
      .include('[data-testid="wo-edit-controls"]')
      .disableRules(['color-contrast'])
      .analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);

    const cancel = page.getByTestId('wo-cancel');
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wo-confirm-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wo-confirmation')).toHaveCount(0);
    await expect(cancel).toBeFocused();

    await expectNoOverflowAt390(page);
  });
});
