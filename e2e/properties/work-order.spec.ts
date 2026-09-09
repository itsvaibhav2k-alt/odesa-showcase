/**
 * Work order detail — `/work-orders/[woId]` E2E.
 *
 * Re-authored (Wave 0) against the REAL page + the real `getWorkOrderDetail`
 * query, driven by the canonical Galaxy seed (see e2e/fixtures/manifest.ts and
 * supabase/seed.sql). The page is a force-dynamic server component that renders
 * 100% from live Supabase rows scoped by RLS.
 *
 * Primary fixture: WO_OPEN_EMERGENCY_ID — the open emergency plumbing ticket
 * (water heater burst) at Oakwood Commons Unit 101, tenant Marcus Alvarez,
 * UNASSIGNED (no vendor). A few tests navigate to WO_COMPLETED_FAUCET_ID (all
 * steps done, logged cost) or WO_ASSIGNED_HVAC_ID (assigned to Capital HVAC)
 * to cover the vendor card + other lifecycle states.
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  WO_OPEN_EMERGENCY_ID,
  WO_ASSIGNED_HVAC_ID,
  WO_COMPLETED_FAUCET_ID,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  CAPITAL_HVAC_VENDOR_ID,
} from '../fixtures/manifest';
import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

/** The seeded description on WO_OPEN_EMERGENCY_ID (mirror of seed.sql). */
const OPEN_WO_DESCRIPTION =
  'Water heater burst in utility closet — standing water on floor.';

/**
 * Benign Next.js / dev-overlay console noise that must not fail the
 * zero-console-errors assertion.
 */
