/**
 * Today empty-state spec.
 *
 * Provisions a brand-new owner with a fresh org (one bare property; no
 * units, leases, tenants, work orders, or rent events) and asserts the
 * live Quiet Operator Console degrades gracefully AND honestly:
 *
 *  - the page renders (no crash on empty queries) — every structural
 *    section of the console mounts
 *  - the owner-review queue shows its quiet empty state ("Nothing needs
 *    your review right now.") with zero rows — no fake urgency
 *  - Ask Odesa still offers its default suggestions, so the operator can
 *    always ask even on a quiet day
 *  - the watch rail + freshness stamp still render, proving Odesa checked
 *    the portfolio rather than showing a blank "nothing here" panel
 *
 * Guards against regressions where a query returning no rows crashes the
 * page (e.g. `.single()` throwing, NaN coercion), where the empty state
 * stops proving monitoring, or where it starts inventing urgency.
 *
 * Selectors match the LIVE page (the interactive island in
 * `today-interactions.tsx` + `ask-odesa-command.tsx`) — the same anchors
 * the passing `today-operator` / `renders` specs use.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionFreshOwner,
  signIn,
  type FreshOwner,
} from './helpers';

test.describe('today: empty state for a fresh org', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: FreshOwner;

  test.beforeEach(async () => {
    owner = await provisionFreshOwner();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  async function gotoToday(
    page: import('@playwright/test').Page,
  ): Promise<void> {
    await signIn(page, { email: owner.email, password: owner.password });
    if (!/\/today/.test(page.url())) {
      await page.goto('/today');
    }
  }

  test('renders the core console sections without crashing on empty data', async ({
    page,
  }) => {
    await gotoToday(page);

    // The page mounted (no empty-query crash): every structural section of
    // the live console is present.
    await expect(page.locator('[data-section="topbar"]')).toBeVisible();
    await expect(page.locator('[data-section="briefing"]')).toBeVisible();
    await expect(page.locator('[data-section="owner-review"]')).toBeVisible();
    await expect(page.locator('[data-section="watching"]')).toBeVisible();
    await expect(page.locator('[data-section="ask-odesa"]')).toBeVisible();
  });

  test('owner-review queue is quietly empty — zero rows, no fake urgency', async ({
    page,
  }) => {
    await gotoToday(page);

    const ownerReview = page.locator('[data-section="owner-review"]');
    await expect(ownerReview).toBeVisible();

    // A fresh org has nothing urgent — no queue rows at all...
    await expect(ownerReview.locator('[data-queue-row]')).toHaveCount(0);

    // ...and the quiet empty state stands in for them (never a bare box).
    const empty = ownerReview.locator('[data-queue-empty]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/nothing needs your review/i);
  });

  test('Ask Odesa still offers its default suggestions on a quiet day', async ({
    page,
  }) => {
    await gotoToday(page);

    const ask = page.locator('[data-section="ask-odesa"]');
    await expect(ask).toBeVisible();
    // Default (no-context) state: TRY eyebrow + the four portfolio chips.
    await expect(ask.locator('[data-ask-eyebrow]')).toContainText('TRY');
    await expect(ask.locator('[data-suggestion-chip]')).toHaveCount(4);
    await expect(ask.locator('[data-ask-input]')).toBeVisible();
  });

  test('watch rail + freshness stamp prove Odesa checked the portfolio', async ({
    page,
  }) => {
    await gotoToday(page);

    // The rail renders its per-channel signals (derived on every load),
    // proving monitoring happened even when nothing is urgent.
    await expect(page.locator('[data-section="watching"]')).toBeVisible();
    await expect(page.locator('[data-watch-item]').first()).toBeVisible();

    // The freshness stamp is the "Odesa checked your portfolio" proof.
    await expect(page.locator('[data-freshness]')).toBeVisible();
  });
});
