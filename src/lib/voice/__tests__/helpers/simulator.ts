/**
 * Scripted-call simulator — TEST HELPER ONLY, never imported by src runtime.
 *
 * WHY a simulator instead of hand-built sessions in each flow test:
 *   - The demo flows (F1–F6) are the product promise stated as scripts:
 *     "caller says X, agent collects Y, attempts Z — what does the landlord
 *     get?" Answering that requires the REAL pipeline, wired exactly as the
 *     webhook + tool routes wire it: extractIntents → reduceCallEvent →
 *     planTurn → gateVoiceAction → compileOutcome. If flow tests re-plumbed
 *     that by hand per test, they would drift from production wiring and pass
 *     while the real pipeline broke.
 *   - Policy stays the sole authority: the simulator never decides anything.
 *     Every attempted action goes through gateVoiceAction; 'allow' executes,
 *     'draft' drafts + queues approval, 'forbid' logs a blocked entry (which
 *     riskFlagsFor turns into a flag for tier-4 attempts). A test cannot
 *     smuggle an action past the gate.
 *   - Determinism is byte-for-byte: timestamps are fixed ISO strings derived
 *     from the turn index (never Date.now()), and synthesized ids are simple
 *     counters ('wo-1', 'msg-1', 'prop-1'), so two runs of the same script
 *     produce identical sessions and outcomes — the no-fabricated-timestamp
 *     assertions in flows.test.ts depend on this.
 *
 * NO Supabase, NO network, NO clock. Pure functions on plain objects.
 */

import { extractIntents } from '../../intents';
import { createSession, reduceCallEvent } from '../../call-state';
import { gateVoiceAction } from '../../policy';
import { planTurn } from '../../plan';
import { compileOutcome } from '../../outcomes';
import type {
  CallFacts,
  CallOutcome,
  CallSession,
  CallerKind,
  TurnPlan,
  VoiceActionId,
  VoiceActionLogEntry,
} from '../../types';

/** One scripted caller turn: what they say, facts collected, actions attempted. */
export interface SimTurn {
  say: string;
  facts?: Partial<CallFacts>;
  act?: VoiceActionId[];
}

/** Script for one simulated call. */
export interface SimulateCallInput {
  callerKind: CallerKind;
  linkedIds?: Pick<CallSession, 'tenantId' | 'vendorId' | 'propertyId' | 'unitId'>;
  turns: SimTurn[];
}

/** Everything a flow test asserts against. */
export interface SimulateCallResult {
  session: CallSession;
  /** One TurnPlan per turn, computed AFTER that turn's intents + facts landed. */
  plans: TurnPlan[];
  outcome: CallOutcome;
}

/** Fixed base timestamp; turn index advances the minute field. Never Date.now(). */
const at = (turnIndex: number): string =>
  `2026-07-05T17:${String(turnIndex).padStart(2, '0')}:00Z`;

/** Which synthesized record id an action produces when it executes or drafts. */
const ID_KIND: Partial<Record<VoiceActionId, 'work_order' | 'message'>> = {
  create_work_order: 'work_order',
  send_safe_confirmation_sms: 'message',
  request_payment_proof_sms: 'message',
  request_photo_sms: 'message',
  send_rent_reminder: 'message',
  create_followup_sms_draft: 'message',
};

const ID_PREFIX = { work_order: 'wo', message: 'msg', proposal: 'prop' } as const;

/**
 * Run a scripted call through the real engine pipeline.
 *
 * Per turn: extractIntents(say) → intent_added events → fact_collected →
 * planTurn (recorded) → each attempted action through gateVoiceAction:
 * allow ⇒ executed action_taken (+ sms_sent when it sends a message);
 * draft ⇒ drafted action_taken (message/proposal ids) + approval_queued;
 * forbid ⇒ blocked action_taken (tier-4 blocks surface via riskFlagsFor).
 * Finally call_ended + compileOutcome over the joined transcript.
 *
 * @param input - Caller identity, linked ids, and the scripted turns.
 * @returns Final session, per-turn plans, and the compiled outcome.
 */
export function simulateCall(input: SimulateCallInput): SimulateCallResult {
  const counters = { work_order: 0, message: 0, proposal: 0 };
  const nextId = (kind: keyof typeof counters): string => {
    counters[kind] += 1;
    return `${ID_PREFIX[kind]}-${counters[kind]}`;
  };

  let session = createSession({
    retellCallId: 'sim-call-1',
    organizationId: 'org-1',
    direction: 'inbound',
    fromNumber: '+15715550201',
    toNumber: '+15715550101',
    startedAt: at(0),
  });
  session = reduceCallEvent(session, {
    type: 'caller_resolved',
    at: at(0),
    callerKind: input.callerKind,
    ...input.linkedIds,
  });

  const plans: TurnPlan[] = [];

  input.turns.forEach((turn, index) => {
    const ts = at(index);
    for (const intent of extractIntents(turn.say)) {
      session = reduceCallEvent(session, { type: 'intent_added', at: ts, intent });
    }
    if (turn.facts) {
      session = reduceCallEvent(session, { type: 'fact_collected', at: ts, facts: turn.facts });
    }
    plans.push(planTurn(session));

    for (const action of turn.act ?? []) {
      const decision = gateVoiceAction(action, session);
      if (decision.decision === 'allow') {
        const kind = ID_KIND[action];
        const id = kind ? nextId(kind) : undefined;
        const entry: VoiceActionLogEntry = {
          action,
          at: ts,
          tier: decision.tier,
          outcome: 'executed',
          ...(kind && id ? { ids: { [kind]: id } } : {}),
          detail: `executed ${action}`,
        };
        session = reduceCallEvent(session, { type: 'action_taken', at: ts, entry });
        if (kind === 'message' && id) {
          session = reduceCallEvent(session, { type: 'sms_sent', at: ts, messageId: id });
        }
      } else if (decision.decision === 'draft') {
        const proposalId = nextId('proposal');
        const messageId = ID_KIND[action] === 'message' ? nextId('message') : undefined;
        const entry: VoiceActionLogEntry = {
          action,
          at: ts,
          tier: decision.tier,
          outcome: 'drafted',
          ids: { proposal: proposalId, ...(messageId ? { message: messageId } : {}) },
          detail: `draft pending approval: ${action}`,
        };
        session = reduceCallEvent(session, { type: 'action_taken', at: ts, entry });
        session = reduceCallEvent(session, { type: 'approval_queued', at: ts, proposalId });
      } else {
        const entry: VoiceActionLogEntry = {
          action,
          at: ts,
          tier: decision.tier,
          outcome: 'blocked',
          detail: decision.reason,
        };
        session = reduceCallEvent(session, { type: 'action_taken', at: ts, entry });
      }
    }
  });

  const endedAt = at(input.turns.length);
  session = reduceCallEvent(session, { type: 'call_ended', at: endedAt });
  const transcript = input.turns.map((turn) => turn.say).join('\n');
  const outcome = compileOutcome(session, transcript, endedAt);

  return { session, plans, outcome };
}
