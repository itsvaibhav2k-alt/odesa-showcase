/**
 * Voice autonomy policy — THE deterministic safety layer of the voice engine.
 *
 * WHY this module exists as pure, synchronous code:
 *   - The product's hard rule is "the LLM proposes, Odesa disposes". Grok may
 *     suggest any action or SMS body; whether it executes, drafts, or is
 *     refused is decided HERE, in unit-tested TypeScript, never by the model.
 *   - Three gates, one per surface:
 *       1. `gateVoiceAction` — per-action tier matrix + caller-kind rules.
 *          Tier 4 verbs (payments, legal threats, fee waivers, lease changes,
 *          dispatch promises, private-data disclosure) are forbidden for
 *          EVERY caller including verified owners: they exist in the
 *          vocabulary purely to be named-and-blocked.
 *       2. `classifySmsBody` — deny-pattern scan then allow-shape scan over
 *          outbound SMS text. Order matters and FAILS CLOSED: a deny match
 *          drafts, an allow match sends, and anything the classifier does not
 *          recognize also drafts. A fabricated "your payment cleared" claim
 *          must never auto-send even when wrapped in friendly wording.
 *       3. `disclosureAllowed` — what data classes a caller kind may hear.
 *          unknown_caller/ambiguous get NOTHING: no tenant names, balances,
 *          unit info, or owner data, through any channel.
 *   - Reasons are short log-friendly strings surfaced in outcome artifacts
 *     and owner-queue review cards, so the landlord can audit every "no".
 *
 * NO Supabase, NO network, NO Date.now(). Fully vitest-safe on plain objects.
 */

import type {
  AutonomyTier,
  CallerKind,
  CallSession,
  VoiceActionDecision,
  VoiceActionId,
} from './types';

// ---------------------------------------------------------------------------
// Tier matrix
// ---------------------------------------------------------------------------

/**
 * Autonomy tier per action verb. Exhaustive over VoiceActionId — adding a
 * verb to types.ts without a row here is a compile error, by design.
 */
export const ACTION_TIERS: Record<VoiceActionId, AutonomyTier> = {
  // tier 0 — answer-only
  answer_rent_status: 0,
  answer_lease_question: 0,
  provide_owner_briefing: 0,
  collect_vendor_status: 0,
  // tier 1 — record
  record_call_note: 1,
  record_callback_request: 1,
  // tier 2 — act, reversible
  create_work_order: 2,
  send_safe_confirmation_sms: 2,
  request_payment_proof_sms: 2,
  request_photo_sms: 2,
  notify_owner: 2,
  create_owner_queue_item: 2,
  schedule_callback: 2,
  escalate_to_landlord: 2,
  // tier 3 — draft for approval
  create_followup_sms_draft: 3,
  send_rent_reminder: 3,
  coordinate_vendor: 3,
  schedule_access_entry: 3,
  // tier 4 — never
  process_payment: 4,
  waive_fee: 4,
  threaten_legal_action: 4,
  amend_lease: 4,
  dispatch_vendor_with_cost: 4,
  promise_appointment: 4,
  promise_emergency_dispatch: 4,
  disclose_private_data: 4,
};

// ---------------------------------------------------------------------------
// Action gate
// ---------------------------------------------------------------------------

/**
 * Tier 0–2 actions an unresolved caller (unknown_caller/ambiguous) may NOT
 * use: anything that discloses tenant/owner/vendor data or creates a
 * tenant-linked record. Acknowledgement-shaped actions (call note, callback
 * request, escalation, owner notification/queue item, safe confirmation SMS,
 * schedule_callback) stay available so the call still lands somewhere.
 */
const UNRESOLVED_CALLER_FORBIDDEN: ReadonlySet<VoiceActionId> = new Set([
  'answer_rent_status',
  'answer_lease_question',
  'create_work_order',
  'request_payment_proof_sms',
  'request_photo_sms',
  'provide_owner_briefing',
  'collect_vendor_status',
]);

/**
 * Deterministic per-action gate.
 *
 * Rules, in order:
 *   - tier 4 → 'forbid' always, for every caller kind;
 *   - tier 3 → 'draft' always (owner approval path);
 *   - tiers 0–2 → 'allow', EXCEPT caller-kind restrictions:
 *       unknown_caller/ambiguous lose all disclosure/tenant-linked actions;
 *       provide_owner_briefing requires verified_owner;
 *       collect_vendor_status requires known_vendor;
 *       answer_rent_status requires ledger disclosure (verified tenant/owner
 *       only — a likely_tenant must verify first, a vendor never hears it).
 *
 * @param action - The action verb the agent proposes.
 * @param session - Caller identity slice of the live session.
 * @returns Decision with tier and an audit-friendly reason.
 */
