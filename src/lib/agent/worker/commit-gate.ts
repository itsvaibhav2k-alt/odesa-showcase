/**
 * Commit gate — pure decision function consumed by proposals/commit.ts.
 *
 * Given an `ActionProposal` (model output + property context), the
 * caller-supplied `autonomyLevel`, and the property's `privacy_mode`,
 * decide whether to:
 *   - 'auto'   — execute the side effect immediately (no human review)
 *   - 'review' — queue the proposal for owner approval
 *   - 'block'  — refuse outright (policy floor; never used for vendor
 *                dispatch — the spec explicitly says NEVER block dispatch)
 *
 * Each action has an explicit safety disposition before thresholds are even
 * considered. Initiate is review-first: model confidence can never turn a
 * tenant, money, lease, vendor, calendar, archival, or policy commitment into
 * an automatic write. Each row of the matrix encodes:
 *   - whether the action is inference-only, an internal record, or requires
 *     explicit owner review
 *   - the minimum autonomy_level required to consider auto
 *   - the minimum confidence required to consider auto
 *   - whether 'block' is ever a legal outcome for that action_type
 *   - whether the action_type is auto-only (e.g. classify_intent
 *     never goes through review — it's a pure read), review-only
 *     (e.g. update_rulebook always goes through owner approval), or
 *     gated (the common case).
 *
 * Privacy Mode `on_prem` caps the effective autonomy level at 0.7 across the
 * board. It never lowers a policy threshold or makes auto-commit easier.
 *
 * This module has NO Supabase dependency. It is fully synchronous
 * and side-effect-free. The gate decision is then persisted by the
 * caller into action_proposals.gate_decision before commit.ts runs.
 */

import type {
  ActionProposal,
  CitationValidationResult,
  ContextFact,
  WorkerActionType,
} from './types';
import { validateCitations } from './types';

// ---------------------------------------------------------------------------
// Decision shape
// ---------------------------------------------------------------------------

export type GateOutcome = 'auto' | 'review' | 'block';

export interface GateDecision {
  outcome: GateOutcome;
  /** Short, log-friendly reason — surfaced in proposals_feed UI. */
  reason: string;
  /** The threshold used; useful for debugging and the proposals UI. */
  appliedThreshold: {
    autonomy: number;
    confidence: number;
  };
}

export type PrivacyMode = 'hosted' | 'on_prem';

// ---------------------------------------------------------------------------
// Per-action policy
// ---------------------------------------------------------------------------
//
// `mode` controls the high-level disposition:
//   - 'gated'     : auto if both thresholds clear; else review
//   - 'auto_only' : always auto (e.g. classify_intent, a read-only call)
//   - 'review_only': always review (e.g. confirm_emergency, update_rulebook)
//   - 'gated_no_block' : like gated but never block (dispatch_vendor —
//                        owner can review forever, but we never refuse)
//
// `autonomy` and `confidence` are the auto-thresholds for `gated`
// modes. They are ignored for auto_only / review_only.

interface ActionPolicy {
  disposition:
    | 'automatic_inference'
    | 'internal_record'
    | 'requires_owner_review';
  mode: 'gated' | 'auto_only' | 'review_only' | 'gated_no_block';
  autonomy: number;
  confidence: number;
}

export type ActionSafetyDisposition = ActionPolicy['disposition'];

const AUTOMATIC_INFERENCE = 'automatic_inference' as const;
const INTERNAL_RECORD = 'internal_record' as const;
const REQUIRES_OWNER_REVIEW = 'requires_owner_review' as const;

