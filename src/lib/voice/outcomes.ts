/**
 * Outcome compiler — turns a finished CallSession into the landlord-facing
 * CallOutcome artifact and its plain-text inbox message.
 *
 * WHY this is a pure compile step at call_ended, not incremental writes:
 *   - The outcome is the product promise made tangible: "you missed the call
 *     and lost nothing". It must be a single honest snapshot — everything the
 *     engine did (actions, records, SMS), everything it deliberately did NOT
 *     do (approvals pending, unresolved facts), and every risk flag — compiled
 *     once from the session log so it can never disagree with the log.
 *   - Honesty rules are load-bearing: NO timestamp in the artifact is ever
 *     generated here. `endedAt` is passed in by the webhook; action `at`
 *     values come from the log. Fabricating a payment date is the exact
 *     failure mode the handoff forbids, so the compiler physically cannot —
 *     it has no clock.
 *   - Intents are the union of what the live agent reported (session.intents)
 *     and what the deterministic extractor finds in the transcript, so topics
 *     the agent handled without tagging still show up for the landlord.
 *   - `unresolved` reuses planTurn's missing-facts view rather than a second
 *     bespoke "what's left" computation — one planner, one truth.
 *
 * NO side effects, NO Supabase, NO clock. Pure functions on plain objects.
 */

import type {
  CallerKind,
  CallOutcome,
  CallSession,
  IntentId,
  VoiceActionLogEntry,
} from './types';
import { INTENT_IDS } from './types';
import { extractIntents } from './intents';
import { riskFlagsFor } from './call-state';
import { planTurn } from './plan';

/** Record kinds surfaced in `recordsCreated` when present in an action's ids. */
const RECORD_KINDS = ['work_order', 'conversation', 'message', 'proposal'] as const;

/** Human labels for the one-sentence summary. */
const CALLER_LABELS: Record<CallerKind, string> = {
  verified_owner: 'Verified owner',
  verified_tenant: 'Verified tenant',
  likely_tenant: 'Likely tenant',
  known_vendor: 'Known vendor',
  unknown_caller: 'Unknown caller',
  ambiguous: 'Unverified caller',
};

/** Dedup preserving first-seen order. */
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** 'create_work_order' → 'create work order' — readable in plain text. */
function humanize(id: string): string {
  return id.replace(/_/g, ' ');
}

/** Pluralize the count nouns in the one-sentence template. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Compile the final CallOutcome from a finished session.
 *
 * @param session - The session as it stood when the call ended (not mutated).
 * @param transcript - Full call transcript, or null when Retell supplied none.
 * @param endedAt - ISO end timestamp from the webhook — passed through, never
 *   generated here (the compiler has no clock by design).
 * @returns The landlord-facing artifact, deterministic for identical inputs.
 */
export function compileOutcome(
  session: CallSession,
  transcript: string | null,
  endedAt: string,
): CallOutcome {
  const merged = new Set<IntentId>([...session.intents, ...extractIntents(transcript ?? '')]);
  const intentsHandled = INTENT_IDS.filter((id) => merged.has(id));

  const recordsCreated = session.actions.flatMap((entry) =>
    RECORD_KINDS.flatMap((kind) => {
      const id = entry.ids?.[kind];
      return id ? [{ kind, id }] : [];
    }),
  );
  const seen = new Set<string>();
  const recordsDeduped = recordsCreated.filter(({ kind, id }) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const autonomousActions = session.actions.filter(
    (entry) => entry.outcome === 'executed' && entry.tier <= 2,
  );

  // Proposal ids already fan into session.approvalsNeeded via the reducer;
  // drafted entries contribute their human-readable detail so nothing pending
  // is invisible to the owner even when a draft carries no proposal id.
  const draftedDetails = session.actions
    .filter((entry) => entry.outcome === 'drafted' && entry.detail)
    .map((entry) => entry.detail as string);
  const approvalsNeeded = dedupe([...session.approvalsNeeded, ...draftedDetails]);

  const riskFlags = dedupe([...riskFlagsFor(session), ...session.riskFlags]);
  const unresolved = [...planTurn(session).missingFacts];

  const topIntents = intentsHandled.slice(0, 3).map(humanize).join(', ') || 'none';
  const oneSentence =
    `${CALLER_LABELS[session.callerKind]} call — ` +
    `${count(intentsHandled.length, 'topic')} handled: ${topIntents}; ` +
    `${count(autonomousActions.length, 'action')} taken, ` +
    `${approvalsNeeded.length} awaiting owner review.`;

  return {
    oneSentence,
    callerKind: session.callerKind,
    callerPhone: session.direction === 'inbound' ? session.fromNumber : session.toNumber,
    tenantId: session.tenantId ?? null,
    vendorId: session.vendorId ?? null,
    propertyId: session.propertyId ?? null,
    unitId: session.unitId ?? null,
    intentsHandled,
    recordsCreated: recordsDeduped,
    autonomousActions: [...autonomousActions],
    approvalsNeeded,
    smsSent: [...session.smsSent],
    smsDrafted: [...session.smsDrafted],
    unresolved,
    riskFlags,
    endedAt,
  };
}

/**
 * Should this outcome open a `voice_call_review` owner-queue proposal?
 *
 * Two conditions, both deterministic:
 *   - `propertyId` must be non-null — `action_proposals.property_id` is a
 *     NOT NULL column, so unknown-caller calls (no property resolved) can
 *     never produce a proposal; their review surface is the open voice
 *     conversation instead.
 *   - Something must actually need eyes: a pending approval or a risk flag.
 *     Clean calls stay out of the owner queue.
 */
export function needsOwnerReview(outcome: CallOutcome, propertyId: string | null): boolean {
  return (
    propertyId !== null &&
    (outcome.approvalsNeeded.length > 0 || outcome.riskFlags.length > 0)
  );
}

/** One bulleted section; '- none' keeps every section present and scannable. */
function section(title: string, lines: readonly string[]): string {
  const body = lines.length > 0 ? lines.map((line) => `- ${line}`).join('\n') : '- none';
  return `${title}\n${body}`;
}

/** Log entry → readable line, e.g. 'create work order — Leaky faucet in 2B'. */
function actionLine(entry: VoiceActionLogEntry): string {
  return entry.detail ? `${humanize(entry.action)} — ${entry.detail}` : humanize(entry.action);
}

/**
 * Format the plain-text message body the webhook stores on the inbox
 * `messages` row. Plain text only — the inbox timeline renders it verbatim.
 *
 * @param outcome - Compiled artifact from compileOutcome.
 * @param transcript - Full transcript, appended under its own divider when
 *   present; omitted entirely when null/empty.
 * @returns Sectioned plain-text body.
 */
export function formatOutcomeMessage(outcome: CallOutcome, transcript: string | null): string {
  const review = [...outcome.approvalsNeeded];
  if (outcome.smsDrafted.length > 0) {
    review.push(`${count(outcome.smsDrafted.length, 'SMS draft')} pending review`);
  }
  const parts = [
    `Handled by Odesa\n${outcome.oneSentence}`,
    section('Topics', outcome.intentsHandled.map(humanize)),
    section('Actions taken', outcome.autonomousActions.map(actionLine)),
    section('Awaiting owner review', review),
    section('Risk flags', outcome.riskFlags.map(humanize)),
  ];
  if (transcript) {
    parts.push(`— Transcript —\n${transcript}`);
  }
  return parts.join('\n\n');
}
