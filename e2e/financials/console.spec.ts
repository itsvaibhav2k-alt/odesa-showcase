/**
 * Financials console — `/financials` E2E.
 *
 * Asserts (against the page's TESTID contract + the Galaxy seed):
 *   - shell + financial-command-center render
 *   - hero shows collected < billed and "2 tenants late"
 *     (Hannah Ito late_3 + Jessica Kim escalated, both unpaid this cycle)
 *   - 4 KPI cards render (Billed / Collected / Outstanding / Late)
 *   - Outstanding card drills into /rent?filter=outstanding pre-filtered
 *   - trend renders month columns (seed has 3 months of rent_events) and
 *     clicking the prior month lands on /rent?cycle= with that period label
 *   - ?period=last chip navigates and the hero shows the prior-month label
 *     at 100% collection (prior cycles are fully paid in the seed)
 *   - trend chart chrome: y ticks, per-month rate badges, and a $ gap figure
 *   - flagship collection-pace panel renders with a /rent?cycle= month link,
 *     the rent-coverage ring (n/m center count), and the operator summary
 *   - property performance board plots >=2 property marks (UUID hrefs),
 *     names 17th Street, and trays Winchester as unbilled
 *   - aging row shows the two late tenants across the late buckets
 *   - spend panel shows the honest "not connected" copy
 *   - no console errors during load
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  createAdmin,
  GALAXY_ORG_ID,
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../properties/helpers';

// The unbilled-tray fixture. The committed Galaxy seed bills every property
// every cycle (and never contained a "Winchester"), so this spec seeds its
// own unbilled property — a property with a unit but NO leases/rent_events
// keeps collectionRatePct null (src/lib/financials/queries.ts) and lands in
// the property-board-unbilled tray. Seeded in beforeAll, removed in afterAll.
const UNBILLED_PROPERTY_ID = '33333333-3333-3333-3333-3333333333ff';
const UNBILLED_UNIT_ID = '44444444-4444-4444-4444-4444444444ff';

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Prior calendar month as { year, month0 } (month0 is 0-indexed). */
function priorMonthParts(now: Date = new Date()): { year: number; month0: number } {
  const index = now.getFullYear() * 12 + now.getMonth() - 1;
  return { year: Math.floor(index / 12), month0: ((index % 12) + 12) % 12 };
}

/** Prior month as the 'YYYY-MM' shape trend drilldown links use. */
function priorCycleParam(now: Date = new Date()): string {
  const { year, month0 } = priorMonthParts(now);
  return `${year}-${String(month0 + 1).padStart(2, '0')}`;
}

