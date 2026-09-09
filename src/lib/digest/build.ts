/**
 * Daily digest — pure builders.
 *
 * Everything in this file is deterministic and side-effect free: the 24h
 * window derivation takes an explicit `now`, and `buildSections` folds
 * already-fetched rows into the version-1 sections shape. No LLM, no
 * I/O — the digest is an honest mechanical summary of what the database
 * says changed.
 */

import {
  type AgentRunItem,
  type DigestSections,
  type PendingDraftItem,
  type RentActivityItem,
  type ScheduledActionItem,
  type WorkOrderClosedItem,
  type WorkOrderOpenedItem,
} from './types';

/** Hard cap on items stored per section — counts stay exact. */
export const SECTION_ITEM_CAP = 20;

/** Preview truncation length for free-text fields stored in jsonb. */
export const PREVIEW_LENGTH = 160;

const WINDOW_HOURS = 24;
const MS_PER_HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

export interface DigestWindow {
  /** UTC calendar date the digest is filed under ('YYYY-MM-DD'). */
  digestDate: string;
  /** Inclusive ISO start of the 24h window. */
  windowStart: string;
  /** Exclusive ISO end of the 24h window (= the fire instant). */
  windowEnd: string;
}

/**
 * Derives the digest window from a fire instant: the 24 hours ending at
 * `now`, filed under `now`'s UTC calendar date. At the 09:30 UTC cron
 * fire time every US timezone is already inside the same calendar day.
 *
 * @param now - The fire instant (injected for determinism).
 * @returns The window bounds plus the digest date.
 */
export function computeDigestWindow(now: Date): DigestWindow {
  const windowEnd = now.toISOString();
  const windowStart = new Date(
    now.getTime() - WINDOW_HOURS * MS_PER_HOUR,
  ).toISOString();
  return {
    digestDate: windowEnd.slice(0, 10),
    windowStart,
    windowEnd,
  };
}

// ---------------------------------------------------------------------------
// Source rows — the exact column shapes the generator selects
// ---------------------------------------------------------------------------

export interface RentEventSourceRow {
  id: string;
  lease_id: string;
  cycle_month: string;
  status: string;
  amount_due: number | null;
  amount_paid: number | null;
  due_date: string | null;
  updated_at: string;
}

export interface PendingDraftSourceRow {
  id: string;
  conversation_id: string;
  body: string | null;
  created_at: string;
}

export interface AgentRunSourceRow {
  id: string;
  status: string;
  surface: string;
  message: string;
  error: string | null;
  finished_at: string | null;
}

export interface WorkOrderOpenedSourceRow {
  id: string;
  status: string;
  urgency: string;
  description: string | null;
  created_at: string;
}

export interface WorkOrderClosedSourceRow {
  id: string;
  status: string;
  description: string | null;
  updated_at: string;
}

export interface ScheduledActionSourceRow {
  id: string;
  status: string;
  action_type: string;
  trigger_at: string;
  fired_at: string | null;
}

export interface DigestSourceRows {
  rentEvents: readonly RentEventSourceRow[];
  pendingDrafts: readonly PendingDraftSourceRow[];
  agentRuns: readonly AgentRunSourceRow[];
  workOrdersOpened: readonly WorkOrderOpenedSourceRow[];
  workOrdersClosed: readonly WorkOrderClosedSourceRow[];
  scheduledActionsFired: readonly ScheduledActionSourceRow[];
}

// ---------------------------------------------------------------------------
// Sections builder
// ---------------------------------------------------------------------------

/**
 * Folds fetched source rows into the version-1 sections snapshot.
 *
 * Counts are exact over the rows passed in; stored items are capped at
 * {@link SECTION_ITEM_CAP} and free-text fields are truncated to
 * {@link PREVIEW_LENGTH} chars so the jsonb stays bounded.
 *
 * @param rows - Per-source rows already filtered to one org + window.
 * @returns The immutable sections object to store.
 */
export function buildSections(rows: DigestSourceRows): DigestSections {
  return {
    rent_activity: {
      count: rows.rentEvents.length,
      items: cap(rows.rentEvents).map(toRentActivityItem),
    },
    drafts_pending: {
      count: rows.pendingDrafts.length,
      items: cap(rows.pendingDrafts).map(toPendingDraftItem),
    },
    agent_runs: {
      done_count: rows.agentRuns.filter((r) => r.status === 'done').length,
      failed_count: rows.agentRuns.filter((r) => r.status === 'failed').length,
      items: cap(rows.agentRuns).map(toAgentRunItem),
    },
    work_orders: {
      opened_count: rows.workOrdersOpened.length,
      closed_count: rows.workOrdersClosed.length,
      opened: cap(rows.workOrdersOpened).map(toWorkOrderOpenedItem),
      closed: cap(rows.workOrdersClosed).map(toWorkOrderClosedItem),
    },
    scheduled_actions_fired: {
      count: rows.scheduledActionsFired.length,
      items: cap(rows.scheduledActionsFired).map(toScheduledActionItem),
    },
  };
}

// ---------------------------------------------------------------------------
// Item mappers
// ---------------------------------------------------------------------------

function toRentActivityItem(row: RentEventSourceRow): RentActivityItem {
  return {
    id: row.id,
    lease_id: row.lease_id,
    cycle_month: row.cycle_month,
    status: row.status,
    amount_due: Number(row.amount_due ?? 0),
    amount_paid: Number(row.amount_paid ?? 0),
    due_date: row.due_date,
    updated_at: row.updated_at,
  };
}

function toPendingDraftItem(row: PendingDraftSourceRow): PendingDraftItem {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    preview: preview(row.body),
    created_at: row.created_at,
  };
}

function toAgentRunItem(row: AgentRunSourceRow): AgentRunItem {
  return {
    id: row.id,
    status: row.status,
    surface: row.surface,
    preview: preview(row.message) ?? '',
    error: row.error,
    finished_at: row.finished_at ?? '',
  };
}

function toWorkOrderOpenedItem(
  row: WorkOrderOpenedSourceRow,
): WorkOrderOpenedItem {
  return {
    id: row.id,
    status: row.status,
    urgency: row.urgency,
    preview: preview(row.description),
    created_at: row.created_at,
  };
}

function toWorkOrderClosedItem(
  row: WorkOrderClosedSourceRow,
): WorkOrderClosedItem {
  return {
    id: row.id,
    status: row.status,
    preview: preview(row.description),
    updated_at: row.updated_at,
  };
}

function toScheduledActionItem(
  row: ScheduledActionSourceRow,
): ScheduledActionItem {
  return {
    id: row.id,
    status: row.status,
    action_type: row.action_type,
    trigger_at: row.trigger_at,
    fired_at: row.fired_at,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function cap<T>(rows: readonly T[]): readonly T[] {
  return rows.slice(0, SECTION_ITEM_CAP);
}

function preview(text: string | null): string | null {
  if (text == null) return null;
  return text.length <= PREVIEW_LENGTH ? text : `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}
