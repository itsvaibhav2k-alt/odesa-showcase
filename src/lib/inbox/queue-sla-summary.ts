/**
 * Aggregate SLA-state lookup for the inbox queue chip plumbing.
 *
 * Conversations and work_orders aren't FK-linked, but they share a
 * `tenant_id`. To paint the `escalated` queue chip without firing a
 * per-row case-context fetch, we run one aggregate pass: pull every
 * open/assigned/in_progress work order in the org, compute the
 * `slaState` per WO via the same `computeSlaState` helper the case
 * file uses, then collapse to a `Map<conversationId, true>` for rows
 * whose tenant has any breached WO.
 *
 * The helper is pure-ish (one supabase round-trip) and returns a
 * snapshot — callers re-fetch on realtime push via `useInboxRealtime`.
 *
 * Reuse policy: leans on `computeSlaState` from `case-context.ts` so
 * the SLA math stays in one place.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  computeSlaState,
  type WorkOrderStatus,
  type WorkOrderUrgency,
} from '@/lib/inbox/case-context';
import type { ConversationListItem } from '@/lib/inbox/conversation-queries';
import type { Database } from '@/types/database';

type ServerSupabase = SupabaseClient<Database>;

const ACTIVE_WO_STATUSES: ReadonlyArray<WorkOrderStatus> = [
  'open',
  'assigned',
  'in_progress',
];

/**
 * Returns the set of tenant ids that have at least one open work
 * order whose SLA is breached at `now`.
 *
 * @param supabase - SSR (cookie-bound) supabase client.
 * @param now      - Reference time. Defaults to `Date.now()`.
 * @returns Set of tenant ids with breached work orders.
 */
export async function getBreachedTenantIds(
  supabase: ServerSupabase,
  now: number = Date.now(),
): Promise<Set<string>> {
  const { data: rows } = await supabase
    .from('work_orders')
    .select('tenant_id, urgency, status, created_at')
    .in('status', ACTIVE_WO_STATUSES as unknown as WorkOrderStatus[]);

  const out = new Set<string>();
  for (const r of rows ?? []) {
    if (!r.tenant_id || !r.created_at) continue;
    const sla = computeSlaState(
      r.urgency as WorkOrderUrgency,
      r.created_at,
      r.status as WorkOrderStatus,
      now,
    );
    if (sla === 'breached') {
      out.add(r.tenant_id);
    }
  }
  return out;
}

/**
 * Decorate the queue rows with a `workOrderSlaBreached` flag in-place
 * (returns a new array — original is not mutated).
 *
 * @param conversations - Queue rows from `listConversations`.
 * @param breachedTenants - Tenant ids whose WOs are breached.
 * @returns A new array shaped `(ConversationListItem & { workOrderSlaBreached: boolean })[]`.
 */
export function decorateQueueWithSla(
  conversations: readonly ConversationListItem[],
  breachedTenants: ReadonlySet<string>,
): Array<ConversationListItem & { workOrderSlaBreached: boolean }> {
  return conversations.map((c) => ({
    ...c,
    workOrderSlaBreached: c.tenantId
      ? breachedTenants.has(c.tenantId)
      : false,
  }));
}

/**
 * Build a `Map<conversationId, slaState>` directly from a conversation
 * list + an SLA-breach set. Convenience wrapper for the provider so
 * downstream chip-renderers can do `slaMap.get(id)` instead of
 * recomputing per row.
 */
export function buildSlaMap(
  conversations: readonly ConversationListItem[],
  breachedTenants: ReadonlySet<string>,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const c of conversations) {
    const breached = c.tenantId ? breachedTenants.has(c.tenantId) : false;
    out.set(c.id, breached);
  }
  return out;
}
