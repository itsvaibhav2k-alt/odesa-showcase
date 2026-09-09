/**
 * Tenants list — `/tenants` E2E (migrated to real seeded Galaxy data).
 *
 * Asserts (against the page's TESTID contract):
 *   - compact Assigned residents header + truthful assigned scope
 *   - client search and roster sort controls
 *   - one directory row per seeded tenant (count live-derived via createAdmin)
 *   - Marcus Alvarez row links to /tenants/<uuid> and NAVIGATES to tenant detail
 *   - facet filters narrow the roster to the real seed's derived pills:
 *       Needs attention -> Hannah Ito + Jessica Kim (watching) + Priya
 *         Banerjee + Ethan Ellis (renewal) = 4 rows
 *       On a plan       -> empty (no on-plan tenant in the seed)
 *       Renewals        -> Priya Banerjee + Ethan Ellis (60-day window) = 2 rows
 *   - no console errors during load
 *
 * Facet expectations are traced from supabase/seed.sql: the current rent cycle
 * is late_3 for Hannah (Unit A) and escalated for Jessica (Unit C) -> both
 * derive the `watching` pill; leases for Priya (end +35d) and Ethan (end +52d)
 * sit inside the 60-day renewal window -> `renewal` pill. Linda/Hannah/Jessica
 * hold expired leases (end in the past) so they never enter the renewal facet.
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  GALAXY_ORG_ID,
  MARCUS_TENANT_ID,
  JESSICA_TENANT_ID,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import { TENANTS } from '../fixtures/manifest';

/** Resolves a seeded tenant's real UUID by full name (fails loudly if renamed). */
function seedTenantId(fullName: string): string {
  const tenant = TENANTS.find((t) => t.fullName === fullName);
  if (!tenant) throw new Error(`Seed tenant not found: ${fullName}`);
  return tenant.id;
}

const PRIYA_TENANT_ID = seedTenantId('Priya Banerjee');
const ETHAN_TENANT_ID = seedTenantId('Ethan Ellis');
const HANNAH_TENANT_ID = seedTenantId('Hannah Ito');

function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

/** Live count of tenants in the seeded Galaxy org — one directory row each. */
async function liveTenantCount(): Promise<number> {
  const admin = createAdmin();
  const { count, error } = await admin
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', GALAXY_ORG_ID);
  if (error || count == null) {
    throw new Error(`Failed to count Galaxy tenants: ${error?.message}`);
  }
  return count;
}

test.describe('tenants: /tenants list page', () => {
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

  test('page shell renders with correct title', async ({ page }) => {
    await page.goto('/tenants');

    await expect(page.getByTestId('tenants-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assigned residents' })).toBeVisible();
    await expect(page.getByLabel('Current access scope')).toContainText('assigned scope');
  });

  test('resident roster supports truthful client search', async ({ page }) => {
    await page.goto('/tenants');

    const search = page.getByPlaceholder('Search residents, properties, or units…');
    await search.fill('Marcus Alvarez');
    await expect(page.getByTestId(/^tenant-dir-/)).toHaveCount(1);
    await expect(page.getByTestId(`tenant-dir-${MARCUS_TENANT_ID}`)).toBeVisible();
  });

  test('roster exposes useful sort choices', async ({ page }) => {
    await page.goto('/tenants');

    const sort = page.getByRole('combobox');
    await expect(sort).toHaveValue('key-date');
    await sort.selectOption('resident');
    await expect(sort).toHaveValue('resident');
  });

  test('renders one directory row per seeded tenant', async ({ page }) => {
    const expected = await liveTenantCount();

    await page.goto('/tenants');

    await expect(page.getByTestId('tenants-directory')).toBeVisible();

    // Exactly one row per tenant in the caller's org (RLS-scoped) — derived
    // live from the DB rather than a hardcoded environment-wide count.
    const rows = page.getByTestId(/^tenant-dir-/);
    await expect(rows).toHaveCount(expected);

    // Seeded flagship tenants are present (structural invariant).
    await expect(page.getByTestId(`tenant-dir-${MARCUS_TENANT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`tenant-dir-${JESSICA_TENANT_ID}`)).toBeVisible();
  });

  test('Marcus Alvarez row links to /tenants/<id> and clicking navigates there', async ({
    page,
  }) => {
    await page.goto('/tenants');

    const marcusRow = page.getByTestId(`tenant-dir-${MARCUS_TENANT_ID}`);
    await expect(marcusRow).toBeVisible();

    // The overlay link should point to the tenant brief keyed by real UUID.
    const marcusLink = marcusRow.locator('a').first();
    await expect(marcusLink).toHaveAttribute(
      'href',
      `/tenants/${MARCUS_TENANT_ID}`,
    );

    // Click the row and confirm navigation to tenant detail.
    await marcusLink.click();
    await page.waitForURL(new RegExp(`/tenants/${MARCUS_TENANT_ID}`), {
      timeout: 10_000,
    });
    await expect(page.url()).toContain(`/tenants/${MARCUS_TENANT_ID}`);
  });

  test('Needs attention filter narrows to the watching + renewal tenants', async ({
    page,
  }) => {
    await page.goto('/tenants');

    await expect(page.getByTestId('filter-bar')).toBeVisible();

    const attentionBtn = page.getByTestId('filter-btn-attention');
    await expect(attentionBtn).toBeVisible();
    await attentionBtn.click();
    await expect(attentionBtn).toHaveAttribute('aria-pressed', 'true');

    // watching: Hannah Ito (late_3), Jessica Kim (escalated).
    // renewal:  Priya Banerjee (+35d), Ethan Ellis (+52d) within the window.
    const rows = page.getByTestId(/^tenant-dir-/);
    await expect(rows).toHaveCount(4);

    await expect(page.getByTestId(`tenant-dir-${HANNAH_TENANT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`tenant-dir-${JESSICA_TENANT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`tenant-dir-${PRIYA_TENANT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`tenant-dir-${ETHAN_TENANT_ID}`)).toBeVisible();
  });

  test('On a plan filter is empty (no on-plan tenant in the seed)', async ({ page }) => {
    await page.goto('/tenants');

    const planBtn = page.getByTestId('filter-btn-plan');
    await planBtn.click();
    await expect(planBtn).toHaveAttribute('aria-pressed', 'true');

    // The seed has no payment-plan rent cycle, so the `plan` facet is empty —
    // the directory shows its no-match state rather than any rows.
    const rows = page.getByTestId(/^tenant-dir-/);
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('tenants-directory-empty')).toBeVisible();
  });

  test('Renewals filter shows the two tenants in the 60-day window', async ({ page }) => {
    await page.goto('/tenants');

    const renewalsBtn = page.getByTestId('filter-btn-renewals');
    await renewalsBtn.click();
    await expect(renewalsBtn).toHaveAttribute('aria-pressed', 'true');

    // Priya Banerjee (lease end +35d) and Ethan Ellis (+52d) — the only active
    // leases inside the 60-day renewal window; expired leases never qualify.
    const rows = page.getByTestId(/^tenant-dir-/);
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId(`tenant-dir-${PRIYA_TENANT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`tenant-dir-${ETHAN_TENANT_ID}`)).toBeVisible();
  });

  test('ask odesa bar is visible and accepts input', async ({ page }) => {
    await page.goto('/tenants');

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();
    await input.fill('test query');
    await expect(input).toHaveValue('test query');
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/tenants');
    await expect(page.getByTestId('tenants-page')).toBeVisible();
    await expect(page.getByTestId('tenants-directory')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
