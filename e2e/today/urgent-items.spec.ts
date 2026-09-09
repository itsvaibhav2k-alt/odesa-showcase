/**
 * Today v2 — owner-review queue interaction spec.
 *
 * The redesigned "Quiet Operator Console" centers on row-level selection
 * that emphasizes a watch-rail item and swaps AskOdesa's chip set into a
 * row-specific context. This spec asserts the full interaction loop
 * against the LIVE, data-driven queue: rows are keyed by DB id and the
 * in-context copy is derived generically by `urgentItemToQueueItem` —
 * NOT the retired hand-authored leak/vendor mock the page no longer
 * renders. It drives whatever rows the seeded Galaxy org surfaces.
 *
 *  - default state: TRY eyebrow + 4 portfolio default chips, no emphasis
 *  - row selection: row goes selected; AskOdesa swaps to IN CONTEXT + 4
 *    context chips + a row-specific placeholder; exactly one watch item
 *    lights up with a LINKED tag
 *  - switching rows moves the selection + emphasis (single-select)
 *  - clear context: the × button reverts to default
 *  - re-click clears: a second click on the same row toggles off
 *  - inline controls (the "Why this?" disclosure) don't propagate to row
 *    selection (the stopPropagation contract)
 *
 * Seeded Galaxy reliably renders a populated queue; the one test that
 * needs ≥2 rows guards on the count so an unusually quiet seed can't
 * false-fail. Skipped when the local Supabase stack isn't running.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

/** The four portfolio-wide default chips (verbatim from the live component). */
const DEFAULT_CHIPS: ReadonlyArray<string> = [
  'Who needs follow-up this afternoon?',
  'Draft May late-rent reminders',
  'Show vendor delays',
  'What should I review before Monday?',
];

/** The default Ask Odesa placeholder prefix — swapped out when in context. */
const DEFAULT_PLACEHOLDER_PREFIX = 'Ask Odesa — try';

function queueRows(page: Page) {
  return page.locator('[data-section="owner-review"] [data-queue-row]');
}

/**
 * Assert AskOdesa is in its default (no-context) state: TRY eyebrow,
 * the 4 portfolio default chips, and no clear-context button visible.
 */
async function expectDefaultAskOdesa(page: Page): Promise<void> {
  const ask = page.locator('[data-section="ask-odesa"]');
  await expect(ask).toBeVisible();
  await expect(ask.locator('[data-ask-eyebrow]')).toContainText('TRY');

  const chips = ask.locator('[data-suggestion-chip]');
  await expect(chips).toHaveCount(4);
  for (const chip of DEFAULT_CHIPS) {
    await expect(ask).toContainText(chip);
  }

  // No watch item should be emphasized in the default state.
  await expect(
    page.locator('[data-watch-item][data-emphasized="true"]'),
  ).toHaveCount(0);

  // Clear-context button is hidden in default state.
  const clearBtn = ask.locator('[data-clear-context]');
  const clearVisible = await clearBtn.isVisible().catch(() => false);
  expect(clearVisible).toBe(false);
}

test.describe('today v2: owner-review queue interactions', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
    // Anchor on a mounted section so each test starts from a settled page.
    await expect(page.locator('[data-section="ask-odesa"]')).toBeVisible();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('default state: TRY eyebrow + 4 default chips + no emphasis', async ({
    page,
  }) => {
    await expectDefaultAskOdesa(page);
  });

  test('selecting a row swaps AskOdesa into context and lights up a watch item', async ({
    page,
  }) => {
    const row = queueRows(page).first();
    await expect(row).toBeVisible();
    await row.click();

    // Row selection state.
    await expect(row).toHaveAttribute('data-selected', 'true');

    const ask = page.locator('[data-section="ask-odesa"]');

    // Eyebrow flips into in-context mode (derived label, e.g.
    // "IN CONTEXT — MAINTENANCE ITEM · UNIT 3B").
    const eyebrow = ask.locator('[data-ask-eyebrow]');
    await expect(eyebrow).toHaveAttribute('data-ask-eyebrow', 'IN_CONTEXT');
    await expect(eyebrow).toContainText(/in context/i);

    // Exactly the 4 derived context chips (swapped off the default set).
    await expect(ask.locator('[data-suggestion-chip]')).toHaveCount(4);

    // A row-specific placeholder replaced the default "Ask Odesa — try …".
    const placeholder = await ask
      .locator('[data-ask-input]')
      .getAttribute('placeholder');
    expect(placeholder ?? '').not.toContain(DEFAULT_PLACEHOLDER_PREFIX);
    expect(placeholder ?? '').toMatch(/ask about this/i);

    // The clear-context button is now available.
    await expect(ask.locator('[data-clear-context]')).toBeVisible();

    // Exactly one watch item is emphasized and surfaces the LINKED tag.
    const emphasized = page.locator(
      '[data-watch-item][data-emphasized="true"]',
    );
    await expect(emphasized).toHaveCount(1);
    await expect(emphasized).toContainText(/LINKED:/i);
  });

  test('switching to another row moves the selection and the emphasis', async ({
    page,
  }) => {
    const rows = queueRows(page);
    const count = await rows.count();
    test.skip(count < 2, 'needs at least two queue rows to test row-switching');

    const first = rows.nth(0);
    const second = rows.nth(1);

    await first.click();
    await expect(first).toHaveAttribute('data-selected', 'true');

    await second.click();
    // Single-select: the first row releases, the second holds selection.
    await expect(first).toHaveAttribute('data-selected', 'false');
    await expect(second).toHaveAttribute('data-selected', 'true');

    // Still exactly one watch item emphasized after the swap.
    await expect(
      page.locator('[data-watch-item][data-emphasized="true"]'),
    ).toHaveCount(1);
  });

  test('clear context button reverts to the default state', async ({ page }) => {
    const row = queueRows(page).first();
    await row.click();
    await expect(row).toHaveAttribute('data-selected', 'true');

    const clearBtn = page
      .locator('[data-section="ask-odesa"] [data-clear-context]')
      .first();
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    await expect(row).toHaveAttribute('data-selected', 'false');
    await expectDefaultAskOdesa(page);
  });

  test('re-clicking the same row clears the selection', async ({ page }) => {
    const row = queueRows(page).first();
    await row.click();
    await expect(row).toHaveAttribute('data-selected', 'true');

    await row.click();
    await expect(row).toHaveAttribute('data-selected', 'false');
    await expectDefaultAskOdesa(page);
  });

  test('inline "Why this?" control does not propagate to row selection', async ({
    page,
  }) => {
    // Live rows carry a single primary action that is a navigation <Link>,
    // so the stopPropagation contract is exercised through the
    // non-navigating inline control instead — the "Why this?" disclosure.
    // Clicking it must toggle the disclosure WITHOUT selecting the row.
    const row = queueRows(page)
      .filter({ has: page.locator('[data-disclosure="why"]') })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-selected', 'false');

    const why = row.locator('[data-disclosure="why"]');
    await expect(why).toHaveAttribute('aria-expanded', 'false');
    await why.click();

    // The disclosure opened, but the row stayed unselected...
    await expect(why).toHaveAttribute('aria-expanded', 'true');
    await expect(row).toHaveAttribute('data-selected', 'false');

    // ...and AskOdesa never left its default state.
    await expectDefaultAskOdesa(page);
  });
});
