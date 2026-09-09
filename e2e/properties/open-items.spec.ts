/**
 * /open-items — portfolio Open items list view E2E.
 *
 * The feed is now fully live: `listOpenItems()` unions four real Supabase
 * sources onto the mock's OpenItemKind enum —
 *   - maintenance ← open work_orders PLUS completed-but-unreviewed ones
 *   - rent        ← late/escalated rent_events (one row per lease)
 *   - owner       ← action_proposals pending review
 *   - leasing     ← vacant units (no active lease)
 * so every count and every row here is derived from the seed at test time via
 * an admin client (the count-reconciliation pattern), never hardcoded. Read
 * back mirrors `src/lib/open-items/queries.ts`.
 *
 * Asserts:
 *   - breadcrumb renders "Portfolio" -> "Open items"
 *   - page title "Open items" is visible (serif h1)
 *   - title meta line shows the live total / urgent / owner-decisions counts
 *   - the five filter facets carry the live per-kind counts
 *   - the list renders one <article> per live open item
 *   - real seeded rows carry the correct title + loc text
 *   - each facet filters to exactly its live count
 *   - a maintenance row's "View ticket" link drills into the real WO detail
 *   - a rent row's "Review plan" link points at the real tenant detail
 *   - no portfolio tab bar (open-items is standalone, not tabbed)
 *   - no console errors
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  GALAXY_ORG_ID,
  JESSICA_TENANT_ID,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import { WO_OPEN_EMERGENCY_ID } from '../fixtures/manifest';

// ---------------------------------------------------------------------------
// Live-derived expectations (mirror src/lib/open-items/queries.ts source
// builders). Each is a single-table read scoped to the Galaxy org so the
// numbers track the seed instead of being frozen into the spec.
// ---------------------------------------------------------------------------

const OPEN_WO_STATUSES: ('open' | 'assigned' | 'in_progress')[] = [
  'open',
  'assigned',
  'in_progress',
];
const LATE_RENT_STATUSES: ('late_1' | 'late_3' | 'late_7' | 'escalated')[] = [
  'late_1',
  'late_3',
  'late_7',
  'escalated',
];
/** urgencies that render "Emergency/Urgent priority" → counted as urgent. */
const URGENT_WO_URGENCIES = ['emergency', 'urgent'];
/** rent statuses that read as urgent ("Rent escalated" / "7 days late"). */
const URGENT_RENT_STATUSES = ['escalated', 'late_7'];

interface LiveCounts {
  total: number;
  maintenance: number;
  rent: number;
  owner: number;
  leasing: number;
  urgent: number;
}

async function liveCounts(): Promise<LiveCounts> {
  const admin = createAdmin();

  // maintenance ← open work orders PLUS completed-but-unreviewed ("Needs
  // owner review") rows, mirroring buildMaintenanceItems' `.or(...)` filter in
  // src/lib/open-items/queries.ts exactly. Completed-unreviewed rows render the
  // "Needs owner review" detail (never a "…priority" line), so they extend the
  // maintenance/total tally but never the urgent tally — which stays scoped to
  // the open work orders, matching the page's isUrgent() derivation.
  const { data: openWos } = await admin
    .from('work_orders')
    .select('id, urgency')
    .eq('organization_id', GALAXY_ORG_ID)
    .in('status', OPEN_WO_STATUSES);
  const { data: reviewWos } = await admin
    .from('work_orders')
    .select('id')
    .eq('organization_id', GALAXY_ORG_ID)
    .eq('status', 'completed')
    .is('reviewed_at', null);
  const maintenance = (openWos?.length ?? 0) + (reviewWos?.length ?? 0);
  const maintenanceUrgent = (openWos ?? []).filter((w) =>
    URGENT_WO_URGENCIES.includes(w.urgency ?? ''),
  ).length;

  // rent ← late/escalated rent events, de-duped to one per lease
  const { data: rentEvents } = await admin
    .from('rent_events')
    .select('lease_id, status')
    .eq('organization_id', GALAXY_ORG_ID)
    .in('status', LATE_RENT_STATUSES);
  const rent = new Set((rentEvents ?? []).map((e) => e.lease_id)).size;
  const rentUrgent = new Set(
    (rentEvents ?? [])
      .filter((e) => URGENT_RENT_STATUSES.includes(e.status))
      .map((e) => e.lease_id),
  ).size;

  // owner ← proposals pending a human gate
  const { data: proposals } = await admin
    .from('action_proposals')
    .select('id, status, gate_decision')
    .eq('organization_id', GALAXY_ORG_ID);
  const owner = (proposals ?? []).filter(
    (p) => p.status === 'proposed' || p.gate_decision === 'review',
  ).length;

  // leasing ← units with no active lease
  const { data: props } = await admin
    .from('properties')
    .select('id')
    .eq('organization_id', GALAXY_ORG_ID);
  const propIds = (props ?? []).map((p) => p.id);
  const { data: units } = await admin
    .from('units')
    .select('id')
    .in('property_id', propIds);
  const unitIds = (units ?? []).map((u) => u.id);
  const { data: activeLeases } = await admin
    .from('leases')
    .select('unit_id')
    .in('unit_id', unitIds)
    .eq('status', 'active');
  const leased = new Set((activeLeases ?? []).map((l) => l.unit_id));
  const leasing = unitIds.filter((id) => !leased.has(id)).length;

  return {
    total: maintenance + rent + owner + leasing,
    maintenance,
    rent,
    owner,
    leasing,
    urgent: maintenanceUrgent + rentUrgent,
  };
}

