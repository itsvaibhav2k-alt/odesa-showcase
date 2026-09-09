import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  actionSafetyDisposition,
  CITATION_ENFORCEMENT_SAFE_DEFAULTS,
  CITATION_ENFORCEMENT_SAFE_INTENTS,
  gateProposal,
  requiresHumanReview,
  type PrivacyMode,
} from '../commit-gate';
import { WORKER_ACTION_TYPES, type WorkerActionType } from '../types';

const CONSEQUENTIAL_ACTIONS = [
  'draft_sms_reply',
  'dispatch_vendor',
  'update_rulebook',
  'add_tenant',
  'set_lease_terms',
  'update_rent',
  'waive_rent',
  'send_tenant_message',
  'update_property_rules',
  'archive_lease',
  'set_property_vendor',
  'update_tenant_preference',
  'request_rent_payment',
  'schedule_calendar_event',
  'cancel_calendar_event',
  'health_flag',
  'voice_call_review',
] as const satisfies ReadonlyArray<WorkerActionType>;

const INTERNAL_RECORD_ACTIONS = [
  'create_property',
  'add_unit',
  'log_maintenance_ticket',
  'add_appliance',
  'update_appliance',
] as const satisfies ReadonlyArray<WorkerActionType>;

describe('gateProposal', () => {
  it.each(CONSEQUENTIAL_ACTIONS)(
    '%s cannot auto-commit at Initiate autonomy 0, even at full confidence',
    (action) => {
      const decision = gateProposal(
        { action_type: action, confidence: 1 },
        0,
        'hosted',
      );
      expect(decision.outcome).toBe('review');
      expect(actionSafetyDisposition(action)).toBe('requires_owner_review');
      expect(requiresHumanReview(action)).toBe(true);
    },
  );

  it.each(CONSEQUENTIAL_ACTIONS)(
    '%s remains review-only at maximum autonomy and confidence',
    (action) => {
      expect(
        gateProposal({ action_type: action, confidence: 1 }, 1, 'hosted')
          .outcome,
      ).toBe('review');
    },
  );

  it.each(INTERNAL_RECORD_ACTIONS)(
    '%s may auto-capture only when the confidence floor is met',
    (action) => {
      expect(actionSafetyDisposition(action)).toBe('internal_record');
      expect(
        gateProposal({ action_type: action, confidence: 0.3 }, 0, 'hosted')
          .outcome,
      ).toBe('auto');
      expect(
        gateProposal({ action_type: action, confidence: 0.29 }, 0, 'hosted')
          .outcome,
      ).toBe('review');
    },
  );

  it('keeps inference-only actions side-effect free and independently gated', () => {
    expect(actionSafetyDisposition('classify_intent')).toBe(
      'automatic_inference',
    );
    expect(
      gateProposal(
        { action_type: 'classify_intent', confidence: 0 },
        0,
        'hosted',
      ).outcome,
    ).toBe('auto');

    expect(actionSafetyDisposition('confirm_emergency')).toBe(
      'automatic_inference',
    );
    expect(
      gateProposal(
        { action_type: 'confirm_emergency', confidence: 0.7 },
        0,
        'hosted',
      ).outcome,
    ).toBe('auto');
    expect(
      gateProposal(
        { action_type: 'confirm_emergency', confidence: 0.69 },
        1,
        'hosted',
      ).outcome,
    ).toBe('review');
  });

  it('requires trust for briefing prose despite its low blast radius', () => {
    expect(actionSafetyDisposition('polish_briefing')).toBe('internal_record');
    expect(
      gateProposal(
        { action_type: 'polish_briefing', confidence: 0 },
        0.5,
        'hosted',
      ).outcome,
    ).toBe('auto');
    expect(
      gateProposal(
        { action_type: 'polish_briefing', confidence: 1 },
        0.49,
        'hosted',
      ).outcome,
    ).toBe('review');
  });

  describe('on-prem privacy mode', () => {
    it('caps the effective autonomy signal without lowering policy thresholds', () => {
      const decision = gateProposal(
        { action_type: 'polish_briefing', confidence: 1 },
        1,
        'on_prem',
      );
      expect(decision.outcome).toBe('auto');
      expect(decision.reason).toMatch(/autonomy 0\.70 >= 0\.5/);
      expect(decision.appliedThreshold.autonomy).toBe(0.5);
    });

    it.each(CONSEQUENTIAL_ACTIONS)(
      '%s stays review-only on-prem',
      (action) => {
        expect(
          gateProposal({ action_type: action, confidence: 1 }, 1, 'on_prem')
            .outcome,
        ).toBe('review');
      },
    );
  });

  describe('citation enforcement', () => {
    const originalFlag = process.env.ODESA_CITATION_ENFORCEMENT;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
      if (originalFlag === undefined) {
        delete process.env.ODESA_CITATION_ENFORCEMENT;
      } else {
        process.env.ODESA_CITATION_ENFORCEMENT = originalFlag;
      }
    });

    it('exports the intended safe inference and intent sets', () => {
      expect(CITATION_ENFORCEMENT_SAFE_DEFAULTS.has('confirm_emergency')).toBe(
        true,
      );
      expect(CITATION_ENFORCEMENT_SAFE_DEFAULTS.has('draft_sms_reply')).toBe(
        false,
      );
      expect(CITATION_ENFORCEMENT_SAFE_INTENTS.has('rent_balance')).toBe(true);
      expect(
        CITATION_ENFORCEMENT_SAFE_INTENTS.has('office_hours_and_contact'),
      ).toBe(true);
      expect(CITATION_ENFORCEMENT_SAFE_INTENTS.has('office_hours')).toBe(false);
    });

    it('keeps a safe-listed classification automatic', () => {
      process.env.ODESA_CITATION_ENFORCEMENT = 'true';
      const decision = gateProposal(
        {
          action_type: 'classify_intent',
          confidence: 0.9,
          payload: {
            intent: 'rent_balance',
            reasoning: 'tenant asked for their balance',
          },
        },
        0,
        'hosted',
        {
          reasoning: 'Jessica usually pays late; classifying as balance ask.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('auto');
    });

    it('forces an otherwise-automatic internal record to review when enabled', () => {
      process.env.ODESA_CITATION_ENFORCEMENT = 'true';
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.9 },
        0,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually pays late; using her preferred name.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('review');
      expect(decision.reason).toMatch(/citation enforcement/);
    });

    it('warns without changing an internal-record outcome in shadow mode', () => {
      delete process.env.ODESA_CITATION_ENFORCEMENT;
      const decision = gateProposal(
        { action_type: 'create_property', confidence: 0.9 },
        0,
        'hosted',
        {
          reasoning: 'Jessica Ramirez usually pays late; using her preferred name.',
          contextFactIds: [],
          contextFacts: [],
        },
      );
      expect(decision.outcome).toBe('auto');
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('never promotes an already-reviewed consequential action', () => {
      process.env.ODESA_CITATION_ENFORCEMENT = 'true';
      expect(
        gateProposal(
          { action_type: 'draft_sms_reply', confidence: 1 },
          1,
          'hosted',
          {
            reasoning: 'Use the supplied tenant message.',
            contextFactIds: ['fact-1'],
            contextFacts: [],
          },
        ).outcome,
      ).toBe('review');
    });
  });

  it('has a disposition and non-blocking gate result for every action type', () => {
    const autonomies = [0, 0.5, 1];
    const confidences = [0, 0.5, 1];
    const modes: PrivacyMode[] = ['hosted', 'on_prem'];

    for (const action of WORKER_ACTION_TYPES) {
      expect([
        'automatic_inference',
        'internal_record',
        'requires_owner_review',
      ]).toContain(actionSafetyDisposition(action));
      for (const autonomy of autonomies) {
        for (const confidence of confidences) {
          for (const mode of modes) {
            expect(
              gateProposal(
                { action_type: action, confidence },
                autonomy,
                mode,
              ).outcome,
            ).not.toBe('block');
          }
        }
      }
    }
  });
});
