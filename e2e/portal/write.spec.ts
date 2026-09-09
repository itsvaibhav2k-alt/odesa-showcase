/**
 * Tenant-portal maintenance write E2E (Wave 3).
 *
 * Covers /portal/maintenance: empty state, the report-an-issue form
 * writing a real work_orders row (source:'portal' in the first
 * status_timeline entry, unit resolved from the active lease), and the
 * cross-tenant leak invariant. Fresh tenant + real OTP sign-in per test;
 * work_orders rows are cleaned up by the helper teardown. Skipped when
 * local Supabase is offline — same gating as e2e/today/helpers.ts.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  createAdmin,
  GALAXY_ORG_ID,
  HAVE_SUPABASE,
  provisionPortalTenant,
  signInPortal,
  type SeededPortalTenant,
} from './helpers';

test.describe('portal maintenance writes', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  const tenants: SeededPortalTenant[] = [];

  test.beforeEach(async ({ request }) => {
    await createMessagingMockHarness(request).install();
  });

  test.afterEach(async ({ request }) => {
    await createMessagingMockHarness(request).uninstall().catch(() => {});
    while (tenants.length > 0) {
      await tenants.pop()!.teardown().catch(() => {});
    }
  });

  async function provision(): Promise<SeededPortalTenant> {
    const tenant = await provisionPortalTenant();
    tenants.push(tenant);
    return tenant;
  }

  test('maintenance page renders the empty state', async ({ page }) => {
    const tenant = await provision();
    await signInPortal(page, tenant.phoneE164);

    await page.goto('/portal/maintenance');
    const root = page.getByTestId('portal-maintenance-page');
    await expect(root).toBeVisible();
    await expect(root.getByTestId('portal-maintenance-empty')).toBeVisible();
    await expect(root.getByTestId('portal-maintenance-list')).toHaveCount(0);
    await expect(root.getByTestId('portal-maintenance-form')).toBeVisible();
  });

  test('submitting the form creates a portal-sourced work order', async ({
    page,
  }) => {
    const tenant = await provision();
    const description = `Portal e2e leak under the kitchen sink ${Date.now()}`;
    await signInPortal(page, tenant.phoneE164);

    await page.goto('/portal/maintenance');
    await page.getByTestId('portal-maintenance-description').fill(description);
    await page.getByTestId('portal-maintenance-category').selectOption('plumbing');
    await page.getByTestId('portal-maintenance-urgency').selectOption('urgent');
    await page.getByTestId('portal-maintenance-submit').click();

    await expect(page.getByTestId('portal-maintenance-success')).toBeVisible({
      timeout: 15_000,
    });
    // The revalidated list above the form shows the new request.
    const renderedItem = page.getByTestId('portal-maintenance-item');
    await expect(renderedItem).toContainText(description);
    await expect(renderedItem).toContainText('Plumbing');
    await expect(renderedItem).toContainText('Urgent');

    const admin = createAdmin();
    const { data: rows, error } = await admin
      .from('work_orders')
      .select('organization_id, tenant_id, unit_id, category, urgency, status, status_timeline')
      .eq('tenant_id', tenant.tenantId);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    const wo = rows![0];
    expect(wo.organization_id).toBe(GALAXY_ORG_ID);
    expect(wo.tenant_id).toBe(tenant.tenantId);
    // Unit resolved server-side from the tenant's active lease.
    expect(wo.unit_id).toBe(tenant.unitId);
    expect(wo.category).toBe('plumbing');
    expect(wo.urgency).toBe('urgent');
    expect(wo.status).toBe('open');
    const timeline = wo.status_timeline as Array<{
      status?: string;
      source?: string;
    }>;
    expect(timeline[0]?.status).toBe('open');
    expect(timeline[0]?.source).toBe('portal');
  });

  test("another tenant's work order in the same org never leaks", async ({
    page,
  }) => {
    const tenantA = await provision();
    const tenantB = await provision();
    const poisonDescription = `LEAKED-WORK-ORDER ${Date.now()} must never render`;

    const admin = createAdmin();
    const { error: poisonErr } = await admin.from('work_orders').insert({
      organization_id: GALAXY_ORG_ID,
      tenant_id: tenantB.tenantId,
      unit_id: tenantB.unitId,
      category: 'plumbing',
      urgency: 'routine',
      status: 'open',
      description: poisonDescription,
      status_timeline: [
        { at: new Date().toISOString(), status: 'open', source: 'portal' },
      ],
    });
    expect(poisonErr).toBeNull();

    await signInPortal(page, tenantA.phoneE164);
    await page.goto('/portal/maintenance');
    await expect(page.getByTestId('portal-maintenance-page')).toBeVisible();
    // PRIVACY INVARIANT: tenant A sees none of tenant B's requests.
    await expect(page.getByText(poisonDescription)).toHaveCount(0);
    await expect(page.getByTestId('portal-maintenance-empty')).toBeVisible();
  });
});
