/**
 * /documents — portfolio Documents list view E2E (re-authored against the
 * REAL seeded Galaxy portfolio, not the deleted mock).
 *
 * Asserts:
 *   - breadcrumb renders "Portfolio" -> "Documents"
 *   - page title "Documents" is visible in the serif heading
 *   - portfolio tab bar renders with the Documents tab active
 *   - filter facets render with labels + LIVE-derived counts (from the 6 seeded
 *     docs in the DOCUMENTS manifest group — the mirror of supabase/seed.sql)
 *   - rows render on initial load; first row is STABLE across reloads (C8:
 *     created_at ties broken by id ASC in src/lib/documents/queries.ts)
 *   - document rows carry text badge tags (never color-only)
 *   - "Leases" / "Inspections" facets filter to only the matching real rows
 *   - a lease row links to the real tenant detail page (Marcus Alvarez)
 *   - a vendor (tax/W-9) row links to the real vendor detail page (Beltway Plumbing)
 *   - Ask Odesa bar renders and accepts input
 *   - no console errors during load
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import {
  DOCUMENTS,
  LEASES,
  MARCUS_TENANT_ID,
  BELTWAY_PLUMBING_VENDOR_ID,
} from '../fixtures/manifest';

/**
 * Facet expectations derived from the canonical seed (DOCUMENTS manifest group,
 * the single-source mirror of supabase/seed.sql). Type `tax` (the W-9) counts in
 * "All" but has no dedicated facet — matching src/lib/documents/queries.ts.
 */
const countOf = (t: string): number =>
  DOCUMENTS.filter((d) => d.type === t).length;

// Seeded document rows predate the exact lease_id association. The ledger must
// keep those files visible as Needs review and separately surface every active
// lease as Missing until an operator makes an exact association.
const expectedRowCount = DOCUMENTS.length + LEASES.length;
const expectedLeaseCount = countOf('lease') + LEASES.length;

const FILTER_FACETS: Array<{ id: string; labelText: string }> = [
  { id: 'all', labelText: `All ${expectedRowCount}` },
  { id: 'leases', labelText: `Leases ${expectedLeaseCount}` },
  { id: 'inspections', labelText: `Inspections ${countOf('inspection')}` },
  { id: 'insurance', labelText: `Insurance ${countOf('insurance')}` },
  { id: 'notices', labelText: `Notices ${countOf('notice')}` },
];

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

