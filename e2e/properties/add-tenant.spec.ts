/**
 * Property "Add tenant" flow — real property detail E2E.
 *
 * Two honest levels of coverage against the server-rendered property
 * detail page:
 *
 *   1. Form visibility (read-only) — against the canonical Galaxy
 *      Oakwood Commons property. Opens the Units-panel "Add tenant"
 *      action, asserts the form + real unit selector render, and does
 *      NOT submit, so no tenant/lease rows are left behind.
 *
 *   2. Persistence (end-to-end) — against a freshly-provisioned ISOLATED
 *      org with a single VACANT unit. Every seeded Galaxy unit already
 *      carries an active lease, so submitting there would create a
 *      conflicting active lease and mask the real add-tenant behavior.
 *      The isolated fixture gives us a vacant unit to attach to, asserts
 *      the tenant + active lease actually persisted in that org, then
 *      tears the whole org down and proves zero leftovers (C11).
 *
 * Skipped when the Supabase stack is unavailable.
 */

import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, OAKWOOD_PROPERTY_ID, provisionGalaxyOwner, signIn } from './helpers';
import {
  createAdmin,
  provisionIsolatedOwnerWithVacantUnit,
} from '../fixtures/isolated-org';

test.describe('properties: add tenant (/properties/[id])', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  test('Units panel exposes an Add tenant action that opens the tenant form', async ({
    page,
  }) => {
    // Read-only: canonical Galaxy owner + Oakwood Commons. Submitting is
    // out of scope here, so signing into the shared org is safe.
    const owner = await provisionGalaxyOwner();
    try {
      await signIn(page, { email: owner.email, password: owner.password });

      await page.goto(`/properties/${OAKWOOD_PROPERTY_ID}`);
      await expect(page.getByTestId('property-detail-page')).toBeVisible({
        timeout: 30_000,
      });

      // CTA is reachable directly in the Units panel — not behind a menu.
      const trigger = page.getByTestId('add-tenant-trigger').first();
      await expect(trigger).toBeVisible();

      await trigger.click();

      // The form reveals name, a unit selector, and a submit affordance.
      const form = page.getByTestId('add-tenant-form');
      await expect(form).toBeVisible();
      await expect(page.getByTestId('add-tenant-submit')).toBeVisible();

      const unitSelect = form.locator('select[name="unitId"]');
      await expect(unitSelect).toBeVisible();
      // Real units come through from the server component — at least one
      // selectable option.
      const optionCount = await unitSelect.locator('option').count();
      expect(optionCount).toBeGreaterThan(0);
    } finally {
      await owner.teardown();
    }
  });

  test('Add tenant persists end-to-end (dialog closes on success)', async ({
    page,
  }) => {
    // Isolated org with exactly one VACANT unit — the only safe place to
    // actually submit, since every Galaxy unit is already occupied.
    const org = await provisionIsolatedOwnerWithVacantUnit();
    const newTenantName = 'QA Smoke Tenant';
    const newTenantPhone = `+1571555${String(Date.now()).slice(-4)}`;
    let cleaned = false;

    try {
      await signIn(page, { email: org.email, password: org.password });

      await page.goto(`/properties/${org.propertyId}`);
      await expect(page.getByTestId('property-detail-page')).toBeVisible({
        timeout: 30_000,
      });

      await page.getByTestId('add-tenant-trigger').first().click();
      const form = page.getByTestId('add-tenant-form');
      await expect(form).toBeVisible();

      await page.getByPlaceholder('Jordan Rivera').fill(newTenantName);
      await page.getByPlaceholder('(571) 555-0134').fill(newTenantPhone);

      // The lone vacant unit — pick the first real (non-placeholder) option.
      const unitSelect = form.locator('select[name="unitId"]');
      const values = await unitSelect
        .locator('option')
        .evaluateAll((opts) =>
          opts
            .map((o) => (o as HTMLOptionElement).value)
            .filter((v) => v.length > 0),
        );
      expect(values.length).toBeGreaterThan(0);
      await unitSelect.selectOption(values[0]);

      await page.getByTestId('add-tenant-submit').click();

      // The dialog only closes when the server action returns success — i.e.
      // the tenant + active lease persisted. A failure keeps the form open
      // and shows add-tenant-error.
      await expect(form).toBeHidden({ timeout: 20_000 });
      await expect(page.getByTestId('add-tenant-error')).toHaveCount(0);

      // Confirm the rows actually landed IN THE ISOLATED ORG.
      const admin = createAdmin();

      const { data: tenants } = await admin
        .from('tenants')
        .select('id, full_name')
        .eq('organization_id', org.organizationId);
      expect(tenants ?? []).toHaveLength(1);
      expect(tenants?.[0]?.full_name).toBe(newTenantName);

      const { data: leases } = await admin
        .from('leases')
        .select('id, status, unit_id, tenant_id')
        .eq('organization_id', org.organizationId)
        .eq('status', 'active');
      expect(leases ?? []).toHaveLength(1);
      expect(leases?.[0]?.unit_id).toBe(org.unitId);
      expect(leases?.[0]?.tenant_id).toBe(tenants?.[0]?.id);

      // C11 cleanup proof: teardown removes the whole org, verifyClean
      // confirms zero org-scoped leftovers.
      await org.teardown();
      cleaned = true;
      const clean = await org.verifyClean();
      expect(clean.ok, JSON.stringify(clean.leftovers)).toBe(true);
    } finally {
      // Guarantee cleanup even if the body threw before teardown.
      if (!cleaned) await org.teardown();
    }
  });
});
