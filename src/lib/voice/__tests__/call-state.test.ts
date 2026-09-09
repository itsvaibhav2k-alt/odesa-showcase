/**
 * call-state reducer tests — pure functions on plain objects, no Supabase,
 * no network, no jsdom. Verifies: immutability of every event branch, each
 * event's effect, intent dedup, shallow fact merge, and risk-flag derivation.
 */

import { describe, expect, it } from 'vitest';

import type { CallEvent, CallSession, VoiceActionLogEntry } from '../types';
import { createSession, reduceCallEvent, riskFlagsFor } from '../call-state';

const AT = '2026-07-05T12:00:00.000Z';

function baseSession(overrides: Partial<CallSession> = {}): CallSession {
  return {
    ...createSession({
      retellCallId: 'call_1',
      organizationId: 'org_1',
      direction: 'inbound',
      fromNumber: '+15715550201',
      toNumber: '+15715550101',
      startedAt: AT,
    }),
    ...overrides,
  };
}

function draftEntry(ids?: Record<string, string>): VoiceActionLogEntry {
  return {
    action: 'create_followup_sms_draft',
    at: AT,
    tier: 3,
    outcome: 'drafted',
    ids,
  };
}

describe('createSession', () => {
  it('should return an unknown-caller session with empty stacks when given a call_started init', () => {
    const session = baseSession();
    expect(session).toEqual({
      retellCallId: 'call_1',
      organizationId: 'org_1',
      direction: 'inbound',
      fromNumber: '+15715550201',
      toNumber: '+15715550101',
      callerKind: 'unknown_caller',
      tenantId: null,
      vendorId: null,
      propertyId: null,
      unitId: null,
      startedAt: AT,
      endedAt: null,
      intents: [],
      facts: {},
      actions: [],
      smsSent: [],
      smsDrafted: [],
      approvalsNeeded: [],
      riskFlags: [],
    });
  });
});

describe('reduceCallEvent', () => {
  const everyEvent: Array<[string, CallEvent]> = [
    [
      'call_started',
      {
        type: 'call_started',
        at: AT,
        retellCallId: 'call_2',
        organizationId: 'org_2',
        direction: 'outbound',
        fromNumber: '+10000000001',
        toNumber: '+10000000002',
      },
    ],
    [
      'caller_resolved',
      { type: 'caller_resolved', at: AT, callerKind: 'verified_tenant', tenantId: 't_1' },
    ],
    ['intent_added', { type: 'intent_added', at: AT, intent: 'rent_status' }],
    ['fact_collected', { type: 'fact_collected', at: AT, facts: { upset: true } }],
    [
      'action_taken',
      { type: 'action_taken', at: AT, entry: draftEntry({ message: 'm_1', proposal: 'p_1' }) },
    ],
    ['sms_sent', { type: 'sms_sent', at: AT, messageId: 'm_2' }],
    ['sms_drafted', { type: 'sms_drafted', at: AT, messageId: 'm_3' }],
    ['approval_queued', { type: 'approval_queued', at: AT, proposalId: 'p_2' }],
    ['call_ended', { type: 'call_ended', at: AT }],
  ];

  it.each(everyEvent)('should not mutate the input session when reducing %s', (_name, event) => {
    const session = baseSession({
      intents: ['maintenance_request'],
      facts: { callerName: 'Marcus' },
      smsSent: ['m_0'],
    });
    const snapshot = structuredClone(session);

    const next = reduceCallEvent(session, event);

    expect(session).toEqual(snapshot);
    expect(next).not.toBe(session);
  });

  it('should re-assert identity fields when call_started replays', () => {
    const next = reduceCallEvent(baseSession(), everyEvent[0][1]);
    expect(next.retellCallId).toBe('call_2');
    expect(next.organizationId).toBe('org_2');
    expect(next.direction).toBe('outbound');
    expect(next.startedAt).toBe(AT);
  });

  it('should set callerKind and linked ids when caller_resolved arrives', () => {
    const next = reduceCallEvent(baseSession(), {
      type: 'caller_resolved',
      at: AT,
      callerKind: 'verified_tenant',
      tenantId: 't_1',
      propertyId: 'prop_1',
      unitId: 'u_1',
    });
    expect(next.callerKind).toBe('verified_tenant');
    expect(next.tenantId).toBe('t_1');
    expect(next.propertyId).toBe('prop_1');
    expect(next.unitId).toBe('u_1');
    expect(next.vendorId).toBeNull();
  });

  it('should clear stale linked ids when caller_resolved omits them', () => {
    const session = baseSession({ callerKind: 'likely_tenant', tenantId: 't_stale' });
    const next = reduceCallEvent(session, {
      type: 'caller_resolved',
      at: AT,
      callerKind: 'unknown_caller',
    });
    expect(next.tenantId).toBeNull();
  });

  it('should append an intent when intent_added carries a new intent', () => {
    const next = reduceCallEvent(baseSession({ intents: ['rent_status'] }), {
      type: 'intent_added',
      at: AT,
      intent: 'maintenance_request',
    });
    expect(next.intents).toEqual(['rent_status', 'maintenance_request']);
  });

  it('should not duplicate an intent when intent_added repeats one already present', () => {
    const next = reduceCallEvent(baseSession({ intents: ['rent_status'] }), {
      type: 'intent_added',
      at: AT,
      intent: 'rent_status',
    });
    expect(next.intents).toEqual(['rent_status']);
  });

  it('should shallow-merge facts when fact_collected arrives', () => {
    const session = baseSession({ facts: { callerName: 'Marcus', upset: false } });
    const next = reduceCallEvent(session, {
      type: 'fact_collected',
      at: AT,
      facts: { upset: true, availability: 'weekday mornings' },
    });
    expect(next.facts).toEqual({
      callerName: 'Marcus',
      upset: true,
      availability: 'weekday mornings',
    });
  });

  it('should append the entry when action_taken outcome is executed', () => {
    const entry: VoiceActionLogEntry = {
      action: 'create_work_order',
      at: AT,
      tier: 2,
      outcome: 'executed',
      ids: { work_order: 'wo_1' },
    };
    const next = reduceCallEvent(baseSession(), { type: 'action_taken', at: AT, entry });
    expect(next.actions).toEqual([entry]);
    expect(next.smsDrafted).toEqual([]);
    expect(next.approvalsNeeded).toEqual([]);
  });

  it('should append drafted ids to smsDrafted and approvalsNeeded when action_taken is drafted', () => {
    const next = reduceCallEvent(baseSession(), {
      type: 'action_taken',
      at: AT,
      entry: draftEntry({ message: 'm_1', proposal: 'p_1' }),
    });
    expect(next.actions).toHaveLength(1);
    expect(next.smsDrafted).toEqual(['m_1']);
    expect(next.approvalsNeeded).toEqual(['p_1']);
  });

  it('should not double-count when a drafted action id also arrives via its own event', () => {
    let session = reduceCallEvent(baseSession(), {
      type: 'action_taken',
      at: AT,
      entry: draftEntry({ message: 'm_1', proposal: 'p_1' }),
    });
    session = reduceCallEvent(session, { type: 'sms_drafted', at: AT, messageId: 'm_1' });
    session = reduceCallEvent(session, { type: 'approval_queued', at: AT, proposalId: 'p_1' });
    expect(session.smsDrafted).toEqual(['m_1']);
    expect(session.approvalsNeeded).toEqual(['p_1']);
  });

  it('should append the message id when sms_sent arrives', () => {
    const next = reduceCallEvent(baseSession(), { type: 'sms_sent', at: AT, messageId: 'm_9' });
    expect(next.smsSent).toEqual(['m_9']);
  });

  it('should append the message id when sms_drafted arrives', () => {
    const next = reduceCallEvent(baseSession(), { type: 'sms_drafted', at: AT, messageId: 'm_8' });
    expect(next.smsDrafted).toEqual(['m_8']);
  });

  it('should append the proposal id when approval_queued arrives', () => {
    const next = reduceCallEvent(baseSession(), {
      type: 'approval_queued',
      at: AT,
      proposalId: 'p_9',
    });
    expect(next.approvalsNeeded).toEqual(['p_9']);
  });

  it('should set endedAt when call_ended arrives', () => {
    const next = reduceCallEvent(baseSession(), { type: 'call_ended', at: AT });
    expect(next.endedAt).toBe(AT);
  });

  it('should return the session unchanged when the event type is unknown', () => {
    const session = baseSession();
    const bogus = { type: 'not_a_thing', at: AT } as unknown as CallEvent;
    expect(reduceCallEvent(session, bogus)).toEqual(session);
  });
});

