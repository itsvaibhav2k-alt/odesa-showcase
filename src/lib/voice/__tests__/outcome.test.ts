/**
 * Outcome compiler tests — artifact completeness, transcript-intent merge,
 * the no-fabricated-timestamp invariant, dedup behavior, message formatting,
 * and minimal-session robustness. Pure objects only: no Supabase, no network.
 */

import { describe, expect, it } from 'vitest';

import { createSession, reduceCallEvent } from '../call-state';
import { compileOutcome, formatOutcomeMessage, needsOwnerReview } from '../outcomes';
import { planTurn } from '../plan';
import { callOutcomeSchema, type CallSession } from '../types';

const T0 = '2026-07-05T17:00:00.000Z';
const T1 = '2026-07-05T17:02:30.000Z';
const T_END = '2026-07-05T17:10:00.000Z';
const INPUT_TIMESTAMPS = [T0, T1, T_END];

/** A realistic finished session touching every artifact field. */
function richSession(): CallSession {
  return {
    retellCallId: 'call_rich_1',
    organizationId: 'org-1',
    direction: 'inbound',
    fromNumber: '+15715550201',
    toNumber: '+15715550101',
    callerKind: 'verified_tenant',
    tenantId: 'tenant-1',
    vendorId: null,
    propertyId: 'property-1',
    unitId: 'unit-1',
    startedAt: T0,
    endedAt: T_END,
    intents: ['payment_dispute', 'maintenance_request'],
    facts: {
      paymentClaim: { claimed: true, method: 'zelle' },
      upset: true,
      emergencyScreen: { activeFlooding: false, contained: true },
    },
    actions: [
      {
        action: 'create_work_order',
        at: T1,
        tier: 2,
        outcome: 'executed',
        ids: { work_order: 'wo-1' },
        detail: 'Leaking kitchen faucet',
      },
      {
        action: 'request_payment_proof_sms',
        at: T1,
        tier: 2,
        outcome: 'executed',
        ids: { message: 'msg-1' },
      },
      {
        action: 'send_rent_reminder',
        at: T1,
        tier: 3,
        outcome: 'drafted',
        ids: { message: 'msg-2', proposal: 'prop-1' },
        detail: 'Rent reminder draft',
      },
      {
        action: 'process_payment',
        at: T1,
        tier: 4,
        outcome: 'blocked',
        detail: 'tier 4 — never executed',
      },
    ],
    smsSent: ['msg-1'],
    smsDrafted: ['msg-2'],
    approvalsNeeded: ['prop-1'],
    riskFlags: ['manual_flag'],
  };
}

