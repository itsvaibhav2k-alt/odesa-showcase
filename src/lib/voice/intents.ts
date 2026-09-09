/**
 * Deterministic intent extraction — keyword/phrase patterns per IntentId.
 *
 * WHY this is regex and not an LLM:
 *   - The voice engine's promise is "the LLM proposes, Odesa disposes". For
 *     that to be unit-testable, intent tagging of transcripts (used by tests
 *     and by call_ended outcome compilation) must be deterministic: same
 *     transcript in, same IntentId[] out, byte-for-byte, forever.
 *   - Production live-call extraction is Grok choosing tools; this extractor
 *     is the offline/compile-time complement, so recall matters more than
 *     precision — a transcript matching several intents reports all of them
 *     (multi-intent calls are the norm, see demo Flow 3), and anything that
 *     matches nothing lands honestly in 'unknown_general' rather than being
 *     silently dropped.
 *   - Output order is fixed to taxonomy order (INTENT_IDS) so downstream
 *     artifacts and snapshots never churn on pattern-evaluation order.
 *
 * Patterns are intentionally plain: word/phrase anchors, no lookbehind, no
 * global flag (a /g regex is stateful across .test() calls and would break
 * determinism). NO side effects, NO Supabase — pure function on a string.
 *
 * // ponytail: keyword extraction; LLM tagging behind ODESA_USE_REAL_AI is
 * // the upgrade path.
 */

import { INTENT_IDS, type IntentId } from './types';

/**
 * Keyword/phrase patterns per intent. 'unknown_general' has no patterns —
 * it is the fallback when nothing else matches non-empty text.
 *
 * Overlap is deliberate (independent matches): "no heat" is both a
 * maintenance_request and emergency_maintenance; "copy of my lease" is both
 * lease_question and document_request. The planner sorts out priority.
 */
export const INTENT_PATTERNS: Record<IntentId, RegExp[]> = {
  rent_status: [
    /did my rent/i,
    /rent (?:go|went|gone) through/i,
    /\bbalance\b/i,
    /how much do i owe/i,
    /what do i owe/i,
    /rent status/i,
    /receive(?:d)? my rent/i,
  ],
  payment_dispute: [
    /already paid/i,
    /\bi paid\b/i,
    /\bzelle\b/i,
    /\bvenmo\b/i,
    /says i'?m late/i,
    /shows? (?:me )?(?:as )?late/i,
    /didn'?t go through/i,
    /sent (?:a|the) check/i,
    /charged twice/i,
  ],
  late_rent_response: [
    /late fee/i,
    /can'?t pay/i,
    /pay(?:ing)? late/i,
    /rent (?:is|will be) late/i,
    /grace period/i,
    /partial payment/i,
    /need (?:a few|a couple|more) days/i,
    /payment plan/i,
  ],
  maintenance_request: [
    /\bleak/i,
    /\bbroken?\b/i,
    /not working/i,
    /stopped working/i,
    /\bclogged?\b/i,
    /\bdrain/i,
    /dishwasher/i,
    /\bsink\b/i,
    /\btoilet\b/i,
    /\bhvac\b/i,
    /\bheat(?:er|ing)?\b/i,
    /\ba\/?c\b/i,
    /air condition/i,
    /refrigerator/i,
    /\bfridge\b/i,
    /garbage disposal/i,
    /\brepair\b/i,
    /maintenance/i,
  ],
  emergency_maintenance: [
    /flood/i,
    /gas (?:smell|leak)/i,
    /smell(?:s)? (?:like )?gas/i,
    /spark(?:s|ing)?\b/i,
    /\bfire\b/i,
    /burst/i,
    /sewage/i,
    /no heat/i,
    /carbon monoxide/i,
    /water everywhere/i,
  ],
  access_permission: [
    /let (?:them|him|her) in/i,
    /out of town/i,
    /come by/i,
    /only come/i,
    /pick up (?:the )?keys?/i,
    /my (?:brother|sister|mom|dad|friend|cousin)/i,
    /give (?:them|him|her) access/i,
    /permission to enter/i,
  ],
  lockout_or_keys: [
    /locked (?:my ?self )?out/i,
    /lock ?out/i,
    /lost my keys?/i,
    /key (?:doesn'?t|won'?t|does not|will not) work/i,
    /new keys?\b/i,
    /spare key/i,
  ],
  callback_request: [
    /call (?:me )?back/i,
    /callback/i,
    /have (?:him|her|them|the owner|the landlord|someone) call/i,
    /return my call/i,
  ],
  lease_question: [
    /\blease\b/i,
    /\bsublet/i,
    /pets? (?:allowed|policy)/i,
    /security deposit/i,
    /guest policy/i,
  ],
  move_out: [
    /mov(?:e|ing) out/i,
    /vacat(?:e|ing)/i,
    /30.day notice/i,
    /give (?:my )?notice/i,
    /end (?:my|the) lease/i,
  ],
  renewal: [
    /renew/i,
    /extend (?:my|the) lease/i,
    /stay (?:for )?another year/i,
    /re-?sign/i,
  ],
  complaint: [
    /complain/i,
    /unacceptable/i,
    /frustrated/i,
    /fed up/i,
    /this is ridiculous/i,
    /never fixed/i,
  ],
  neighbor_issue: [
    /neighbou?r/i,
    /upstairs/i,
    /next door/i,
    /\bnois[ey]\b/i,
    /loud music/i,
    /barking/i,
  ],
  vendor_status: [
    /job (?:is )?(?:done|complete|finished)/i,
    /finished the (?:job|repair|work)/i,
    /need(?:s)? parts?/i,
    /reschedul/i,
    /on ?site\b/i,
    /\binvoice\b/i,
    /\bquote\b/i,
  ],
  owner_briefing: [
    /briefing/i,
    /portfolio/i,
    /how (?:are|is) (?:my|the) propert/i,
    /status of my propert/i,
    /catch me up/i,
    /what happened (?:today|this week)/i,
  ],
  document_request: [
    /copy of (?:my |the )?(?:lease|ledger|receipt)/i,
    /\bdocument\b/i,
    /\breceipt\b/i,
    /proof of residency/i,
  ],
  unknown_general: [],
};

/**
 * Extract every intent whose patterns match the text (case-insensitive via
 * /i flags), deduped by construction, in fixed taxonomy (INTENT_IDS) order.
 *
 * @param text - Utterance or transcript to scan.
 * @returns Matched intents; ['unknown_general'] when non-empty text matches
 *   nothing; [] for empty/whitespace-only input.
 *
 * @example
 * extractIntents('My sink is leaking'); // ['maintenance_request']
 */
export function extractIntents(text: string): IntentId[] {
  if (text.trim() === '') {
    return [];
  }
  const matched = INTENT_IDS.filter((id) =>
    INTENT_PATTERNS[id].some((pattern) => pattern.test(text)),
  );
  return matched.length > 0 ? matched : ['unknown_general'];
}
