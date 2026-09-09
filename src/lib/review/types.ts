/**
 * Owner Review flow — view-model + action result types.
 *
 * Dependency-free (no DB types). `getReviewCase` maps a live record into a
 * `ReviewCase`; the review surface renders it; the review server actions return
 * `ReviewActionResult`.
 */

export type ReviewKind = 'rent' | 'conversation' | 'work_order';

/** The three URL segments that map 1:1 to `ReviewKind`. */
export const REVIEW_KINDS: readonly ReviewKind[] = [
  'rent',
  'conversation',
  'work_order',
];

export function isReviewKind(value: string): value is ReviewKind {
  return (REVIEW_KINDS as readonly string[]).includes(value);
}

export type ReviewBadgeTone = 'clay' | 'amber' | 'green' | 'muted';

/** A single action button on the review surface. */
export interface ReviewAction {
  /** Stable key, e.g. 'rent.escalate' / 'conversation.resolve'. */
  id: string;
  label: string;
  variant: 'primary' | 'secondary';
  /**
   * 'transition' → calls a status-transition server action (DB persists);
   * 'send'       → calls a messaging server action (provider-gated);
   * 'link'       → plain navigation to `href`.
   */
  kind: 'transition' | 'send' | 'link';
  href?: string;
}

/** A labelled block of key/value context rows (lease, payments, thread, …). */
export interface ReviewContextBlock {
  label: string;
  rows: { k: string; v: string; mono?: boolean }[];
  href?: string;
}

export interface ReviewCase {
  kind: ReviewKind;
  id: string;
  eyebrow: string;
  title: string;
  badge: { label: string; tone: ReviewBadgeTone };
  meta: string[];
  recommendation: string;
  draft?: { body: string; editable: boolean };
  context: ReviewContextBlock[];
  actions: ReviewAction[];
  backHref: string;
}

export interface ReviewActionOk {
  ok: true;
  data?: { status?: string; messageId?: string };
}
export interface ReviewActionErr {
  ok: false;
  error: string;
}
export type ReviewActionResult = ReviewActionOk | ReviewActionErr;
