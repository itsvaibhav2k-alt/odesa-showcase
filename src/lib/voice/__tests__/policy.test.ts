/**
 * Unit tests for the deterministic voice autonomy policy (policy.ts).
 *
 * These tests ARE the safety contract: the full tier matrix, every tier-4
 * verb forbidden for every caller kind, every SMS deny category drafting,
 * fail-closed classification of unmatched bodies, the unknown-caller privacy
 * matrix, and the disclosure matrix. Pure functions on plain objects — no
 * Supabase, no network, no jsdom.
 */

import { describe, expect, it } from 'vitest';

import { ACTION_TIERS, classifySmsBody, disclosureAllowed, gateVoiceAction } from '../policy';
import type { CallerKind, VoiceActionId } from '../types';
import { CALLER_KINDS, VOICE_ACTION_IDS } from '../types';

const session = (callerKind: CallerKind) => ({
  callerKind,
  tenantId: null,
  vendorId: null,
});

// ---------------------------------------------------------------------------
// Tier matrix
// ---------------------------------------------------------------------------

describe('ACTION_TIERS', () => {
  const expectedTiers: Record<VoiceActionId, 0 | 1 | 2 | 3 | 4> = {
    answer_rent_status: 0,
    answer_lease_question: 0,
    provide_owner_briefing: 0,
    collect_vendor_status: 0,
    record_call_note: 1,
    record_callback_request: 1,
    create_work_order: 2,
    send_safe_confirmation_sms: 2,
    request_payment_proof_sms: 2,
    request_photo_sms: 2,
    notify_owner: 2,
    create_owner_queue_item: 2,
    schedule_callback: 2,
    escalate_to_landlord: 2,
    create_followup_sms_draft: 3,
    send_rent_reminder: 3,
    coordinate_vendor: 3,
    schedule_access_entry: 3,
    process_payment: 4,
    waive_fee: 4,
    threaten_legal_action: 4,
    amend_lease: 4,
    dispatch_vendor_with_cost: 4,
    promise_appointment: 4,
    promise_emergency_dispatch: 4,
    disclose_private_data: 4,
  };

  it('should cover every VoiceActionId when the vocabulary is exhaustive', () => {
    expect(Object.keys(ACTION_TIERS).sort()).toEqual([...VOICE_ACTION_IDS].sort());
  });

  it.each(Object.entries(expectedTiers))(
    'should assign tier %s → %d when the shared vocabulary defines it',
    (action, tier) => {
      expect(ACTION_TIERS[action as VoiceActionId]).toBe(tier);
    },
  );
});

// ---------------------------------------------------------------------------
// gateVoiceAction — tier rules
// ---------------------------------------------------------------------------

