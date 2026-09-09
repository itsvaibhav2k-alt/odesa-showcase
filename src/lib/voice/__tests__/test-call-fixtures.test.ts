import { describe, expect, it } from 'vitest';

import type { Json } from '@/types/database';

import { deriveCallReview, type CallStatusTone } from '../queries';
import { callOutcomeSchema } from '../types';
import {
  buildTestCallFixture,
  TEST_CALL_SCENARIOS,
  type TestCallScenario,
} from '../test-call-fixtures';

const ORG_ID = 'org-test-0001';
const NOW = new Date('2026-07-07T15:00:00.000Z');

function fixtureFor(scenario: TestCallScenario) {
  return buildTestCallFixture(scenario, ORG_ID, `test-call-${scenario}`, NOW);
}

/** Honest tone per scenario — the whole point of the fixtures feeding deriveCallReview. */
const EXPECTED_TONE: Record<TestCallScenario, CallStatusTone> = {
  maintenance_clean: 'green',
  payment_dispute_review: 'clay',
  unknown_caller_privacy: 'clay',
};

describe('buildTestCallFixture', () => {
  it('should expose exactly the three scenarios', () => {
    expect(TEST_CALL_SCENARIOS).toEqual([
      'maintenance_clean',
      'payment_dispute_review',
      'unknown_caller_privacy',
    ]);
  });

  describe('outcome parses against callOutcomeSchema', () => {
    for (const scenario of TEST_CALL_SCENARIOS) {
      it(`should produce a schema-valid outcome for ${scenario}`, () => {
        const { outcome } = fixtureFor(scenario);
        expect(callOutcomeSchema.safeParse(outcome).success).toBe(true);
      });
    }
  });

  describe('deriveCallReview status tone', () => {
    for (const scenario of TEST_CALL_SCENARIOS) {
      it(`should derive ${EXPECTED_TONE[scenario]} for ${scenario}`, () => {
        const { outcome } = fixtureFor(scenario);
        const review = deriveCallReview('completed', outcome as unknown as Json);
        expect(review.statusTone).toBe(EXPECTED_TONE[scenario]);
      });
    }
  });

  it('should keep the maintenance transcript talking about the kitchen sink', () => {
    expect(fixtureFor('maintenance_clean').transcript).toContain('kitchen sink');
  });

  it('should keep the unknown-caller fixture free of seeded names and dollar amounts', () => {
    const { transcript, outcome } = fixtureFor('unknown_caller_privacy');
    const blob = `${transcript}\n${JSON.stringify(outcome)}`;
    expect(blob).not.toMatch(/Marcus|Alvarez/);
    expect(blob).not.toContain('$');
  });

  it('should be deterministic for identical inputs', () => {
    expect(fixtureFor('maintenance_clean')).toEqual(fixtureFor('maintenance_clean'));
  });
});