function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('work order detail: open emergency WO at /work-orders/[woId]', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto(`/work-orders/${WO_OPEN_EMERGENCY_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  // ---------------------------------------------------------------------------
  // Breadcrumb
  // ---------------------------------------------------------------------------

  test('breadcrumb renders Portfolio / Properties / Oakwood Commons / Unit 101', async ({
    page,
  }) => {
    const bar = page.getByRole('navigation', { name: 'Breadcrumb' });

    // "Properties" crumb links to /properties.
    const propertiesLink = bar.getByRole('link', { name: 'Properties' });
    await expect(propertiesLink).toHaveAttribute('href', '/properties');

    // Property crumb links to the real property detail route.
    const propLink = bar.getByRole('link', { name: 'Oakwood Commons' });
    await expect(propLink).toHaveAttribute(
      'href',
      `/properties/${OAKWOOD_PROPERTY_ID}`,
    );

    // Unit crumb links to the real unit detail route.
    const unitLink = bar.getByRole('link', { name: '101' });
    await expect(unitLink).toHaveAttribute(
      'href',
      `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Title block
  // ---------------------------------------------------------------------------

  test('title shows "Plumbing work order"', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /Plumbing work order/ }),
    ).toBeVisible();
  });

  test('status badge shows "Open"', async ({ page }) => {
    // The badge is the only sibling of the <h1> in the title row; scope to that
    // row so the "Open" also carried by the stepper + metrics doesn't collide.
    const titleRow = page
      .getByRole('heading', { name: /Plumbing work order/ })
      .locator('xpath=..');
    await expect(titleRow.getByText('Open', { exact: true })).toBeVisible();
  });

  test('eyebrow reads "Maintenance ticket"', async ({ page }) => {
    await expect(
      page.getByText('Maintenance ticket', { exact: true }),
    ).toBeVisible();
  });

  test('title meta shows Oakwood Commons, unit 101, and an opened-ago label', async ({
    page,
  }) => {
    // Scope to the title block (grandparent of the <h1>) so these tokens are
    // asserted against the meta line, not the breadcrumb.
    const titleBlock = page
      .getByRole('heading', { name: /Plumbing work order/ })
      .locator('xpath=../..');
    await expect(titleBlock.getByText('Oakwood Commons')).toBeVisible();
    await expect(titleBlock.getByText('101')).toBeVisible();
    await expect(titleBlock.getByText(/opened/i)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Status stepper
  // ---------------------------------------------------------------------------

  test('status stepper shows Open as the current step', async ({ page }) => {
    // StatusStepper renders role="img" with the current status in its name.
    const stepper = page.getByRole('img', { name: 'Status: Open' });
    await expect(stepper).toBeVisible();

    // The four real lifecycle labels all render inside the stepper.
    for (const step of ['Open', 'Assigned', 'In progress', 'Completed']) {
      await expect(stepper.getByText(step, { exact: true })).toBeVisible();
    }
  });

  test('a completed work order marks every stepper step done', async ({ page }) => {
    await page.goto(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    const stepper = page.getByRole('img', { name: 'Status: Completed' });
    await expect(stepper).toBeVisible();
    for (const step of ['Open', 'Assigned', 'In progress', 'Completed']) {
      await expect(stepper.getByText(step, { exact: true })).toBeVisible();
    }
  });

  // ---------------------------------------------------------------------------
  // "What's happening" brief
  // ---------------------------------------------------------------------------

  test('"What\'s happening" section renders with the derived count', async ({
    page,
  }) => {
    // The AttentionBrief heading uses a curly apostrophe (U+2019).
    await expect(page.getByText('What’s happening', { exact: true })).toBeVisible();
    // Count is derived: `${urgency} · ${status}` => "emergency · open".
    await expect(page.getByText('emergency · open')).toBeVisible();
  });

  test('the attention brief row summarises the plumbing issue', async ({ page }) => {
    // The single derived brief row: kind "Plumbing issue" + the seeded detail.
    const row = page.locator('[data-brief-row]').first();
    await expect(row.getByText('Plumbing issue', { exact: true })).toBeVisible();
    await expect(row.getByText(/Water heater burst in utility closet/)).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Metrics strip
  // ---------------------------------------------------------------------------

  test('metrics strip renders its five cells', async ({ page }) => {
    const METRIC_LABELS = ['Priority', 'Status', 'Vendor', 'Category', 'Opened'];
    for (const label of METRIC_LABELS) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('metrics strip shows Urgent priority and an unassigned vendor', async ({
    page,
  }) => {
    // emergency urgency maps to the "urgent" priority indicator ("Urgent").
    await expect(page.getByText('Urgent').first()).toBeVisible();
    // No vendor is assigned on the open emergency WO.
    await expect(page.getByText('Unassigned').first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Work order timeline
  // ---------------------------------------------------------------------------

  test('timeline section renders with the "Work order log" sub', async ({ page }) => {
    await expect(page.getByText('Work order timeline', { exact: true })).toBeVisible();
    await expect(page.getByText('Work order log', { exact: true }).first()).toBeVisible();
  });

  test('the work-order timeline renders the seeded created event', async ({ page }) => {
    // WO_OPEN_EMERGENCY_ID has exactly one status_timeline entry: a "created"
    // event logged by retell:alex.
    const timeline = page.locator('[data-detail-timeline]');
    await expect(timeline).toBeVisible();

    const events = timeline.locator('[data-tl-event]');
    await expect(events).toHaveCount(1);
    await expect(events.first()).toContainText('retell:alex');
    await expect(events.first()).toContainText('Created');
  });

  test('the timeline renders its events in chronological order', async ({ page }) => {
    // The completed faucet WO carries three ordered entries: created, assigned,
    // completed (with the logged cost).
    await page.goto(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    const events = page.locator('[data-detail-timeline] [data-tl-event]');
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText('Created');
    await expect(events.nth(1)).toContainText('Assigned');
    await expect(events.nth(2)).toContainText('Completed');
    await expect(events.nth(2)).toContainText('$145.00');
  });

  // ---------------------------------------------------------------------------
  // Owner approval (derived from the work order log)
  // ---------------------------------------------------------------------------

  test('owner approval surfaces who logged the work order', async ({ page }) => {
    await expect(page.getByText('Owner approval', { exact: true })).toBeVisible();
    await expect(
      page.getByText('from the work order log', { exact: true }),
    ).toBeVisible();
    // The created entry's `by` becomes a "Logged by" approval cell.
    await expect(page.getByText('Logged by', { exact: true })).toBeVisible();
    await expect(page.getByText('retell:alex', { exact: true }).first()).toBeVisible();
  });

  test('a completed work order shows the logged cost as the approval amount', async ({
    page,
  }) => {
    await page.goto(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    await expect(page.getByText('Owner approval', { exact: true })).toBeVisible();
    // The completion event's cost_cents (14500) surfaces as an "Amount" cell.
    await expect(page.getByText('Amount', { exact: true })).toBeVisible();
    await expect(page.getByText('$145.00').first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Vendor card
  // ---------------------------------------------------------------------------

  test('the vendor section shows the assigned vendor and a View vendor link', async ({
    page,
  }) => {
    // The open emergency WO is unassigned; use the assigned HVAC WO to exercise
    // the real vendor CtxCard + its cross-link to the vendor detail route.
    await page.goto(`/work-orders/${WO_ASSIGNED_HVAC_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    await expect(page.getByText('Capital HVAC Services').first()).toBeVisible();
    await expect(
      page.getByText('HVAC vendor · +15715550302', { exact: true }),
    ).toBeVisible();

    const viewVendor = page.getByRole('link', { name: 'View vendor' });
    await expect(viewVendor).toHaveAttribute(
      'href',
      `/vendors/${CAPITAL_HVAC_VENDOR_ID}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Access · mitigation KV (derived from category + description)
  // ---------------------------------------------------------------------------

  test('access · mitigation section renders its derived rows', async ({ page }) => {
    await expect(page.getByText('Access · mitigation', { exact: true })).toBeVisible();
    // Derived KV keys: Category + Issue.
    await expect(page.getByText('Issue', { exact: true })).toBeVisible();
    await expect(page.getByText('Category', { exact: true }).first()).toBeVisible();
  });

  test('access · mitigation shows the plumbing category and the reported issue', async ({
    page,
  }) => {
    // Issue value is the seeded description; Category value is "Plumbing".
    await expect(page.getByText(OPEN_WO_DESCRIPTION).first()).toBeVisible();
    await expect(page.getByText('Plumbing', { exact: true }).first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Ask Odesa bar
  // ---------------------------------------------------------------------------

  test('clicking an ask chip hands off to the assistant with context', async ({
    page,
  }) => {
    const firstChip = page.getByTestId('ask-bar-chip').first();
    const chipText = (await firstChip.textContent())?.trim() ?? '';
    expect(chipText.length).toBeGreaterThan(0);

    await firstChip.click();

    // The chip performs an explicit handoff to the global assistant, carrying
    // the (contextualised) prompt in the query string.
    await page.waitForURL(/\/assistant\?q=/);
    const q = new URL(page.url()).searchParams.get('q') ?? '';
    expect(q).toContain(chipText);
  });

  test('ask input is visible and accepts text', async ({ page }) => {
    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();
    await input.click();
    await input.fill('Check the vendor status');
    await expect(input).toHaveValue('Check the vendor status');
  });

  // ---------------------------------------------------------------------------
  // Adjust section — priority (Wave 2) + guarded vendor lifecycle controls
  // ---------------------------------------------------------------------------

  test('keeps the Priority select and drops the free Status select', async ({ page }) => {
    // The urgency override stays on the Wave 2 path.
    await expect(page.getByTestId('wo-edit-priority')).toBeVisible();
    // The old free-form status <select> is gone — status now moves only through
    // the guarded lifecycle controls, never a raw dropdown.
    await expect(page.getByTestId('wo-edit-status')).toHaveCount(0);
  });

  test('an open unassigned WO shows the assign-vendor control and no vendor-reply buttons', async ({
    page,
  }) => {
    // Open + no vendor => assign (not reassign), no reply/start/complete yet.
    await expect(page.getByTestId('wo-assign-vendor-select')).toBeVisible();
    await expect(page.getByTestId('wo-assign-vendor')).toHaveText('Assign vendor');
    await expect(page.getByTestId('wo-record-accepted')).toHaveCount(0);
    await expect(page.getByTestId('wo-start-work')).toHaveCount(0);
    // Open work can still be cancelled.
    await expect(page.getByTestId('wo-cancel')).toBeVisible();
  });

  test('an assigned WO awaits an accepted reply before exposing start-work', async ({
    page,
  }) => {
    await page.goto(`/work-orders/${WO_ASSIGNED_HVAC_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    await expect(page.getByTestId('wo-record-accepted')).toBeVisible();
    await expect(page.getByTestId('wo-record-declined')).toBeVisible();
    await expect(page.getByTestId('wo-record-no-response')).toBeVisible();
    await expect(page.getByTestId('wo-start-work')).toHaveCount(0);
    // A vendor is already assigned, so the assign control reads "Reassign".
    await expect(page.getByTestId('wo-assign-vendor')).toHaveText('Reassign vendor');
    await expect(page.getByTestId('wo-cancel')).toBeVisible();
  });

  test('a completed unreviewed WO offers Approve result and Reopen, not vendor replies', async ({
    page,
  }) => {
    await page.goto(`/work-orders/${WO_COMPLETED_FAUCET_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();

    await expect(page.getByTestId('wo-approve')).toBeVisible();
    await expect(page.getByTestId('wo-reopen')).toBeVisible();
    // Completed work is past the vendor-reply and start-work stages.
    await expect(page.getByTestId('wo-record-accepted')).toHaveCount(0);
    await expect(page.getByTestId('wo-start-work')).toHaveCount(0);
    await expect(page.getByTestId('wo-assign-vendor')).toHaveCount(0);
    // And a completed WO can no longer be cancelled.
    await expect(page.getByTestId('wo-cancel')).toHaveCount(0);
  });

  // ---------------------------------------------------------------------------
  // No console errors
  // ---------------------------------------------------------------------------

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto(`/work-orders/${WO_OPEN_EMERGENCY_ID}`);
    await expect(page.getByTestId('work-order-page')).toBeVisible();
    // Let client islands settle so late errors are captured.
    await expect(page.getByTestId('ask-odesa-bar-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
