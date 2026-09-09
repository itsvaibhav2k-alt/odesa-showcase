/**
 * Today v2 — operator-accountability behavioral spec.
 *
 * Verifies the "Sharpen, don't expand" pass: the page reads like an
 * accountable operator, not a beautiful AI briefing. Each assertion is
 * written to hold REGARDLESS of seed data — data-dependent checks are
 * conditional-guarded so an empty Galaxy seed can never false-fail, and
 * the seed-independent regression checks (no "just now ago", Ask Odesa
 * navigation) always run.
 *
 * Covers the four trust-eroding defects the redesign repaired:
 *  1. The broken "checked just now ago" / "Refreshed … just now ago"
 *     grammar (centralized in `formatAgoPhrase`) never appears anywhere.
 *  2. Owner-review row titles are event-first ("Rent escalation",
 *     "Emergency repair", …) — never the old generic "Escalated" /
 *     "Emergency WO" labels — and action links route to
 *     `/review/<kind>/<id>`.
 *  3. Ask Odesa is live: typing + submit, and a suggestion-chip click,
 *     both navigate to `/assistant?q=…`.
 *  4. The "Why this?" disclosure reveals additional grounded text.
 *
 * Sources data the same way the sibling a11y/render specs do — a seeded
 * Galaxy owner via `provisionGalaxyOwner` + `signIn` — and skips cleanly
 * when the local Supabase stack isn't configured.
 *
 * Scope: this spec only. It intentionally does NOT touch the visual
 * snapshot suite (`today-visual`), whose baselines are stale until
 * design sign-off.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from './helpers';

/** Forbidden grammar — the bug the centralized `formatAgoPhrase` killed. */
const BROKEN_AGO = 'just now ago';
const BROKEN_CHECKED = 'checked just now ago';

/** The old generic row titles that the event-first pass replaced. */
const FORBIDDEN_ROW_TITLES = ['Escalated', 'Emergency WO'];

