/**
 * Daily digest generator — the single writer for `daily_digests`.
 *
 * For every organization, collects the five "what changed overnight"
 * sources for the 24h window ending at `now`, folds them through the
 * pure `buildSections`, and INSERTs one snapshot row per (org, date).
 *
 * Idempotency is structural: `uq_daily_digests_org_date` makes a second
 * row for the same (org, date) impossible, and a 23505 on insert (a
 * concurrent or repeated run won the race) is counted as `skipped` —
 * deliberately NOT ON CONFLICT, mirroring generateRentCycle, so the
 * first writer's snapshot is never overwritten.
 *
 * Honesty note: the rent section is `rent_activity` — rent_events whose
 * `updated_at` falls in the window, with their CURRENT status. There is
 * no transition-history table and the set_updated_at trigger fires on
 * any update, so we do not claim from→to transitions we cannot prove.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';
import {
  buildSections,
  computeDigestWindow,
  type AgentRunSourceRow,
  type DigestWindow,
  type PendingDraftSourceRow,
  type RentEventSourceRow,
  type ScheduledActionSourceRow,
  type WorkOrderClosedSourceRow,
  type WorkOrderOpenedSourceRow,
} from './build';
import { SECTIONS_VERSION } from './types';

/** Safety bound per source query — counts above this are clipped. */
const SOURCE_QUERY_LIMIT = 200;

export interface GenerateDailyDigestsOptions {
  /** The fire instant; the window is the 24h ending here. */
  now: Date;
  /** Restrict to a single organization; omit to cover every org. */
  organizationId?: string;
}

export interface GenerateDailyDigestsResult {
  /** UTC date the digests were filed under ('YYYY-MM-DD'). */
  digestDate: string;
  /** ISO bounds of the computed window. */
  windowStart: string;
  windowEnd: string;
  /** Organizations swept (created + skipped). */
  orgs: number;
  /** Digest rows inserted by this run. */
  created: number;
  /** Digests that already existed for (org, date) — 23505 races included. */
  skipped: number;
}

/**
 * One sweep: build + insert today's digest for every organization.
 *
 * @param db - Service-role supabase client (writes bypass RLS).
 * @param options - Fire instant and optional org scope.
 * @returns Per-bucket counts; created + skipped === orgs.
 * @throws {Error} On any non-23505 database error.
 */
export async function generateDailyDigests(
  db: SupabaseClient<Database>,
  options: GenerateDailyDigestsOptions,
): Promise<GenerateDailyDigestsResult> {
  const window = computeDigestWindow(options.now);

  let orgQuery = db.from('organizations').select('id');
  if (options.organizationId) {
    orgQuery = orgQuery.eq('id', options.organizationId);
  }
  const { data: orgs, error: orgError } = await orgQuery;
  if (orgError) {
    throw new Error(`daily-digest: organizations query failed: ${orgError.message}`);
  }

  let created = 0;
  let skipped = 0;
  for (const org of orgs ?? []) {
    const sections = buildSections(await collectSourceRows(db, org.id, window));

    const { error: insertError } = await db.from('daily_digests').insert({
      organization_id: org.id,
      digest_date: window.digestDate,
      sections: sections as unknown as Json,
      version: SECTIONS_VERSION,
      window_start: window.windowStart,
      window_end: window.windowEnd,
    });
    if (insertError) {
      if (insertError.code === '23505') {
        skipped += 1;
        continue;
      }
      throw new Error(
        `daily-digest: insert failed for org ${org.id}: ${insertError.message}`,
      );
    }
    created += 1;
  }

  return {
    digestDate: window.digestDate,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    orgs: (orgs ?? []).length,
    created,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Source queries — explicit column lists, all org + window scoped
// ---------------------------------------------------------------------------

interface SourceRows {
  rentEvents: RentEventSourceRow[];
  pendingDrafts: PendingDraftSourceRow[];
  agentRuns: AgentRunSourceRow[];
  workOrdersOpened: WorkOrderOpenedSourceRow[];
  workOrdersClosed: WorkOrderClosedSourceRow[];
  scheduledActionsFired: ScheduledActionSourceRow[];
}

async function collectSourceRows(
  db: SupabaseClient<Database>,
  organizationId: string,
  window: DigestWindow,
): Promise<SourceRows> {
  const [
    rentEvents,
    pendingDrafts,
    agentRuns,
    workOrdersOpened,
    workOrdersClosed,
    scheduledActionsFired,
  ] = await Promise.all([
    fetchRentActivity(db, organizationId, window),
    fetchPendingDrafts(db, organizationId),
    fetchFinishedAgentRuns(db, organizationId, window),
    fetchWorkOrdersOpened(db, organizationId, window),
    fetchWorkOrdersClosed(db, organizationId, window),
    fetchScheduledActionsFired(db, organizationId, window),
  ]);

  return {
    rentEvents,
    pendingDrafts,
    agentRuns,
    workOrdersOpened,
    workOrdersClosed,
    scheduledActionsFired,
  };
}

async function fetchRentActivity(
  db: SupabaseClient<Database>,
  organizationId: string,
  window: DigestWindow,
): Promise<RentEventSourceRow[]> {
  const { data, error } = await db
    .from('rent_events')
    .select('id, lease_id, cycle_month, status, amount_due, amount_paid, due_date, updated_at')
    .eq('organization_id', organizationId)
    .gte('updated_at', window.windowStart)
    .lt('updated_at', window.windowEnd)
    .order('updated_at', { ascending: false })
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`daily-digest: rent_events query failed: ${error.message}`);
  }
  return data ?? [];
}