const POLICIES: Record<WorkerActionType, ActionPolicy> = {
  // A draft becomes a real tenant-facing send when committed. Confidence is
  // not consent, so every draft waits in Owner Queue for explicit review.
  draft_sms_reply: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },

  // Intent classification is a pure inference, never executes a side
  // effect. Always auto so the caller can pipe it through the
  // whitelist without owner involvement.
  classify_intent: {
    disposition: AUTOMATIC_INFERENCE,
    mode: 'auto_only',
    autonomy: 0,
    confidence: 0,
  },

  // Emergency confirmation is inference-only at this proposal layer. The
  // deterministic lexical-first emergency caller owns immediate escalation;
  // this generic proposal commit is a no-op and cannot promise access, legal,
  // financial, vendor, or dispatch outcomes.
  confirm_emergency: {
    disposition: AUTOMATIC_INFERENCE,
    mode: 'gated_no_block',
    autonomy: 0,
    confidence: 0.7,
  },

  // Briefing prose polish — low blast radius (it's text on a page).
  // Auto at 0.5+ autonomy regardless of confidence; review otherwise.
  polish_briefing: {
    disposition: INTERNAL_RECORD,
    mode: 'gated',
    autonomy: 0.5,
    confidence: 0,
  },

  // Recording approval is itself a commitment-ledger outcome even before a
  // provider integration exists. A system actor may never manufacture it.
  dispatch_vendor: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },

  // Rulebook edits: always owner-reviewed. The rulebook is the
  // contract; the worker proposes, the owner accepts.
  update_rulebook: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },

  // Internal, provider-free record capture may auto at Initiate defaults. The
  // consequential lifecycle, tenant, money, lease, and policy actions below
  // remain review-only regardless of model confidence.
  create_property: {
    disposition: INTERNAL_RECORD,
    mode: 'gated',
    autonomy: 0,
    confidence: 0.3,
  },
  add_unit: {
    disposition: INTERNAL_RECORD,
    mode: 'gated',
    autonomy: 0,
    confidence: 0.3,
  },
  add_tenant: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  set_lease_terms: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  update_rent: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  waive_rent: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  send_tenant_message: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  log_maintenance_ticket: {
    disposition: INTERNAL_RECORD,
    mode: 'gated',
    autonomy: 0,
    confidence: 0.3,
  },
  update_property_rules: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  archive_lease: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },

  add_appliance: {
    disposition: INTERNAL_RECORD,
    mode: 'gated',
    autonomy: 0,
    confidence: 0.3,
  },
  update_appliance: {
    disposition: INTERNAL_RECORD,
    mode: 'gated',
    autonomy: 0,
    confidence: 0.3,
  },
  set_property_vendor: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  // Preferences can alter future contact behavior and carry deposit facts;
  // keep the composite action reviewed until those concerns are split apart.
  update_tenant_preference: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  request_rent_payment: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  schedule_calendar_event: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
  cancel_calendar_event: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },

  // Feature 5 — proactive health flags from the deterministic
  // daily-health-check cron (src/lib/health). ALWAYS owner-reviewed
  // (same policy shape as update_rulebook): review_only means the gate
  // can never emit 'auto', so a health flag can never enter the
  // owner-queue's routine/approve-all batch — approving one is a
  // deliberate per-card acknowledge.
  health_flag: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },

  // Voice Operator V1 — call outcomes always need owner eyes; commit
  // is a no-op acknowledge (proposals/commit.ts). review_only means it
  // can never auto-commit or join an approve-all batch.
  voice_call_review: {
    disposition: REQUIRES_OWNER_REVIEW,
    mode: 'review_only',
    autonomy: 0,
    confidence: 0,
  },
};

/** Return the explicit safety disposition for audit and defense-in-depth. */
export function actionSafetyDisposition(
  actionType: WorkerActionType,
): ActionSafetyDisposition {
  return POLICIES[actionType].disposition;
}

/** True when only an authenticated human review may commit the action. */
export function requiresHumanReview(actionType: WorkerActionType): boolean {
  return actionSafetyDisposition(actionType) === REQUIRES_OWNER_REVIEW;
}

// On-prem privacy mode caps the caller's effective autonomy. It must never
// reduce a policy threshold, which would make local-model auto-commit easier.
const ON_PREM_AUTONOMY_CAP = 0.7;

// ---------------------------------------------------------------------------
// Citation enforcement (v1.8)
// ---------------------------------------------------------------------------
//
// `validateCitations` (types.ts) flags reasoning that appears to draw on
// a memory_fact without listing one in `context_fact_ids`. When that
// signal fires, route to review — UNLESS the action_type is on the
// safe-by-default list, where blocking would cause real-world harm
// (e.g. delaying an emergency confirm at 3am).
//
// Feature flag: `process.env.ODESA_CITATION_ENFORCEMENT === 'true'`.
// Default OFF — validator still runs but only logs `console.warn`. Flip
// the flag after a day of shadow validation to actually affect gating.

const CITATION_SAFE_DEFAULT_ACTIONS: ReadonlySet<string> = new Set([
  'confirm_emergency',
]);