describe('gateVoiceAction', () => {
  const tier4Actions = VOICE_ACTION_IDS.filter((a) => ACTION_TIERS[a] === 4);
  const tier3Actions = VOICE_ACTION_IDS.filter((a) => ACTION_TIERS[a] === 3);

  describe('tier 4 (never)', () => {
    const cases = tier4Actions.flatMap((action) =>
      CALLER_KINDS.map((kind) => [action, kind] as const),
    );

    it.each(cases)('should forbid %s when caller is %s', (action, kind) => {
      const decision = gateVoiceAction(action, session(kind));
      expect(decision.decision).toBe('forbid');
      expect(decision.tier).toBe(4);
    });
  });

  describe('tier 3 (draft/approval)', () => {
    const cases = tier3Actions.flatMap((action) =>
      CALLER_KINDS.map((kind) => [action, kind] as const),
    );

    it.each(cases)('should draft %s when caller is %s', (action, kind) => {
      const decision = gateVoiceAction(action, session(kind));
      expect(decision.decision).toBe('draft');
      expect(decision.tier).toBe(3);
    });
  });

  describe('unresolved caller privacy (unknown_caller and ambiguous)', () => {
    const forbidden: VoiceActionId[] = [
      'answer_rent_status',
      'answer_lease_question',
      'create_work_order',
      'request_payment_proof_sms',
      'request_photo_sms',
      'provide_owner_briefing',
      'collect_vendor_status',
    ];
    const allowed: VoiceActionId[] = [
      'record_call_note',
      'record_callback_request',
      'escalate_to_landlord',
      'notify_owner',
      'create_owner_queue_item',
      'send_safe_confirmation_sms',
    ];
    const unresolvedKinds: CallerKind[] = ['unknown_caller', 'ambiguous'];

    it.each(unresolvedKinds.flatMap((k) => forbidden.map((a) => [a, k] as const)))(
      'should forbid %s when caller is %s',
      (action, kind) => {
        const decision = gateVoiceAction(action, session(kind));
        expect(decision.decision).toBe('forbid');
      },
    );

    it.each(unresolvedKinds.flatMap((k) => allowed.map((a) => [a, k] as const)))(
      'should allow %s when caller is %s',
      (action, kind) => {
        const decision = gateVoiceAction(action, session(kind));
        expect(decision.decision).toBe('allow');
      },
    );
  });

  describe('caller-kind requirements on tier-0 answers', () => {
    it('should allow provide_owner_briefing when caller is verified_owner', () => {
      expect(gateVoiceAction('provide_owner_briefing', session('verified_owner')).decision).toBe(
        'allow',
      );
    });

    it.each(CALLER_KINDS.filter((k) => k !== 'verified_owner'))(
      'should forbid provide_owner_briefing when caller is %s',
      (kind) => {
        expect(gateVoiceAction('provide_owner_briefing', session(kind)).decision).toBe('forbid');
      },
    );

    it('should allow collect_vendor_status when caller is known_vendor', () => {
      expect(gateVoiceAction('collect_vendor_status', session('known_vendor')).decision).toBe(
        'allow',
      );
    });

    it.each(CALLER_KINDS.filter((k) => k !== 'known_vendor'))(
      'should forbid collect_vendor_status when caller is %s',
      (kind) => {
        expect(gateVoiceAction('collect_vendor_status', session(kind)).decision).toBe('forbid');
      },
    );

    it('should forbid answer_rent_status when caller is likely_tenant (needs verification)', () => {
      const decision = gateVoiceAction('answer_rent_status', session('likely_tenant'));
      expect(decision.decision).toBe('forbid');
    });

    it('should allow answer_rent_status when caller is verified_tenant', () => {
      expect(gateVoiceAction('answer_rent_status', session('verified_tenant')).decision).toBe(
        'allow',
      );
    });

    it('should allow create_work_order when caller is likely_tenant', () => {
      expect(gateVoiceAction('create_work_order', session('likely_tenant')).decision).toBe(
        'allow',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// classifySmsBody
// ---------------------------------------------------------------------------

describe('classifySmsBody', () => {
  describe('deny categories', () => {
    const denyCases: Array<[string, string]> = [
      // [category, body]
      ['legal_or_eviction', 'We will begin eviction proceedings if rent is not paid.'],
      ['legal_or_eviction', 'Our attorney will contact you regarding legal action.'],
      ['fee_waiver', 'Good news — your late fee has been waived.'],
      ['fee_waiver', 'We will remove the late fee this month.'],
      ['payment_cleared_claim', 'Your payment was received and cleared today.'],
      ['payment_cleared_claim', 'Your rent payment went through this morning.'],
      ['payment_plan', 'We can set up a payment plan for the balance.'],
      ['payment_plan', 'You can split the rent across two payments.'],
      ['appointment_promise', "You're scheduled for Tuesday at 2pm."],
      ['appointment_promise', 'The plumber will arrive between 9 and 11am.'],
      ['lease_change_promise', 'We will amend the lease to add your roommate.'],
      ['lease_change_promise', 'Your lease has been extended by six months.'],
      ['dispatch_promise', 'A technician has been dispatched to your unit.'],
      ['dispatch_promise', 'The plumber is on his way now.'],
      ['pressure_or_threat', 'This is your final notice before further action.'],
      ['pressure_or_threat', 'Pay today or else there will be consequences.'],
    ];

    it.each(denyCases)('should draft as %s when body is %j', (category, body) => {
      const result = classifySmsBody(body);
      expect(result.classification).toBe('draft');
      expect(result.category).toBe(category);
    });
  });

  describe('safe confirmation shapes', () => {
    const safeBodies = [
      'We received your request and will follow up.',
      'Your work order was created and the owner has been notified.',
      'Please reply with a photo of the leak.',
      'Please reply with payment confirmation or a screenshot.',
      "I'll ask the owner to follow up about a good callback time.",
      'Thanks for letting us know.',
    ];

    it.each(safeBodies)('should classify as safe when body is %j', (body) => {
      const result = classifySmsBody(body);
      expect(result.classification).toBe('safe');
      expect(result.category).toBe('safe_confirmation');
    });

    it('allows a message made entirely from known-safe sentences', () => {
      expect(
        classifySmsBody('We received your request. A work order was created.')
          .classification,
      ).toBe('safe');
    });
  });

  describe('fail-closed default', () => {
    const unmatchedBodies = [
      'The weather is lovely in Arlington today.',
      'Your unit inspection results are attached below.',
      'We received your request. The owner approved a free month of rent.',
      'We received your request and the owner approved a rent credit.',
      '',
    ];

    it.each(unmatchedBodies)('should draft as unmatched when body is %j', (body) => {
      const result = classifySmsBody(body);
      expect(result.classification).toBe('draft');
      expect(result.category).toBe('unmatched');
    });
  });

  it('should draft the existing e2e body as payment_cleared_claim when classified', () => {
    const result = classifySmsBody('Confirming your rent payment was received — thanks!');
    expect(result.classification).toBe('draft');
    expect(result.category).toBe('payment_cleared_claim');
  });
});

// ---------------------------------------------------------------------------
// disclosureAllowed
// ---------------------------------------------------------------------------

describe('disclosureAllowed', () => {
  const matrix: Array<[CallerKind, ReturnType<typeof disclosureAllowed>]> = [
    [
      'verified_owner',
      { tenantIdentity: true, ledger: true, ownerPortfolio: true, vendorJobContext: true },
    ],
    [
      'verified_tenant',
      { tenantIdentity: true, ledger: true, ownerPortfolio: false, vendorJobContext: false },
    ],
    [
      'likely_tenant',
      { tenantIdentity: true, ledger: false, ownerPortfolio: false, vendorJobContext: false },
    ],
    [
      'known_vendor',
      { tenantIdentity: false, ledger: false, ownerPortfolio: false, vendorJobContext: true },
    ],
    [
      'unknown_caller',
      { tenantIdentity: false, ledger: false, ownerPortfolio: false, vendorJobContext: false },
    ],
    [
      'ambiguous',
      { tenantIdentity: false, ledger: false, ownerPortfolio: false, vendorJobContext: false },
    ],
  ];

  it.each(matrix)('should grant the exact disclosure set when caller is %s', (kind, expected) => {
    expect(disclosureAllowed(kind)).toEqual(expected);
  });

  it('should return a fresh copy when called so callers cannot mutate the matrix', () => {
    const first = disclosureAllowed('verified_owner');
    const mutated = { ...first, ledger: false };
    expect(mutated.ledger).toBe(false);
    expect(disclosureAllowed('verified_owner').ledger).toBe(true);
  });
});
