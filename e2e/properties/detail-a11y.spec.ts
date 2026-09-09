/**
 * Interior detail pages — accessibility spec.
 *
 * Covers all four drill-down pages built in the interior-pages wave
 * (routes resolved from canonical seed IDs in ../fixtures/manifest):
 *   - /properties/[id]                 (Oakwood Commons brief)
 *   - /properties/[id]/units/[unitId]  (Unit 101 brief)
 *   - /tenants/[tenantId]              (Marcus Alvarez brief)
 *   - /work-orders/[woId]              (open-emergency ticket)
 *
 * Each page is checked for:
 *   1. Zero axe violations (same disableRules as the portfolio spec).
 *   2. No interactive element nesting another interactive element.
 *   3. No horizontal overflow at 390px (with offenders diagnostic on failure).
 *
 * A11y contract shared by all four pages:
 *   - Every interactive row uses a single overlay <a> — no nested buttons.
 *   - Status is never conveyed by color alone (text + aria-hidden dot).
 *   - Decorative glyphs are aria-hidden.
 *   - Visible terracotta focus rings via hoisted <style precedence>.
 *
 * Modeled on e2e/properties/properties-a11y.spec.ts (same AxeBuilder usage,
 * same disableRules, same DOM scan helpers, same HAVE_SUPABASE gate).
 * Skipped when the local Supabase stack is not running.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  MARCUS_TENANT_ID,
  OAKWOOD_PROPERTY_ID,
  UNIT_101_ID,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';
import { WO_OPEN_EMERGENCY_ID } from '../fixtures/manifest';

/**
 * Documented, app-wide a11y trade-offs (mirrors properties-a11y.spec.ts).
 *  - color-contrast: warm-paper palette uses muted ink tiers below AA 4.5:1.
 *    Approved operator-console aesthetic.
 *  - landmark-*: dashboard layout <main> + page shell trip duplicate/top-level/
 *    unique-landmark rules. Structural TODO, not page-level bugs.
 */
const A11Y_RULE_EXCLUSIONS = [
  'color-contrast',
  'landmark-no-duplicate-main',
  'landmark-main-is-top-level',
  'landmark-unique',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function expectNoNestedInteractive(page: Page): Promise<void> {
  const offender = await page.evaluate(() => {
    const INTERACTIVE = 'a, button, [role="button"]';
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(INTERACTIVE),
    );
    for (const el of elements) {
      if (el.querySelector(INTERACTIVE)) {
        const html = el.outerHTML;
        return html.length > 600 ? `${html.slice(0, 600)}…` : html;
      }
    }
    return null;
  });

  expect(
    offender,
    `found an interactive element nesting another interactive element:\n${offender ?? ''}`,
  ).toBeNull();
}

async function expectNoOverflowAt390(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 800 });

  const overflow = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders: {
      tag: string;
      testid: string;
      cls: string;
      right: number;
      width: number;
    }[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute('data-testid') ?? '',
          cls:
            typeof el.className === 'string'
              ? el.className.slice(0, 40)
              : '',
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
    }
    offenders.sort((a, b) => b.right - a.right);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: vw,
      offenders: offenders.slice(0, 8),
    };
  });

  expect(
    overflow.scrollWidth,
    `page overflows horizontally at 390px: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}\noffenders: ${JSON.stringify(overflow.offenders, null, 2)}`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

// ---------------------------------------------------------------------------
// Pages under test
// ---------------------------------------------------------------------------

interface PageSpec {
  route: string;
  label: string;
  testId: string;
  /** Secondary testid used to confirm page has fully rendered (optional). */
  anchorTestId?: string;
}

const DETAIL_PAGES: readonly PageSpec[] = [
  {
    route: `/properties/${OAKWOOD_PROPERTY_ID}`,
    label: 'property-detail (Oakwood Commons)',
    testId: 'property-detail-page',
    anchorTestId: 'property-units',
  },
  {
    route: `/properties/${OAKWOOD_PROPERTY_ID}/units/${UNIT_101_ID}`,
    label: 'unit-detail (Unit 101)',
    testId: 'unit-detail-page',
    anchorTestId: 'unit-tenant-link',
  },
  {
    route: `/tenants/${MARCUS_TENANT_ID}`,
    label: 'tenant-detail (Marcus Alvarez)',
    testId: 'tenant-detail-page',
    anchorTestId: 'tenant-property-link',
  },
  {
    route: `/work-orders/${WO_OPEN_EMERGENCY_ID}`,
    label: 'work-order-detail (open emergency)',
    testId: 'work-order-page',
    anchorTestId: 'ask-odesa-bar-input',
  },
] as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('detail pages: accessibility', () => {
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

  for (const spec of DETAIL_PAGES) {
    test.describe(spec.label, () => {
      test(`axe: ${spec.route} has zero violations`, async ({ page }) => {
        await page.goto(spec.route);
        await expect(page.getByTestId(spec.testId)).toBeVisible();
        if (spec.anchorTestId) {
          await expect(page.getByTestId(spec.anchorTestId)).toBeVisible();
        }

        await expectNoAxeViolations(page, spec.label);
      });

      test(`no interactive element nests another — ${spec.route}`, async ({
        page,
      }) => {
        await page.goto(spec.route);
        await expect(page.getByTestId(spec.testId)).toBeVisible();

        await expectNoNestedInteractive(page);
      });

      test(`no horizontal overflow at 390px — ${spec.route}`, async ({
        page,
      }) => {
        await page.goto(spec.route);
        await expect(page.getByTestId(spec.testId)).toBeVisible();

        await expectNoOverflowAt390(page);
      });
    });
  }
});
