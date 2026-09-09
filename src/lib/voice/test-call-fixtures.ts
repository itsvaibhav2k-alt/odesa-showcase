/**
 * Deterministic, honest test-call fixtures for POST /api/retell/test-call.
 *
 * WHY this is a pure module (no clock, no Supabase, no side effects):
 *   - Test calls must be replayable byte-for-byte and safe to render in the
 *     /calls UI. The route owns the DB writes; this module only *describes*
 *     the artifact. `now` and `retellCallId` are passed in so the same inputs
 *     always yield the same fixture (never Date.now() inside — same discipline
 *     as the voice engine's reducers/compiler).
 *
 * Honesty rules these fixtures obey (load-bearing — do not weaken):
 *   - No fake drillable ids: recordsCreated is [] and smsDrafted/smsSent carry
 *     NO invented message ids. A pending draft is represented as a human
 *     readable line in approvalsNeeded (exactly how compileOutcome surfaces a
 *     draft with no proposal id), so nothing implies a row that doesn't exist.
 *   - unknown_caller_privacy discloses nothing: no tenant/vendor/property/unit
 *     ids, no seeded tenant names, no dollar amounts anywhere.
 *   - payment_dispute_review never claims a payment cleared; it records the
 *     dispute for the owner to reconcile. No property → no proposal → its
 *     review surface is the inbox conversation, not the owner queue.
 *
 * Risk-flag strings are the REAL vocabulary emitted by call-state.ts
 * riskFlagsFor: 'payment_claim_ledger_conflict', 'unknown_caller_needs_review'.
 */

import type { CallOutcome, CallSession, CallerKind, IntentId } from './types';

export const TEST_CALL_SCENARIOS = [
  'maintenance_clean',
  'payment_dispute_review',
  'unknown_caller_privacy',
] as const;

export type TestCallScenario = (typeof TEST_CALL_SCENARIOS)[number];

/** Everything the test-call route needs to insert a voice_calls + message row. */
export interface TestCallFixture {
  callerKind: CallerKind;
  fromNumber: string;
  toNumber: string;
  intents: IntentId[];
  session: CallSession;
  outcome: CallOutcome;
  transcript: string;
  /** voice_calls.summary — always the outcome's one-sentence honest headline. */
  summary: string;
}

const TO_NUMBER = '+15555550100';

/**
 * Build a deterministic test-call fixture.
 *
 * @param scenario - Which honest scenario to render.
 * @param organizationId - RLS org the call belongs to.
 * @param retellCallId - Synthetic call id the route already minted.
 * @param now - Call start instant; endedAt is derived from it, never generated
 *   inside this module (pure, replayable).
 */
export function buildTestCallFixture(
  scenario: TestCallScenario,
  organizationId: string,
  retellCallId: string,
  now: Date,
): TestCallFixture {
  switch (scenario) {
    case 'maintenance_clean':
      return maintenanceClean(organizationId, retellCallId, now);
    case 'payment_dispute_review':
      return paymentDisputeReview(organizationId, retellCallId, now);
    case 'unknown_caller_privacy':
      return unknownCallerPrivacy(organizationId, retellCallId, now);
    default: {
      const exhaustive: never = scenario;
      void exhaustive;
      return maintenanceClean(organizationId, retellCallId, now);
    }
  }
}

// ---------------------------------------------------------------------------
// maintenance_clean — verbatim move of the original hardcoded route scenario.
// Verified tenant, kitchen-sink leak, one reversible work order, clean resolve.
// ---------------------------------------------------------------------------

