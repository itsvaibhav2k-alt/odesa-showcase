/**
 * Property page — proposals feed spec.
 *
 * The property page surfaces a feed of recent action_proposals with
 * approve / reject / edit affordances on each pending row. The
 * fixture seeds 10 proposals across all 5 statuses; this spec asserts
 * the feed renders and the actions update the DB.
 *
 * Acceptance:
 *   - Feed renders all 3 'proposed' rows in pending state.
 *   - Approve flips the row to 'committed', sets committed_at.
 *   - Reject flips the row to 'rejected', sets rejected_at.
 *   - Edit opens an inline form; save flips status to 'edited' and
 *     stores edit_diff.
 *   - Filter chip ("All / Pending / Committed / Rejected") narrows
 *     the list.
 *
 * Not mock-state-sensitive.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyV15,
  type GalaxyV15Fixture,
} from '../fixtures/galaxy-v1-5';

test.describe('property: proposals feed', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async () => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test.fixme(
    'feed renders proposed / committed / rejected rows from the seed',
    async ({ page }) => {
      const propertyId = fixture.properties[0]!.id;
      await page.goto('/login');
      await page.getByTestId('login-email').fill(fixture.owner.email);
      await page.getByTestId('login-password').fill(fixture.owner.password);
      await page.getByTestId('login-submit').click();
      await page.waitForURL(/\/today/);
      await page.goto(`/properties/${propertyId}`);

      // Fixture seeds: 3 proposed, 3 committed, 2 rejected, 1 edited,
      // 1 expired. Feed filter defaults to "All".
      const rows = page.getByTestId(/^proposal-row-/);
      await expect(rows).toHaveCount(10);
    },
  );

  test.fixme('approve commits the proposal', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;
    const proposed = fixture.proposals.filter((p) => p.status === 'proposed');
    const target = proposed[0]!;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);

    await page.getByTestId(`proposal-approve-${target.id}`).click();
    await expect(
      page.getByTestId(`proposal-status-${target.id}`),
    ).toHaveText(/committed/i);

    const admin = createAdmin();
    const { data } = await admin
      .from('action_proposals')
      .select('status, committed_at')
      .eq('id', target.id)
      .single();
    expect(data?.status).toBe('committed');
    expect(data?.committed_at).not.toBeNull();
  });

  test.fixme('reject sets rejected_at', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;
    const proposed = fixture.proposals.filter((p) => p.status === 'proposed');
    const target = proposed[1]!;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);

    await page.getByTestId(`proposal-reject-${target.id}`).click();
    const admin = createAdmin();
    const { data } = await admin
      .from('action_proposals')
      .select('status, rejected_at')
      .eq('id', target.id)
      .single();
    expect(data?.status).toBe('rejected');
    expect(data?.rejected_at).not.toBeNull();
  });

  test.fixme('edit stores edit_diff and flips status to edited', async ({
    page,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    const proposed = fixture.proposals.filter((p) => p.status === 'proposed');
    const target = proposed[2]!;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);

    await page.getByTestId(`proposal-edit-${target.id}`).click();
    await page.getByTestId(`proposal-edit-summary-${target.id}`).fill(
      'Edited by owner',
    );
    await page.getByTestId(`proposal-edit-save-${target.id}`).click();

    const admin = createAdmin();
    const { data } = await admin
      .from('action_proposals')
      .select('status, edit_diff')
      .eq('id', target.id)
      .single();
    expect(data?.status).toBe('edited');
    expect(data?.edit_diff).not.toBeNull();
  });

  test.fixme('filter chips narrow the list', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;
    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/);
    await page.goto(`/properties/${propertyId}`);

    await page.getByTestId('proposal-filter-pending').click();
    await expect(page.getByTestId(/^proposal-row-/)).toHaveCount(3);

    await page.getByTestId('proposal-filter-committed').click();
    await expect(page.getByTestId(/^proposal-row-/)).toHaveCount(3);

    await page.getByTestId('proposal-filter-rejected').click();
    await expect(page.getByTestId(/^proposal-row-/)).toHaveCount(2);
  });
});

// =====================================================================
// Read-only display — owned by ui-eng (task #7).
//
// The mutation specs above stay .fixme; v1.5 ships proposals as a
// read-only audit trail with approve/reject/edit deferred to v1.6.
// These tests cover what the feed actually renders today: last 10
// proposals + collapsible reasoning + edit_diff JSON dump when present.
// =====================================================================

test.describe('property: proposals feed display', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: GalaxyV15Fixture;

  test.beforeEach(async () => {
    fixture = await provisionGalaxyV15({ propertyCount: 1 });
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test('feed renders up to 10 rows from action_proposals', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });
    await page.goto(`/properties/${propertyId}`);

    const feed = page.getByTestId('property-proposals-feed');
    await expect(feed).toBeVisible();

    const rows = page.locator('[data-testid^="property-proposals-row-"]');
    const count = await rows.count();
    // Galaxy v1.5 fixture seeds 10 proposals; the feed caps at 10.
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(10);

    // Every row must declare a gate decision and a status, so the
    // pills line up with the underlying data without surprise variants.
    const firstRow = rows.first();
    const gate = await firstRow.getAttribute('data-gate-decision');
    expect(['auto', 'review', 'block']).toContain(gate);
    const status = await firstRow.getAttribute('data-status');
    expect([
      'proposed',
      'committed',
      'rejected',
      'edited',
      'expired',
    ]).toContain(status);
  });

  test('clicking a row reveals the reasoning paragraph', async ({ page }) => {
    const propertyId = fixture.properties[0]!.id;

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });
    await page.goto(`/properties/${propertyId}`);

    const firstRow = page
      .locator('[data-testid^="property-proposals-row-"]')
      .first();
    const rowId =
      (await firstRow.getAttribute('data-testid'))?.replace(
        'property-proposals-row-',
        '',
      ) ?? '';
    expect(rowId).not.toBe('');

    const summary = page.getByTestId(`property-proposals-summary-${rowId}`);
    const detail = page.getByTestId(`property-proposals-detail-${rowId}`);

    // <details> body is hidden until clicked.
    await expect(detail).toBeHidden();
    await summary.click();
    await expect(detail).toBeVisible();
  });

  test('renders empty state when property has no proposals', async ({
    page,
  }) => {
    const propertyId = fixture.properties[0]!.id;
    const admin = createAdmin();
    await admin
      .from('action_proposals')
      .delete()
      .eq('property_id', propertyId);

    await page.goto('/login');
    await page.getByTestId('login-email').fill(fixture.owner.email);
    await page.getByTestId('login-password').fill(fixture.owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });
    await page.goto(`/properties/${propertyId}`);

    await expect(page.getByTestId('property-proposals-empty')).toBeVisible();
  });
});
