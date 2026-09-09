/**
 * Settings — Billing section (spec §11.4 section 4).
 *
 * The current-plan card is driven off `organizations.plan`. Billing is
 * not connected, so the figures are PREVIEW pricing (not the account's
 * real charges) and the plan-change control is disabled.
 *
 * Covers:
 *  - The card shows the right plan title + MRR for each plan value
 *  - The preview-pricing label is present (figures are not real charges)
 *  - Payment-method placeholder copy renders
 *  - "Change plan" is disabled (no inline panel to open)
 */

import { expect, test } from '@playwright/test';

import type { OrganizationPlan } from '../../src/types/database';

import {
  createAdmin,
  GALAXY_ORG_ID,
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signInAndOpenSettings,
  type SeededOwner,
} from './helpers';

interface PlanCase {
  plan: OrganizationPlan;
  title: string;
  mrrRegex: RegExp;
}

const PLAN_CASES: readonly PlanCase[] = [
  { plan: 'starter', title: 'Starter', mrrRegex: /^\$199$/ },
  { plan: 'pro', title: 'Pro', mrrRegex: /^\$299$/ },
  { plan: 'managed', title: 'Managed', mrrRegex: /^4\.5%$/ },
];

test.describe('settings: billing', () => {
  // Every test in this file mutates the shared Galaxy org's `plan`
  // column to exercise the three plan cards. Running them in parallel
  // causes one test's update to be observed by another test's render,
  // flipping the plan title off its expected value. Serialize the
  // describe so the DB sees one plan at a time.
  test.describe.configure({ mode: 'serial' });

  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
    // Restore the seeded plan in case a test left a different value.
    const admin = createAdmin();
    await admin
      .from('organizations')
      .update({ plan: 'managed' })
      .eq('id', GALAXY_ORG_ID);
  });

  for (const c of PLAN_CASES) {
    test(`renders the ${c.plan} plan card correctly`, async ({ page }) => {
      const admin = createAdmin();
      await admin
        .from('organizations')
        .update({ plan: c.plan })
        .eq('id', GALAXY_ORG_ID);

      await signInAndOpenSettings(page, {
        email: owner.email,
        password: owner.password,
      });

      await expect(page.getByTestId('settings-billing-section')).toBeVisible();

      const card = page.getByTestId('settings-billing-current-plan');
      await expect(card).toHaveAttribute('data-plan', c.plan);
      await expect(page.getByTestId('settings-billing-plan-title')).toHaveText(
        c.title,
      );
      await expect(page.getByTestId('settings-billing-mrr')).toHaveText(
        c.mrrRegex,
      );
    });
  }

  test('preview label is present, payment-method renders, change-plan disabled', async ({
    page,
  }) => {
    await signInAndOpenSettings(page, {
      email: owner.email,
      password: owner.password,
    });

    await expect(page.getByTestId('settings-billing-section')).toBeVisible();

    // Figures are labelled as preview pricing, not the account's charges.
    await expect(
      page.getByTestId('settings-billing-preview-note'),
    ).toContainText(/Preview pricing/i);

    await expect(
      page.getByTestId('settings-billing-payment-method'),
    ).toContainText(/Add a payment method/);

    // Plan changes are not wired — the control is disabled and no inline
    // panel can open.
    await expect(
      page.getByTestId('settings-billing-change-plan-button'),
    ).toBeDisabled();
    await expect(
      page.getByTestId('settings-billing-change-plan-panel'),
    ).toHaveCount(0);
  });
});
