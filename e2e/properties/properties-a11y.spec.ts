/**
 * Properties — accessibility spec for the portfolio command center.
 *
 * The command center was built to a strict a11y contract:
 *   - NO nested interactive elements (priority rows are <article> with
 *     SEPARATE action <button>s; cards are <article> whose only
 *     interactive child is a single overlay <a>).
 *   - Status is never conveyed by color alone (every pill/issue has a
 *     visible text label).
 *   - Decorative glyphs are aria-hidden; icon-only controls are labeled.
 *
 * Bar: zero axe violations EXCEPT the same documented exclusions the shipped
 * /owner-queue + /today specs carry (color-contrast for the muted warm-paper
 * palette incl. the shared sidebar, plus the dashboard double-<main>) — these
 * are app-wide accepted design trade-offs, not page bugs. Every OTHER rule
 * (nested-interactive, labels, ARIA, roles, region-name…) still fails loudly.
 *
 * Three checks:
 *   1. axe scan of /properties → zero violations.
 *   2. no-nested-interactive DOM invariant (evaluated in the browser).
 *   3. no horizontal overflow at a narrow (390px) viewport.
 *
 * Modeled on `e2e/today/today-a11y.spec.ts` (same AxeBuilder util, same
 * auth setup). Skipped when the local Supabase stack isn't running.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

/**
 * Documented, app-wide a11y trade-offs shared with /today + /owner-queue
 * (mirrors e2e/owner-queue/owner-queue-a11y.spec.ts). Drop each the moment its
 * underlying constraint is lifted.
 *  - color-contrast: the warm-paper palette uses muted ink tiers (--ink-3/-4,
 *    incl. the shared sidebar eyebrows/⌘K/account meta) below AA's 4.5:1 floor.
 *    Approved operator-console aesthetic. TODO(design): tighten palette OR
 *    formally accept the AA exception.
 *  - landmark-*: the dashboard layout's <main> plus the page shell trip the
 *    duplicate/top-level/unique-landmark rules. TODO(shell): restructure.
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

test.describe('properties: accessibility', () => {
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

  test('axe: /properties has zero violations', async ({ page }) => {
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();
    await expect(page.getByTestId('ask-odesa-input')).toBeVisible();

    await expectNoAxeViolations(page, 'default');
  });

  test('no interactive element nests another interactive element', async ({
    page,
  }) => {
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();

    // For every interactive element, assert it contains no descendant
    // that is itself interactive. Returns the offending outerHTML (the
    // ancestor) for a precise failure message, or null when clean.
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
  });

  test('no horizontal overflow at a narrow viewport (390px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const vw = window.innerWidth;
      const offenders: { tag: string; testid: string; cls: string; right: number; width: number }[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            testid: el.getAttribute('data-testid') ?? '',
            cls: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
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
  });
});