function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('financials: /financials console', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeAll(async () => {
    if (!HAVE_SUPABASE) return;
    const admin = createAdmin();
    const { error: propErr } = await admin.from('properties').insert({
      id: UNBILLED_PROPERTY_ID,
      organization_id: GALAXY_ORG_ID,
      name: 'Winchester',
      address_street: '9 Winchester Way',
      address_city: 'Reston',
      address_state: 'VA',
      address_zip: '20190',
      timezone: 'America/New_York',
    });
    expect(propErr).toBeNull();
    const { error: unitErr } = await admin.from('units').insert({
      id: UNBILLED_UNIT_ID,
      organization_id: GALAXY_ORG_ID,
      property_id: UNBILLED_PROPERTY_ID,
      label: '1',
      bedrooms: 2,
      bathrooms: 1.0,
      square_feet: 800,
    });
    expect(unitErr).toBeNull();
    // Intentionally NO leases / NO rent_events → unbilled.
  });

  test.afterAll(async () => {
    if (!HAVE_SUPABASE) return;
    const admin = createAdmin();
    await admin.from('units').delete().eq('id', UNBILLED_UNIT_ID);
    await admin.from('properties').delete().eq('id', UNBILLED_PROPERTY_ID);
  });

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('page shell and command center render', async ({ page }) => {
    await page.goto('/financials');

    const shell = page.getByTestId('list-page-shell');
    await expect(shell).toBeVisible();
    await expect(
      shell.getByRole('heading', { level: 1, name: /Financial command center/ }),
    ).toBeVisible();
    // The body streams behind the Suspense boundary — on a cold server the
    // first render can exceed the default expect budget (same idiom as the
    // period-chip test's streamed-content gate).
    await expect(page.getByTestId('financial-command-center')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('collection-hero')).toBeVisible();

    // Flagship pace panel with a month drilldown into the rent ledger.
    const pace = page.getByTestId('collection-pace');
    await expect(pace).toBeVisible();
    await expect(
      pace.locator('a[href*="/rent?cycle="]').first(),
    ).toHaveAttribute('href', /\/rent\?cycle=\d{4}-\d{2}/);

    // Portfolio status ring: center count reads "n/m".
    const ring = page.getByTestId('rent-coverage-ring');
    await expect(ring).toBeVisible();
    await expect(ring).toContainText(/\d+\/\d+/);

    // Operator summary carries the recommended move.
    const summary = page.getByTestId('operator-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Recommended');
  });

  test('hero shows collected < billed and the seeded late count', async ({ page }) => {
    await page.goto('/financials');

    // Figure reads "$X collected of $Y billed" — Hannah + Jessica are
    // unpaid this cycle, so collected must be strictly below billed.
    const figureText = (
      await page.getByTestId('collection-hero-figure').innerText()
    ).trim();
    const match = /^\$([\d,]+) collected of \$([\d,]+) billed$/.exec(figureText);
    expect(match, `unexpected hero figure: "${figureText}"`).not.toBeNull();
    const collected = Number(match![1].replaceAll(',', ''));
    const billed = Number(match![2].replaceAll(',', ''));
    expect(collected).toBeGreaterThan(0);
    expect(collected).toBeLessThan(billed);

    // Hannah Ito (late_3) + Jessica Kim (escalated) = 2 late tenants.
    await expect(page.getByTestId('collection-hero-late-count')).toHaveText(
      '2 tenants late',
    );
  });

  test('renders the four KPI cards', async ({ page }) => {
    await page.goto('/financials');

    await expect(page.getByTestId('metric-billed')).toBeVisible();
    await expect(page.getByTestId('metric-collected')).toBeVisible();
    await expect(page.getByTestId('metric-outstanding')).toBeVisible();
    await expect(page.getByTestId('metric-late-exposure')).toBeVisible();
  });

  test('Outstanding card drills into the pre-filtered rent ledger', async ({ page }) => {
    await page.goto('/financials');

    const link = page.getByTestId('metric-outstanding').locator('a.metric-card-link');
    await expect(link).toHaveAttribute('href', '/rent?filter=outstanding');
    await link.click();

    await page.waitForURL(/\/rent\?filter=outstanding/, { timeout: 10_000 });

    // The Outstanding facet arrives pre-selected and shows the two unpaid
    // seeded rows (not the empty state).
    await expect(page.getByTestId('filter-btn-outstanding')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('rent-row').first()).toBeVisible();
    await expect(page.getByTestId('rent-empty')).toHaveCount(0);
  });

  test('trend renders month columns and prior month drills into that cycle', async ({ page }) => {
    await page.goto('/financials');

    await expect(page.getByTestId('collection-trend')).toBeVisible();
    // Seed carries 3 months of rent_events — at least prior + current.
    const months = page.getByTestId('collection-trend-month');
    expect(await months.count()).toBeGreaterThanOrEqual(2);

    // Chart chrome: y-axis ticks, the rate badge rail, and the honest gap figure.
    expect(await page.getByTestId('collection-trend-ytick').count()).toBeGreaterThanOrEqual(2);
    // Rate badges under the month labels (seed's current month renders 74.7%).
    const rate = page.getByTestId('collection-trend-rate');
    await expect(rate.first()).toBeVisible();
    await expect(rate.first()).toContainText(/\d+(\.\d+)?%/);
    const gap = page.getByTestId('collection-trend-gap');
    await expect(gap).toBeVisible();
    // Hannah Ito (late_3) + Jessica Kim (escalated) leave current-month
    // outstanding, so the gap always carries a dollar figure labelled open.
    await expect(gap).toContainText('$');
    await expect(gap).toContainText('open');

    const cycleParam = priorCycleParam();
    const priorLink = page
      .getByTestId('collection-trend')
      .locator(`a[href="/rent?cycle=${cycleParam}"]`);
    await expect(priorLink).toBeVisible();
    await priorLink.click();

    await page.waitForURL(/\/rent\?cycle=/, { timeout: 10_000 });
    expect(page.url()).toContain(`/rent?cycle=${cycleParam}`);

    // The ledger heading carries the prior month's short label.
    const { month0 } = priorMonthParts();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: new RegExp(`Rent · ${MONTH_SHORT[month0]}`),
      }),
    ).toBeVisible();
  });

  test('Last month chip shows the prior period at full collection', async ({ page }) => {
    await page.goto('/financials');
    // Gate on streamed content: during the loading skeleton the real chips
    // exist 0×0 inside React's hidden streaming container — clicking then
    // dispatches into a node the swap replaces, and the nav never happens.
    await expect(page.getByTestId('collection-hero')).toBeVisible();

    await page.getByTestId('period-chip-last').click();
    // Same-segment searchParams nav re-renders the force-dynamic page against
    // cloud Supabase with no loading boundary — allow the full nav budget.
    await page.waitForURL(/\/financials\?period=last/, { timeout: 30_000 });

    await expect(page.getByTestId('period-chip-last')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Hero eyebrow carries the prior month's full label…
    const { year, month0 } = priorMonthParts();
    await expect(page.getByTestId('collection-hero')).toContainText(
      `${MONTH_FULL[month0]} ${year}`,
    );
    // …and every prior-month cycle is fully paid in the seed.
    await expect(page.getByTestId('collection-hero-rate')).toContainText('100%');
  });

  test('property performance board renders with plotted and unbilled marks', async ({ page }) => {
    await page.goto('/financials');
    // Gate on streamed content (same idiom as the period-chip test).
    await expect(page.getByTestId('collection-hero')).toBeVisible();

    await expect(page.getByTestId('property-performance-board')).toBeVisible();

    // Galaxy seeds multiple billed properties → at least 2 plotted marks.
    const marks = page.locator('[data-testid^="property-mark-"]');
    expect(await marks.count()).toBeGreaterThanOrEqual(2);

    // Each mark drills into its property detail page by UUID.
    await expect(marks.first()).toHaveAttribute(
      'href',
      /\/properties\/[0-9a-f-]{36}/,
    );

    await expect(page.getByTestId('property-performance-board')).toContainText('17th Street');
    // Winchester (seeded by this spec's beforeAll) has no billing → unbilled tray.
    await expect(page.getByTestId('property-board-unbilled')).toContainText('Winchester');
  });

  test('aging row buckets the two late tenants', async ({ page }) => {
    await page.goto('/financials');

    await expect(page.getByTestId('aging-row')).toBeVisible();

    // Hannah (late_3 floor 3d) + Jessica (escalated floor 7d) land in the
    // late buckets — exactly where depends on today's date, so assert the
    // distinct-tenant total across all three late buckets instead.
    let lateTenants = 0;
    for (const id of ['aging-bucket-d1_7', 'aging-bucket-d8_30', 'aging-bucket-d31_plus']) {
      const text = await page.getByTestId(id).innerText();
      const match = /(\d+) tenants?/.exec(text);
      lateTenants += match ? Number(match[1]) : 0;
    }
    expect(lateTenants).toBe(2);
  });

  test('spend panel shows the honest not-connected copy', async ({ page }) => {
    await page.goto('/financials');

    const panel = page.getByTestId('spend-pressure-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Operating result unavailable');
    await expect(panel).toContainText('Expense imports');
    await expect(panel).toContainText('Schedule E');
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/financials');
    await expect(page.getByTestId('financial-command-center')).toBeVisible();
    await expect(page.getByTestId('collection-trend')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
