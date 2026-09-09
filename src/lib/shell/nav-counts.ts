/**
 * Global sidebar nav counts.
 *
 * Fetched once per dashboard render in `src/app/(dashboard)/layout.tsx`
 * and passed to `<Sidebar counts={...} />`. Each query is RLS-scoped to
 * the caller's organization — no `organization_id` parameter so callers
 * cannot accidentally bypass it.
 *
 * All queries run in a single `Promise.all` to keep layout latency
 * within a single round-trip budget. Each individual query uses
 * `count: 'exact', head: true` so we get a count without paying for
 * row payloads.
 *
 * Errors from any single query degrade gracefully to `0` — the sidebar
 * is a navigation chrome surface and must not block render on a
 * transient count failure.
 */

import { cache } from 'react';
import { createServerClient } from '@/lib/supabase/server';
import {
  getDraftsAwaitingReviewCount,
  getOwnerDecisionCounts,
  getTodayUrgentReviewCount,
  type OwnerDecisionCounts,
} from '@/lib/operator/counts';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

export interface NavCounts {
  /**
   * Urgent reviews on the Today Owner-Review queue. Canonical
   * {@link getTodayUrgentReviewCount} — the exact list the queue renders —
   * so the badge matches Today's "Owner review · N" heading.
   */
  todayUrgent: number;
  /**
   * Drafts awaiting owner review — outbound `pending_review` messages on
   * active (non-muted, non-snoozed) threads. Canonical
   * {@link getDraftsAwaitingReviewCount}, shared with the Inbox activity
   * strip's "N need review" so the two can never disagree.
   */
  inboxDraftsAwaitingReview: number;
  /**
   * Pending owner decisions on the /owner-queue "Decisions Desk" — the
   * commit-capable subset (legacy seed `action_type`s are dropped in
   * `getDecisions`). Canonical {@link getOwnerDecisionCounts}, the SAME
   * source the desk top bar's "N pending owner decisions" renders, so the
   * badge and the page always agree.
   */
  ownerReview: number;
  /** Total properties in the org. */
  properties: number;
  /** Total tenants in the org. */
  tenants: number;
  /** Total vendors in the org. */
  vendors: number;
  /** Short month label for the rent nav link (e.g. "May"). */
  rentMonthLabel: string;
}

/** Returns "May" / "Jun" etc. for the current calendar month. */
function monthLabel(d: Date): string {
  return d.toLocaleString('en-US', { month: 'short' });
}

async function safeCount(
  promise: PromiseLike<{ count: number | null }>,
): Promise<number> {
  try {
    const { count } = await promise;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** RLS-scoped head counts for the portfolio tab strip. */
export interface PortfolioTabCounts {
  /** Total tenants in the org. */
  tenants: number;
  /** Total vendors in the org. */
  vendors: number;
  /** Total documents in the org. */
  documents: number;
}

/**
 * RLS-scoped head counts for the portfolio list tab strip
 * (Tenants / Vendors / Documents).
 *
 * Creates its own request-scoped Supabase client via `createServerClient()`
 * and is wrapped in React `cache()` so repeat calls within a single request
 * (sidebar via `getNavCounts` + the tab strip) share one round-trip. The
 * cache is request-scoped only — never module-level — so counts can never
 * leak across users or orgs.
 *
 * Never throws — individual query failures degrade to 0.
 */
export const getPortfolioTabCounts = cache(
  async (): Promise<PortfolioTabCounts> => {
    const supabase = await createServerClient();

    const [tenants, vendors, documents] = await Promise.all([
      safeCount(
        supabase.from('tenants').select('id', { count: 'exact', head: true }),
      ),
      safeCount(
        supabase.from('vendors').select('id', { count: 'exact', head: true }),
      ),
      safeCount(
        // `documents` is not in the generated Database types yet — cast the
        // table name, mirroring src/lib/documents/queries.ts.
        supabase
          .from('documents' as never)
          .select('id', { count: 'exact', head: true }),
      ),
    ]);

    return { tenants, vendors, documents };
  },
);

/**
 * Reads RLS-scoped counts for the sidebar nav badges.
 *
 * Tenants/vendors are sourced from `getPortfolioTabCounts()` so the sidebar
 * and the portfolio tab strip can never diverge.
 *
 * @param supabase - Server-side Supabase client (created with
 *   `createServerClient()` in the dashboard layout).
 * @returns A snapshot of nav counts. Never throws — individual query
 *   failures degrade to 0 so the shell still renders.
 */
export async function getNavCounts(
  supabase: SupabaseServerClient,
): Promise<NavCounts> {
  // Every operator badge routes through the shared canonical scope (see
  // src/lib/operator/counts.ts) so the sidebar can never disagree with the
  // surface it links to. Each is wrapped so a transient failure degrades to
  // a zeroed count rather than blocking the shell render.
  // ponytail: the owner/today scopes re-run getDecisions/getUrgentItems on
  // every dashboard render (the shell needs correct badges everywhere). If
  // that read cost shows up, wrap those two queries in React cache() so the
  // layout and the page share one fetch on their own routes.
  const [ownerCounts, todayUrgent, inboxDraftsAwaitingReview, properties, tabCounts] =
    await Promise.all([
      safeOwnerCounts(),
      safeNum(() => getTodayUrgentReviewCount()),
      safeNum(() => getDraftsAwaitingReviewCount(supabase)),
      safeCount(
        supabase.from('properties').select('id', { count: 'exact', head: true }),
      ),
      getPortfolioTabCounts(),
    ]);

  return {
    todayUrgent,
    inboxDraftsAwaitingReview,
    ownerReview: ownerCounts.ownerDecisions,
    properties,
    tenants: tabCounts.tenants,
    vendors: tabCounts.vendors,
    rentMonthLabel: monthLabel(new Date()),
  };
}

/** Runs a count helper, degrading to 0 on any error (shell must not block). */
async function safeNum(fn: () => Promise<number>): Promise<number> {
  try {
    return await fn();
  } catch {
    return 0;
  }
}

/** Owner-decision counts with the same graceful-degrade contract as {@link safeCount}. */
async function safeOwnerCounts(): Promise<OwnerDecisionCounts> {
  try {
    return await getOwnerDecisionCounts();
  } catch {
    return { ownerDecisions: 0, judgmentDecisions: 0, routineBatchItems: 0 };
  }
}
