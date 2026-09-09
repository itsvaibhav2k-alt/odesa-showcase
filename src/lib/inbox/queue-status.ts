/**
 * Queue row status derivation — wave 4.
 *
 * Pure helper that maps a `ConversationListItem` (plus a small context
 * envelope provided by the consumer) onto the visual chip the queue row
 * renders. Five chip kinds, in priority order:
 *
 *   1. `review`     — a pending owner-review draft exists.
 *   2. `escalated`  — a linked work order has breached its SLA.
 *                     (Context is wired by Wave 5; Wave 4 ships chip
 *                     rendering with `workOrderSlaBreached` defaulting
 *                     to `false`.)
 *   3. `draft`      — inbound message in the last 15 minutes with no
 *                     draft yet (Odesa is composing).
 *   4. `handled`    — everything else: Odesa already replied or the
 *                     thread has gone quiet recently.
 *   5. `watching`   — reserved for future "quiet but monitored" rows.
 *                     Not derived automatically yet; callers may pass
 *                     `kind: 'watching'` via the helper variant.
 *
 * The helper is intentionally stateless so it's easy to unit test and
 * reuse from a server-side preview pass.
 */

import type { ConversationListItem } from '@/lib/inbox/conversation-queries';

export type QueueStatusKind =
  | 'review'
  | 'draft'
  | 'escalated'
  | 'handled'
  | 'watching';

export interface QueueStatus {
  kind: QueueStatusKind;
  label: string;
}

export interface QueueStatusContext {
  /**
   * `true` when a work order linked to this conversation has breached
   * its SLA. Wired by Wave 5; Wave 4 callers should pass `false`.
   */
  workOrderSlaBreached?: boolean;
  /**
   * Reference timestamp for "is the inbound recent?" derivation. Tests
   * pass a fixed value; UI defaults to `Date.now()`.
   */
  now?: number;
  /**
   * Window (in minutes) within which an unanswered inbound is treated
   * as "draft pending". Defaults to 15.
   */
  draftWindowMinutes?: number;
}

const DEFAULT_DRAFT_WINDOW_MINUTES = 15;

const LABELS: Record<QueueStatusKind, string> = {
  review: 'Needs review',
  draft: 'Draft pending',
  escalated: 'Vendor delay',
  handled: 'Odesa handled',
  watching: 'Watching',
};

/**
 * Derive the queue chip for a conversation row.
 *
 * @param conv - The conversation list row from `listConversations`.
 * @param ctx  - Optional context (SLA flag, clock override, window).
 * @returns The chip kind + display label.
 *
 * @example
 *   deriveQueueStatus(conv);                                   // 'handled'
 *   deriveQueueStatus(convWithPending);                        // 'review'
 *   deriveQueueStatus(conv, { workOrderSlaBreached: true });   // 'escalated'
 */
export function deriveQueueStatus(
  conv: Pick<
    ConversationListItem,
    'pendingDraftId' | 'lastMessageDirection' | 'lastMessageAt'
  >,
  ctx: QueueStatusContext = {},
): QueueStatus {
  if (conv.pendingDraftId) {
    return { kind: 'review', label: LABELS.review };
  }

  if (ctx.workOrderSlaBreached) {
    return { kind: 'escalated', label: LABELS.escalated };
  }

  if (
    conv.lastMessageDirection === 'inbound' &&
    isRecentInbound(conv.lastMessageAt, ctx)
  ) {
    return { kind: 'draft', label: LABELS.draft };
  }

  return { kind: 'handled', label: LABELS.handled };
}

/**
 * Label lookup for the `watching` variant — exposed so the queue
 * column can render a manually-set "quiet but monitored" chip without
 * round-tripping through `deriveQueueStatus`.
 */
export function watchingStatus(): QueueStatus {
  return { kind: 'watching', label: LABELS.watching };
}

function isRecentInbound(
  iso: string | null | undefined,
  ctx: QueueStatusContext,
): boolean {
  if (!iso) return false;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return false;
  const now = ctx.now ?? Date.now();
  const windowMs =
    (ctx.draftWindowMinutes ?? DEFAULT_DRAFT_WINDOW_MINUTES) * 60_000;
  const diff = now - then;
  // Negative diffs (future-dated messages from clock skew) count as
  // "recent" — the inbound just landed. Anything older than the window
  // is no longer a fresh-inbound.
  return diff < windowMs;
}
