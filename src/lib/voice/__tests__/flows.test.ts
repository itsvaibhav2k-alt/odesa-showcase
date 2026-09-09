/**
 * Demo-flow tests — the six handoff scenarios (F1–F6) driven engine-level
 * through the scripted-call simulator (extractIntents → reducer → planTurn →
 * gateVoiceAction → compileOutcome), exactly as production wires the pieces.
 *
 * These are the product-promise tests: each flow asserts what the landlord
 * actually gets (records, drafts, risk flags, honest outcome) and what the
 * engine refused to do (tier-4 blocks, unknown-caller privacy). The global
 * sweep at the bottom is the hard safety net across every flow: nothing above
 * tier 2 ever appears as an autonomous action, and every tier-4 attempt is
 * blocked. Pure functions on plain objects — no Supabase, network, or jsdom.
 */

import { describe, expect, it } from 'vitest';

import { disclosureAllowed } from '../policy';
import { simulateCall, type SimulateCallResult } from './helpers/simulator';

const EMERGENCY_QUESTION = 'Is there any active flooding or electrical danger right now?';

const CONTAINED_SCREEN = {
  emergencyScreen: { activeFlooding: false, electricalDanger: false, contained: true },
};

// ---------------------------------------------------------------------------
// The six flows, simulated once (deterministic — same result every run).
// ---------------------------------------------------------------------------

const f1 = simulateCall({
  callerKind: 'verified_tenant',
  linkedIds: { tenantId: 'ten-1', propertyId: 'prop-a', unitId: 'unit-2b', vendorId: null },
  turns: [
    { say: 'My kitchen sink is leaking' },
    {
      say: 'No, it is under control and safe, you can come whenever works.',
      facts: {
        ...CONTAINED_SCREEN,
        issueDescription: 'Kitchen sink leaking under the cabinet',
        accessPermission: true,
      },
      act: ['create_work_order', 'send_safe_confirmation_sms'],
    },
  ],
});

const f2 = simulateCall({
  callerKind: 'verified_tenant',
  linkedIds: { tenantId: 'ten-1', propertyId: 'prop-a', unitId: 'unit-2b', vendorId: null },
  turns: [
    { say: 'I already paid my rent, did it go through?' },
    {
      say: 'I sent it through Zelle on the first.',
      facts: { paymentClaim: { claimed: true, method: 'zelle' } },
      act: ['answer_rent_status', 'request_payment_proof_sms', 'create_followup_sms_draft'],
    },
  ],
});

const f3 = simulateCall({
  callerKind: 'verified_tenant',
  linkedIds: { tenantId: 'ten-1', propertyId: 'prop-a', unitId: 'unit-2b', vendorId: null },
  turns: [
    {
      say:
        'My dishwasher is broken, I already paid rent with Zelle but the portal says ' +
        "I'm late, and I'm out of town next week — my brother can let the plumber in.",
    },
    {
      say: 'It is not urgent, nothing dangerous.',
      facts: {
        ...CONTAINED_SCREEN,
        issueDescription: 'Dishwasher not draining',
        accessPermission: true,
        availability: 'Brother available weekday mornings',
        paymentClaim: { claimed: true, method: 'zelle' },
      },
      act: ['create_work_order', 'request_payment_proof_sms', 'record_call_note', 'promise_appointment'],
    },
  ],
});

const f4 = simulateCall({
  callerKind: 'unknown_caller',
  turns: [
    {
      say: "I'm calling about the apartment",
      act: ['answer_rent_status', 'create_work_order', 'record_call_note', 'create_owner_queue_item'],
    },
  ],
});

const f5 = simulateCall({
  callerKind: 'verified_owner',
  turns: [
    {
      say: 'Catch me up — what needs my attention today?',
      act: ['provide_owner_briefing', 'send_rent_reminder'],
    },
  ],
});

const f6 = simulateCall({
  callerKind: 'known_vendor',
  linkedIds: { vendorId: 'ven-1', tenantId: null, propertyId: 'prop-a', unitId: null },
  turns: [
    {
      say: 'Calling about the sink job — I have the invoice ready.',
      act: ['collect_vendor_status', 'dispatch_vendor_with_cost', 'coordinate_vendor'],
    },
  ],
});

const ALL_FLOWS: Array<[string, SimulateCallResult]> = [
  ['F1 maintenance', f1],
  ['F2 rent dispute', f2],
  ['F3 multi-topic', f3],
  ['F4 unknown caller', f4],
  ['F5 owner briefing', f5],
  ['F6 vendor status', f6],
];

// ---------------------------------------------------------------------------
// F1 — tenant maintenance
// ---------------------------------------------------------------------------

