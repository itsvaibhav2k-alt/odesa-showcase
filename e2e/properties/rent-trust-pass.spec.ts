/**
 * Rent + tenant trust-pass regression E2E.
 *
 * Guards the "no high-stakes CTA silently does nothing" invariants added in
 * the rent/tenant/inbox trust-actionability pass:
 *   - T1: tenant-detail thread actions are real links (assistant draft /
 *         focused unit ledger), never bare no-op buttons.
 *   - T3: /rent exposes a Record-payment path with explicit "no money moves"
 *         copy on outstanding rows.
 *   - T4: the inbox never leaks the literal `{tenantFirstName}` template.
 *   - T7: a surface showing "Escalated" never also says "before any escalation".
 *
 * Driven by the seeded Galaxy org (Jessica Kim is the escalated tenant).
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  JESSICA_TENANT_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

test.describe('rent + tenant trust pass', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  // T1 — tenant-detail thread actions are real links, not no-op buttons.
  test('tenant detail thread actions route to the assistant (not no-ops)', async ({
    page,
  }) => {
    await page.goto(`/tenants/${JESSICA_TENANT_ID}`);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    // An escalated tenant exposes "Draft reminder" / "Prepare escalation",
    // both wired to the read-only assistant desk — so at least one assistant
    // link must be present (a no-op <button> would have no href).
    const assistantLinks = page.locator('a[href*="/assistant"]');
    expect(await assistantLinks.count()).toBeGreaterThan(0);
  });

  // T7 — escalation copy is internally consistent.
  test('escalated tenant page does not say "before any escalation"', async ({
    page,
  }) => {
    await page.goto(`/tenants/${JESSICA_TENANT_ID}`);
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    if (body.includes('escalat')) {
      expect(body).not.toContain('before any escalation');
    }
  });

  // T3 — /rent exposes a Record-payment path with "no money" copy.
  test('rent outstanding rows expose a Record payment path with no-money copy', async ({
    page,
  }) => {
    await page.goto('/rent');
    await page.waitForLoadState('networkidle');

    const trigger = page.getByTestId('record-payment-trigger').first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(page.getByTestId('record-payment-modal')).toBeVisible();
    await expect(page.getByTestId('record-payment-nomoney-note')).toContainText(
      /no money is moved/i,
    );
  });

  // T4 — the inbox never renders the raw tenant-name template.
  test('inbox does not leak the {tenantFirstName} template', async ({ page }) => {
    await page.goto('/inbox');
    await page.waitForLoadState('networkidle');

    const body = await page.locator('body').innerText();
    expect(body).not.toContain('{tenantFirstName}');
  });
});
