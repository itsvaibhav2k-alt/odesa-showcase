/**
 * Canonical operator count scopes.
 *
 * Single source of truth for the cross-surface numbers that Today, the
 * sidebar, the Inbox, and the Owner Queue all display. The QA audit found
 * these surfaces disagreeing about counts of the same entities (e.g. the
 * sidebar "Today" badge read 0 while Today showed live urgent rows; the
 * sidebar "Owner queue" badge counted raw `proposed` rows while the desk
 * counted the commit-capable subset). Each labelled scope below has ONE
 * query definition so the surfaces can never drift again.
 *
 * Every scope routes through the SAME canonical query the primary surface
 * already renders:
 *   - ownerDecisions / judgmentDecisions / routineBatchItems ← `getDecisions()`
 *     (the exact list the /owner-queue desk renders)
 *   - todayUrgentReviews ← `getUrgentItems()` (the exact list the Today
 *     Owner-Review queue renders — same default cap, so the badge can never
 *     show a number the queue doesn't)
 *   - draftsAwaitingReview ← outbound `pending_review` messages on threads
 *     that are neither muted nor currently snoozed (the Inbox "need review"
 *     definition, now shared by Today's handling panel + the sidebar)
 *
 * The sixth audited scope, `inboxThreads`, is single-surface (only the
 * Inbox strip shows it) and is canonically `listConversations().length` in
 * `@/lib/inbox/conversation-queries` — the very list the page already
 * renders. Adding a separate head-count here would risk diverging from that
 * list (a raw conversation count includes threads with no visible message),
 * so it is intentionally NOT duplicated into this module. The
 * count-reconciliation e2e still pins it to the same DB-derived definition.
 *
 * Labels (what each number counts) live next to the surface that renders
 * them; this module owns the arithmetic so the number is identical
 * everywhere it appears.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { getDecisions } from '@/lib/owner-queue/queries';
import { getUrgentItems } from '@/lib/today/queries';
import type { Database } from '@/types/database';

type ServerSupabase = SupabaseClient<Database>;

export interface OwnerDecisionCounts {
  /** Pending owner decisions — commit-capable proposals (legacy verbs dropped). */
  ownerDecisions: number;
  /** Subset needing owner judgment — 'review'/'block' gated. */
  judgmentDecisions: number;
  /** Subset safe to batch-approve — 'auto' gated. */
  routineBatchItems: number;
}

/**
 * Owner-decision counts, all three derived from the single canonical
 * {@link getDecisions} query the /owner-queue desk renders — so the sidebar
 * badge, the desk top bar, and the routine/judgment splits can never
 * disagree. `getDecisions` already drops legacy non-commit-capable rows, so
 * this count is the honest "what the owner can actually act on" number.
 */
export async function getOwnerDecisionCounts(): Promise<OwnerDecisionCounts> {
  const decisions = await getDecisions();
  const routineBatchItems = decisions.filter(
    (d) => d.recommendation === 'approve',
  ).length;
  return {
    ownerDecisions: decisions.length,
    judgmentDecisions: decisions.length - routineBatchItems,
    routineBatchItems,
  };
}

/**
 * Urgent reviews on the Today Owner-Review queue. Counts the SAME
 * {@link getUrgentItems} list the queue renders (default cap included) so
 * the sidebar "Today" badge and the queue's own "Owner review · N" heading
 * always match — never the old hardcoded 0.
 */
export async function getTodayUrgentReviewCount(): Promise<number> {
  return (await getUrgentItems()).length;
}

/**
 * Drafts awaiting owner review — outbound `pending_review` messages on
 * threads that are neither muted nor currently snoozed (muting/snoozing a
 * thread drops its draft out of the "needs you" count immediately). ONE
 * definition, consumed by the Inbox activity strip, the Today handling
 * panel, and the sidebar badge.
 *
 * @param supabase - RLS-scoped server client (org-scoped by the caller's cookies).
 */
export async function getDraftsAwaitingReviewCount(
  supabase: ServerSupabase,
): Promise<number> {
  const nowIso = new Date().toISOString();

  const [pendingRows, inactiveConvs] = await Promise.all([
    supabase
      .from('messages')
      .select('conversation_id')
      .eq('direction', 'outbound')
      .eq('draft_status', 'pending_review'),
    supabase
      .from('conversations')
      .select('id')
      .or(`muted.eq.true,snoozed_until.gt.${nowIso}`),
  ]);

  const inactiveIds = new Set((inactiveConvs.data ?? []).map((c) => c.id));
  return (pendingRows.data ?? []).filter(
    (m) => m.conversation_id && !inactiveIds.has(m.conversation_id),
  ).length;
}