describe('F1 tenant maintenance flow', () => {
  it('should ask the emergency screen first when a tenant reports a leak', () => {
    expect(f1.plans[0].nextQuestion).toBe(EMERGENCY_QUESTION);
    expect(f1.plans[0].missingFacts[0]).toBe('emergencyScreen');
  });

  it('should have no missing facts or next question when screen, description, and access land', () => {
    expect(f1.plans[1].missingFacts).toEqual([]);
    expect(f1.plans[1].nextQuestion).toBeNull();
  });

  it('should allow and execute create_work_order when the emergency screen is contained', () => {
    expect(f1.plans[1].allowedActions).toContain('create_work_order');
    const entry = f1.session.actions.find((a) => a.action === 'create_work_order');
    expect(entry?.outcome).toBe('executed');
    expect(entry?.ids).toEqual({ work_order: 'wo-1' });
  });

  it('should allow send_safe_confirmation_sms when the caller is a verified tenant', () => {
    expect(f1.plans[1].allowedActions).toContain('send_safe_confirmation_sms');
    const entry = f1.session.actions.find((a) => a.action === 'send_safe_confirmation_sms');
    expect(entry?.outcome).toBe('executed');
    expect(f1.outcome.smsSent).toContain('msg-1');
  });

  it('should list the work order record and executed actions in the outcome', () => {
    expect(f1.outcome.recordsCreated).toContainEqual({ kind: 'work_order', id: 'wo-1' });
    const actions = f1.outcome.autonomousActions.map((a) => a.action);
    expect(actions).toContain('create_work_order');
    expect(actions).toContain('send_safe_confirmation_sms');
    expect(f1.outcome.intentsHandled).toContain('maintenance_request');
  });
});

// ---------------------------------------------------------------------------
// F2 — rent dispute
// ---------------------------------------------------------------------------

describe('F2 rent dispute flow', () => {
  it('should extract payment_dispute when the caller says they already paid', () => {
    expect(f2.session.intents).toContain('payment_dispute');
  });

  it('should allow answer_rent_status when the caller is a verified tenant', () => {
    expect(f2.plans[1].allowedActions).toContain('answer_rent_status');
    const entry = f2.session.actions.find((a) => a.action === 'answer_rent_status');
    expect(entry?.outcome).toBe('executed');
  });

  it('should execute request_payment_proof_sms when the dispute is raised', () => {
    const actions = f2.outcome.autonomousActions.map((a) => a.action);
    expect(actions).toContain('request_payment_proof_sms');
  });

  it('should draft create_followup_sms_draft and queue an approval when attempted', () => {
    const entry = f2.session.actions.find((a) => a.action === 'create_followup_sms_draft');
    expect(entry?.outcome).toBe('drafted');
    expect(f2.outcome.approvalsNeeded.length).toBeGreaterThan(0);
    expect(f2.outcome.approvalsNeeded).toContain('prop-1');
  });

  it('should flag the payment-claim ledger conflict when the tenant claims payment', () => {
    expect(f2.outcome.riskFlags).toContain('payment_claim_ledger_conflict');
  });

  it('should contain no payment date anywhere in the outcome when compiling the dispute', () => {
    const text = JSON.stringify(f2.outcome);
    // Every date-like string must be a simulator timestamp, never a payment date.
    const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) expect(date).toBe('2026-07-05');
    expect(text).not.toMatch(/cleared on|received on|processed on|payment cleared/i);
  });
});

// ---------------------------------------------------------------------------
// F3 — multi-topic
// ---------------------------------------------------------------------------