describe('riskFlagsFor', () => {
  const cases: Array<[string, Partial<CallSession>, string[]]> = [
    ['clean verified tenant', { callerKind: 'verified_tenant' }, []],
    [
      'active flooding on screen',
      { callerKind: 'verified_tenant', facts: { emergencyScreen: { activeFlooding: true } } },
      ['emergency_screen_positive'],
    ],
    [
      'electrical danger on screen',
      { callerKind: 'verified_tenant', facts: { emergencyScreen: { electricalDanger: true } } },
      ['emergency_screen_positive'],
    ],
    [
      'contained issue is not an emergency',
      { callerKind: 'verified_tenant', facts: { emergencyScreen: { contained: true } } },
      [],
    ],
    [
      'payment claimed against ledger',
      { callerKind: 'verified_tenant', facts: { paymentClaim: { claimed: true, method: 'zelle' } } },
      ['payment_claim_ledger_conflict'],
    ],
    [
      'payment claim explicitly false',
      { callerKind: 'verified_tenant', facts: { paymentClaim: { claimed: false } } },
      [],
    ],
    [
      'caller upset',
      { callerKind: 'verified_tenant', facts: { upset: true } },
      ['caller_upset'],
    ],
    ['unknown caller', { callerKind: 'unknown_caller' }, ['unknown_caller_needs_review']],
    ['ambiguous caller', { callerKind: 'ambiguous' }, ['unknown_caller_needs_review']],
    [
      'blocked tier-4 attempt',
      {
        callerKind: 'verified_tenant',
        actions: [{ action: 'waive_fee', at: AT, tier: 4, outcome: 'blocked' }],
      },
      ['tier4_action_attempted'],
    ],
    [
      'executed tier-2 action carries no flag',
      {
        callerKind: 'verified_tenant',
        actions: [{ action: 'create_work_order', at: AT, tier: 2, outcome: 'executed' }],
      },
      [],
    ],
    [
      'everything at once stacks all flags',
      {
        callerKind: 'ambiguous',
        facts: {
          emergencyScreen: { activeFlooding: true },
          paymentClaim: { claimed: true },
          upset: true,
        },
        actions: [{ action: 'process_payment', at: AT, tier: 4, outcome: 'blocked' }],
      },
      [
        'emergency_screen_positive',
        'payment_claim_ledger_conflict',
        'caller_upset',
        'unknown_caller_needs_review',
        'tier4_action_attempted',
      ],
    ],
  ];

  it.each(cases)('should derive %s flags correctly', (_name, overrides, expected) => {
    expect(riskFlagsFor(baseSession(overrides))).toEqual(expected);
  });
});
