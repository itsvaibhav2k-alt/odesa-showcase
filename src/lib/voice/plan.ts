/**
 * Declarative turn planner — what to ask next and what the agent may do,
 * computed per turn from the live session. One spec table + one pure
 * function, NOT six workflow classes.
 *
 * WHY declarative specs instead of per-intent workflow code:
 *   - Every intent reduces to the same three questions: which facts do we
 *     still need, what do we ask for the highest-priority missing fact, and
 *     which action verbs does this topic unlock. A Record<IntentId, IntentSpec>
 *     answers all three, is exhaustive by construction (adding an IntentId to
 *     types.ts without a spec row is a compile error), and multi-intent calls
 *     fall out for free as a union over specs — no workflow orchestration.
 *   - Safety stays in policy.ts: planTurn never decides allow/draft/forbid
 *     itself. Every candidate action is run through gateVoiceAction(session),
 *     so a spec listing an action can never smuggle it past the tier matrix
 *     or the unresolved-caller privacy rules.
 *   - Question priority is a fixed rank, not per-intent logic: emergency
 *     screening always outranks everything (safety), then access permission,
 *     payment-claim details, callback time, and finally caller identity for
 *     unresolved callers. missingFacts ordering differs deliberately —
 *     identity facts surface right after the emergency screen there, because
 *     an unresolved caller's plan must show identity as the blocking gap even
 *     while the agent asks safety questions first.
 *   - honestyHints carry the non-negotiable phrasings ("the ledger currently
 *     shows…", "I'll ask the owner to follow up", escalate-never-promise) so
 *     the prompt layer can inject them verbatim every turn.
 *
 * NO side effects, NO Supabase, NO Date.now(). Pure function on plain objects.
 */

import { gateVoiceAction } from './policy';
import type {
  CallFacts,
  CallSession,
  IntentId,
  TurnPlan,
  VoiceActionDecision,
  VoiceActionId,
} from './types';

// ---------------------------------------------------------------------------
// Intent specs
// ---------------------------------------------------------------------------

/** Per-intent recipe: facts to collect, how to ask for them, actions unlocked. */
export interface IntentSpec {
  requiredFacts: Array<keyof CallFacts | string>;
  questionFor: Record<string, string>;
  actions: VoiceActionId[];
}

const EMERGENCY_SCREEN_QUESTION =
  'Is there any active flooding or electrical danger right now?';
const ACCESS_QUESTION =
  'Is it safe to enter, and do we have your permission for maintenance access?';

/**
 * The 17-intent spec table. Facts referenced here are the typed CallFacts
 * keys plus 'issueDescription' (open jsonb key) for maintenance. Actions are
 * candidates only — gateVoiceAction has final say per caller kind.
 */
