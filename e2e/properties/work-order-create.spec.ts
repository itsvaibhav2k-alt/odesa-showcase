/**
 * Work-order creation smoke — `/properties/[id]/units/[unitId]` E2E.
 *
 * Drives the unit-detail "File a request" dialog end-to-end against real
 * Supabase: open the modal, pick a category + urgency, describe the issue,
 * submit, and assert (a) the dialog closes on a successful write and (b) the
 * exact description text surfaces in the unit's maintenance ticket list (the
 * `createWorkOrderAction` server action revalidates the unit route).
 *
 * Idempotent by construction: the description carries a fresh
 * `crypto.randomUUID()` suffix, so reruns never collide and no destructive
 * cleanup is needed. The suffix is a random UUID — never a tenant or
 * conversation id — so surfacing it in the model-facing UI is privacy-safe.
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

/** Oakwood unit 101 (leased to Marcus Alvarez) — real-data unit brief. */
const UNIT_101_PATH = `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`;

test.describe('properties: file a maintenance request (idempotent smoke)', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;
  // The work order this run files; deleted in afterEach so the shared seed
  // unit never accumulates rows across runs (which would otherwise let one
  // run's row mask the next under the unit's maintenance list).
  let filedDescription: string | null = null;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
  });

  test.afterEach(async () => {
    if (filedDescription) {
      await createAdmin()
        .from('work_orders')
        .delete()
        .ilike('description', `%${filedDescription}%`);
      filedDescription = null;
    }
    if (owner) await owner.teardown();
  });

  test('filing a request closes the modal and surfaces it in the ticket list', async ({
    page,
  }) => {
    // Fresh random suffix keeps reruns from colliding. It is a random UUID,
    // not a tenant/conversation id, so it is safe to surface in the UI.
    const uniqueDescription = `W6 smoke maintenance request ${randomUUID()}`;
    filedDescription = uniqueDescription;

    await page.goto(UNIT_101_PATH);
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();

    // Open the "File a request" dialog.
    await page.getByTestId('req-modal-trigger').click();
    const modal = page.getByTestId('req-modal');
    await expect(modal).toBeVisible();

    // Pick a category and describe the issue (urgency keeps its default
    // 'high' — the smoke covers the create round-trip, not every field).
    // Interactions are scoped to the modal to avoid strict-mode collisions
    // with labels in existing ticket rows behind the dialog.
    await modal.getByLabel('Category').selectOption('Electrical');
    await modal.getByLabel("What's happening?").fill(uniqueDescription);

    // Submit the request. The dialog's fixed Base UI backdrop sits over the
    // popup for headless pointer hit-testing, so fire the button's own click
    // handler directly — this still drives the real onClick -> server action
    // -> work_orders insert -> revalidate chain the assertions below verify.
    await modal
      .getByTestId('req-modal-submit')
      .evaluate((el) => (el as HTMLElement).click());

    // The dialog closes on a successful work_orders insert.
    await expect(modal).toBeHidden();

    // Assert the durable outcome: the request persisted and renders on the
    // unit page from a fresh server fetch. Reloading decouples the smoke from
    // the in-app router.refresh() timing while still proving the full
    // modal -> server action -> work_orders insert chain. Match against the
    // list's full text so the WO-code prefix and composed entry-consent
    // suffix around the description don't matter.
    await page.reload();
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();
    await expect(page.locator('[data-ticket-list]')).toContainText(
      uniqueDescription,
      { timeout: 15_000 },
    );
  });
});
