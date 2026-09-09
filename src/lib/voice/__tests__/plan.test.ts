/**
 * Unit tests for the declarative turn planner (plan.ts).
 *
 * The planner is where "the LLM proposes, Odesa disposes" becomes a per-turn
 * plan, so the tests sweep the whole surface: all 17 INTENT_SPECS produce
 * policy-consistent plans, emergency screening always outranks other
 * questions, multi-intent sessions merge into one plan with a single next
 * question, unresolved callers get identity questions and zero disclosure
 * actions, and tier-4 verbs never appear in allowedActions for ANY caller
 * kind × intent combination. Pure objects — no Supabase, no network.
 */

import { describe, expect, it } from 'vitest';

import { createSession } from '../call-state';
import { ACTION_TIERS, gateVoiceAction } from '../policy';
import { INTENT_SPECS, planTurn } from '../plan';
import type { CallerKind, CallFacts, CallSession, IntentId } from '../types';
import { CALLER_KINDS, INTENT_IDS } from '../types';

const makeSession = (
  overrides: Partial<CallSession> = {},
): CallSession => ({
  ...createSession({
    retellCallId: 'call_test_1',
    organizationId: 'org_1',
    direction: 'inbound',
    fromNumber: '+15715550201',
    toNumber: '+15715550101',
    startedAt: '2026-07-05T10:00:00.000Z',
  }),
  callerKind: 'verified_tenant',
  ...overrides,
});

const IDENTITY_FACTS = [
  'callerName',
  'callerStatedProperty',
  'callerStatedUnit',
  'callerStatedReason',
];

// ---------------------------------------------------------------------------
// INTENT_SPECS table
// ---------------------------------------------------------------------------