function maintenanceClean(
  organizationId: string,
  retellCallId: string,
  now: Date,
): TestCallFixture {
  const startedAt = now.toISOString();
  const endedAt = new Date(now.getTime() + 120000).toISOString();
  const fromNumber = '+15555551234';

  const session: CallSession = {
    retellCallId,
    organizationId,
    direction: 'inbound',
    fromNumber,
    toNumber: TO_NUMBER,
    callerKind: 'verified_tenant',
    tenantId: null,
    propertyId: null,
    unitId: null,
    startedAt,
    intents: ['maintenance_request'],
    facts: {
      maintenanceIssue: {
        description: 'Test kitchen sink leak',
        category: 'plumbing',
        urgency: 'routine',
      },
    },
    actions: [
      {
        action: 'create_work_order',
        at: startedAt,
        tier: 2,
        outcome: 'executed',
        ids: { work_order: 'test-wo-123' },
        detail: 'Test kitchen sink leak - plumbing - routine',
      },
    ],
    smsSent: [],
    smsDrafted: [],
    approvalsNeeded: [],
    riskFlags: [],
  };

  const outcome: CallOutcome = {
    oneSentence:
      'Verified tenant call — 1 topic handled: maintenance request; 1 action taken, 0 awaiting owner review.',
    callerKind: 'verified_tenant',
    callerPhone: fromNumber,
    tenantId: null,
    vendorId: null,
    propertyId: null,
    unitId: null,
    intentsHandled: ['maintenance_request'],
    // No real work_orders row is created for a test call, so we intentionally
    // emit no drillable record — the "Work order created" named action still
    // renders (derived from autonomousActions), but there is no dead
    // /work-orders/<fake> drill link in the dossier.
    recordsCreated: [],
    autonomousActions: [
      {
        action: 'create_work_order',
        at: startedAt,
        tier: 2,
        outcome: 'executed',
        ids: { work_order: 'test-wo-123' },
        detail: 'Test kitchen sink leak - plumbing - routine',
      },
    ],
    approvalsNeeded: [],
    smsSent: [],
    smsDrafted: [],
    unresolved: [],
    riskFlags: [],
    endedAt,
  };

  const transcript = `Agent: Thank you for calling property management. How can I help you today?
Caller: Hi, I have a leak under my kitchen sink.
Agent: I'm sorry to hear about the leak. Can you tell me more about it?
Caller: It's dripping slowly but steadily. I've put a bucket under it for now.
Agent: Thank you for containing it. I'll create a work order for a plumber to come fix that.
Agent: Is there anything else I can help you with?
Caller: No, that's all. Thank you.
Agent: You're welcome. A plumber will contact you within 24 hours. Have a great day!`;

  return {
    callerKind: 'verified_tenant',
    fromNumber,
    toNumber: TO_NUMBER,
    intents: ['maintenance_request'],
    session,
    outcome,
    transcript,
    summary: outcome.oneSentence,
  };
}

// ---------------------------------------------------------------------------
// payment_dispute_review — verified tenant disputing that a rent payment
// posted (paid on the 1st, portal still shows owed). Odesa records the dispute
// and hands it to the owner; it NEVER claims the payment cleared. No autonomous
// action, no property → no proposal. The drafted reply lives in approvalsNeeded
// as a human line (no fake message id). Derives to clay "Needs review" whose
// honest next move is the inbox conversation.
// ---------------------------------------------------------------------------