// Whitelist intent ids (`IntentId` in src/lib/agent/types.ts) whose
// classify_intent proposals skip citation enforcement — these resolve
// to templated/whitelisted replies where routing to review on citation
// grounds harms more than it protects. Compared against the
// classify_intent payload's `intent` field, NOT action_type: intent
// ids never appear as WorkerActionTypes, so the previous single-set
// check made these entries dead (and 'office_hours' wasn't even the
// real intent id — 'office_hours_and_contact' is).
const CITATION_SAFE_DEFAULT_INTENTS: ReadonlySet<string> = new Set([
  'rent_balance',
  'office_hours_and_contact',
  'general_callback',
]);

function isCitationEnforcementEnabled(): boolean {
  return process.env.ODESA_CITATION_ENFORCEMENT === 'true';
}

// ---------------------------------------------------------------------------
// gateProposal
// ---------------------------------------------------------------------------

/**
 * Optional citation-enforcement input. When provided, the gate may
 * route an otherwise-auto proposal to review if `validateCitations`
 * flags the reasoning as fact-shaped without `context_fact_ids`. Wired
 * behind `ODESA_CITATION_ENFORCEMENT=true`; default OFF (warn-only).
 *
 * `proposal` carries the model's reasoning + cited fact ids; `contextFacts`
 * is the set of facts the worker had available (currently informational —
 * see `validateCitations` for forward compatibility notes).
 */
export interface CitationGateInput {
  reasoning: string;
  contextFactIds: ReadonlyArray<string>;
  contextFacts: ReadonlyArray<ContextFact>;
}

/**
 * Decide the gate outcome for a proposal.
 *
 * Pure function. No DB calls; no side effects (other than warn-level
 * logging when citation enforcement is in shadow mode). The caller
 * handles persistence (proposals/record.ts stamps gate_decision before
 * insert).
 *
 * Inputs:
 *   - proposal       : ActionProposal in its pre-persist shape (id may
 *                      still be null). Only `action_type`, `confidence`,
 *                      and (for classify_intent safe-listing) `payload`
 *                      are read. `payload` is optional so existing
 *                      callers/tests that gate on type+confidence alone
 *                      keep compiling.
 *   - autonomyLevel  : the property's current autonomy_level (0..1).
 *   - privacyMode    : 'hosted' | 'on_prem' from the property row.
 *   - citation       : optional. When provided, the validator runs and
 *                      (under the feature flag) may force `review`.
 *
 * Returns a `GateDecision` that the caller copies into
 * `action_proposals.gate_decision`.
 */
export function gateProposal(
  proposal: Pick<ActionProposal, 'action_type' | 'confidence'> &
    Partial<Pick<ActionProposal, 'payload'>>,
  autonomyLevel: number,
  privacyMode: PrivacyMode,
  citation?: CitationGateInput,
): GateDecision {
  const policy = POLICIES[proposal.action_type];

  const baseDecision = computeBaseDecision(proposal, autonomyLevel, privacyMode, policy);

  // Citation enforcement runs after the base decision so we can override
  // an otherwise-auto outcome. Skipped entirely when the caller did not
  // supply citation input, when the action_type (or, for
  // classify_intent, the classified intent) is on a safe-by-default
  // list, or when the base decision is already 'review' (no need to
  // re-route something already routed).
  if (!citation) return baseDecision;
  if (CITATION_SAFE_DEFAULT_ACTIONS.has(proposal.action_type)) {
    return baseDecision;
  }
  if (isSafeClassifiedIntent(proposal.action_type, proposal.payload)) {
    return baseDecision;
  }

  const validation = validateCitations(
    { reasoning: citation.reasoning, context_fact_ids: citation.contextFactIds },
    citation.contextFacts,
  );

  return applyCitationEnforcement(baseDecision, validation, proposal.action_type);
}