/** Facet id → display label; count comes from the live tally. */
const FACETS: Array<{ id: string; label: string; key: keyof LiveCounts }> = [
  { id: 'all', label: 'All', key: 'total' },
  { id: 'maintenance', label: 'Maintenance', key: 'maintenance' },
  { id: 'rent', label: 'Rent', key: 'rent' },
  { id: 'owner', label: 'Owner decisions', key: 'owner' },
  { id: 'leasing', label: 'Leasing', key: 'leasing' },
];

function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('open-items: portfolio Open items list view', () => {
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

  test('page renders with breadcrumb Portfolio -> Open items', async ({ page }) => {
    await page.goto('/open-items');

    await expect(page.getByTestId('open-items-page')).toBeVisible();

    // Breadcrumb navigation
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toBeVisible();

    const portfolioLink = breadcrumb.getByRole('link', { name: 'Portfolio' });
    await expect(portfolioLink).toBeVisible();
    await expect(portfolioLink).toHaveAttribute('href', '/properties');

    // "Open items" is the current page segment
    await expect(breadcrumb.getByText('Open items')).toBeVisible();
  });

  test('page title "Open items" renders as serif h1', async ({ page }) => {
    await page.goto('/open-items');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Open items' }),
    ).toBeVisible();
  });

  test('title meta line shows the live summary counts', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    // The meta line segments are rendered from header.summary. total /
    // urgent / owner-decisions are exact single-source tallies; the trailing
    // "N properties" segment spans all four sources, so it is asserted
    // structurally (a real positive count renders), not recomputed.
    const content = page.getByTestId('open-items-page');
    await expect(content).toContainText(`${counts.total} open`);
    await expect(content).toContainText(`${counts.urgent} urgent`);
    await expect(content).toContainText(`${counts.owner} owner decision`);
    await expect(content).toContainText(/[1-9]\d* propert(y|ies)/);
  });

  test('no portfolio tab bar (open-items is standalone)', async ({ page }) => {
    await page.goto('/open-items');

    // ListPageTabs is NOT rendered on open-items; only a breadcrumb
    await expect(page.getByTestId('list-page-tabs')).not.toBeAttached();
  });

  test('filter bar renders all five facets with live counts', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    const filterBar = page.getByTestId('filter-bar');
    await expect(filterBar).toBeVisible();

    for (const { id, label, key } of FACETS) {
      const btn = page.getByTestId(`filter-btn-${id}`);
      await expect(btn).toBeVisible();
      await expect(btn).toContainText(`${label} ${counts[key]}`);
    }

    // "All" is active by default
    await expect(page.getByTestId('filter-btn-all')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('open-items-list renders one article per live open item', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    const list = page.getByTestId('open-items-list');
    await expect(list).toBeVisible();

    // Seed always carries at least the Unit 101 emergency WO, so this is not
    // a trivial 0 == 0.
    expect(counts.total).toBeGreaterThan(0);
    await expect(list.locator('article')).toHaveCount(counts.total);
  });

  test('real seeded rows render with correct title and location text', async ({ page }) => {
    await page.goto('/open-items');

    const list = page.getByTestId('open-items-list');
    await expect(list).toBeVisible();

    // maintenance (open work orders) — category title + property·unit loc
    await expect(list).toContainText('Oakwood Commons · Unit 101'); // WO_OPEN_EMERGENCY
    await expect(list).toContainText('Oakwood Commons · Unit 201'); // assigned HVAC

    // rent (late/escalated) — Jessica escalated (Unit C), Hannah late (Unit A)
    await expect(list).toContainText('Rent escalated');
    await expect(list).toContainText('17th Street Row · Unit C');
    await expect(list).toContainText('Rent late');
    await expect(list).toContainText('17th Street Row · Unit A');

    // owner (pending proposals) — real action-type titles
    await expect(list).toContainText('Update rent');
    await expect(list).toContainText('Dispatch vendor');
  });

  test('Maintenance filter shows exactly the live maintenance count', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    await page.getByTestId('filter-btn-maintenance').click();
    await expect(page.getByTestId('filter-btn-maintenance')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const list = page.getByTestId('open-items-list');
    await expect(list.locator('article')).toHaveCount(counts.maintenance);

    // Real open work-order category titles.
    await expect(list).toContainText('Plumbing');
    await expect(list).toContainText('Hvac');
    await expect(list).toContainText('Appliances');
  });

  test('Rent filter shows exactly the live rent count', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    await page.getByTestId('filter-btn-rent').click();
    await expect(page.getByTestId('filter-btn-rent')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const list = page.getByTestId('open-items-list');
    await expect(list.locator('article')).toHaveCount(counts.rent);
    await expect(list).toContainText('Rent escalated');
    await expect(list).toContainText('Rent late');
  });

  test('Owner decisions filter shows exactly the live owner count', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    await page.getByTestId('filter-btn-owner').click();
    await expect(page.getByTestId('filter-btn-owner')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const list = page.getByTestId('open-items-list');
    await expect(list.locator('article')).toHaveCount(counts.owner);
    // Every owner row drills into the queue (seed carries 5 proposals).
    if (counts.owner > 0) {
      await expect(
        list.getByRole('link', { name: 'View decision' }).first(),
      ).toBeVisible();
    }
  });

  test('Leasing filter shows exactly the live leasing count', async ({ page }) => {
    const counts = await liveCounts();

    await page.goto('/open-items');

    await page.getByTestId('filter-btn-leasing').click();
    await expect(page.getByTestId('filter-btn-leasing')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const list = page.getByTestId('open-items-list');
    await expect(list.locator('article')).toHaveCount(counts.leasing);

    // The seed fully occupies every unit, so this filter renders the list's
    // empty state; assert it honestly whenever the live count is 0.
    if (counts.leasing === 0) {
      await expect(list).toContainText('No open items match this filter.');
    }
  });

  test('a maintenance row action navigates to the real work-order detail', async ({ page }) => {
    await page.goto('/open-items');

    const list = page.getByTestId('open-items-list');
    const ticketLink = list.locator(
      `a[href="/work-orders/${WO_OPEN_EMERGENCY_ID}"]`,
    );
    await expect(ticketLink).toBeVisible();
    await expect(ticketLink).toHaveText('View ticket');

    await ticketLink.click();
    // The row is a plain <a> (hard nav). Wait on the destination page's own
    // testid — DOM-polled, so immune to any post-nav `load`-state stall — the
    // way portfolio-wiring / unit-detail verify a WO drill-down.
    await expect(page.getByTestId('work-order-page')).toBeVisible({
      timeout: 15_000,
    });
    expect(page.url()).toContain(`/work-orders/${WO_OPEN_EMERGENCY_ID}`);
  });

  test('a rent row action link points at the real tenant detail', async ({ page }) => {
    await page.goto('/open-items');

    const list = page.getByTestId('open-items-list');
    // Jessica Kim (escalated rent, Unit C) → /tenants/<uuid> with "Review plan".
    const reviewPlanLink = list.locator(
      `a[href="/tenants/${JESSICA_TENANT_ID}"]`,
    );
    await expect(reviewPlanLink).toBeVisible();
    await expect(reviewPlanLink).toHaveText('Review plan');
  });

  test('Ask Odesa bar renders and accepts input', async ({ page }) => {
    await page.goto('/open-items');

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();

    await input.fill('What\'s most urgent?');
    await expect(input).toHaveValue('What\'s most urgent?');

    // Enter performs the real handoff to the global assistant, preserving the
    // open-items scope in the query (mirrors the unit / work-order Ask bars).
    await input.press('Enter');
    await page.waitForURL(/\/assistant\?q=/, { timeout: 15_000 });
    const q = new URL(page.url()).searchParams.get('q') ?? '';
    expect(q).toContain('Open items');
    expect(q).toContain('What\'s most urgent?');
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/open-items');
    await expect(page.getByTestId('open-items-page')).toBeVisible();
    await expect(page.getByTestId('ask-odesa-bar-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