describe('F3 multi-topic flow', () => {
  it('should extract at least three intents when one utterance spans three topics', () => {
    expect(f3.session.intents).toEqual(
      expect.arrayContaining(['payment_dispute', 'maintenance_request', 'access_permission']),
    );
    expect(f3.session.intents.length).toBeGreaterThanOrEqual(3);
  });

  it('should merge specs into one plan with a single emergency-first question', () => {
    expect(f3.plans[0].nextQuestion).toBe(EMERGENCY_QUESTION);
    expect(typeof f3.plans[0].nextQuestion).toBe('string');
  });

  it('should surface the tier-3 followup draft in blockedOrDraft when planning', () => {
    const draft = f3.plans[0].blockedOrDraft.find(
      (d) => d.action === 'create_followup_sms_draft',
    );
    expect(draft?.decision).toBe('draft');
  });

  it('should execute work order, proof request, and access note when facts are in', () => {
    const executed = f3.outcome.autonomousActions.map((a) => a.action);
    expect(executed).toContain('create_work_order');
    expect(executed).toContain('request_payment_proof_sms');
    expect(executed).toContain('record_call_note');
  });

  it('should block promise_appointment and flag the attempt when the agent tries it', () => {
    const entry = f3.session.actions.find((a) => a.action === 'promise_appointment');
    expect(entry?.outcome).toBe('blocked');
    expect(entry?.tier).toBe(4);
    expect(f3.outcome.riskFlags).toContain('tier4_action_attempted');
  });

  it('should list at least three intents handled in the outcome', () => {
    expect(f3.outcome.intentsHandled.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// F4 — unknown caller
// ---------------------------------------------------------------------------

describe('F4 unknown caller flow', () => {
  it('should ask identity facts first when the caller is unresolved', () => {
    expect(f4.plans[0].missingFacts).toEqual([
      'callerName',
      'callerStatedProperty',
      'callerStatedUnit',
      'callerStatedReason',
    ]);
    expect(f4.plans[0].nextQuestion).toBe('Can I get your name, please?');
  });

  it('should forbid answer_rent_status and create_work_order when the caller is unknown', () => {
    for (const action of ['answer_rent_status', 'create_work_order'] as const) {
      const entry = f4.session.actions.find((a) => a.action === action);
      expect(entry?.outcome).toBe('blocked');
      expect(entry?.detail).toContain('privacy');
    }
  });

  it('should execute record_call_note and create_owner_queue_item when the caller is unknown', () => {
    const executed = f4.outcome.autonomousActions.map((a) => a.action);
    expect(executed).toContain('record_call_note');
    expect(executed).toContain('create_owner_queue_item');
  });

  it('should flag the call for owner review when the caller stays unresolved', () => {
    expect(f4.outcome.riskFlags).toContain('unknown_caller_needs_review');
  });

  it('should grant no disclosures and link no tenant when the caller is unknown', () => {
    expect(disclosureAllowed('unknown_caller')).toEqual({
      tenantIdentity: false,
      ledger: false,
      ownerPortfolio: false,
      vendorJobContext: false,
    });
    expect(f4.outcome.tenantId).toBeNull();
    expect(f4.outcome.unitId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F5 — owner briefing
// ---------------------------------------------------------------------------

describe('F5 owner briefing flow', () => {
  it('should allow provide_owner_briefing when the caller is a verified owner', () => {
    expect(f5.plans[0].allowedActions).toContain('provide_owner_briefing');
    const entry = f5.session.actions.find((a) => a.action === 'provide_owner_briefing');
    expect(entry?.outcome).toBe('executed');
  });

  it('should draft send_rent_reminder instead of sending when the owner asks for it', () => {
    const entry = f5.session.actions.find((a) => a.action === 'send_rent_reminder');
    expect(entry?.outcome).toBe('drafted');
    expect(f5.outcome.smsSent).toEqual([]);
    expect(f5.outcome.smsDrafted).toContain('msg-1');
  });

  it('should show the drafted approval in the outcome when the reminder is drafted', () => {
    expect(f5.outcome.approvalsNeeded).toContain('prop-1');
  });
});

// ---------------------------------------------------------------------------
// F6 — vendor status
// ---------------------------------------------------------------------------

describe('F6 vendor status flow', () => {
  it('should allow collect_vendor_status when the caller is a known vendor', () => {
    expect(f6.plans[0].allowedActions).toContain('collect_vendor_status');
    const entry = f6.session.actions.find((a) => a.action === 'collect_vendor_status');
    expect(entry?.outcome).toBe('executed');
  });

  it('should forbid dispatch_vendor_with_cost when the vendor mentions cost commitments', () => {
    const entry = f6.session.actions.find((a) => a.action === 'dispatch_vendor_with_cost');
    expect(entry?.outcome).toBe('blocked');
    expect(entry?.tier).toBe(4);
  });

  it('should draft coordinate_vendor when the agent attempts coordination', () => {
    const entry = f6.session.actions.find((a) => a.action === 'coordinate_vendor');
    expect(entry?.outcome).toBe('drafted');
    expect(f6.outcome.approvalsNeeded.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Global safety sweep
// ---------------------------------------------------------------------------

describe('global flow safety sweep', () => {
  it.each(ALL_FLOWS)(
    'should keep every autonomous action at tier 2 or below when running %s',
    (_name, flow) => {
      for (const entry of flow.outcome.autonomousActions) {
        expect(entry.tier).toBeLessThanOrEqual(2);
      }
    },
  );

  it.each(ALL_FLOWS)(
    'should block every tier-4 action attempt when running %s',
    (_name, flow) => {
      for (const entry of flow.session.actions.filter((a) => a.tier === 4)) {
        expect(entry.outcome).toBe('blocked');
      }
    },
  );
});
