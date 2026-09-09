/**
 * Owner Queue — "Decisions Desk" PASS 2 behavioral spec (real decision control).
 *
 * Pass 1 left the action buttons DISABLED. Pass 2 ENABLES + wires them to the
 * real server actions (`approveDecision` / `declineDecision` / `saveDecisionEdits`
 * / `saveAndApproveDecision` / `batchApprove` / `saveDecisionAsOwnerRule`). This
 * spec proves the desk's control surface behaves AND — critically — that the
 * dangerous commit paths are gated behind an explicit confirm so a single click
 * can never fire a real SMS, Stripe link, or lease write.
 *
 * SAFETY CONTRACT (load-bearing — this spec MUST NOT regress it):
 *   - `send_tenant_message` → SMS, `request_rent_payment` → Stripe link + SMS,
 *     `update_rent` / `set_lease_terms` → lease write. Committing those is REAL.
 *   - So this spec NEVER clicks a final commit for those types: a message/money/
 *     lease card's primary ("Preview + approve" / "Escalate to owner" /
 *     "Edit terms") OPENS the edit drawer with a visible PREVIEW, and the spec
 *     STOPS THERE — it never clicks the in-drawer "Save & approve"
 *     (`decision-edit-save-approve`).
 *   - `dispatch_vendor` commit is a safe no-op (records the decision, vendor is
 *     not contacted), so "Record dispatch approval" is the only enabled primary the spec
 *     is allowed to actually click — and even that is optional (asserting it is
 *     enabled is sufficient).
 *   - Decline (recordOutcome rejected) is safe; the batch modal enumerates
 *     side-effects and gates the confirm behind an explicit acknowledgement — the
 *     spec opens the modal and asserts the gate WITHOUT confirming.
 *
 * Seed: the live Galaxy queue is empty by default, so `beforeAll` runs the
 * idempotent `seed:owner-queue` script (dedicated demo tenants on non-deliverable
 * +1555 numbers — see scripts/seed-owner-queue-proposals.mjs). The cards the seed
 * produces are humanized commit-capable verbs ("Send Tenant Message" /
 * "Dispatch Vendor" / "Update Rent" / "Request Rent Payment"); the legacy
 * non-schema titles ("Offer Payment Plan" / "Send Rent Reminder") are filtered
 * out of the live query, so they must NOT appear on the desk.
 *
 * Auth reuses the Today suite's `provisionGalaxyOwner` + `signIn` (same pattern
 * as today-a11y.spec.ts). Skipped when the local Supabase env isn't sourced.
 */

import { execFileSync } from 'node:child_process';

import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

/** Where the desk + drawer screenshots land for the verify report. */
const SHOT_DIR = '/tmp/owner-queue-shots-p2';

/** Per-card decision cards are keyed `decision-card-<uuid>` (prefix match). */
const CARD_PREFIX = 'decision-card-';

/**
 * Legacy, non-commit-capable titles the live query drops. They must NEVER render
 * on the desk again — committing one would fail re-validation, so surfacing it
 * would be false confidence. Case-insensitive so a casing tweak can't smuggle
 * them back.
 */
const FORBIDDEN_LEGACY_TITLES = [
  'offer payment plan',
  'send rent reminder',
  'draft lease renewal',
  'escalate collections',
] as const;

/** The card primary labels that OPEN THE PREVIEW DRAWER (never a bare commit). */
const DRAWER_OPENING_PRIMARIES = [
  'Preview + approve',
  'Escalate to owner',
  'Edit terms',
] as const;

function decisionCards(page: Page): Locator {
  return page.locator(`[data-testid^="${CARD_PREFIX}"]`);
}

/**
 * The first decision card whose primary action opens the preview drawer (a
 * message / money / lease decision). Resolves the card id off its primary
 * control's test-id (`approve-<id>`) so the drawer assertion follows the same
 * id. Returns null when none rendered.
 */
async function findDrawerOpeningCard(
  page: Page,
): Promise<{ id: string; label: string } | null> {
  const cards = decisionCards(page);
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const testId = await card.getAttribute('data-testid');
    if (!testId) continue;
    const id = testId.slice(CARD_PREFIX.length);
    const primary = card.getByTestId(`approve-${id}`);
    if ((await primary.count()) === 0) continue;
    const label = (await primary.innerText()).trim();
    if (DRAWER_OPENING_PRIMARIES.some((l) => label.startsWith(l))) {
      return { id, label };
    }
  }
  return null;
}

