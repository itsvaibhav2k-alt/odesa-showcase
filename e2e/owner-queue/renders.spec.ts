/**
 * Owner Queue ("Decisions Desk") — render + interaction spec.
 *
 * Mounts `/owner-queue` for a seeded Galaxy owner and asserts the page's
 * STRUCTURAL anchors and core interactions in a way that holds REGARDLESS
 * of the live seed.
 *
 * Why this was rewritten: the original spec hard-coded mock decision ids
 * (`switch` / `dispatch` / `heater` / `renewal` / `waiver`) and a literal
 * "5 pending" count. The desk now renders LIVE `action_proposals` whose ids
 * are real UUIDs and whose pending count drifts with the seed, so every
 * id-pinned and count-pinned assertion false-fails. This rewrite:
 *
 *   - Anchors on stable structural test-ids that never depend on data
 *     (`owner-queue-page`, `owner-queue-topbar`, `ask-odesa-input`).
 *   - Asserts the pending count is a grammatical "<N> pending" rather than a
 *     fixed number, and that N agrees with the rendered card count.
 *   - Selects cards / disclosures / commit controls by test-id PREFIX
 *     (`decision-card-`, `why-`, `approve-`, `reasoning-`) so real UUID ids
 *     resolve.
 *   - Conditional-guards every data-dependent check: a non-empty queue shows
 *     the summary banner + at least one card; an empty queue shows the quiet
 *     `owner-queue-empty` state. Neither can false-fail the other.
 *   - Sweeps the full page text to prove the removed phrases "Switch now" and
 *     "Hold until 3 PM" appear NOWHERE — the display-language regression the
 *     review pass is responsible for.
 *   - Reflects the Pass-2 desk: the commit controls (per-card Approve / Decline,
 *     the batch "Approve all") are now LIVE and enabled. This spec asserts they
 *     render enabled with their final labels but does NOT click a final commit —
 *     the safe commit behavior (preview drawer for tenant-facing/money/lease, the
 *     batch acknowledgement gate) is exercised in decisions-desk.spec. The
 *     read-only affordances (Why this?, the Ask Odesa chips that route to
 *     `/assistant?q=…`) ARE exercised as functional here.
 *
 * Reuses the Today suite's Supabase auth helpers verbatim
 * (`provisionGalaxyOwner` + `signIn`); only the navigation target changes to
 * `/owner-queue`. Skipped when the local Supabase stack is unavailable.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from "../today/helpers";

/**
 * Display-language phrases the review pass removed. They must never appear in
 * the desk again — "Hold until 3 PM" fabricated an enforced ETA and "Switch
 * now" fabricated a vendor alternative, both forbidden by the evidence-only
 * rule. The sweep is case-insensitive so a casing tweak can't smuggle them back.
 */
const FORBIDDEN_PHRASES = ["switch now", "hold until 3 pm"] as const;

/** Test-id prefixes for the per-card controls (ids are live UUIDs). */
const CARD_PREFIX = "decision-card-";

/**
 * Returns every visible decision card. Cards are keyed `decision-card-<id>`
 * for both the judgment and recommended variants, so a prefix match collects
 * the whole feed regardless of how the live queue splits across sections.
 */
function decisionCards(page: Page) {
  return page.locator(`[data-testid^="${CARD_PREFIX}"]`);
}