describe('INTENT_SPECS', () => {
  it('should define a spec for every IntentId when the taxonomy is exhaustive', () => {
    expect(Object.keys(INTENT_SPECS).sort()).toEqual([...INTENT_IDS].sort());
  });

  it.each([...INTENT_IDS])(
    'should provide a question for every required fact when intent is %s',
    (intent) => {
      const spec = INTENT_SPECS[intent];
      for (const fact of spec.requiredFacts) {
        expect(spec.questionFor[String(fact)]).toBeTruthy();
      }
    },
  );

  it.each([...INTENT_IDS])(
    'should list no tier-4 actions in the spec when intent is %s',
    (intent) => {
      for (const action of INTENT_SPECS[intent].actions) {
        expect(ACTION_TIERS[action]).toBeLessThan(4);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Per-intent plans are policy-consistent (table-driven, all 17)
// ---------------------------------------------------------------------------

describe('planTurn', () => {
  describe('per-intent policy consistency', () => {
    it.each([...INTENT_IDS])(
      'should split spec actions exactly into allowed vs blockedOrDraft when intent is %s',
      (intent) => {
        const session = makeSession({ intents: [intent] });
        const plan = planTurn(session);
        const spec = INTENT_SPECS[intent];

        for (const action of plan.allowedActions) {
          expect(gateVoiceAction(action, session).decision).toBe('allow');
        }
        for (const decision of plan.blockedOrDraft) {
          expect(['draft', 'forbid']).toContain(decision.decision);
        }
        const covered = [...plan.allowedActions, ...plan.blockedOrDraft.map((d) => d.action)];
        expect(covered.sort()).toEqual([...spec.actions].sort());
      },
    );

    it('should return no actions and no question when the session has no intents', () => {
      const plan = planTurn(makeSession({ intents: [] }));
      expect(plan.allowedActions).toEqual([]);
      expect(plan.blockedOrDraft).toEqual([]);
      expect(plan.missingFacts).toEqual([]);
      expect(plan.nextQuestion).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Maintenance flow — emergency screen first, then access
  // -------------------------------------------------------------------------

  describe('maintenance fact ordering', () => {
    it('should ask the emergency screen question first when no facts are collected', () => {
      const plan = planTurn(makeSession({ intents: ['maintenance_request'] }));
      expect(plan.missingFacts[0]).toBe('emergencyScreen');
      expect(plan.nextQuestion).toMatch(/flooding or electrical danger/i);
    });

    it('should ask for access permission when the emergency screen is done', () => {
      const facts: CallFacts = {
        emergencyScreen: { activeFlooding: false, electricalDanger: false },
      };
      const plan = planTurn(makeSession({ intents: ['maintenance_request'], facts }));
      expect(plan.missingFacts).not.toContain('emergencyScreen');
      expect(plan.nextQuestion).toMatch(/safe to enter.*permission/i);
    });

    it('should have no next question when all maintenance facts are collected', () => {
      const facts: CallFacts = {
        emergencyScreen: { activeFlooding: false },
        issueDescription: 'leaking kitchen faucet',
        accessPermission: true,
      };
      const plan = planTurn(makeSession({ intents: ['maintenance_request'], facts }));
      expect(plan.missingFacts).toEqual([]);
      expect(plan.nextQuestion).toBeNull();
    });

    it('should keep the emergency screen question first when the intent is emergency', () => {
      const plan = planTurn(
        makeSession({ intents: ['emergency_maintenance', 'callback_request'] }),
      );
      expect(plan.missingFacts[0]).toBe('emergencyScreen');
      expect(plan.nextQuestion).toMatch(/flooding or electrical danger/i);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-intent merge (Flow 3 shape)
  // -------------------------------------------------------------------------

  describe('multi-intent sessions', () => {
    const intents: IntentId[] = ['maintenance_request', 'payment_dispute', 'access_permission'];

    it('should merge required facts across intents with emergency screen first', () => {
      const plan = planTurn(makeSession({ intents }));
      expect(plan.missingFacts[0]).toBe('emergencyScreen');
      expect(plan.missingFacts).toEqual(
        expect.arrayContaining(['accessPermission', 'paymentClaim', 'availability']),
      );
    });

    it('should produce exactly one next question when several facts are missing', () => {
      const plan = planTurn(makeSession({ intents }));
      expect(typeof plan.nextQuestion).toBe('string');
      expect(plan.nextQuestion).toMatch(/flooding or electrical danger/i);
    });

    it('should cover all three intents with allowed actions when caller is verified', () => {
      const plan = planTurn(makeSession({ intents }));
      expect(plan.allowedActions).toEqual(
        expect.arrayContaining([
          'create_work_order',
          'answer_rent_status',
          'request_payment_proof_sms',
          'record_call_note',
          'notify_owner',
        ]),
      );
    });

    it('should surface tier-3 actions as drafts when intents include payment_dispute', () => {
      const plan = planTurn(makeSession({ intents }));
      const draft = plan.blockedOrDraft.find((d) => d.action === 'create_followup_sms_draft');
      expect(draft?.decision).toBe('draft');
      expect(draft?.tier).toBe(3);
    });

    it('should dedupe actions shared by intents when specs overlap', () => {
      const plan = planTurn(
        makeSession({ intents: ['complaint', 'neighbor_issue', 'move_out'] }),
      );
      const all = [...plan.allowedActions, ...plan.blockedOrDraft.map((d) => d.action)];
      expect(new Set(all).size).toBe(all.length);
    });
  });

  // -------------------------------------------------------------------------
  // Unknown / ambiguous callers — identity first, zero disclosure
  // -------------------------------------------------------------------------

  describe('unresolved callers', () => {
    it.each(['unknown_caller', 'ambiguous'] as const)(
      'should require identity facts before topic facts when caller is %s',
      (callerKind) => {
        const plan = planTurn(makeSession({ callerKind, intents: ['rent_status'] }));
        expect(plan.missingFacts.slice(0, 4)).toEqual(IDENTITY_FACTS);
      },
    );

    it('should keep emergency screen ahead of identity facts when caller is unknown', () => {
      const plan = planTurn(
        makeSession({ callerKind: 'unknown_caller', intents: ['maintenance_request'] }),
      );
      expect(plan.missingFacts[0]).toBe('emergencyScreen');
      expect(plan.missingFacts.slice(1, 5)).toEqual(IDENTITY_FACTS);
    });

    it('should ask an identity question when only identity facts are missing', () => {
      const plan = planTurn(
        makeSession({ callerKind: 'unknown_caller', intents: ['rent_status'] }),
      );
      expect(plan.nextQuestion).toMatch(/your name/i);
    });

    it('should block disclosure actions when the caller is unknown', () => {
      const plan = planTurn(
        makeSession({ callerKind: 'unknown_caller', intents: ['rent_status'] }),
      );
      expect(plan.allowedActions).not.toContain('answer_rent_status');
      const blocked = plan.blockedOrDraft.find((d) => d.action === 'answer_rent_status');
      expect(blocked?.decision).toBe('forbid');
    });

    it('should include the no-disclosure honesty hint when the caller is ambiguous', () => {
      const plan = planTurn(makeSession({ callerKind: 'ambiguous', intents: ['rent_status'] }));
      expect(plan.honestyHints.join(' ')).toMatch(/disclose\s+no/i);
    });

    it('should skip already-collected identity facts when the caller gave a name', () => {
      const plan = planTurn(
        makeSession({
          callerKind: 'unknown_caller',
          intents: ['rent_status'],
          facts: { callerName: 'Pat' },
        }),
      );
      expect(plan.missingFacts).not.toContain('callerName');
      expect(plan.missingFacts[0]).toBe('callerStatedProperty');
    });
  });

  // -------------------------------------------------------------------------
  // Owner briefing gating
  // -------------------------------------------------------------------------

  describe('owner briefing', () => {
    it.each([...CALLER_KINDS])(
      'should allow provide_owner_briefing only for verified_owner when caller is %s',
      (callerKind) => {
        const plan = planTurn(makeSession({ callerKind, intents: ['owner_briefing'] }));
        if (callerKind === 'verified_owner') {
          expect(plan.allowedActions).toContain('provide_owner_briefing');
        } else {
          expect(plan.allowedActions).not.toContain('provide_owner_briefing');
          const blocked = plan.blockedOrDraft.find((d) => d.action === 'provide_owner_briefing');
          expect(blocked?.decision).toBe('forbid');
        }
      },
    );
  });

  // -------------------------------------------------------------------------
  // Honesty hints
  // -------------------------------------------------------------------------

  describe('honesty hints', () => {
    it.each(['rent_status', 'payment_dispute', 'late_rent_response'] as const)(
      'should include the ledger-honest hint when intent is %s',
      (intent) => {
        const plan = planTurn(makeSession({ intents: [intent] }));
        expect(plan.honestyHints.join(' ')).toContain('the ledger currently shows');
      },
    );

    it('should never hint that a payment cleared when rent intents are present', () => {
      const plan = planTurn(makeSession({ intents: ['rent_status'] }));
      expect(plan.honestyHints.join(' ')).toMatch(/never claim a payment cleared/i);
    });

    it.each(['callback_request', 'access_permission'] as const)(
      'should include the owner-follow-up phrasing hint when intent is %s',
      (intent) => {
        const plan = planTurn(makeSession({ intents: [intent] }));
        const hints = plan.honestyHints.join(' ');
        expect(hints).toContain("I'll ask the owner to follow up");
        expect(hints).toMatch(/never say\s+"you're scheduled"/i);
      },
    );

    it('should include the escalate-not-promise hint when intent is emergency_maintenance', () => {
      const plan = planTurn(makeSession({ intents: ['emergency_maintenance'] }));
      expect(plan.honestyHints.join(' ')).toMatch(/never promise dispatch/i);
    });

    it('should return no hints when intents carry no honesty risk', () => {
      const plan = planTurn(makeSession({ intents: ['lease_question'] }));
      expect(plan.honestyHints).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Property-style sweep: caller kinds × intents
  // -------------------------------------------------------------------------

  describe('tier-4 exclusion sweep', () => {
    const combos: Array<[CallerKind, IntentId]> = CALLER_KINDS.flatMap((kind) =>
      INTENT_IDS.map((intent): [CallerKind, IntentId] => [kind, intent]),
    );

    it.each(combos)(
      'should never allow a tier-4 action when caller is %s and intent is %s',
      (callerKind, intent) => {
        const plan = planTurn(makeSession({ callerKind, intents: [intent] }));
        for (const action of plan.allowedActions) {
          expect(ACTION_TIERS[action]).toBeLessThan(3);
        }
        for (const decision of plan.blockedOrDraft) {
          expect(['draft', 'forbid']).toContain(decision.decision);
        }
      },
    );

    it.each([...CALLER_KINDS])(
      'should never allow a tier-4 action when caller is %s with all 17 intents at once',
      (callerKind) => {
        const plan = planTurn(makeSession({ callerKind, intents: [...INTENT_IDS] }));
        for (const action of plan.allowedActions) {
          expect(ACTION_TIERS[action]).toBeLessThan(3);
        }
      },
    );
  });

  // -------------------------------------------------------------------------
  // Purity
  // -------------------------------------------------------------------------

  describe('immutability', () => {
    it('should not mutate the session when planning a turn', () => {
      const session = makeSession({
        callerKind: 'unknown_caller',
        intents: ['maintenance_request', 'payment_dispute'],
        facts: { upset: true },
      });
      const snapshot = JSON.parse(JSON.stringify(session)) as CallSession;
      planTurn(session);
      expect(session).toEqual(snapshot);
    });
  });
});
