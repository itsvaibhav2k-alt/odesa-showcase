/**
 * Property page — autonomy panel spec.
 *
 * Surfaces the per-property autonomy_level slider + privacy_mode
 * toggle + the live trust score. UI gate; backed by the same column
 * as the agent autonomy graduation spec.
 *
 * Acceptance:
 *   - Slider initial value matches the property's seeded autonomy.
 *   - Dragging the slider updates `autonomy_level` in the DB.
 *   - The "auto / review / block" caption under the slider updates
 *     to reflect the gate threshold the new level lands on.
 *   - Privacy-mode toggle flips between hosted/on_prem and reveals
 *     the Ollama host input when on_prem is selected.
 *
 * Not mock-state-sensitive (no Anthropic calls).
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyV15,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';

test.describe('property: autonomy panel', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async () => {
    fixture = await provisionGalaxyV15({
      propertyCount: 1,
      autonomyLevel: 0.5,
    });
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test.fixme('slider renders at the seeded autonomy level', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;
    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);
    const slider = page.getByTestId('autonomy-slider');
    await expect(slider).toHaveAttribute('aria-valuenow', '0.5');
  });

  test.fixme('moving the slider persists autonomy_level', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;
    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);

    // Slider component owned by ui-eng — assume aria-driven keyboard
    // increments; spec uses the explicit "set to 0.8" testid the panel
    // exposes for deterministic E2E control.
    await page.getByTestId('autonomy-set-0.8').click();
    await expect(page.getByTestId('autonomy-saved-badge')).toBeVisible();

    const admin = createAdmin();
    const { data } = await admin
      .from('properties')
      .select('autonomy_level')
      .eq('id', propertyId)
      .single();
    expect(Number(data?.autonomy_level ?? 0)).toBeCloseTo(0.8, 2);
  });

  test.fixme('privacy toggle reveals Ollama host input on_prem', async ({
    page,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);

    await expect(page.getByTestId('ollama-host-input')).not.toBeVisible();
    await page.getByTestId('privacy-mode-on_prem').click();
    await expect(page.getByTestId('ollama-host-input')).toBeVisible();
  });
});

// =====================================================================
// Read-only display — owned by ui-eng (task #7).
//
// The mutation tests above (slider, on-prem toggle inside the panel)
// stay .fixme; v1.5 ships autonomy as a read-only reflection of the
// gate's history, with mutations deferred to v1.6. These specs cover
// what the panel actually renders today.
// =====================================================================

test.describe('property: autonomy panel display', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async () => {
    fixture = await provisionGalaxyV15({
      propertyCount: 1,
      autonomyLevel: 0.5,
    });
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test('renders seeded autonomy level + per-action rollup', async ({
    page,
  }) => {
    const propertyId = fixture.properties[0]!.id;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });
    await page.goto(`/properties/${propertyId}`);

    const panel = page.getByTestId('property-autonomy-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-autonomy-level', '0.50');

    // Galaxy v1.5 fixture seeds 10 proposals across 5 statuses; the
    // autonomy rollup must produce at least one row.
    const rows = page.locator('[data-testid^="property-autonomy-row-"]');
    expect(await rows.count()).toBeGreaterThan(0);

    // Each row carries a decision attribute from {auto, review, block}.
    const firstDecision = await rows
      .first()
      .getAttribute('data-decision');
    expect(['auto', 'review', 'block']).toContain(firstDecision);
  });

  test('renders empty state when no proposals exist', async ({ page }) => {
    // Wipe the seeded proposals so the rollup goes empty.
    const propertyId = fixture.properties[0]!.id;
    const admin = createAdmin();
    await admin.from('action_proposals').delete().eq('property_id', propertyId);

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });
    await page.goto(`/properties/${propertyId}`);

    await expect(page.getByTestId('property-autonomy-empty')).toBeVisible();
  });
});