function paymentDisputeReview(
  organizationId: string,
  retellCallId: string,
  now: Date,
): TestCallFixture {
  const startedAt = now.toISOString();
  const endedAt = new Date(now.getTime() + 120000).toISOString();
  const fromNumber = '+15555552345';
  const approvalLine =
    'Draft reply to tenant disputing that this month’s rent payment posted — owner to confirm against the ledger before Odesa responds.';

  const session: CallSession = {
    retellCallId,
    organizationId,
    direction: 'inbound',
    fromNumber,
    toNumber: TO_NUMBER,
    callerKind: 'verified_tenant',
    tenantId: null,
    propertyId: null,
    unitId: null,
    startedAt,
    intents: ['payment_dispute'],
    facts: {
      paymentClaim: { method: 'online portal', claimed: true },
    },
    actions: [],
    smsSent: [],
    smsDrafted: [],
    approvalsNeeded: [approvalLine],
    riskFlags: ['payment_claim_ledger_conflict'],
  };

  const outcome: CallOutcome = {
    oneSentence:
      'Verified tenant call — 1 topic handled: payment dispute; 0 actions taken, 1 awaiting owner review.',
    callerKind: 'verified_tenant',
    callerPhone: fromNumber,
    tenantId: null,
    vendorId: null,
    propertyId: null,
    unitId: null,
    intentsHandled: ['payment_dispute'],
    recordsCreated: [],
    autonomousActions: [],
    approvalsNeeded: [approvalLine],
    smsSent: [],
    smsDrafted: [],
    unresolved: [],
    riskFlags: ['payment_claim_ledger_conflict'],
    endedAt,
  };

  const transcript = `Agent: Thank you for calling property management. How can I help you today?
Caller: I paid my rent on the first through the online portal, but the tenant portal still shows I owe for this month.
Agent: I understand — you believe the payment went through, but the balance still shows as owed. I'm not able to confirm or clear a payment on this call.
Caller: I definitely paid it. Can you fix the balance?
Agent: I can't adjust the balance or confirm the payment myself. I've recorded that you're disputing this month's rent charge, and the property owner will review it against the ledger and follow up with you.
Caller: Okay, please have them check.
Agent: I've noted the dispute for the owner to review. Is there anything else I can help you with?
Caller: No, that's it. Thank you.
Agent: You're welcome. The owner will review your rent dispute and get back to you. Have a good day.`;

  return {
    callerKind: 'verified_tenant',
    fromNumber,
    toNumber: TO_NUMBER,
    intents: ['payment_dispute'],
    session,
    outcome,
    transcript,
    summary: outcome.oneSentence,
  };
}

// ---------------------------------------------------------------------------
// unknown_caller_privacy — a caller who will not identify themselves. Odesa
// discloses nothing, takes a message, and flags for review. No identity ids,
// no seeded tenant names, no dollar amounts. Derives to clay "Needs review"
// via the real 'unknown_caller_needs_review' flag with a neutral privacy move.
// ---------------------------------------------------------------------------

function unknownCallerPrivacy(
  organizationId: string,
  retellCallId: string,
  now: Date,
): TestCallFixture {
  const startedAt = now.toISOString();
  const endedAt = new Date(now.getTime() + 90000).toISOString();
  const fromNumber = '+15555559876';

  const session: CallSession = {
    retellCallId,
    organizationId,
    direction: 'inbound',
    fromNumber,
    toNumber: TO_NUMBER,
    callerKind: 'unknown_caller',
    tenantId: null,
    propertyId: null,
    unitId: null,
    startedAt,
    intents: ['unknown_general'],
    facts: {},
    actions: [],
    smsSent: [],
    smsDrafted: [],
    approvalsNeeded: [],
    riskFlags: ['unknown_caller_needs_review'],
  };

  const outcome: CallOutcome = {
    oneSentence:
      'Unknown caller call — 1 topic handled: unknown general; 0 actions taken, 0 awaiting owner review.',
    callerKind: 'unknown_caller',
    callerPhone: fromNumber,
    tenantId: null,
    vendorId: null,
    propertyId: null,
    unitId: null,
    intentsHandled: ['unknown_general'],
    recordsCreated: [],
    autonomousActions: [],
    approvalsNeeded: [],
    smsSent: [],
    smsDrafted: [],
    unresolved: [],
    riskFlags: ['unknown_caller_needs_review'],
    endedAt,
  };

  const transcript = `Agent: Thank you for calling property management. How can I help you today?
Caller: I'd rather not say who I am, but I have a question about one of your units.
Agent: I understand. For privacy, I'm not able to share any tenant, unit, or account details with a caller I can't verify.
Caller: I just want some information. I won't give you my name.
Agent: That's completely fine, and I won't ask you to. I also can't disclose any private information without verifying who you are. I can take a message and have the property owner follow up if you'd like to leave a callback number.
Caller: Never mind then.
Agent: No problem at all. I've noted that an unidentified caller reached out. If you change your mind, please call back anytime. Have a good day.`;

  return {
    callerKind: 'unknown_caller',
    fromNumber,
    toNumber: TO_NUMBER,
    intents: ['unknown_general'],
    session,
    outcome,
    transcript,
    summary: outcome.oneSentence,
  };
}