export const INTENT_SPECS: Record<IntentId, IntentSpec> = {
  rent_status: {
    // No facts: eligibility is identity (verified tenant/owner), enforced by the gate.
    requiredFacts: [],
    questionFor: {},
    actions: ['answer_rent_status', 'send_safe_confirmation_sms'],
  },
  payment_dispute: {
    requiredFacts: ['paymentClaim'],
    questionFor: {
      paymentClaim: 'When did you make the payment, and how — check, transfer, or the portal?',
    },
    actions: [
      'answer_rent_status',
      'request_payment_proof_sms',
      'create_owner_queue_item',
      'create_followup_sms_draft',
    ],
  },
  late_rent_response: {
    requiredFacts: ['paymentClaim'],
    questionFor: {
      paymentClaim: 'Have you already sent this payment, or when do you plan to?',
    },
    // send_rent_reminder is tier 3 — surfaces in blockedOrDraft as a draft.
    actions: ['answer_rent_status', 'request_payment_proof_sms', 'send_rent_reminder'],
  },
  maintenance_request: {
    requiredFacts: ['emergencyScreen', 'issueDescription', 'accessPermission'],
    questionFor: {
      emergencyScreen: EMERGENCY_SCREEN_QUESTION,
      issueDescription: 'Can you describe the issue and where in the unit it is?',
      accessPermission: ACCESS_QUESTION,
    },
    actions: [
      'create_work_order',
      'request_photo_sms',
      'send_safe_confirmation_sms',
      'notify_owner',
    ],
  },
  emergency_maintenance: {
    requiredFacts: ['emergencyScreen'],
    questionFor: { emergencyScreen: EMERGENCY_SCREEN_QUESTION },
    actions: ['escalate_to_landlord', 'create_work_order', 'send_safe_confirmation_sms'],
  },
  access_permission: {
    requiredFacts: ['accessPermission', 'availability'],
    questionFor: {
      accessPermission: ACCESS_QUESTION,
      availability: 'What days and times work for access?',
    },
    actions: ['record_call_note', 'notify_owner'],
  },
  lockout_or_keys: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'escalate_to_landlord'],
  },
  callback_request: {
    requiredFacts: ['callbackAfter'],
    questionFor: {
      callbackAfter: 'When is a good time for the owner to reach you?',
    },
    actions: ['record_callback_request', 'schedule_callback'],
  },
  lease_question: {
    requiredFacts: [],
    questionFor: {},
    actions: ['answer_lease_question', 'create_followup_sms_draft'],
  },
  move_out: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'create_owner_queue_item', 'create_followup_sms_draft'],
  },
  renewal: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'create_owner_queue_item', 'create_followup_sms_draft'],
  },
  complaint: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'create_owner_queue_item', 'create_followup_sms_draft'],
  },
  neighbor_issue: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'create_owner_queue_item', 'create_followup_sms_draft'],
  },
  vendor_status: {
    requiredFacts: [],
    questionFor: {},
    actions: ['collect_vendor_status', 'escalate_to_landlord'],
  },
  owner_briefing: {
    requiredFacts: [],
    questionFor: {},
    actions: ['provide_owner_briefing', 'create_followup_sms_draft'],
  },
  document_request: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'create_owner_queue_item', 'create_followup_sms_draft'],
  },
  unknown_general: {
    requiredFacts: [],
    questionFor: {},
    actions: ['record_call_note', 'create_owner_queue_item', 'send_safe_confirmation_sms'],
  },
};

// ---------------------------------------------------------------------------
// Fact priorities + identity facts for unresolved callers
// ---------------------------------------------------------------------------

/** Identity facts an unresolved (unknown/ambiguous) caller must supply. */
const IDENTITY_FACTS = [
  'callerName',
  'callerStatedProperty',
  'callerStatedUnit',
  'callerStatedReason',
] as const;

const IDENTITY_QUESTIONS: Record<string, string> = {
  callerName: 'Can I get your name, please?',
  callerStatedProperty: 'Which property are you calling about?',
  callerStatedUnit: 'Which unit is this regarding?',
  callerStatedReason: 'What can I help you with today?',
};

/**
 * missingFacts display order: emergency screen first (safety), then identity
 * facts (an unresolved caller's blocking gap), then the rest by operational
 * priority. Unranked facts keep spec insertion order at the end.
 */
const MISSING_FACTS_ORDER: readonly string[] = [
  'emergencyScreen',
  ...IDENTITY_FACTS,
  'accessPermission',
  'paymentClaim',
  'callbackAfter',
];

/**
 * nextQuestion priority: emergency screen > access permission > payment
 * claim details > callback time > caller identity. Identity ranks last here
 * — the agent resolves the topic's safety questions before interrogating
 * who is calling.
 */
const QUESTION_ORDER: readonly string[] = [
  'emergencyScreen',
  'accessPermission',
  'paymentClaim',
  'callbackAfter',
  ...IDENTITY_FACTS,
];

const rankIn = (order: readonly string[], fact: string): number => {
  const index = order.indexOf(fact);
  return index === -1 ? order.length : index;
};

// ---------------------------------------------------------------------------
// Honesty hints
// ---------------------------------------------------------------------------

