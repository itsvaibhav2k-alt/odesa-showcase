/**
 * Rent ledger — `/rent` E2E (real Supabase, current cycle).
 *
 * Re-authored against the live `/rent` page (src/app/(dashboard)/rent) and the
 * seeded Galaxy ledger. The current cycle bills the 10 seeded leases: 8 paid,
 * plus two outstanding rows — Hannah Ito (late) and Jessica Kim (escalated).
 * There is NO on-plan row in the current-cycle fixture, so the "On a plan"
 * facet is empty and the "Outstanding" facet is populated (the inverse of the
 * old mock, which had one on-plan "Maya R." row and zero outstanding).
 *
 * Counts are LIVE-derived (createAdmin → count current-cycle rent_events)
 * rather than hard-coded, mirroring e2e/operator/count-reconciliation.spec.ts,
 * so the assertions stay honest if a prior test records a payment.
 *
 * Asserts (against the page's TESTID contract):
 *   - shell / breadcrumb / active Rent tab render
 *   - title contains "Rent · {Mon}"
 *   - ledger renders one row per current-cycle rent_event (live count)
 *   - rows show real amounts, real tenant names, and status pill text
 *   - Marcus Alvarez's row links to his unit detail page (UUID route)
 *   - clicking that row NAVIGATES to the unit detail page
 *   - Paid facet narrows to the paid rows (live count) and hides outstanding
 *   - On a plan facet matches its live count (empty in the seed)
 *   - Outstanding facet shows the outstanding rows incl. Jessica Kim
 *   - no console errors during load
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  createAdmin,
  GALAXY_ORG_ID,
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  provisionGalaxyOwner,
  SEVENTEENTH_PROPERTY_ID,
  signIn,
  UNIT_101_ID,
  UNIT_C_ID,
  type SeededOwner,
} from './helpers';

/** Marcus Alvarez (Unit 101, Oakwood) — a stable paid row. */
const MARCUS_UNIT_HREF = `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`;

/** Jessica Kim (Unit C, 17th Street) — the escalated / outstanding row. */
const JESSICA_UNIT_HREF = `/properties/${SEVENTEENTH_PROPERTY_ID}/units/${UNIT_C_ID}`;

/**
 * First-of-this-month ISO date in LOCAL time — matches
 * `currentCycleMonthIso()` in src/lib/rent/queries.ts, so we count the same
 * cycle the page renders.
 */
function currentCycleMonthIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

interface FacetCounts {
  total: number;
  paid: number;
  outstanding: number;
  onPlan: number;
}

/**
 * Live facet counts for the current cycle, derived directly from raw
 * `rent_events` columns. The pill mapping is date-independent:
 *   balance <= 0                          → Paid
 *   balance > 0 && status = 'plan_agreed' → On a plan
 *   balance > 0 && otherwise              → Outstanding
 * (see toRentStatusPill/deriveRentCycleStatus), so counting from the columns
 * reproduces the page's facet split without replicating the date logic.
 */
async function countCurrentCycleFacets(): Promise<FacetCounts> {
  const admin = createAdmin();
  const { data, error } = await admin
    .from('rent_events')
    .select('amount_due, amount_paid, status')
    .eq('organization_id', GALAXY_ORG_ID)
    .eq('cycle_month', currentCycleMonthIso());

  if (error || !data) {
    throw new Error(
      `Failed to count rent_events: ${error?.message ?? 'no data'}`,
    );
  }

  let paid = 0;
  let outstanding = 0;
  let onPlan = 0;
  for (const r of data) {
    const balanceCents = Math.round(
      (Number(r.amount_due) - Number(r.amount_paid)) * 100,
    );
    if (balanceCents <= 0) paid += 1;
    else if (r.status === 'plan_agreed') onPlan += 1;
    else outstanding += 1;
  }

  return { total: data.length, paid, outstanding, onPlan };
}