test.describe("owner-queue: Decisions Desk renders and reacts", () => {
  test.skip(
    !HAVE_SUPABASE,
    "Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run",
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto("/owner-queue");
    await page.waitForURL(/\/owner-queue/, { timeout: 15_000 });
    // Anchor on the page root so each test starts from a mounted page
    // rather than a mid-navigation state.
    await expect(page.getByTestId("owner-queue-page")).toBeVisible();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. Structural shell: page root + top bar with a grammatical count
  // ─────────────────────────────────────────────────────────────────

  test('page and top bar render with a grammatical "<N> pending" count', async ({
    page,
  }) => {
    await expect(page.getByTestId("owner-queue-page")).toBeVisible();

    const topbar = page.getByTestId("owner-queue-topbar");
    await expect(topbar).toBeVisible();
    await expect(topbar).toContainText(/Owner queue/i);

    // Seed-independent: the count is whatever the live queue holds, but it
    // must read as "<number> pending" — never a hard-coded "5 pending".
    await expect(topbar).toContainText(/\d+\s+pending/i);

    // The bounded ledger renders one page at a time, so its range status — not
    // the number of currently mounted rows — must agree with the top bar.
    const topbarText = await topbar.innerText();
    const match = topbarText.match(/(\d+)\s+pending/i);
    expect(
      match,
      `top bar must show "<N> pending"; got "${topbarText}"`,
    ).not.toBeNull();
    const claimedPending = Number(match![1]);

    const ledgerRange = page.getByTestId("ledger-range");
    await expect(ledgerRange).toContainText(
      new RegExp(`of\\s+${claimedPending}$`, "i"),
    );

    const visibleRowCount = await decisionCards(page).count();
    expect(
      visibleRowCount,
      "a non-empty ledger page must render at least one row",
    ).toBeGreaterThan(0);
    expect(
      visibleRowCount,
      "the ledger is deliberately bounded to ten rows per page",
    ).toBeLessThanOrEqual(10);
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. Non-empty vs empty queue (mutually-exclusive, conditional-guarded)
  // ─────────────────────────────────────────────────────────────────

  test("non-empty queue shows the summary banner + at least one card; empty queue shows the quiet empty state", async ({
    page,
  }) => {
    const cards = decisionCards(page);
    const cardCount = await cards.count();

    if (cardCount === 0) {
      // Empty seed → the quiet "all caught up" state, never a bare page.
      await expect(
        page.getByTestId("owner-queue-empty"),
        "empty queue must render the quiet empty state",
      ).toBeVisible();
      // No summary banner / approve-all control when there is nothing to batch.
      await expect(page.getByTestId("decision-summary-banner")).toHaveCount(0);
      await expect(page.getByTestId("approve-all-button")).toHaveCount(0);
      return;
    }

    // Non-empty seed → at least one decision card and the summary banner.
    await expect(cards.first()).toBeVisible();
    await expect(page.getByTestId("owner-queue-empty")).toHaveCount(0);
    await expect(page.getByTestId("decision-summary-banner")).toBeVisible();
    await expect(page.getByTestId("approve-all-button")).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Display-language regression: forbidden phrases appear NOWHERE
  // ─────────────────────────────────────────────────────────────────

  test('the desk never renders "Switch now" or "Hold until 3 PM"', async ({
    page,
  }) => {
    // Full-page text scan: the body text is the union of every text node, so
    // one `.toContain` per phrase covers cards, the approve-all modal trigger,
    // and any footer copy at once.
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(
        bodyText,
        `page text must not contain the removed phrase "${phrase}"`,
      ).not.toContain(phrase);
    }

    // Belt-and-suspenders: walk every text node so a phrase `innerText` might
    // collapse (e.g. split across inline elements) still can't slip through.
    const offending = await page.evaluate(
      (needles) => {
        const hits: string[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let node = walker.nextNode();
        while (node) {
          const text = (node.textContent ?? "").toLowerCase();
          for (const needle of needles) {
            if (text.includes(needle)) hits.push(text.trim());
          }
          node = walker.nextNode();
        }
        return hits;
      },
      [...FORBIDDEN_PHRASES],
    );
    expect(
      offending,
      `text nodes containing a forbidden phrase: ${JSON.stringify(offending)}`,
    ).toEqual([]);

    // Pass 2: the approve-all control is now ENABLED (batch commit is wired and
    // gated behind the modal's explicit acknowledgement — exercised safely in
    // decisions-desk.spec). Here we only confirm its own label carries no
    // forbidden phrase; the full-page sweep above covers every rendered node.
    const approveAll = page.getByTestId("approve-all-button");
    if ((await approveAll.count()) > 0) {
      const triggerText = (await approveAll.innerText()).toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(
          triggerText,
          `approve-all trigger must not contain the removed phrase "${phrase}"`,
        ).not.toContain(phrase);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. "Why this?" disclosure toggles aria-expanded + shows the panel
  //    (data-dependent: only runs when a card with a Why control exists)
  // ─────────────────────────────────────────────────────────────────

  test('a "Why" disclosure, when present, flips aria-expanded and reveals the reasoning panel', async ({
    page,
  }) => {
    const toggles = page.locator('[data-testid^="why-"]');
    const toggleCount = await toggles.count();

    if (toggleCount === 0) {
      test.info().annotations.push({
        type: "note",
        description: 'No "Why" disclosure rendered (empty queue).',
      });
      return;
    }

    const toggle = toggles.first();
    // The disclosure is wired to its panel via aria-controls; derive the
    // panel test-id from that so the assertion follows the same UUID id.
    const controls = await toggle.getAttribute("aria-controls");
    expect(
      controls,
      "Why toggle must be wired to a panel via aria-controls",
    ).toBeTruthy();
    const panel = page.getByTestId(controls!);

    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. A routine approve control renders its final label and is enabled
  //    (Pass-2 commit wiring is live; safe commit behavior is covered by
  //    decisions-desk.spec). (data-dependent: only runs when one exists)
  // ─────────────────────────────────────────────────────────────────

  test("a routine approve control renders enabled with its final label", async ({
    page,
  }) => {
    // Scope to the per-card approve controls (`approve-<id>`); the batch
    // `approve-all-button` lives in the banner and is covered separately.
    const approves = page.locator(
      '[data-testid^="approve-"]:not([data-testid="approve-all-button"])',
    );
    const approveCount = await approves.count();

    if (approveCount === 0) {
      test.info().annotations.push({
        type: "note",
        description:
          "No routine approve control rendered (empty / judgment-only queue).",
      });
      return;
    }

    const approve = approves.first();
    const approveTestId = await approve.getAttribute("data-testid");
    expect(approveTestId).toMatch(/^approve-/);

    // Pass 2: the approve control is now LIVE — final label, enabled, no longer
    // the inert Pass-1 affordance. We assert it is interactive but do NOT click
    // it: a real click can commit a tenant-facing/money/lease action, which is
    // exercised SAFELY (preview drawer, no final commit) in decisions-desk.spec.
    await expect(approve).toBeEnabled();
    await expect(approve).not.toHaveAttribute("aria-disabled", "true");
    await expect(approve).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. Approve-all control carries its final label and is enabled (Pass-2;
  //    batch commit is gated behind the modal acknowledgement, covered by
  //    decisions-desk.spec). (data-dependent: only runs when there is a batch)
  // ─────────────────────────────────────────────────────────────────

  test("approve-all renders enabled with its final label", async ({ page }) => {
    const approveAll = page.getByTestId("approve-all-button");

    if ((await approveAll.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description: "No approve-all control rendered (empty queue).",
      });
      return;
    }

    // Pass 2: the batch control is now ENABLED (commit is wired, gated behind
    // the modal's explicit acknowledgement — exercised safely in
    // decisions-desk.spec). Assert it is interactive; do NOT open/commit here.
    await expect(approveAll).toBeEnabled();
    await expect(approveAll).not.toHaveAttribute("aria-disabled", "true");
    await expect(approveAll).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────
  // 7. Ask Odesa: a suggestion chip routes to /assistant (read-only
  //    affordance, always present — the panel renders default chips even
  //    with an empty queue)
  // ─────────────────────────────────────────────────────────────────

  test("clicking the first ask chip routes to /assistant with Owner Queue context", async ({
    page,
  }) => {
    const chips = page.getByTestId("ask-chip");

    if ((await chips.count()) === 0) {
      test.info().annotations.push({
        type: "note",
        description:
          "No ask chips rendered (Ask Odesa panel absent on empty queue).",
      });
      return;
    }

    const firstChip = chips.first();
    const chipText = (await firstChip.innerText()).trim();
    expect(chipText.length).toBeGreaterThan(0);

    // The sharpened desk treats the chip as a functional read-only affordance:
    // it routes to the global assistant rather than mutating the input.
    // Confirm the input is untouched on this page BEFORE the click navigates
    // away — the chip never fills the input.
    await expect(page.getByTestId("ask-odesa-input")).toHaveValue("");

    // The navigation IS the behavior under test: tapping the chip lands on
    // /assistant with the Owner Queue scope and chip text carried in q.
    await firstChip.click();
    await page.waitForURL(/\/assistant\?q=/, { timeout: 15_000 });
    const query = new URL(page.url()).searchParams.get("q");
    expect(query).toContain("Owner Queue context");
    expect(query).toContain(chipText);
  });
});