test.describe('owner-queue: Decisions Desk — real decision control (Pass 2)', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: source .env.local (SUPABASE_URL + SERVICE_ROLE + anon key) to run',
  );

  let owner: SeededOwner;

  // Seed the realistic commit-capable proposals ONCE for the whole file. The
  // script is idempotent (deterministic ids + ignoreDuplicates), so a re-run is
  // a harmless no-op — we never delete the rows in teardown (other specs/the
  // demo desk can keep using them; they only ever route to +1555 test contacts).
  test.beforeAll(() => {
    execFileSync(
      'node',
      ['--env-file=.env.local', 'scripts/seed-owner-queue-proposals.mjs'],
      { cwd: process.cwd(), stdio: 'inherit' },
    );
  });

  test.beforeEach(async ({ page }) => {
    owner = await provisionGalaxyOwner();
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/owner-queue');
    await page.waitForURL(/\/owner-queue/, { timeout: 15_000 });
    await expect(page.getByTestId('owner-queue-page')).toBeVisible();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  // ───────────────────────────────────────────────────────────────────
  // 1. The desk shows ONLY commit-capable cards — no legacy titles — and a
  //    desk screenshot is captured.
  // ───────────────────────────────────────────────────────────────────

  test('shows only commit-capable cards (no legacy titles) and captures the desk', async ({
    page,
  }) => {
    const cards = decisionCards(page);
    await expect(cards.first()).toBeVisible();
    expect(
      await cards.count(),
      'seed should produce at least one commit-capable card',
    ).toBeGreaterThan(0);

    // The summary banner + the (now-enabled) Approve-all control are present.
    await expect(page.getByTestId('decision-summary-banner')).toBeVisible();
    const approveAll = page.getByTestId('approve-all-button');
    await expect(approveAll).toBeVisible();
    await expect(approveAll).toBeEnabled();

    // No legacy, non-commit-capable titles anywhere on the desk.
    const bodyText = (await page.locator('body').innerText()).toLowerCase();
    for (const legacy of FORBIDDEN_LEGACY_TITLES) {
      expect(
        bodyText,
        `legacy non-commit-capable title "${legacy}" must not render`,
      ).not.toContain(legacy);
    }

    await page.screenshot({
      path: `${SHOT_DIR}/01-desk.png`,
      fullPage: true,
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // 2. A message/money/lease card's primary OPENS the edit drawer with a
  //    visible preview — and we STOP there. We never click "Save & approve".
  //    (data-dependent: only runs when such a card is present.)
  // ───────────────────────────────────────────────────────────────────

  test('a message/money card primary opens the edit drawer with a preview — without committing', async ({
    page,
  }) => {
    const target = await findDrawerOpeningCard(page);
    if (!target) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No message/money/lease card rendered — nothing to gate via the drawer.',
      });
      return;
    }

    const card = page.getByTestId(`${CARD_PREFIX}${target.id}`);
    const primary = card.getByTestId(`approve-${target.id}`);
    await expect(primary).toBeVisible();
    await expect(primary).toBeEnabled();

    // Clicking the primary OPENS the drawer — it must NOT commit. The drawer
    // and its in-drawer commit control mount; the spec asserts the preview and
    // then closes WITHOUT touching "Save & approve".
    await primary.click();

    const drawer = page.getByTestId('decision-edit-drawer');
    await expect(drawer).toBeVisible();

    // The in-drawer commit control is the ONLY real commit path. We assert it
    // is present (so the wiring exists) but NEVER click it.
    const saveApprove = page.getByTestId('decision-edit-save-approve');
    await expect(saveApprove).toBeVisible();

    // The card must NOT have flipped to approved from merely opening the drawer
    // (opening previews; it does not commit).
    await expect(page.getByTestId(`settled-${target.id}`)).toHaveCount(0);

    // For a tenant-facing message the drawer renders the styled tenant-facing
    // PREVIEW block; assert it + its recipient meta. For money/lease kinds the
    // drawer still renders editable fields (the in-drawer boundary names the
    // real commit) — assert the boundary so the preview-layer gate is proven.
    const preview = page.getByTestId('decision-edit-preview');
    const boundary = page.getByTestId('decision-edit-boundary');
    if (target.label.startsWith('Preview + approve')) {
      // Tenant-facing message: the preview block is the load-bearing artifact.
      await expect(preview).toBeVisible();
      await expect(preview).toContainText(/to/i);
      // G1 LOCK: the preview must render the REAL seeded message body, never an
      // empty "no message yet" placeholder. The two seeded send_tenant_message
      // bodies are the rent reminder ("friendly reminder") and the collections
      // note ("outstanding balance") — assert against both so the lock is robust
      // to whichever message card resolves first. No commit is performed.
      await expect(preview).not.toContainText(/no message yet/i);
      await expect(preview).toContainText(/friendly reminder|outstanding balance/i);
    } else {
      // Money / lease: the preview block is message-only, but the in-drawer
      // boundary line is the explicit "Save & approve does X now" gate.
      await expect(boundary).toBeVisible();
    }

    // Screenshot the open drawer (preview visible) for the verify report.
    await page.screenshot({
      path: `${SHOT_DIR}/02-drawer-open.png`,
      fullPage: true,
    });

    // Close the drawer WITHOUT committing — Cancel is the safe exit.
    await page.getByTestId('decision-edit-cancel').click();
    await expect(drawer).toBeHidden();
    // Still nothing committed.
    await expect(page.getByTestId(`settled-${target.id}`)).toHaveCount(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // 3. The `dispatch_vendor` "Record dispatch approval" primary is the ONLY enabled
  //    commit (a safe no-op — vendor is not contacted). Assert it is clickable
  //    and enabled. (data-dependent.)
  // ───────────────────────────────────────────────────────────────────

  test('the "Record dispatch approval" primary is enabled (safe no-op commit)', async ({
    page,
  }) => {
    // The dispatch card carries the literal "Record dispatch approval" primary label.
    const dispatchPrimary = page
      .locator('[data-testid^="approve-"]:not([data-testid="approve-all-button"])')
      .filter({ hasText: 'Record dispatch approval' });

    if ((await dispatchPrimary.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No dispatch_vendor card rendered.',
      });
      return;
    }

    const primary = dispatchPrimary.first();
    await expect(primary).toBeVisible();
    await expect(primary).toBeEnabled();

    // The boundary copy honestly states the vendor is not contacted.
    const card = primary.locator('xpath=ancestor::article[1]');
    await expect(card).toContainText(/vendor is not contacted/i);
  });

  // ───────────────────────────────────────────────────────────────────
  // 4. Decline is present on a card (the safe path) and stays inert until
  //    clicked — we do NOT exercise the mutation here (it's safe but real).
  // ───────────────────────────────────────────────────────────────────

  test('a Decline control is present on the desk (the safe path)', async ({
    page,
  }) => {
    const declines = page.locator('[data-testid^="decline-"]');
    expect(
      await declines.count(),
      'at least one card should expose a Decline control',
    ).toBeGreaterThan(0);
    const decline = declines.first();
    await expect(decline).toBeVisible();
    await expect(decline).toBeEnabled();
    await expect(decline).toHaveText(/decline/i);
  });

  // ───────────────────────────────────────────────────────────────────
  // 5. The batch "Approve all" modal ENUMERATES the included items' side
  //    effects AND gates the confirm behind an explicit acknowledgement —
  //    a single click can never fire a side-effecting batch. We open the modal
  //    and assert the gate WITHOUT confirming.
  // ───────────────────────────────────────────────────────────────────

  test('the batch modal enumerates side-effects and requires an explicit confirm', async ({
    page,
  }) => {
    const approveAll = page.getByTestId('approve-all-button');
    await expect(approveAll).toBeVisible();
    await expect(approveAll).toBeEnabled();

    await approveAll.click();

    const modal = page.getByTestId('approve-all-modal');
    await expect(modal).toBeVisible();

    // The modal enumerates the included routine items by listing their titles
    // under "Included". The auto-gated seed (rent reminder, send_tenant_message)
    // is a side-effecting message, so the explicit acknowledgement gate appears.
    await expect(modal).toContainText(/included/i);

    const ack = page.getByTestId('approve-all-ack');
    const ackCheckbox = page.getByTestId('approve-all-ack-checkbox');
    const confirm = page.getByTestId('modal-approve-button');

    if (await ack.isVisible().catch(() => false)) {
      // Side-effecting batch: the per-row side-effect line is enumerated and the
      // confirm is DISABLED until the owner explicitly acknowledges. We assert
      // the gate and DO NOT acknowledge / confirm — no batch commit fires.
      await expect(ack).toContainText(/sends/i);
      await expect(ackCheckbox).not.toBeChecked();
      await expect(confirm).toBeDisabled();
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    } else {
      // A dispatch-only / no-side-effect batch needs no second confirm, but the
      // included enumeration must still be present. We still never confirm.
      test.info().annotations.push({
        type: 'note',
        description:
          'Batch has no acknowledgement-worthy side effects; confirm not gated.',
      });
    }

    // Close the modal WITHOUT committing. The batch-success state must never
    // have been reached.
    await page.getByTestId('modal-cancel-button').click();
    await expect(modal).toBeHidden();
    await expect(page.getByTestId('batch-success')).toHaveCount(0);
  });
});