function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('rent: /rent ledger', () => {
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

  test('page shell renders with Rent title', async ({ page }) => {
    await page.goto('/rent');

    const shell = page.getByTestId('list-page-shell');
    await expect(shell).toBeVisible();
    // Title block h1 should contain "Rent · May" (scoped to the heading so we
    // don't also match the breadcrumb / tab / sidebar "Rent" text).
    await expect(
      shell.getByRole('heading', { level: 1, name: /Rent · \w{3}/ }),
    ).toBeVisible();
  });

  test('breadcrumb shows Portfolio / Rent', async ({ page }) => {
    await page.goto('/rent');

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });

    // Portfolio crumb links to /properties
    const portfolioLink = breadcrumb.getByRole('link', { name: 'Portfolio' });
    await expect(portfolioLink).toBeVisible();
    await expect(portfolioLink).toHaveAttribute('href', '/properties');

    // Rent crumb is current — scoped to the breadcrumb to avoid matching the
    // sidebar nav item and the active tab (both also carry aria-current).
    const rentCurrent = breadcrumb.locator('[aria-current="page"]');
    await expect(rentCurrent).toContainText('Rent');
  });

  test('tab bar: Rent tab is active', async ({ page }) => {
    await page.goto('/rent');

    const tabs = page.getByTestId('list-page-tabs');
    await expect(tabs).toBeVisible();

    const rentTab = page.getByTestId('list-tab-rent');
    await expect(rentTab).toBeVisible();
    await expect(rentTab).toHaveAttribute('aria-current', 'page');
  });

  test('ledger renders one row per current-cycle rent event (All facet)', async ({ page }) => {
    const facets = await countCurrentCycleFacets();

    await page.goto('/rent');

    await expect(page.getByTestId('rent-ledger')).toBeVisible();

    const rows = page.getByTestId('rent-row');
    await expect(rows).toHaveCount(facets.total);
  });

  test('ledger rows show real amounts, tenant names, and status pill text', async ({ page }) => {
    await page.goto('/rent');

    const ledger = page.getByTestId('rent-ledger');

    // Real seeded rent amounts (Marcus Alvarez $1,450; Jessica Kim $2,950).
    await expect(ledger).toContainText('$1,450');
    await expect(ledger).toContainText('$2,950');

    // Real seeded tenant names.
    await expect(ledger).toContainText('Marcus Alvarez');
    await expect(ledger).toContainText('Jessica Kim');

    // Status pills are text (never color-only). Paid rows exist, and Jessica
    // Kim's current cycle is escalated. ("On plan" only ever appears in the
    // legend, which sits OUTSIDE the rent-ledger testid.)
    await expect(ledger).toContainText('Paid');
    await expect(ledger).toContainText('Escalated');
  });

  test('Marcus Alvarez row links to his unit detail page', async ({ page }) => {
    await page.goto('/rent');

    // The overlay <a> on Marcus's row targets his unit-detail (UUID) route.
    const marcusLink = page.locator(`a[href="${MARCUS_UNIT_HREF}"]`).first();

    await expect(marcusLink).toBeVisible();
    await expect(marcusLink).toHaveAttribute('href', MARCUS_UNIT_HREF);
  });

  test('clicking a row navigates to unit detail page', async ({ page }) => {
    await page.goto('/rent');

    // Click Marcus's overlay link (first link to his oak unit).
    const marcusLink = page.locator(`a[href="${MARCUS_UNIT_HREF}"]`).first();
    await expect(marcusLink).toBeVisible();
    await marcusLink.click();

    await page.waitForURL((url) => url.pathname === MARCUS_UNIT_HREF, {
      timeout: 10_000,
    });
    await expect(page.url()).toContain(MARCUS_UNIT_HREF);
  });

  test('Paid filter narrows to the paid rows and hides outstanding', async ({ page }) => {
    const facets = await countCurrentCycleFacets();

    await page.goto('/rent');

    const paidBtn = page.getByTestId('filter-btn-paid');
    await expect(paidBtn).toBeVisible();
    await paidBtn.click();
    await expect(paidBtn).toHaveAttribute('aria-pressed', 'true');

    // Only the paid rows remain (live count).
    const rows = page.getByTestId('rent-row');
    await expect(rows).toHaveCount(facets.paid);

    // Jessica Kim's escalated (outstanding) row is hidden under Paid.
    await expect(page.locator(`a[href="${JESSICA_UNIT_HREF}"]`)).toHaveCount(0);
  });

  test('On a plan filter matches its live count', async ({ page }) => {
    const facets = await countCurrentCycleFacets();

    await page.goto('/rent');

    const onPlanBtn = page.getByTestId('filter-btn-on-plan');
    await onPlanBtn.click();
    await expect(onPlanBtn).toHaveAttribute('aria-pressed', 'true');

    const rows = page.getByTestId('rent-row');
    await expect(rows).toHaveCount(facets.onPlan);

    // The current-cycle fixture seeds no payment plans, so the facet is empty
    // and the inline empty state shows.
    if (facets.onPlan === 0) {
      await expect(page.getByTestId('rent-empty')).toBeVisible();
    }
  });

  test('Outstanding filter shows the outstanding rows', async ({ page }) => {
    const facets = await countCurrentCycleFacets();

    await page.goto('/rent');

    const outstandingBtn = page.getByTestId('filter-btn-outstanding');
    await outstandingBtn.click();
    await expect(outstandingBtn).toHaveAttribute('aria-pressed', 'true');

    const rows = page.getByTestId('rent-row');
    await expect(rows).toHaveCount(facets.outstanding);

    // The seed has outstanding rows (Hannah late + Jessica escalated), so the
    // list is populated and Jessica Kim's escalated row is present.
    if (facets.outstanding > 0) {
      await expect(page.locator(`a[href="${JESSICA_UNIT_HREF}"]`)).toBeVisible();
      await expect(page.getByTestId('rent-ledger')).toContainText('Escalated');
    } else {
      await expect(page.getByTestId('rent-empty')).toBeVisible();
    }
  });

  test('ask odesa bar is visible and accepts input', async ({ page }) => {
    await page.goto('/rent');

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();
    await input.fill('show outstanding');
    await expect(input).toHaveValue('show outstanding');
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/rent');
    await expect(page.getByTestId('list-page-shell')).toBeVisible();
    await expect(page.getByTestId('rent-ledger')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
