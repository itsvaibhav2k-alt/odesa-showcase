/**
 * Deterministic synthesiser for the "Odesa says" one-liner shown above
 * the case-file timeline.
 *
 * No LLM, no Markov chain — just a small priority ladder of template
 * branches keyed off the pending draft + work-order SLA + handled flag.
 * The returned `text` is what the UI renders; the `emphasis` array lists
 * the substrings the renderer should bold so the operator's eye lands
 * on the noun-of-record (vendor name, action verb, etc.).
 *
 * Branch priority:
 *   1. `pendingDraft && status === 'review'`  → "Drafted a {verb} — awaiting your approval."
 *   2. `status === 'escalated' && wo?.slaState === 'breached'`
 *                                              → "Vendor is past their ETA. Follow-up needs review."
 *   3. `status === 'handled'`                  → "Resolved. Watching for follow-up."
 *   4. default                                 → "Watching this thread."
 *
 * Reuse policy: shared with the case-header for the status chip's a11y
 * label so screen readers hear the same synthesis. Pure — no React.
 */
import type {
  PaymentSummary,
  WorkOrderSummary,
} from '@/lib/inbox/case-context';

export type OdesaLineStatus = 'review' | 'draft' | 'escalated' | 'handled';

export interface OdesaLineInput {
  pendingDraft: { body: string; reasoning: string | null } | null;
  status: OdesaLineStatus;
  workOrder: WorkOrderSummary | null;
  payments: PaymentSummary;
  audience?: 'owner' | 'va';
}

export interface OdesaLine {
  text: string;
  emphasis: string[];
}

/**
 * Verb taxonomy used to pick the most descriptive action from a draft
 * body. Order matters: earlier verbs win when multiple appear in the
 * same body. "dispatch" wins over "send" because it's a more specific
 * operational verb.
 */
const DRAFT_VERBS: ReadonlyArray<{ keyword: RegExp; verb: string }> = [
  { keyword: /\b(dispatch|dispatching|dispatched)\b/i, verb: 'dispatch' },
  { keyword: /\b(escalat\w*)\b/i, verb: 'escalation' },
  { keyword: /\b(schedul\w*)\b/i, verb: 'scheduling' },
  { keyword: /\b(refund\w*)\b/i, verb: 'refund' },
  { keyword: /\b(cancel\w*)\b/i, verb: 'cancellation' },
  { keyword: /\b(confirm\w*)\b/i, verb: 'confirmation' },
  { keyword: /\b(remind\w*|reminder)\b/i, verb: 'reminder' },
  { keyword: /\b(nudg\w*)\b/i, verb: 'nudge' },
  { keyword: /\b(follow[- ]?up)\b/i, verb: 'follow-up' },
  { keyword: /\b(ask\w*|asking)\b/i, verb: 'question' },
  { keyword: /\b(reply|replying|replied)\b/i, verb: 'reply' },
  { keyword: /\b(send|sending|sent)\b/i, verb: 'reply' },
  { keyword: /\b(quote|quoting)\b/i, verb: 'quote' },
  { keyword: /\b(apolog\w*)\b/i, verb: 'apology' },
];

/**
 * Pick a verb-noun from a draft body. Falls back to "reply" when none
 * of the keywords land — keeps the line natural even on free-form
 * drafts.
 */
export function extractDraftVerb(body: string): string {
  for (const { keyword, verb } of DRAFT_VERBS) {
    if (keyword.test(body)) return verb;
  }
  return 'reply';
}

/**
 * Build the Odesa-says line for a conversation case-file.
 *
 * @param input - Pending draft + status + work order + payment summary.
 * @returns The synthesised text and the substrings to render bold.
 *
 * @example
 *   buildOdesaLine({
 *     pendingDraft: { body: 'I will dispatch a plumber.', reasoning: null },
 *     status: 'review',
 *     workOrder: null,
 *     payments: { onTimeCount: 0, totalRecent: 0, balanceCents: 0, daysLateTier: null },
 *   });
 *   // → { text: 'Drafted a dispatch — awaiting your approval.', emphasis: ['dispatch'] }
 */
export function buildOdesaLine(input: OdesaLineInput): OdesaLine {
  const { pendingDraft, status, workOrder, audience = 'owner' } = input;

  // 1. Pending review draft — describe the action we're suggesting.
  if (pendingDraft && status === 'review') {
    const verb = extractDraftVerb(pendingDraft.body);
    return {
      text: `Drafted a ${verb} — awaiting ${audience === 'va' ? 'owner' : 'your'} approval.`,
      emphasis: [verb],
    };
  }

  // 2. Vendor SLA breached — the timeline tells the rest, this line
  //    just names the operational state.
  if (status === 'escalated' && workOrder?.slaState === 'breached') {
    return {
      text: 'Vendor is past their ETA. Follow-up needs review.',
      emphasis: ['past their ETA', 'needs review'],
    };
  }

  // 3. Handled — Odesa already replied and the thread is quiet.
  if (status === 'handled') {
    return {
      text: 'Resolved. Watching for follow-up.',
      emphasis: ['Resolved'],
    };
  }

  // 4. Default — quiet thread, no pending action.
  return {
    text: 'Watching this thread.',
    emphasis: [],
  };
}
