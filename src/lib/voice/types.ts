/**
 * Voice engine contracts — the single source of truth every sibling module
 * in src/lib/voice/ imports (policy, intents, plan, call-state, outcomes,
 * session-store, webhook route).
 *
 * WHY this file exists as pure types + zod:
 *   - The voice engine is deterministic and unit-tested: the LLM (Retell/
 *     Grok) proposes, Odesa disposes. That only works if every module talks
 *     the same vocabulary — 17 IntentIds, 6 CallerKinds, 26 VoiceActionIds,
 *     autonomy tiers 0–4 — declared once, here, as const arrays with derived
 *     unions so TypeScript enforces exhaustiveness in the policy matrices.
 *   - CallSession/CallOutcome live in `voice_calls.session`/`.outcome` jsonb
 *     columns. jsonb has no DB-level shape guarantee, so the zod schemas
 *     below are the trust boundary on every read-back and webhook ingest.
 *   - Reducers are pure: CallEvent payloads carry ISO timestamps passed in
 *     by the caller — never Date.now() inside the engine — so tests can
 *     replay scripted calls byte-for-byte.
 *
 * NO side effects, NO imports beyond zod, NO Supabase. Fully vitest-safe.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Core vocabulary — const arrays + derived unions
// ---------------------------------------------------------------------------

/** The 17 call topics V1 recognizes (handoff taxonomy; 'unknown_general' is the catch-all). */
export const INTENT_IDS = [
  'rent_status',
  'payment_dispute',
  'late_rent_response',
  'maintenance_request',
  'emergency_maintenance',
  'access_permission',
  'lockout_or_keys',
  'callback_request',
  'lease_question',
  'move_out',
  'renewal',
  'complaint',
  'neighbor_issue',
  'vendor_status',
  'owner_briefing',
  'document_request',
  'unknown_general',
] as const;

export type IntentId = (typeof INTENT_IDS)[number];

/**
 * Who is on the line. Disclosure policy keys off this: 'unknown_caller' and
 * 'ambiguous' receive NO tenant names, balances, unit info, or owner data
 * through any channel.
 */
export const CALLER_KINDS = [
  'verified_owner',
  'verified_tenant',
  'likely_tenant',
  'known_vendor',
  'unknown_caller',
  'ambiguous',
] as const;

export type CallerKind = (typeof CALLER_KINDS)[number];

/**
 * Autonomy tiers:
 *   0 answer-only · 1 record · 2 act-reversible · 3 draft/approval · 4 never.
 * Tier 4 actions exist in the vocabulary purely so policy can name-and-forbid
 * them (and tests can assert every one is blocked).
 */
export type AutonomyTier = 0 | 1 | 2 | 3 | 4;

/** Every action verb the voice engine can allow, draft, or forbid. */
export const VOICE_ACTION_IDS = [
  // tier 0 — answer-only
  'answer_rent_status',
  'answer_lease_question',
  'provide_owner_briefing',
  'collect_vendor_status',
  // tier 1 — record
  'record_call_note',
  'record_callback_request',
  // tier 2 — act, reversible
  'create_work_order',
  'send_safe_confirmation_sms',
  'request_payment_proof_sms',
  'request_photo_sms',
  'notify_owner',
  'create_owner_queue_item',
  'schedule_callback',
  'escalate_to_landlord',
  // tier 3 — draft for approval
  'create_followup_sms_draft',
  'send_rent_reminder',
  'coordinate_vendor',
  'schedule_access_entry',
  // tier 4 — never
  'process_payment',
  'waive_fee',
  'threaten_legal_action',
  'amend_lease',
  'dispatch_vendor_with_cost',
  'promise_appointment',
  'promise_emergency_dispatch',
  'disclose_private_data',
] as const;

export type VoiceActionId = (typeof VOICE_ACTION_IDS)[number];

// ---------------------------------------------------------------------------
// Policy decision + action log
// ---------------------------------------------------------------------------

/** Output of the deterministic gate: what happened to a proposed action and why. */
export interface VoiceActionDecision {
  action: VoiceActionId;
  decision: 'allow' | 'draft' | 'forbid';
  tier: AutonomyTier;
  /** Short, log-friendly reason — surfaced in outcome artifacts and tests. */
  reason: string;
}

