/**
 * Count reconciliation — the QA "counts disagree" audit, as an e2e contract.
 *
 * Today, the sidebar, the Inbox, and the Owner Queue must all show the SAME
 * number for the SAME labelled scope. Each surface now routes its count
 * through one canonical query in `src/lib/operator/counts.ts`, so this spec
 * signs in as the standing seeded Galaxy owner, reads the rendered numbers,
 * and asserts the same-scope numbers are EQUAL. Expected values are derived
 * live from the DB via the service client — nothing is hardcoded.
 *
 * Scopes checked:
 *   - ownerDecisions       — sidebar "Owner queue" badge  == desk "N pending
 *                            owner decisions" == DB count of commit-capable
 *                            proposed proposals.
 *   - draftsAwaitingReview — sidebar "Inbox" badge == inbox strip "N need
 *                            review" == DB count of active pending drafts.
 *   - inboxThreads         — inbox strip "N threads" == DB count of threads
 *                            with a visible message.
 *   - todayUrgentReviews   — sidebar "Today" badge == Today "Owner review · N".
 *
 * REBUILD NOTE: the sidebar badges, the Today "Owner review" count testid,
 * and the badge labels are SERVER-RENDERED from this branch's `src` changes.
 * A prod server built BEFORE these changes still emits the old sidebar
 * (Today badge hardcoded 0, no `today-owner-review-count` testid, "proposed"
 * label). The owner + inbox reconciliation happen to hold on that old server
 * too (raw-proposed == commit-capable when there are no legacy rows, and the
 * inbox scopes are 0 in the seed), but the TODAY reconciliation only holds
 * once the coordinator rebuilds. That test is isolated so the others stay
 * green now; do not weaken it to pass pre-rebuild.
 *
 * Skips cleanly when the local Supabase stack is offline.
 */

import { expect, test, type Page } from '@playwright/test';

import { signInAs } from '../fixtures/galaxy';
import { HAVE_SUPABASE, GALAXY_ORG_ID, createAdmin } from '../today/helpers';
import { WORKER_ACTION_TYPES } from '../../src/lib/agent/worker/types';

/** The commit-capable action verbs `getDecisions` keeps (drops legacy rows). */
const COMMIT_CAPABLE = new Set<string>(WORKER_ACTION_TYPES);

/**
 * Reads the numeric badge on a sidebar nav link. The badge is hidden when
 * the count is 0, so an absent numeral reads as 0. Nav labels carry no
 * digits, so the first digit run in the link IS the count.
 */
async function sidebarBadge(page: Page, slug: string): Promise<number> {
  const link = page.getByTestId(`sidebar-link-${slug}`).first();
  const text = (await link.innerText()).trim();
  const m = text.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** Extracts the first capture group as a number, or throws if the pattern is absent. */
function numFrom(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  if (!m) throw new Error(`pattern ${pattern} not found in: ${text}`);
  return Number(m[1]);
}

test.describe('operator count reconciliation (seeded Galaxy)', () => {
  test.skip(!HAVE_SUPABASE, 'local Supabase stack required');

  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'owner');
  });

  test('owner decisions: sidebar badge == desk top bar == commit-capable DB count', async ({
    page,
  }) => {
    const admin = createAdmin();
    const { data: proposed } = await admin
      .from('action_proposals')
      .select('action_type')
      .eq('organization_id', GALAXY_ORG_ID)
      .eq('status', 'proposed');
    const expected = (proposed ?? []).filter((p) =>
      COMMIT_CAPABLE.has(p.action_type),
    ).length;

    await page.goto('/owner-queue');
    await expect(page.getByTestId('owner-queue-topbar')).toBeVisible();

    const topbarText = await page.getByTestId('owner-queue-topbar').innerText();
    const deskPending = numFrom(topbarText, /(\d+)\s+pending owner decisions/);
    const badge = await sidebarBadge(page, 'owner-queue');

    expect(deskPending).toBe(expected);
    expect(badge).toBe(expected);
  });

  test('inbox: threads + drafts-awaiting-review reconcile across strip, sidebar, and DB', async ({
    page,
  }) => {
    const admin = createAdmin();
    const nowIso = new Date().toISOString();

    // draftsAwaitingReview: outbound pending_review messages on threads that
    // are neither muted nor currently snoozed (matches getDraftsAwaitingReviewCount).
    const [{ data: pend }, { data: inactive }, { data: allMsgs }, { data: convs }] =
      await Promise.all([
        admin
          .from('messages')
          .select('conversation_id')
          .eq('organization_id', GALAXY_ORG_ID)
          .eq('direction', 'outbound')
          .eq('draft_status', 'pending_review'),
        admin
          .from('conversations')
          .select('id')
          .eq('organization_id', GALAXY_ORG_ID)
          .or(`muted.eq.true,snoozed_until.gt.${nowIso}`),
        admin
          .from('messages')
          .select('conversation_id, draft_status')
          .eq('organization_id', GALAXY_ORG_ID),
        admin
          .from('conversations')
          .select('id')
          .eq('organization_id', GALAXY_ORG_ID),
      ]);

    const inactiveIds = new Set((inactive ?? []).map((c) => c.id));
    const expectedDrafts = (pend ?? []).filter(
      (m) => m.conversation_id && !inactiveIds.has(m.conversation_id),
    ).length;

    // inboxThreads: conversations with >=1 non-rejected message (listConversations
    // skips conversations without a latest visible message).
    const convIds = new Set((convs ?? []).map((c) => c.id));
    const threadIds = new Set(
      (allMsgs ?? [])
        .filter(
          (m) =>
            m.draft_status !== 'rejected' &&
            m.conversation_id &&
            convIds.has(m.conversation_id),
        )
        .map((m) => m.conversation_id),
    );
    const expectedThreads = threadIds.size;

    await page.goto('/inbox');
    await expect(page.getByTestId('inbox-activity-strip')).toBeVisible();

    const stripText = await page.getByTestId('inbox-activity-strip').innerText();
    const threads = numFrom(stripText, /(\d+)\s+threads?/);
    const needReview = numFrom(stripText, /(\d+)\s+need review/);
    const badge = await sidebarBadge(page, 'inbox');

    expect(threads).toBe(expectedThreads);
    expect(needReview).toBe(expectedDrafts);
    // Same scope, one query → the sidebar badge must equal the strip's count.
    expect(badge).toBe(needReview);
  });

  // REBUILD-DEPENDENT: asserts the post-refactor Today↔sidebar contract. Fails
  // against a prod server built before this branch (old sidebar shows Today=0
  // and the count testid is absent). The coordinator re-runs it post-rebuild.
  test('today urgent reviews: sidebar badge == Today "Owner review" count', async ({
    page,
  }) => {
    await page.goto('/today');

    const count = Number(
      (await page.getByTestId('today-owner-review-count').innerText()).trim(),
    );
    const badge = await sidebarBadge(page, 'today');

    // Seed always carries the Unit 101 emergency work order, so the queue is
    // non-empty — a sanity guard that this isn't trivially 0 == 0.
    expect(count).toBeGreaterThan(0);
    // Same scope, one query (getUrgentItems, same cap) → they must be equal.
    expect(badge).toBe(count);
  });
});
