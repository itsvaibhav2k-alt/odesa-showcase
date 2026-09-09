/**
 * Daily digest — sections shape (version 1) and its zod schema.
 *
 * The digest is an immutable per-day jsonb snapshot written once by the
 * generate-daily-digest cron and read org-scoped by /today. The zod
 * schema is the boundary contract: the builder's output is validated in
 * tests, and the /today reader `safeParse`s rows coming back from the
 * database so a future shape change (bump `SECTIONS_VERSION`) degrades
 * to "no card" instead of a render crash.
 *
 * Naming honesty: there is no rent transition-history table and the
 * `set_updated_at` trigger fires on ANY update, so the rent section is
 * `rent_activity` — "rent events touched in the window, with current
 * status" — NOT from→to transitions we cannot prove.
 */

import { z } from 'zod';

/** Bump when the sections shape changes; the renderer keys off this. */
export const SECTIONS_VERSION = 1;

// ---------------------------------------------------------------------------
// Per-section item schemas
// ---------------------------------------------------------------------------

const rentActivityItemSchema = z.object({
  id: z.string(),
  lease_id: z.string(),
  cycle_month: z.string(),
  status: z.string(),
  /** Dollars, mirroring the rent_events columns. */
  amount_due: z.number(),
  amount_paid: z.number(),
  due_date: z.string().nullable(),
  updated_at: z.string(),
});

const pendingDraftItemSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  /** First 160 chars of the draft body; null when the body is null. */
  preview: z.string().nullable(),
  created_at: z.string(),
});

const agentRunItemSchema = z.object({
  id: z.string(),
  status: z.string(),
  surface: z.string(),
  /** First 160 chars of the operator message. */
  preview: z.string(),
  error: z.string().nullable(),
  finished_at: z.string(),
});

const workOrderOpenedItemSchema = z.object({
  id: z.string(),
  status: z.string(),
  urgency: z.string(),
  /** First 160 chars of the description; null when absent. */
  preview: z.string().nullable(),
  created_at: z.string(),
});

const workOrderClosedItemSchema = z.object({
  id: z.string(),
  /** 'completed' | 'cancelled' — the terminal work_order_status values. */
  status: z.string(),
  preview: z.string().nullable(),
  updated_at: z.string(),
});

const scheduledActionItemSchema = z.object({
  id: z.string(),
  /** 'fired' | 'condition_failed'. */
  status: z.string(),
  action_type: z.string(),
  trigger_at: z.string(),
  fired_at: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Sections schema (version 1)
// ---------------------------------------------------------------------------

export const digestSectionsSchema = z.object({
  /** rent_events touched in the window, with their CURRENT status. */
  rent_activity: z.object({
    count: z.number(),
    items: z.array(rentActivityItemSchema),
  }),
  /** Point-in-time snapshot of drafts awaiting review — not a 24h delta. */
  drafts_pending: z.object({
    count: z.number(),
    items: z.array(pendingDraftItemSchema),
  }),
  /** Agent runs that finished (done or failed) inside the window. */
  agent_runs: z.object({
    done_count: z.number(),
    failed_count: z.number(),
    items: z.array(agentRunItemSchema),
  }),
  /** Work orders opened / closed (completed or cancelled) in the window. */
  work_orders: z.object({
    opened_count: z.number(),
    closed_count: z.number(),
    opened: z.array(workOrderOpenedItemSchema),
    closed: z.array(workOrderClosedItemSchema),
  }),
  /** scheduled_actions whose fired_at falls inside the window. */
  scheduled_actions_fired: z.object({
    count: z.number(),
    items: z.array(scheduledActionItemSchema),
  }),
});

export type DigestSections = z.infer<typeof digestSectionsSchema>;
export type RentActivityItem = z.infer<typeof rentActivityItemSchema>;
export type PendingDraftItem = z.infer<typeof pendingDraftItemSchema>;
export type AgentRunItem = z.infer<typeof agentRunItemSchema>;
export type WorkOrderOpenedItem = z.infer<typeof workOrderOpenedItemSchema>;
export type WorkOrderClosedItem = z.infer<typeof workOrderClosedItemSchema>;
export type ScheduledActionItem = z.infer<typeof scheduledActionItemSchema>;
