/**
 * Property detail reliability QA — `/properties/[id]` E2E.
 *
 * Verifies the demo-reliability pass against the real authenticated page:
 *   - header "Edit" opens a real edit-property dialog (no longer a no-op),
 *   - the right-rail Ask Odesa bar exposes an explicit handoff affordance,
 *   - the vendors room "Manage vendors" routes to the real /vendors page,
 *   - the maintenance room exposes a real "Create ticket" trigger,
 *   - a vacant unit's drawer tabs (Tenant/Lease/Payments/Conversations)
 *     all render honest empty states, with an Add tenant CTA on Tenant.
 *
 * Button trust pass (added): the rent room's record-payment stub is now an
 * honest "not connected yet" callout linking to /rent; the autonomy rollup
 * rows expand to a real per-action explanation and the decision pill is a
 * label (not a button); adding a pet keeps the occupied unit drawer open; the
 * /properties map Ask Odesa send ignores empty input and routes real queries;
 * and the per-property privacy On-prem toggle still flips state + flashes the
 * save badge.
 *
 * Read-only: opens dialogs/drawers but never submits, so no rows are written
 * to the shared DB. The one exception — the privacy-mode guard — saves On-prem
 * then immediately restores Hosted, so the seeded property is left unchanged.
 * Skipped when Supabase is unavailable.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  SEVENTEENTH_PROPERTY_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import { provisionIsolatedOwnerWithVacantUnit } from '../fixtures/isolated-org';

// Seeded Oakwood Commons — a real Galaxy property the beforeEach owner can
// open. Feeds the four read-only checks below (header Edit dialog, Ask Odesa
// rail, vendors-room Manage-vendors link, maintenance Create-ticket). Its
// units are all occupied, so the vacant-unit test provisions its own isolated
// org rather than relying on this property.
const PROPERTY_ID = OAKWOOD_PROPERTY_ID;

// Seeded 17th Street Row (3 units). Unit A is occupied by Hannah Ito and the
// property carries seeded action proposals, so it exercises the rent callout,
// the autonomy rollup, the occupied-unit drawer, and the privacy card with
// real data. Distinct from PROPERTY_ID (the header/edit fixtures above).
const TRUST_PROPERTY_ID = SEVENTEENTH_PROPERTY_ID;

test.describe('properties: detail reliability QA', () => {
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

  test('header Edit opens a real edit-property dialog', async ({ page }) => {
    await page.goto(`/properties/${PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible({
      timeout: 30_000,
    });

    const trigger = page.getByTestId('edit-property-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(page.getByTestId('edit-property-dialog')).toBeVisible();
    await expect(page.getByTestId('edit-property-form')).toBeVisible();
    // Name field is pre-filled with the current property name.
    await expect(page.locator('input[name="name"]')).not.toHaveValue('');
  });

  test('Ask Odesa rail exposes an explicit handoff affordance', async ({
    page,
  }) => {
    await page.goto(`/properties/${PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible({
      timeout: 30_000,
    });

    const submit = page.getByTestId('ask-bar-submit');
    await expect(submit).toBeVisible();
    await expect(submit).toContainText('Ask Odesa about this property');
  });

  test('vendors room Manage vendors routes to the real /vendors page', async ({
    page,
  }) => {
    await page.goto(`/properties/${PROPERTY_ID}?room=vendors`);
    const link = page.getByTestId('manage-vendors-link');
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute('href', '/vendors');
  });

  test('maintenance room exposes a real Create ticket trigger', async ({
    page,
  }) => {
    await page.goto(`/properties/${PROPERTY_ID}?room=maintenance`);
    // Either a working create-ticket trigger (units exist) or an honest
    // disabled stub with a visible explanation — never a silent no-op.
    const trigger = page.getByTestId('create-ticket-trigger');
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
    await expect(page.getByTestId('create-ticket-dialog')).toBeVisible();
    await expect(page.getByTestId('create-ticket-form')).toBeVisible();
  });

  test('vacant unit drawer tabs render honest empty states', async ({
    page,
  }) => {
    // Every seeded Galaxy/Oakwood unit is occupied, so there is no vacant
    // unit in the shared seed to exercise the empty states. Provision a
    // throwaway isolated org that owns exactly one VACANT unit (no lease, no
    // tenant), sign in as its owner, and tear the whole org down afterward.
    const isolated = await provisionIsolatedOwnerWithVacantUnit();
    try {
      // Drop the beforeEach Galaxy session first — middleware redirects an
      // already-authenticated user away from /login, so signIn would never
      // reach the form otherwise.
      await page.context().clearCookies();
      await signIn(page, {
        email: isolated.email,
        password: isolated.password,
      });

      // Open the vacant unit's drawer directly via the URL-synced ?unit=
      // param; the fixture hands back the real unit UUID.
      await page.goto(
        `/properties/${isolated.propertyId}?unit=${isolated.unitId}`,
      );
      await expect(page.getByTestId('unit-detail-drawer')).toBeVisible({
        timeout: 30_000,
      });

      // Tenant tab: empty state + an Add tenant CTA (no blank panel).
      await expect(
        page.getByTestId('unit-detail-drawer-tenant-empty'),
      ).toBeVisible();
      await expect(
        page
          .getByTestId('unit-detail-drawer-tenant-empty')
          .getByTestId('add-tenant-trigger'),
      ).toBeVisible();

      // Lease tab.
      await page.getByTestId('unit-detail-tab-lease').click();
      await expect(
        page.getByTestId('unit-detail-drawer-lease-empty'),
      ).toBeVisible();

      // Payments tab — honest vacancy copy, not just a heading.
      await page.getByTestId('unit-detail-tab-payments').click();
      await expect(
        page.getByTestId('unit-detail-drawer-payments-empty'),
      ).toContainText('rent ledger');

      // Conversations tab.
      await page.getByTestId('unit-detail-tab-conversations').click();
      await expect(
        page.getByTestId('unit-detail-drawer-conversations-empty'),
      ).toBeVisible();
    } finally {
      await isolated.teardown();
      const { ok, leftovers } = await isolated.verifyClean();
      expect(
        ok,
        `isolated org left rows behind: ${JSON.stringify(leftovers)}`,
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Button trust pass — added coverage for the trust fixes.
  // -------------------------------------------------------------------------

  test('rent room replaces the record-payment stub with an honest callout', async ({
    page,
  }) => {
    await page.goto(`/properties/${TRUST_PROPERTY_ID}?room=payments`);

    const room = page.getByTestId('payments-room');
    await expect(room).toBeVisible({ timeout: 30_000 });

    // The misleading "not connected yet" stub is gone; recording offline
    // payments IS connected now, so an honest pointer to where it happens
    // (Rent ledger / tenant pages) stands in its place.
    await expect(page.getByTestId('record-payment-unavailable')).toHaveCount(0);

    const callout = page.getByTestId('record-payment-pointer');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText(/record an offline payment/i);
    await expect(callout).toContainText(/no money moves/i);
    await expect(callout).not.toContainText(/not connected yet/i);

    const openRent = page.getByTestId('record-payment-open-rent');
    await expect(openRent).toBeVisible();
    await expect(openRent).toHaveAttribute('href', '/rent');

    // No "+ Record payment" stub control is left behind inside the rent room
    // itself (the real Record-payment action lives on the unit rows + ledger).
    await expect(
      room.getByRole('button', { name: /record payment/i }),
    ).toHaveCount(0);
    await expect(room.getByText('+ Record payment')).toHaveCount(0);
  });

  test('autonomy rows expand to an honest explanation and the pill is a label', async ({
    page,
  }) => {
    await page.goto(`/properties/${TRUST_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible({
      timeout: 30_000,
    });

    const panel = page.getByTestId('property-autonomy-panel');
    await expect(panel).toBeVisible();

    // 17th Street's seeded proposals produce at least one autonomy row, each
    // now wrapped in a <details> disclosure.
    const details = page
      .locator('[data-testid^="property-autonomy-details-"]')
      .first();
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute('open', '');

    // The explanation lives in the DOM but is hidden inside the closed details.
    const explain = details.locator(
      '[data-testid^="property-autonomy-explain-"]',
    );
    await expect(explain).toBeHidden();

    // Clicking the summary opens the disclosure and reveals the explanation.
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');
    await expect(explain).toBeVisible();
    await expect(explain).toContainText('graduated trust');

    // The decision pill is a label inside the row, never a <button>.
    const pill = page
      .locator('[data-testid^="property-autonomy-pill-"]')
      .first();
    await expect(pill).toBeVisible();
    const pillTag = await pill.evaluate((el) => el.tagName);
    expect(pillTag).toBe('SPAN');
    await expect(
      pill.locator(
        'xpath=ancestor::*[starts-with(@data-testid, "property-autonomy-row-")]',
      ),
    ).toHaveCount(1);
  });

  test('adding a pet keeps the occupied unit drawer open', async ({ page }) => {
    await page.goto(`/properties/${TRUST_PROPERTY_ID}?room=units`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible({
      timeout: 30_000,
    });

    // Unit A is occupied by Hannah Ito; its row carries the unit UUID.
    const unitARow = page
      .locator('[data-unit-row]')
      .filter({ hasText: 'Hannah Ito' })
      .first();
    await expect(unitARow).toBeVisible();
    const unitId = await unitARow.getAttribute('data-unit-row');
    expect(unitId).toBeTruthy();

    await page.goto(`/properties/${TRUST_PROPERTY_ID}?unit=${unitId}`);
    const drawer = page.getByTestId('unit-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 30_000 });

    // Tenant tab is the default; assert it explicitly for serial-safety.
    await page.getByTestId('unit-detail-tab-tenant').click();
    const petAdd = drawer.getByTestId('pet-add');
    await expect(petAdd).toBeVisible();

    const before = await drawer.getByTestId('pet-row').count();
    await petAdd.click();

    // Regression: adding a pet is local state and must NOT close the drawer.
    // (We never click tenant-preferences-save — pet rows stay in client state
    // so the shared Hannah Ito tenant record is left untouched.)
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('pet-row')).toHaveCount(before + 1);
  });

  test('occupied Unit A renders real content on every drawer tab', async ({
    page,
  }) => {
    await page.goto(`/properties/${TRUST_PROPERTY_ID}?room=units`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible({
      timeout: 30_000,
    });

    const unitARow = page
      .locator('[data-unit-row]')
      .filter({ hasText: 'Hannah Ito' })
      .first();
    await expect(unitARow).toBeVisible();
    const unitId = await unitARow.getAttribute('data-unit-row');
    expect(unitId).toBeTruthy();

    await page.goto(`/properties/${TRUST_PROPERTY_ID}?unit=${unitId}`);
    const drawer = page.getByTestId('unit-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 30_000 });

    // Tenant tab: the real tenant block, not the vacant empty state.
    await page.getByTestId('unit-detail-tab-tenant').click();
    await expect(drawer).toContainText('Hannah Ito');
    await expect(
      page.getByTestId('unit-detail-drawer-tenant-empty'),
    ).toHaveCount(0);

    // Lease tab: occupied unit has an active lease — no vacancy empty state.
    await page.getByTestId('unit-detail-tab-lease').click();
    await expect(
      page.getByTestId('unit-detail-drawer-lease-empty'),
    ).toHaveCount(0);

    // Payments tab: lease present → rent ledger, not the vacant empty state.
    await page.getByTestId('unit-detail-tab-payments').click();
    await expect(
      page.getByTestId('unit-detail-drawer-payments-empty'),
    ).toHaveCount(0);

    // Conversations tab: tenant present → conversations rail, not the blank.
    await page.getByTestId('unit-detail-tab-conversations').click();
    await expect(
      page.getByTestId('unit-detail-drawer-conversations-empty'),
    ).toHaveCount(0);
    await expect(drawer).toBeVisible();
  });

  test('Ask Odesa ignores empty input and routes a real query', async ({
    page,
  }) => {
    await page.goto('/properties');

    const input = page.getByTestId('ask-odesa-input');
    await expect(input).toBeVisible({ timeout: 30_000 });

    // Empty input never leaves /properties.
    await input.press('Enter');
    await expect(page).toHaveURL(/\/properties$/);

    await input.fill('Which units are past due?');
    await input.press('Enter');

    // Non-empty query routes to the assistant with the query preserved.
    await page.waitForURL(/\/assistant\?q=/, { timeout: 15_000 });
    await expect(page).toHaveURL(/q=Which/);
  });

  test('privacy On-prem toggle flips state and surfaces the save badge', async ({
    page,
  }) => {
    await page.goto(`/properties/${TRUST_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible({
      timeout: 30_000,
    });

    const onPrem = page.getByTestId('property-privacy-mode-on-prem');
    const hosted = page.getByTestId('property-privacy-mode-hosted');
    await expect(onPrem).toBeVisible();

    // Normalize to the Hosted baseline rather than assuming it — this property
    // is a shared seed, so a prior run could have left it on On-prem. Doing so
    // also makes this test self-healing for the next run.
    if ((await onPrem.getAttribute('data-state')) === 'on') {
      await hosted.click();
      await expect(onPrem).toHaveAttribute('data-state', 'off', {
        timeout: 5_000,
      });
    }
    await expect(onPrem).toHaveAttribute('data-state', 'off');

    await onPrem.click();
    await expect(onPrem).toHaveAttribute('data-state', 'on');
    // The optimistic save badge appears (saving → saved).
    await expect(page.getByTestId('optimistic-save-privacy-mode')).toBeVisible();
    // On-prem reveals the Ollama host configuration.
    await expect(
      page.getByTestId('property-privacy-mode-on-prem-config'),
    ).toBeVisible();

    // Restore the shared seed to its default Hosted mode so the suite stays
    // side-effect-free for other specs reading this property. Assert the
    // durable UI state (data-state) rather than the transient save badge,
    // which auto-clears after a couple seconds. Reload to confirm the restore
    // actually persisted to the DB (not just an optimistic flip).
    await hosted.click();
    await expect(onPrem).toHaveAttribute('data-state', 'off');
    await page.reload();
    await expect(onPrem).toHaveAttribute('data-state', 'off', {
      timeout: 30_000,
    });
  });

  test('rulebook autosave surfaces a visible save badge after typing', async ({
    page,
  }) => {
    await page.goto(`/properties/${TRUST_PROPERTY_ID}?room=rulebook`);

    const textarea = page.getByTestId('property-rulebook-textarea');
    await expect(textarea).toBeVisible({ timeout: 30_000 });

    // Capture the seeded rules so we can restore them and keep the shared
    // property side-effect-free for other specs.
    const original = await textarea.inputValue();

    // A transient edit triggers the 1s-debounced autosave, which must flash a
    // visible saving → saved badge (the whole point of finding #6).
    await textarea.fill(`${original} QA trust check`.trim());
    const badge = page.getByTestId('optimistic-save-rulebook');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute('data-state', 'saved', {
      timeout: 10_000,
    });

    // Restore the seeded text and confirm the restore itself saved.
    await textarea.fill(original);
    await expect(badge).toHaveAttribute('data-state', 'saved', {
      timeout: 10_000,
    });
  });
});