const RENT_INTENTS: ReadonlySet<IntentId> = new Set([
  'rent_status',
  'payment_dispute',
  'late_rent_response',
]);
const CALLBACK_INTENTS: ReadonlySet<IntentId> = new Set(['callback_request', 'access_permission']);

const HINT_LEDGER =
  'Rent answers must say "the ledger currently shows…" — never claim a payment cleared, ' +
  'was received, or was processed.';
const HINT_CALLBACK =
  'Phrase callbacks and scheduling as "I\'ll ask the owner to follow up" — never say ' +
  '"you\'re scheduled" or promise a time.';
const HINT_EMERGENCY =
  'Emergencies escalate to the landlord — never promise dispatch or an arrival time.';
const HINT_UNKNOWN_CALLER =
  'Caller is unresolved: collect name, property, unit, and reason for calling — disclose ' +
  'no tenant names, balances, unit details, or owner information.';

// ---------------------------------------------------------------------------
// planTurn
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic turn plan for the current session: the union of
 * intent specs, minus collected facts, with every candidate action gated by
 * policy.
 *
 * @param session - Live call session (not mutated).
 * @returns Missing facts (priority-ordered), the single next question or
 *   null, policy-allowed actions, blocked/draft decisions, honesty hints.
 */
export function planTurn(session: CallSession): TurnPlan {
  const unresolved = session.callerKind === 'unknown_caller' || session.callerKind === 'ambiguous';
  const specs = session.intents.map((intent) => INTENT_SPECS[intent]);

  // Union of required facts (insertion order) + question lookup per fact.
  const required: string[] = [];
  const questionByFact: Record<string, string> = { ...IDENTITY_QUESTIONS };
  for (const spec of specs) {
    for (const fact of spec.requiredFacts) {
      const key = String(fact);
      if (!required.includes(key)) required.push(key);
    }
    for (const [fact, question] of Object.entries(spec.questionFor)) {
      if (!(fact in questionByFact)) questionByFact[fact] = question;
    }
  }
  if (unresolved) {
    for (const fact of IDENTITY_FACTS) {
      if (!required.includes(fact)) required.push(fact);
    }
  }

  const missing = required.filter((fact) => session.facts[fact] === undefined);
  const missingFacts = [...missing].sort(
    (a, b) => rankIn(MISSING_FACTS_ORDER, a) - rankIn(MISSING_FACTS_ORDER, b),
  );
  const nextFact = [...missing]
    .sort((a, b) => rankIn(QUESTION_ORDER, a) - rankIn(QUESTION_ORDER, b))
    .find((fact) => questionByFact[fact] !== undefined);
  const nextQuestion = nextFact !== undefined ? questionByFact[nextFact] : null;

  // Gate every candidate action — policy, not the spec table, has final say.
  const candidates: VoiceActionId[] = [];
  for (const spec of specs) {
    for (const action of spec.actions) {
      if (!candidates.includes(action)) candidates.push(action);
    }
  }
  const allowedActions: VoiceActionId[] = [];
  const blockedOrDraft: VoiceActionDecision[] = [];
  for (const action of candidates) {
    const decision = gateVoiceAction(action, session);
    if (decision.decision === 'allow') {
      allowedActions.push(action);
    } else {
      blockedOrDraft.push(decision);
    }
  }

  const honestyHints: string[] = [];
  if (session.intents.some((intent) => RENT_INTENTS.has(intent))) honestyHints.push(HINT_LEDGER);
  if (session.intents.some((intent) => CALLBACK_INTENTS.has(intent))) {
    honestyHints.push(HINT_CALLBACK);
  }
  if (session.intents.includes('emergency_maintenance')) honestyHints.push(HINT_EMERGENCY);
  if (unresolved) honestyHints.push(HINT_UNKNOWN_CALLER);

  return { missingFacts, nextQuestion, allowedActions, blockedOrDraft, honestyHints };
}
