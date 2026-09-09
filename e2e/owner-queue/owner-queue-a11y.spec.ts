/**
 * Owner Queue ("Decisions Desk") — accessibility spec.
 *
 * Runs @axe-core/playwright across the page on initial render and again
 * with the approve-all modal open. The bar is zero axe violations per
 * state. Modeled on `e2e/today/today-a11y.spec.ts` — same AxeBuilder
 * import + scan utility, same Supabase auth setup, same documented
 * rule-exclusion approach (warm-paper palette + dashboard landmark
 * structure are shared with the Today console).
 *
 * Reuses the Today suite's auth helpers verbatim
 * (`provisionGalaxyOwner` + `signIn`); only the navigation target changes
 * to `/owner-queue`. Skipped when the local Supabase stack is unavailable.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

/**
 * Known a11y trade-offs shared with the v2 Today design — the Decisions
 * Desk lives under the same `.today-theme` warm-paper palette and the
 * same dashboard layout group, so it inherits the same documented
 * exclusions. Each needs a documented reason; drop it the moment the
 * underlying constraint is lifted.
 *
 *  - `color-contrast`: the warm-paper palette uses muted ink tiers
 *    (`--ink-3`, `--ink-4`) below WCAG 2.x AA's 4.5:1 floor. Approved
 *    aesthetic for the operator console.
 *    TODO(design): tighten palette OR formally accept the AA exception.
 *
 *  - `landmark-no-duplicate-main` / `landmark-main-is-top-level` /
 *    `landmark-unique`: the dashboard layout group already renders a
 *    `<main>` around every dashboard page; the page shell adds its own
 *    `<main>` to scope `.today-theme`. Folding into a single landmark
 *    would force the shell to be aware of its enclosing layout — out of
 *    scope for the port.
 *    TODO(shell): swap the inner element to `role="region"` or
 *    restructure the dashboard layout.
 *
 * Excluding these here keeps the suite from drowning in known-known
 * violations while still failing loudly on every OTHER rule (missing
 * labels, invalid ARIA, role misuse, orphaned form controls, focus
 * traps, region-name issues, nested-interactive, etc.).
 */
const A11Y_RULE_EXCLUSIONS = [
  'color-contrast',
  'landmark-no-duplicate-main',
  'landmark-main-is-top-level',
  'landmark-unique',
] as const;

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .disableRules([...A11Y_RULE_EXCLUSIONS])
    .analyze();
  expect(
    results.violations,
    `axe violations in state="${label}":\n${JSON.stringify(
      results.violations,
      null,
      2,
    )}`,
  ).toEqual([]);
}

test.describe('owner-queue: accessibility', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/owner-queue');
    await page.waitForURL(/\/owner-queue/, { timeout: 15_000 });
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('axe: default state has zero violations', async ({ page }) => {
    await expect(page.getByTestId('owner-queue-page')).toBeVisible();
    await expectNoAxeViolations(page, 'default');
  });

  test('axe: approve-all modal open has zero violations', async ({ page }) => {
    await page.getByTestId('approve-all-button').click();
    await expect(page.getByTestId('approve-all-modal')).toBeVisible();
    await expectNoAxeViolations(page, 'approve-all-modal-open');
  });
});