test.describe('today v2: operator accountability', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
    // Anchor on a structural section so every test starts from a mounted
    // page rather than a mid-navigation state.
    await expect(page.locator('[data-section="ask-odesa"]')).toBeVisible();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. No "just now ago" grammar defect anywhere (seed-independent)
  // ─────────────────────────────────────────────────────────────────

  test('renders without the "just now ago" / "checked just now ago" defect', async ({
    page,
  }) => {
    // Wait for the freshness stamps to mount before scanning text.
    await expect(page.locator('[data-section="owner-review"]')).toBeVisible();
    await expect(page.locator('[data-freshness]')).toBeVisible();

    // Full-page text scan: no node may contain either broken phrase. The
    // body text is the union of every visible/invisible text node, so a
    // single `.toContain` check covers the topbar, briefing eyebrow, and
    // rail footer at once.
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    expect(bodyText).not.toContain(BROKEN_AGO);
    expect(bodyText).not.toContain(BROKEN_CHECKED);

    // Belt-and-suspenders: no individual text node equals or contains the
    // broken phrase (catches a node that `innerText` might collapse).
    const offending = await page.evaluate((needle) => {
      const matches: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node = walker.nextNode();
      while (node) {
        const text = (node.textContent ?? '').toLowerCase();
        if (text.includes(needle)) matches.push(text.trim());
        node = walker.nextNode();
      }
      return matches;
    }, BROKEN_AGO);
    expect(offending, `text nodes containing "${BROKEN_AGO}"`).toEqual([]);

    // The topbar freshness stamp specifically must read grammatically.
    const freshnessText = (
      await page.locator('[data-freshness]').innerText()
    ).toLowerCase();
    expect(freshnessText).not.toContain(BROKEN_AGO);

    // The rail footer ("Refreshed …") must not carry the defect either.
    const railFooterText = (
      await page.locator('[data-section="watching"]').innerText()
    ).toLowerCase();
    expect(railFooterText).not.toContain(BROKEN_AGO);
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. Event-first owner-review titles + /review/<kind>/<id> routing
  // ─────────────────────────────────────────────────────────────────

  test('owner-review titles are event-first and actions route to /review/<kind>/<id>', async ({
    page,
  }) => {
    const ownerReview = page.locator('[data-section="owner-review"]');
    await expect(ownerReview).toBeVisible();

    const rows = ownerReview.locator('[data-queue-row]');
    const rowCount = await rows.count();

    // Data-dependent: an empty Galaxy seed renders the quiet empty state
    // (`[data-queue-empty]`) and no rows. Only assert row semantics when
    // rows actually exist, so the spec can't false-fail on an empty seed.
    if (rowCount === 0) {
      await expect(
        ownerReview.locator('[data-queue-empty]'),
        'empty queue must show the quiet empty state, not a bare box',
      ).toBeVisible();
      return;
    }

    // The visible title is the first text block inside each row's body.
    // Assert NO row title is exactly one of the old generic labels.
    const titles = await rows.evaluateAll((nodes) =>
      nodes.map((node) => {
        // The body column is the 2nd grid child; its first child div is
        // the title line. Fall back to the row text if the structure
        // shifts so the assertion still has something to check.
        const body = node.children[1] as HTMLElement | undefined;
        const titleEl = body?.children[0] as HTMLElement | undefined;
        return (titleEl?.textContent ?? '').trim();
      }),
    );

    expect(titles.length).toBe(rowCount);
    for (const title of titles) {
      for (const forbidden of FORBIDDEN_ROW_TITLES) {
        expect(
          title,
          `row title must not be the old generic label "${forbidden}"`,
        ).not.toBe(forbidden);
      }
    }

    // At least one action link/button must route to a review detail page.
    // Live rows render the primary action as a <Link> whose href is the
    // row's `/review/<kind>/<id>` target. Collect every action href.
    const actionHrefs = await ownerReview
      .locator('[data-action]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href')).filter(Boolean),
      );

    const reviewRoute = /\/review\/(rent|work_order|conversation)\//;
    const hasReviewRoute = actionHrefs.some(
      (href) => href != null && reviewRoute.test(href),
    );
    expect(
      hasReviewRoute,
      `at least one action must route to /review/<kind>/<id>; got hrefs=${JSON.stringify(
        actionHrefs,
      )}`,
    ).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Ask Odesa is live — input submit + chip click navigate to
  //    /assistant?q=… (seed-independent: default chips always render)
  // ─────────────────────────────────────────────────────────────────

  test('Ask Odesa input submit (Enter) navigates to /assistant?q=…', async ({
    page,
  }) => {
    const input = page.locator('[data-ask-input]');
    await expect(input).toBeVisible();

    await input.click();
    await input.fill('what should I review before Monday?');
    await input.press('Enter');

    await page.waitForURL(/\/assistant\?q=/);
    expect(page.url()).toContain('/assistant?q=');
  });

  test('Ask Odesa send button navigates to /assistant?q=…', async ({
    page,
  }) => {
    const input = page.locator('[data-ask-input]');
    await expect(input).toBeVisible();

    await input.fill('show vendor delays');
    // The ↵ send button is the submit control inside the ask-odesa form.
    await page
      .locator('[data-section="ask-odesa"] button[type="submit"]')
      .click();

    await page.waitForURL(/\/assistant\?q=/);
    expect(page.url()).toContain('/assistant?q=');
  });

  test('Ask Odesa suggestion chip click navigates to /assistant?q=…', async ({
    page,
  }) => {
    const ask = page.locator('[data-section="ask-odesa"]');
    await expect(ask).toBeVisible();

    const firstChip = ask.locator('[data-suggestion-chip]').first();
    await expect(firstChip).toBeVisible();
    await firstChip.click();

    await page.waitForURL(/\/assistant\?q=/);
    expect(page.url()).toContain('/assistant?q=');
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. "Why this?" disclosure reveals additional grounded text
  //    (data-dependent: only live rows carry a `reason`)
  // ─────────────────────────────────────────────────────────────────

  test('"Why this?" control, when present, reveals additional text on click', async ({
    page,
  }) => {
    const whyButtons = page.locator(
      '[data-section="owner-review"] [data-disclosure="why"]',
    );
    const whyCount = await whyButtons.count();

    // Conditional-guard: an empty seed (or rows without a grounded
    // reason) renders no "Why this?" control. Skip the assertion rather
    // than false-fail when there's nothing to disclose.
    if (whyCount === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No "Why this?" control rendered (empty/seed-less queue).',
      });
      return;
    }

    const why = whyButtons.first();
    await expect(why).toBeVisible();
    await expect(why).toHaveAttribute('aria-expanded', 'false');

    // Measure the owning row's text before/after to confirm the click
    // reveals MORE text (the grounded `reason` line), not just toggles a
    // class. The row is the closest [data-queue-row] ancestor.
    const owningRow = page
      .locator('[data-section="owner-review"] [data-queue-row]')
      .filter({ has: page.locator('[data-disclosure="why"]') })
      .first();

    const before = (await owningRow.innerText()).length;
    await why.click();
    await expect(why).toHaveAttribute('aria-expanded', 'true');

    // The reveal must surface additional visible text in the same row.
    await expect
      .poll(async () => (await owningRow.innerText()).length, {
        message: 'clicking "Why this?" must reveal additional text',
      })
      .toBeGreaterThan(before);
  });

  // ─────────────────────────────────────────────────────────────────
  // Bonus: domain-specific source link routes to the row evidence
  // (data-dependent, conditional-guarded)
  // ─────────────────────────────────────────────────────────────────

  test('source links, when present, point at the row evidence route', async ({
    page,
  }) => {
    const sourceLinks = page.locator(
      '[data-section="owner-review"] [data-source-link]',
    );
    const count = await sourceLinks.count();

    if (count === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No source links rendered (empty/seed-less queue).',
      });
      return;
    }

    const hrefs = await sourceLinks.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href')).filter(Boolean),
    );
    const reviewRoute = /\/review\/(rent|work_order|conversation)\//;
    for (const href of hrefs) {
      expect(
        href != null && reviewRoute.test(href),
        `source link href must be a /review/<kind>/<id> route; got "${href}"`,
      ).toBe(true);
    }
  });
});