describe('compileOutcome', () => {
  it('should populate every CallOutcome field when compiling a rich session', () => {
    const session = richSession();
    const outcome = compileOutcome(session, 'did my rent go through this month?', T_END);

    expect(callOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(outcome.oneSentence).toContain('Verified tenant call');
    expect(outcome.callerKind).toBe('verified_tenant');
    expect(outcome.callerPhone).toBe('+15715550201');
    expect(outcome.tenantId).toBe('tenant-1');
    expect(outcome.propertyId).toBe('property-1');
    expect(outcome.unitId).toBe('unit-1');
    expect(outcome.vendorId).toBeNull();
    expect(outcome.recordsCreated).toEqual([
      { kind: 'work_order', id: 'wo-1' },
      { kind: 'message', id: 'msg-1' },
      { kind: 'message', id: 'msg-2' },
      { kind: 'proposal', id: 'prop-1' },
    ]);
    expect(outcome.autonomousActions.map((entry) => entry.action)).toEqual([
      'create_work_order',
      'request_payment_proof_sms',
    ]);
    expect(outcome.approvalsNeeded).toEqual(['prop-1', 'Rent reminder draft']);
    expect(outcome.smsSent).toEqual(['msg-1']);
    expect(outcome.smsDrafted).toEqual(['msg-2']);
    expect(outcome.unresolved).toEqual(planTurn(session).missingFacts);
    expect(outcome.riskFlags).toEqual([
      'payment_claim_ledger_conflict',
      'caller_upset',
      'tier4_action_attempted',
      'manual_flag',
    ]);
    expect(outcome.endedAt).toBe(T_END);
  });

  it('should merge transcript-extracted intents in taxonomy order when the agent missed them', () => {
    const session: CallSession = { ...richSession(), intents: ['maintenance_request'] };
    const outcome = compileOutcome(session, 'I already paid via zelle, did my rent go through?', T_END);

    // Session only tagged maintenance; transcript adds rent_status + payment_dispute.
    expect(outcome.intentsHandled).toEqual([
      'rent_status',
      'payment_dispute',
      'maintenance_request',
    ]);
  });

  it('should be deterministic when compiled twice from identical inputs', () => {
    const first = compileOutcome(richSession(), 'did my rent go through?', T_END);
    const second = compileOutcome(richSession(), 'did my rent go through?', T_END);

    expect(second).toEqual(first);
  });

  it('should contain no timestamp that was not present in the inputs', () => {
    const outcome = compileOutcome(richSession(), 'the sink is leaking', T_END);
    const message = formatOutcomeMessage(outcome, 'the sink is leaking');
    const haystack = JSON.stringify(outcome) + message;
    const found = haystack.match(/\d{4}-\d{2}-\d{2}[T\d:.]*Z?/g) ?? [];

    expect(found.length).toBeGreaterThan(0);
    for (const stamp of found) {
      expect(INPUT_TIMESTAMPS.some((input) => input.startsWith(stamp))).toBe(true);
    }
    expect(outcome.endedAt).toBe(T_END);
  });

  it('should dedup records, approvals, and risk flags when the log repeats ids', () => {
    const base = richSession();
    const session: CallSession = {
      ...base,
      actions: [
        ...base.actions,
        // Webhook retry replays the same drafted action + ids + detail.
        {
          action: 'send_rent_reminder',
          at: T1,
          tier: 3,
          outcome: 'drafted',
          ids: { message: 'msg-2', proposal: 'prop-1' },
          detail: 'Rent reminder draft',
        },
      ],
      approvalsNeeded: ['prop-1', 'prop-1'],
      riskFlags: ['manual_flag', 'caller_upset'],
    };
    const outcome = compileOutcome(session, null, T_END);

    expect(outcome.recordsCreated.filter(({ id }) => id === 'msg-2')).toHaveLength(1);
    expect(outcome.recordsCreated.filter(({ id }) => id === 'prop-1')).toHaveLength(1);
    expect(outcome.approvalsNeeded).toEqual(['prop-1', 'Rent reminder draft']);
    expect(outcome.riskFlags.filter((flag) => flag === 'caller_upset')).toHaveLength(1);
    expect(outcome.riskFlags.filter((flag) => flag === 'manual_flag')).toHaveLength(1);
  });

  it('should not mutate the input session when compiling', () => {
    const session = richSession();
    const snapshot = JSON.parse(JSON.stringify(session)) as CallSession;
    compileOutcome(session, 'did my rent go through?', T_END);

    expect(session).toEqual(snapshot);
  });

  it('should compile without throwing when the session is minimal and transcript is null', () => {
    const session = reduceCallEvent(
      createSession({
        retellCallId: 'call_min_1',
        organizationId: 'org-1',
        direction: 'inbound',
        fromNumber: '+15715559999',
        toNumber: '+15715550101',
        startedAt: T0,
      }),
      { type: 'call_ended', at: T_END },
    );
    const outcome = compileOutcome(session, null, T_END);

    expect(callOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(outcome.intentsHandled).toEqual([]);
    expect(outcome.recordsCreated).toEqual([]);
    expect(outcome.autonomousActions).toEqual([]);
    expect(outcome.approvalsNeeded).toEqual([]);
    expect(outcome.riskFlags).toContain('unknown_caller_needs_review');
    expect(outcome.endedAt).toBe(T_END);
  });
});

describe('needsOwnerReview', () => {
  /** Rich session compiles with approvals + risk flags; strip per case. */
  function outcomeWith(overrides: { approvalsNeeded?: string[]; riskFlags?: string[] }) {
    const base = compileOutcome(richSession(), null, T_END);
    return {
      ...base,
      approvalsNeeded: overrides.approvalsNeeded ?? base.approvalsNeeded,
      riskFlags: overrides.riskFlags ?? base.riskFlags,
    };
  }

  const cases: Array<{
    name: string;
    approvalsNeeded: string[];
    riskFlags: string[];
    propertyId: string | null;
    expected: boolean;
  }> = [
    {
      name: 'property null + approvals present (NOT NULL guard)',
      approvalsNeeded: ['prop-1'],
      riskFlags: [],
      propertyId: null,
      expected: false,
    },
    {
      name: 'property null + risk flags present (NOT NULL guard)',
      approvalsNeeded: [],
      riskFlags: ['caller_upset'],
      propertyId: null,
      expected: false,
    },
    {
      name: 'property set + approvals present',
      approvalsNeeded: ['prop-1'],
      riskFlags: [],
      propertyId: 'property-1',
      expected: true,
    },
    {
      name: 'property set + risk flags only',
      approvalsNeeded: [],
      riskFlags: ['caller_upset'],
      propertyId: 'property-1',
      expected: true,
    },
    {
      name: 'property set + clean outcome',
      approvalsNeeded: [],
      riskFlags: [],
      propertyId: 'property-1',
      expected: false,
    },
  ];

  for (const { name, approvalsNeeded, riskFlags, propertyId, expected } of cases) {
    it(`should return ${expected} when ${name}`, () => {
      const outcome = outcomeWith({ approvalsNeeded, riskFlags });
      expect(needsOwnerReview(outcome, propertyId)).toBe(expected);
    });
  }
});

describe('formatOutcomeMessage', () => {
  it('should include every section and the transcript when a transcript is present', () => {
    const transcript = 'Tenant: my sink is leaking. Odesa: I have logged a work order.';
    const outcome = compileOutcome(richSession(), transcript, T_END);
    const message = formatOutcomeMessage(outcome, transcript);

    expect(message).toContain('Handled by Odesa');
    expect(message).toContain(outcome.oneSentence);
    expect(message).toContain('Topics');
    expect(message).toContain('Actions taken');
    expect(message).toContain('Awaiting owner review');
    expect(message).toContain('Risk flags');
    expect(message).toContain('— Transcript —');
    expect(message).toContain(transcript);
    expect(message).toContain('create work order — Leaking kitchen faucet');
    expect(message).toContain('payment claim ledger conflict');
  });

  it('should omit the transcript section when transcript is null', () => {
    const outcome = compileOutcome(richSession(), null, T_END);
    const message = formatOutcomeMessage(outcome, null);

    expect(message).not.toContain('— Transcript —');
    expect(message).toContain('Handled by Odesa');
  });
});