export function gateVoiceAction(
  action: VoiceActionId,
  session: Pick<CallSession, 'callerKind' | 'tenantId' | 'vendorId'>,
): VoiceActionDecision {
  const tier = ACTION_TIERS[action];
  const { callerKind } = session;

  if (tier === 4) {
    return { action, decision: 'forbid', tier, reason: 'tier 4: never permitted by policy' };
  }
  if (tier === 3) {
    return { action, decision: 'draft', tier, reason: 'tier 3: drafts for owner approval' };
  }

  const unresolved = callerKind === 'unknown_caller' || callerKind === 'ambiguous';
  if (unresolved && UNRESOLVED_CALLER_FORBIDDEN.has(action)) {
    return {
      action,
      decision: 'forbid',
      tier,
      reason: 'privacy: unresolved caller gets no tenant, owner, or vendor data or linked records',
    };
  }
  if (action === 'provide_owner_briefing' && callerKind !== 'verified_owner') {
    return {
      action,
      decision: 'forbid',
      tier,
      reason: 'owner briefing requires a verified owner',
    };
  }
  if (action === 'collect_vendor_status' && callerKind !== 'known_vendor') {
    return {
      action,
      decision: 'forbid',
      tier,
      reason: 'vendor status collection requires a known vendor',
    };
  }
  if (action === 'answer_rent_status' && !disclosureAllowed(callerKind).ledger) {
    return {
      action,
      decision: 'forbid',
      tier,
      reason: 'ledger disclosure requires a verified tenant or owner',
    };
  }

  return { action, decision: 'allow', tier, reason: `tier ${tier}: within autonomy for caller` };
}

// ---------------------------------------------------------------------------
// SMS body classifier
// ---------------------------------------------------------------------------

/** Result of classifying an outbound SMS body. */
export interface SmsClassification {
  classification: 'safe' | 'draft';
  /** Deny category, 'safe_confirmation', or 'unmatched' (fail-closed default). */
  category: string;
  reason: string;
}

interface DenyCategory {
  category: string;
  reason: string;
  patterns: readonly RegExp[];
}

/**
 * Deny patterns — each category is a promise or claim the voice agent must
 * never auto-send. Matched against a lowercased, quote-normalized body.
 * First matching category wins (order is cosmetic; any match drafts).
 */