function computeBaseDecision(
  proposal: Pick<ActionProposal, 'action_type' | 'confidence'>,
  autonomyLevel: number,
  privacyMode: PrivacyMode,
  policy: ActionPolicy,
): GateDecision {
  // auto_only — always auto, regardless of trust/confidence/privacy.
  if (policy.mode === 'auto_only') {
    return {
      outcome: 'auto',
      reason: `${proposal.action_type} is read-only and never gated`,
      appliedThreshold: { autonomy: 0, confidence: 0 },
    };
  }

  // review_only — always review, regardless of trust/confidence/privacy.
  if (policy.mode === 'review_only') {
    return {
      outcome: 'review',
      reason: `${proposal.action_type} requires owner review`,
      appliedThreshold: { autonomy: 0, confidence: 0 },
    };
  }

  // Gated path: cap the effective autonomy signal on-prem, then
  // compare both autonomy and confidence.
  const effectiveAutonomy =
    privacyMode === 'on_prem'
      ? Math.min(autonomyLevel, ON_PREM_AUTONOMY_CAP)
      : autonomyLevel;

  const meetsAutonomy = effectiveAutonomy >= policy.autonomy;
  const meetsConfidence = proposal.confidence >= policy.confidence;

  if (meetsAutonomy && meetsConfidence) {
    return {
      outcome: 'auto',
      reason:
        `autonomy ${effectiveAutonomy.toFixed(2)} >= ${policy.autonomy} ` +
        `& confidence ${proposal.confidence.toFixed(2)} >= ${policy.confidence}`,
      appliedThreshold: {
        autonomy: policy.autonomy,
        confidence: policy.confidence,
      },
    };
  }

  // `gated_no_block` inference never disappears on low confidence: it falls
  // through to review so the caller can resolve uncertainty explicitly.
  if (policy.mode === 'gated_no_block') {
    return {
      outcome: 'review',
      reason:
        meetsAutonomy
          ? `confidence ${proposal.confidence.toFixed(2)} below ${policy.confidence}`
          : `autonomy ${effectiveAutonomy.toFixed(2)} below ${policy.autonomy}`,
      appliedThreshold: {
        autonomy: policy.autonomy,
        confidence: policy.confidence,
      },
    };
  }

  // Plain gated: failing thresholds means review. We do not produce
  // 'block' from threshold checks alone; 'block' is reserved for an
  // explicit policy refusal we'll wire later (e.g. PII redaction
  // failure). Keeping that surface narrow keeps the gate predictable.
  return {
    outcome: 'review',
    reason:
      meetsAutonomy
        ? `confidence ${proposal.confidence.toFixed(2)} below ${policy.confidence}`
        : `autonomy ${effectiveAutonomy.toFixed(2)} below ${policy.autonomy}`,
    appliedThreshold: {
      autonomy: policy.autonomy,
      confidence: policy.confidence,
    },
  };
}

/**
 * True when the proposal is a `classify_intent` whose classified intent
 * is on the safe-by-default intent list. The intent lives in the model
 * payload (`ClassifyIntentPayload.intent`); reading it defensively via
 * a shape probe keeps the gate total over any payload union member
 * without importing per-action payload types.
 */
function isSafeClassifiedIntent(
  actionType: WorkerActionType,
  payload: ActionProposal['payload'] | undefined,
): boolean {
  if (actionType !== 'classify_intent' || !payload) return false;
  const intent = (payload as { intent?: unknown }).intent;
  return typeof intent === 'string' && CITATION_SAFE_DEFAULT_INTENTS.has(intent);
}

function applyCitationEnforcement(
  baseDecision: GateDecision,
  validation: CitationValidationResult,
  actionType: WorkerActionType,
): GateDecision {
  if (validation.ok) return baseDecision;

  // Validator says not-ok. Behaviour depends on feature flag:
  //   ON  → force outcome to 'review' (unless already 'review')
  //   OFF → log warn-level and return the base decision unchanged
  if (!isCitationEnforcementEnabled()) {
    console.warn(
      `[citation-enforcement:shadow] action_type=${actionType} ` +
        `reason="${validation.reason ?? 'fact-shaped reasoning without citation'}"`,
    );
    return baseDecision;
  }

  if (baseDecision.outcome === 'review') return baseDecision;

  return {
    outcome: 'review',
    reason: `citation enforcement: ${validation.reason ?? 'uncited fact-shaped reasoning'}`,
    appliedThreshold: baseDecision.appliedThreshold,
  };
}

// Re-export the action-policy table for the proposals UI / tests so
// they can render thresholds without duplicating the matrix.
export const COMMIT_GATE_POLICIES: Readonly<Record<WorkerActionType, ActionPolicy>> = POLICIES;

// Re-export citation knobs for the proposals UI / tests / monitoring.
export const CITATION_ENFORCEMENT_SAFE_DEFAULTS: ReadonlySet<string> = CITATION_SAFE_DEFAULT_ACTIONS;
export const CITATION_ENFORCEMENT_SAFE_INTENTS: ReadonlySet<string> = CITATION_SAFE_DEFAULT_INTENTS;
export { validateCitations } from './types';
export { isCitationEnforcementEnabled };