/** Point-in-time snapshot of drafts awaiting review — not a 24h delta. */
async function fetchPendingDrafts(
  db: SupabaseClient<Database>,
  organizationId: string,
): Promise<PendingDraftSourceRow[]> {
  const { data, error } = await db
    .from('messages')
    .select('id, conversation_id, body, created_at')
    .eq('organization_id', organizationId)
    .eq('draft_status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`daily-digest: messages query failed: ${error.message}`);
  }
  return data ?? [];
}

async function fetchFinishedAgentRuns(
  db: SupabaseClient<Database>,
  organizationId: string,
  window: DigestWindow,
): Promise<AgentRunSourceRow[]> {
  const { data, error } = await db
    .from('agent_runs')
    .select('id, status, surface, message, error, finished_at')
    .eq('organization_id', organizationId)
    .in('status', ['done', 'failed'])
    .gte('finished_at', window.windowStart)
    .lt('finished_at', window.windowEnd)
    .order('finished_at', { ascending: false })
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`daily-digest: agent_runs query failed: ${error.message}`);
  }
  return data ?? [];
}

async function fetchWorkOrdersOpened(
  db: SupabaseClient<Database>,
  organizationId: string,
  window: DigestWindow,
): Promise<WorkOrderOpenedSourceRow[]> {
  const { data, error } = await db
    .from('work_orders')
    .select('id, status, urgency, description, created_at')
    .eq('organization_id', organizationId)
    .gte('created_at', window.windowStart)
    .lt('created_at', window.windowEnd)
    .order('created_at', { ascending: false })
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`daily-digest: work_orders(opened) query failed: ${error.message}`);
  }
  return data ?? [];
}

async function fetchWorkOrdersClosed(
  db: SupabaseClient<Database>,
  organizationId: string,
  window: DigestWindow,
): Promise<WorkOrderClosedSourceRow[]> {
  // work_order_status terminal values are 'completed' and 'cancelled'
  // (there is no 'resolved'). updated_at-in-window is the closest
  // honest proxy for "closed in window"; status_timeline carries the
  // precise per-event timestamps if a future version needs them.
  const { data, error } = await db
    .from('work_orders')
    .select('id, status, description, updated_at')
    .eq('organization_id', organizationId)
    .in('status', ['completed', 'cancelled'])
    .gte('updated_at', window.windowStart)
    .lt('updated_at', window.windowEnd)
    .order('updated_at', { ascending: false })
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`daily-digest: work_orders(closed) query failed: ${error.message}`);
  }
  return data ?? [];
}

async function fetchScheduledActionsFired(
  db: SupabaseClient<Database>,
  organizationId: string,
  window: DigestWindow,
): Promise<ScheduledActionSourceRow[]> {
  const { data, error } = await db
    .from('scheduled_actions')
    .select('id, status, action_type, trigger_at, fired_at')
    .eq('organization_id', organizationId)
    .gte('fired_at', window.windowStart)
    .lt('fired_at', window.windowEnd)
    .order('fired_at', { ascending: false })
    .limit(SOURCE_QUERY_LIMIT);
  if (error) {
    throw new Error(`daily-digest: scheduled_actions query failed: ${error.message}`);
  }
  return data ?? [];
}