test.describe('documents: portfolio Documents list view', () => {
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

  test('page renders with breadcrumb Portfolio -> Documents', async ({ page }) => {
    await page.goto('/documents');

    await expect(page.getByTestId('documents-page')).toBeVisible();

    // Breadcrumb: "Portfolio" link + "Documents" current segment
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByRole('link', { name: 'Portfolio' })).toBeVisible();
    await expect(
      breadcrumb.getByRole('link', { name: 'Portfolio' }),
    ).toHaveAttribute('href', '/properties');

    // The active breadcrumb segment carries aria-current="page"
    await expect(breadcrumb.getByText('Documents')).toBeVisible();
  });

  test('page title "Documents" renders inside the serif heading', async ({ page }) => {
    await page.goto('/documents');

    const shell = page.getByTestId('list-page-shell');
    await expect(shell).toBeVisible();
    await expect(shell.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  });

  test('portfolio tab bar renders with Documents tab active', async ({ page }) => {
    await page.goto('/documents');

    const tabs = page.getByTestId('list-page-tabs');
    await expect(tabs).toBeVisible();

    const docTab = page.getByTestId('list-tab-documents');
    await expect(docTab).toBeVisible();
    await expect(docTab).toHaveAttribute('aria-current', 'page');
  });

  test('filter bar renders all five facets with correct label and count', async ({ page }) => {
    await page.goto('/documents');

    const filterBar = page.getByTestId('filter-bar');
    await expect(filterBar).toBeVisible();

    for (const { id, labelText } of FILTER_FACETS) {
      const btn = page.getByTestId(`filter-btn-${id}`);
      await expect(btn).toBeVisible();
      await expect(btn).toContainText(labelText);
    }

    // "All" is active by default
    const allBtn = page.getByTestId('filter-btn-all');
    await expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('documents-list renders all seeded rows on initial load (All filter)', async ({ page }) => {
    await page.goto('/documents');

    const list = page.getByTestId('documents-list');
    await expect(list).toBeVisible();

    // The full portfolio renders every file plus honest missing-lease rows.
    const rows = list.locator('.document-row');
    await expect(rows).toHaveCount(expectedRowCount);

    // Sanity: a representative real row is present.
    await expect(list).toContainText('Lease — Marcus Alvarez');
  });

  test('first document row is stable across reloads (deterministic tie-break)', async ({ page }) => {
    // C8 regression: the 6 seeded docs share a created_at, so the query adds an
    // `id` ASC tie-break. The first row must therefore be identical on reload —
    // and must resolve to the id-smallest doc (cc…01, Marcus's lease).
    await page.goto('/documents');
    const firstRow = page.getByTestId('documents-list').locator('.document-row').first();

    const initialText = (await firstRow.innerText()).trim();

    await page.reload();
    const reloadedText = (await firstRow.innerText()).trim();

    expect(reloadedText).toBe(initialText);
    expect(initialText).toContain('Lease — Marcus Alvarez');
  });

  test('document rows carry text badge tags (never color-only)', async ({ page }) => {
    await page.goto('/documents');

    const list = page.getByTestId('documents-list');

    // First row is Marcus's historical file. It has no exact lease_id, so the
    // safe badge is Needs review rather than an inferred Active association.
    const firstRow = list.locator('.document-row').first();
    await expect(firstRow).toContainText('Lease — Marcus Alvarez');
    await expect(firstRow).toContainText('Needs review');

    // A non-lease row carries its own type badge, proving badges are typed text
    // (not color-only). The insurance doc renders the "Insurance" badge.
    const insuranceRow = list
      .locator('.document-row')
      .filter({ hasText: 'Property insurance — Oakwood Commons' });
    await expect(insuranceRow).toContainText('Insurance');
  });

  test('Leases filter shows only lease rows', async ({ page }) => {
    await page.goto('/documents');

    await page.getByTestId('filter-btn-leases').click();
    await expect(page.getByTestId('filter-btn-leases')).toHaveAttribute('aria-pressed', 'true');

    const list = page.getByTestId('documents-list');
    const rows = list.locator('.document-row');
    await expect(rows).toHaveCount(expectedLeaseCount);
    await expect(list).toContainText('Lease — Marcus Alvarez');
    await expect(list).toContainText('Lease — Jessica Kim');

    // Non-lease document types must be filtered out.
    await expect(list).not.toContainText('Move-in inspection — Unit 101');
    await expect(list).not.toContainText('Property insurance — Oakwood Commons');
    await expect(list).not.toContainText('W-9 — preferred vendor');
    await expect(list).not.toContainText('Late-rent notice — Unit C');
  });

  test('Inspections filter shows only inspection rows', async ({ page }) => {
    await page.goto('/documents');

    await page.getByTestId('filter-btn-inspections').click();
    await expect(page.getByTestId('filter-btn-inspections')).toHaveAttribute('aria-pressed', 'true');

    const list = page.getByTestId('documents-list');
    await expect(list).toContainText('Move-in inspection — Unit 101');
    await expect(list).not.toContainText('Lease — Marcus Alvarez');
  });

  test('clicking a lease row navigates to tenant detail', async ({ page }) => {
    await page.goto('/documents');

    // Marcus's lease row links to the real tenant detail route.
    const list = page.getByTestId('documents-list');
    const marcusRow = list
      .locator('.document-row')
      .filter({ hasText: 'Lease — Marcus Alvarez' });
    await expect(marcusRow).toBeVisible();

    const tenantHref = `/tenants/${MARCUS_TENANT_ID}`;
    const link = marcusRow.locator('a.document-row-link');
    await expect(link).toHaveAttribute('href', tenantHref);

    await link.click();
    await page.waitForURL(new RegExp(`/tenants/${MARCUS_TENANT_ID}`));
    expect(page.url()).toContain(tenantHref);
  });

  test('clicking a vendor document row navigates to vendor detail', async ({ page }) => {
    await page.goto('/documents');

    // The W-9 (tax) doc is linked to Beltway Plumbing → vendor detail route.
    const list = page.getByTestId('documents-list');
    const vendorRow = list
      .locator('.document-row')
      .filter({ hasText: 'W-9 — preferred vendor' });
    await expect(vendorRow).toBeVisible();

    const vendorHref = `/vendors/${BELTWAY_PLUMBING_VENDOR_ID}`;
    const link = vendorRow.locator('a.document-row-link');
    await expect(link).toHaveAttribute('href', vendorHref);

    await link.click();
    await page.waitForURL(new RegExp(`/vendors/${BELTWAY_PLUMBING_VENDOR_ID}`));
    expect(page.url()).toContain(vendorHref);
  });

  test('Ask Odesa bar renders and accepts input', async ({ page }) => {
    await page.goto('/documents');

    const input = page.getByTestId('ask-odesa-bar-input');
    await expect(input).toBeVisible();

    await input.fill('Which leases expire in 90 days?');
    await expect(input).toHaveValue('Which leases expire in 90 days?');
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto('/documents');
    await expect(page.getByTestId('documents-page')).toBeVisible();
    await expect(page.getByTestId('ask-odesa-bar-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
