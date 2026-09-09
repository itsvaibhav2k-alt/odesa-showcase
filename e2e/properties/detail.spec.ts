/**
 * Property detail — `/properties/[id]` E2E (real Galaxy data).
 *
 * Re-authored (Wave 0) off the deleted mock `/properties/oak` fixtures onto the
 * real detail page (src/app/(dashboard)/properties/[id]/page.tsx) against the
 * seeded Oakwood Commons property. Covers the page-shell behaviors that
 * qa-pass.spec.ts / detail-a11y.spec.ts do NOT already cover:
 *   - breadcrumb: Portfolio / Properties / Oakwood Commons (real name + link)
 *   - hero renders the real property name + a data-derived status badge
 *   - the Odesa brief surfaces at least one live attention item
 *   - the "At a glance" metrics panel renders the real metric labels
 *   - each unit row's overlay link resolves to /properties/{id}/units/{unitId}
 *   - clicking a unit row navigates to that unit's detail page
 *   - no console errors during load
 *
 * The mock-only assertions (verbatim "22 Oak St" / "Maya R." units, the exact
 * 5-cell metric strip + 88% value, the Rent late/Noise complaint/Collection
 * risk attention order, and the chip-mirrors-into-input behavior — which the
 * real AskOdesaBar does NOT do; chips route straight to /assistant) were
 * archived: see coverage-ledger.md.
 *
 * Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type ConsoleMessage } from '@playwright/test';

import {
  HAVE_SUPABASE,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

/**
 * Benign console noise that must not fail the zero-console-errors assertion.
 */
function isBenignConsoleError(text: string): boolean {
  if (text.trim() === '') return true;
  return (
    text.includes('Download the React DevTools') ||
    text.includes('[Fast Refresh]')
  );
}

test.describe('properties: property detail (/properties/[id])', () => {
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

  test('breadcrumb renders Portfolio / Properties / Oakwood Commons', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    // Scope to the breadcrumb nav (DetailGlobalBar renders <nav
    // aria-label="Breadcrumb">). The dashboard sidebar also renders a
    // <nav aria-label="Primary"> with its own "Properties" link, so a bare
    // getByRole('navigation') is ambiguous (strict-mode violation).
    const nav = page.getByRole('navigation', { name: 'Breadcrumb' });

    // All three crumbs are present in the breadcrumb trail (split across
    // separate <span>/<Link> nodes with "/" separators).
    await expect(nav).toContainText('Portfolio');
    await expect(nav).toContainText('Properties');
    await expect(nav).toContainText('Oakwood Commons');

    // The final "Oakwood Commons" crumb is the current page (aria-current="page").
    await expect(
      nav.getByText('Oakwood Commons', { exact: true }),
    ).toHaveAttribute('aria-current', 'page');

    // The "Properties" crumb links back to /properties.
    const propertiesCrumb = nav.getByRole('link', { name: 'Properties' });
    await expect(propertiesCrumb).toHaveAttribute('href', '/properties');
  });

  test('hero renders the real property name with a status badge', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    // The page heading is the real property name.
    await expect(
      page.getByRole('heading', { name: 'Oakwood Commons' }),
    ).toBeVisible();

    // A data-derived status badge is text-visible (never color-only). The badge
    // label is one of the three property states deriveBadge() can produce, so
    // we assert membership rather than a specific (mock) value.
    const badge = page.locator('.property-badge-stack');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/At risk|Watching|Calm/);
  });

  test('Odesa brief surfaces at least one live attention item', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    // The Odesa brief panel (aria-label="Odesa brief") renders its heading and
    // at least one attention tile derived from the property's live state.
    const brief = page.getByRole('region', { name: 'Odesa brief' });
    await expect(brief).toBeVisible();
    await expect(brief).toContainText('What needs attention');
    await expect(brief.locator('.attention-tile').first()).toBeVisible();
  });

  test('At a glance metrics panel renders the real metric labels', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    await expect(page.getByTestId('property-detail-page')).toBeVisible();

    // The metrics panel (aria-label="At a glance") renders the stable
    // labels buildMetrics() emits; the "… collected" label carries the current
    // month, so it's matched by substring rather than a hardcoded month/value.
    const metrics = page.getByRole('region', { name: 'At a glance' });
    await expect(metrics).toBeVisible();
    for (const label of [
      'Occupancy',
      'Active items',
      'Monthly rent',
      'Open work orders',
    ]) {
      await expect(metrics).toContainText(label);
    }
    await expect(metrics).toContainText(/collected/i);
  });

  test('each unit row overlay link resolves to /properties/{id}/units/{unitId}', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    const unitsList = page.getByTestId('property-units');
    await expect(unitsList).toBeVisible();

    // Live-derived expectation: the Units panel renders one row per seeded
    // Oakwood unit (count-reconciliation pattern — no hardcoded count).
    const admin = createAdmin();
    const { count, error } = await admin
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', OAKWOOD_PROPERTY_ID);
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThan(0);

    const rows = unitsList.locator('[data-unit-row]');
    await expect(rows).toHaveCount(count ?? 0);

    // For real data the brief `unitSlug` (the row's data-unit-row) is the unit
    // id; the overlay link points at that unit's detail route.
    const slugs = await rows.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-unit-row') ?? ''),
    );
    expect(slugs).toContain(UNIT_101_ID);

    for (const slug of slugs) {
      const row = unitsList.getByTestId(`unit-row-${slug}`);
      // The single full-row overlay link (never the "View tenant" action link).
      await expect(row.locator('.unit-row-link')).toHaveAttribute(
        'href',
        `/properties/${OAKWOOD_PROPERTY_ID}/units/${slug}`,
      );
    }
  });

  test('clicking a unit row navigates to its unit detail page', async ({
    page,
  }) => {
    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);

    const unitsList = page.getByTestId('property-units');
    await expect(unitsList).toBeVisible();

    // Unit 101 (Marcus Alvarez). Click the overlay link — the only full-row
    // navigation target (the row also renders a "View tenant" link, so we must
    // target .unit-row-link explicitly, not a bare getByRole('link')).
    const row = unitsList.getByTestId(`unit-row-${UNIT_101_ID}`);
    await expect(row).toBeVisible();
    await row.locator('.unit-row-link').click();

    await page.waitForURL(
      `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('unit-detail-page')).toBeVisible();
  });

  test('no console errors during page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isBenignConsoleError(text)) return;
      errors.push(text);
    });

    await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);
    await expect(page.getByTestId('property-detail-page')).toBeVisible();
    // Let any deferred client work settle so late errors are captured.
    await expect(page.getByTestId('ask-odesa-bar-input')).toBeVisible();

    expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