/** One executed/drafted/blocked action, appended to the session log by tool routes. */
export interface VoiceActionLogEntry {
  action: VoiceActionId;
  /** ISO timestamp supplied by the caller (never generated inside the engine). */
  at: string;
  tier: AutonomyTier;
  outcome: 'executed' | 'drafted' | 'blocked';
  /** Created record ids keyed by kind, e.g. { work_order: uuid, message: uuid }. */
  ids?: Record<string, string>;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Call-local facts
// ---------------------------------------------------------------------------

/**
 * Structured facts collected during the call. Typed keys are the ones the
 * planner's INTENT_SPECS reference; the open index keeps forward-compat with
 * facts the agent reports that this version doesn't know yet (they round-trip
 * through jsonb untouched).
 */
export type CallFacts = {
  emergencyScreen?: {
    activeFlooding?: boolean;
    electricalDanger?: boolean;
    contained?: boolean;
  };
  accessPermission?: boolean;
  availability?: string;
  paymentClaim?: { method?: string; claimed: boolean };
  callbackAfter?: string;
  callerName?: string;
  callerStatedProperty?: string;
  callerStatedUnit?: string;
  callerStatedReason?: string;
  upset?: boolean;
} & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Live session (voice_calls.session jsonb)
// ---------------------------------------------------------------------------

/** The live per-call state the reducer folds CallEvents into. */
export interface CallSession {
  retellCallId: string;
  organizationId: string;
  direction: 'inbound' | 'outbound';
  fromNumber: string;
  toNumber: string;
  callerKind: CallerKind;
  tenantId?: string | null;
  vendorId?: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  startedAt: string;
  endedAt?: string | null;
  intents: IntentId[];
  facts: CallFacts;
  actions: VoiceActionLogEntry[];
  /** Message ids of SMS actually sent / drafted during the call. */
  smsSent: string[];
  smsDrafted: string[];
  /** Proposal ids queued for owner approval. */
  approvalsNeeded: string[];
  riskFlags: string[];
  /**
   * Cross-retry idempotency ledger for record-creating tools: idempotency key
   * → the exact tool response body already returned. A duplicate Retell retry
   * replays the stored body instead of re-running side effects. Additive and
   * optional — absent on legacy rows and calls that never invoked a write tool.
   */
  idempotencyLedger?: Record<string, unknown>;
  /**
   * Provider (Retell) `call_analysis` blob, stashed additively when the
   * `call_analyzed` webhook arrives AFTER the call is already finalized. Never
   * mutates the compiled `outcome`; it is enrichment-only reference data.
   */
  providerAnalysis?: unknown;
}

// ---------------------------------------------------------------------------
// Call events — reducer input (all timestamps ISO, passed in by callers)
// ---------------------------------------------------------------------------

export type CallEvent =
  | {
      type: 'call_started';
      at: string;
      retellCallId: string;
      organizationId: string;
      direction: 'inbound' | 'outbound';
      fromNumber: string;
      toNumber: string;
    }
  | {
      type: 'caller_resolved';
      at: string;
      callerKind: CallerKind;
      tenantId?: string | null;
      vendorId?: string | null;
      propertyId?: string | null;
      unitId?: string | null;
    }
  | { type: 'intent_added'; at: string; intent: IntentId }
  | { type: 'fact_collected'; at: string; facts: CallFacts }
  | { type: 'action_taken'; at: string; entry: VoiceActionLogEntry }
  | { type: 'sms_sent'; at: string; messageId: string }
  | { type: 'sms_drafted'; at: string; messageId: string }
  | { type: 'approval_queued'; at: string; proposalId: string }
  | { type: 'call_ended'; at: string };

// ---------------------------------------------------------------------------
// Compiled outcome (voice_calls.outcome jsonb; written once at call_ended)
// ---------------------------------------------------------------------------

/** The landlord-facing artifact: everything that happened on the call, honestly. */
export interface CallOutcome {
  oneSentence: string;
  callerKind: CallerKind;
  callerPhone: string;
  tenantId?: string | null;
  vendorId?: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  intentsHandled: IntentId[];
  recordsCreated: Array<{ kind: string; id: string }>;
  autonomousActions: VoiceActionLogEntry[];
  approvalsNeeded: string[];
  smsSent: string[];
  smsDrafted: string[];
  /** Facts the planner still wanted at call end — honest "not done" list. */
  unresolved: string[];
  riskFlags: string[];
  endedAt: string;
}

// ---------------------------------------------------------------------------
// Turn planning — planTurn(session) return shape
// ---------------------------------------------------------------------------

/** What the agent should do next, computed deterministically per turn. */
export interface TurnPlan {
  missingFacts: string[];
  nextQuestion: string | null;
  allowedActions: VoiceActionId[];
  blockedOrDraft: VoiceActionDecision[];
  /** Ledger-honest / no-promise phrasing lines the agent must respect. */
  honestyHints: string[];
}

// ---------------------------------------------------------------------------
// zod schemas — trust boundary for jsonb round-trips and webhook ingest
// ---------------------------------------------------------------------------

export const intentIdSchema = z.enum(INTENT_IDS);
export const callerKindSchema = z.enum(CALLER_KINDS);
export const voiceActionIdSchema = z.enum(VOICE_ACTION_IDS);
export const autonomyTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const voiceActionLogEntrySchema = z.object({
  action: voiceActionIdSchema,
  at: z.string(),
  tier: autonomyTierSchema,
  outcome: z.enum(['executed', 'drafted', 'blocked']),
  ids: z.record(z.string(), z.string()).optional(),
  detail: z.string().optional(),
});

/** Typed keys validated; unknown keys pass through (jsonb forward-compat). */
export const callFactsSchema = z.looseObject({
  emergencyScreen: z
    .object({
      activeFlooding: z.boolean().optional(),
      electricalDanger: z.boolean().optional(),
      contained: z.boolean().optional(),
    })
    .optional(),
  accessPermission: z.boolean().optional(),
  availability: z.string().optional(),
  paymentClaim: z.object({ method: z.string().optional(), claimed: z.boolean() }).optional(),
  callbackAfter: z.string().optional(),
  callerName: z.string().optional(),
  callerStatedProperty: z.string().optional(),
  callerStatedUnit: z.string().optional(),
  callerStatedReason: z.string().optional(),
  upset: z.boolean().optional(),
});

export const callSessionSchema = z.object({
  retellCallId: z.string(),
  organizationId: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  fromNumber: z.string(),
  toNumber: z.string(),
  callerKind: callerKindSchema,
  tenantId: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  intents: z.array(intentIdSchema),
  facts: callFactsSchema,
  actions: z.array(voiceActionLogEntrySchema),
  smsSent: z.array(z.string()),
  smsDrafted: z.array(z.string()),
  approvalsNeeded: z.array(z.string()),
  riskFlags: z.array(z.string()),
  // Additive: absent on legacy rows, so both are optional (jsonb forward-compat).
  idempotencyLedger: z.record(z.string(), z.unknown()).optional(),
  providerAnalysis: z.unknown().optional(),
});

export const callOutcomeSchema = z.object({
  oneSentence: z.string(),
  callerKind: callerKindSchema,
  callerPhone: z.string(),
  tenantId: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  unitId: z.string().nullable().optional(),
  intentsHandled: z.array(intentIdSchema),
  recordsCreated: z.array(z.object({ kind: z.string(), id: z.string() })),
  autonomousActions: z.array(voiceActionLogEntrySchema),
  approvalsNeeded: z.array(z.string()),
  smsSent: z.array(z.string()),
  smsDrafted: z.array(z.string()),
  unresolved: z.array(z.string()),
  riskFlags: z.array(z.string()),
  endedAt: z.string(),
});

/**
 * Internal webhook event union — the shape tests speak natively. The route's
 * thin adapter maps Retell's external payload into this before validation.
 * call_ended carries the transcript; call_started never does.
 */
export const voiceWebhookEventSchema = z.object({
  event: z.enum(['call_started', 'call_ended']),
  call: z.object({
    call_id: z.string(),
    direction: z.enum(['inbound', 'outbound']).optional(),
    from_number: z.string(),
    to_number: z.string(),
    transcript: z.string().optional(),
  }),
});

export type VoiceWebhookEvent = z.infer<typeof voiceWebhookEventSchema>;