const DENY_CATEGORIES: readonly DenyCategory[] = [
  {
    category: 'legal_or_eviction',
    reason: 'legal threats and eviction language are never automated',
    patterns: [
      /\bevict/,
      /legal\s+action/,
      /\b(attorney|lawyer|lawsuit)\b/,
      /\bsue\s+you\b/,
      /take\s+you\s+to\s+court/,
    ],
  },
  {
    category: 'fee_waiver',
    reason: 'fee waivers are an owner decision, never automated',
    patterns: [
      /\bwaiv(e|ed|er|ing)\b/,
      /(remove|drop|forgive|cancel)\w*\s+(the\s+)?(late\s+)?fee/,
      /fee\s+(was|is|has\s+been|will\s+be)\s+(removed|dropped|forgiven|cancell?ed)/,
      /no\s+late\s+fee/,
    ],
  },
  {
    category: 'payment_cleared_claim',
    reason: 'ledger honesty: never claim a payment was received, cleared, or processed',
    patterns: [
      /(payment|rent)[^.!?]*\b(was|has\s+been|is)\s+(received|cleared|processed|posted)\b/,
      /\b(went|gone)\s+through\b/,
      /we\s+(have\s+)?received\s+your\s+(rent|payment)/,
      /\bcleared\s+on\b/,
    ],
  },
  {
    category: 'payment_plan',
    reason: 'payment plans are an owner decision, never automated',
    patterns: [
      /payment\s+plan/,
      /\binstallments?\b/,
      /split\s+(the\s+|your\s+)?(rent|payment|balance)/,
      /pay\s+(half|part|partial)\b/,
    ],
  },
  {
    category: 'appointment_promise',
    reason: 'never promise scheduling; say the owner will follow up',
    patterns: [
      /you('| a)?re\s+scheduled/,
      /\bconfirmed\s+for\b/,
      /will\s+arrive\s+(at|between|by)\b/,
      /appointment\s+(is\s+)?(set|booked|confirmed)/,
      /\bscheduled\s+for\b/,
    ],
  },
  {
    category: 'lease_change_promise',
    reason: 'lease changes are an owner decision, never automated',
    patterns: [
      /lease\s+(was|is|has\s+been|will\s+be)\s+(amended|changed|updated|extended|modified)/,
      /we('ll|\s+will)\s+(change|amend|update|extend)\s+(the\s+|your\s+)?lease/,
      /add(ed)?\s+to\s+(the\s+|your\s+)?lease/,
      /new\s+lease\s+terms/,
    ],
  },
  {
    category: 'dispatch_promise',
    reason: 'never promise dispatch; escalate instead',
    patterns: [
      /\bdispatched\b/,
      /on\s+(his|her|their|the)\s+way/,
      /(plumber|electrician|technician|vendor|handyman|someone)\s+(is|has\s+been|will\s+be)\s+(coming|sent|there|headed)/,
      /sent\s+(a|the)\s+(plumber|electrician|technician|vendor|handyman)/,
    ],
  },
  {
    category: 'pressure_or_threat',
    reason: 'pressure and threats are never automated',
    patterns: [
      /or\s+else/,
      /final\s+(notice|warning)/,
      /\bconsequences\b/,
      /last\s+chance/,
      /immediately\s+or\b/,
    ],
  },
];

/**
 * Allow shapes — the known-safe confirmation sentences the agent is allowed
 * to auto-send. Deliberately narrow: honest acknowledgements, photo/proof
 * requests, and "I'll ask the owner to follow up" phrasing only.
 */
const ALLOW_SHAPES: readonly RegExp[] = [
  /^we(?:'ve| have)? received your request(?: and (?:we(?:'ll| will)|will) follow up)?$/,
  /^(?:your|a) work order (?:was |has been )?(?:created|logged|opened)(?: and the owner has been notified)?$/,
  /^the owner has been notified$/,
  /^please reply with a photo(?: of (?:the )?(?:leak|issue|damage|affected area))?$/,
  /^please reply with payment confirmation or a screenshot$/,
  /^i'll ask the owner to follow up(?: about (?:a )?good callback time)?$/,
  /^thanks for (?:calling|letting us know|reaching out)$/,
  /^we(?:'ve| have) (?:noted|logged) (?:this|that|your (?:request|message|concern|issue))$/,
];

/**
 * Classify an outbound SMS body as auto-sendable ('safe') or approval-needed
 * ('draft'). Order is the safety property: deny match → draft, allow match →
 * safe, NEITHER → draft. Unrecognized text fails closed.
 *
 * @param body - Raw SMS body as proposed by the agent.
 */
export function classifySmsBody(body: string): SmsClassification {
  const normalized = body
    .toLowerCase()
    .replace(/[‘’]/g, '\'')
    .replace(/\s+/g, ' ')
    .trim();

  for (const { category, reason, patterns } of DENY_CATEGORIES) {
    if (patterns.some((p) => p.test(normalized))) {
      return { classification: 'draft', category, reason };
    }
  }
  // A safe substring is not a safe message. Require every sentence/clause
  // emitted by the model to match a complete allow shape so unsupported text
  // cannot ride behind an acknowledgement prefix.
  const clauses = normalized
    .split(/[.!?;]+|\s+[—–]\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (
    clauses.length > 0 &&
    clauses.every((clause) => ALLOW_SHAPES.some((p) => p.test(clause)))
  ) {
    return {
      classification: 'safe',
      category: 'safe_confirmation',
      reason: 'matches a known-safe confirmation shape',
    };
  }
  return {
    classification: 'draft',
    category: 'unmatched',
    reason: 'fail closed: body matches no known-safe shape',
  };
}

// ---------------------------------------------------------------------------
// Disclosure matrix
// ---------------------------------------------------------------------------

/** Which data classes a caller kind may hear through any channel. */
export interface DisclosureGrant {
  tenantIdentity: boolean;
  ledger: boolean;
  ownerPortfolio: boolean;
  vendorJobContext: boolean;
}

const DISCLOSURE_MATRIX: Record<CallerKind, DisclosureGrant> = {
  verified_owner: {
    tenantIdentity: true,
    ledger: true,
    ownerPortfolio: true,
    vendorJobContext: true,
  },
  verified_tenant: {
    tenantIdentity: true,
    ledger: true,
    ownerPortfolio: false,
    vendorJobContext: false,
  },
  likely_tenant: {
    tenantIdentity: true,
    ledger: false,
    ownerPortfolio: false,
    vendorJobContext: false,
  },
  known_vendor: {
    tenantIdentity: false,
    ledger: false,
    ownerPortfolio: false,
    vendorJobContext: true,
  },
  unknown_caller: {
    tenantIdentity: false,
    ledger: false,
    ownerPortfolio: false,
    vendorJobContext: false,
  },
  ambiguous: {
    tenantIdentity: false,
    ledger: false,
    ownerPortfolio: false,
    vendorJobContext: false,
  },
};

/**
 * What this caller kind may be told. Returns a fresh copy (immutable matrix).
 *
 * @param callerKind - Resolved caller identity class.
 */
export function disclosureAllowed(callerKind: CallerKind): DisclosureGrant {
  return { ...DISCLOSURE_MATRIX[callerKind] };
}
