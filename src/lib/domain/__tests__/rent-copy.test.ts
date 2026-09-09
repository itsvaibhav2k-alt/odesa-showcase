/**
 * Unit tests for the canonical rent recommendation copy.
 *
 * Guards the trust invariant that an escalated cycle never recommends a
 * reminder "before any escalation", and that the late line is exactly the
 * calm-reminder sentence every surface reads from.
 */
import { describe, expect, it } from 'vitest';

import {
  rentRecommendationCopy,
  type RentRecommendationKind,
} from '@/lib/domain/rent-copy';

const CALM_REMINDER_LINE =
  'Rent is late. Odesa recommends a calm reminder before escalation.';

describe('rentRecommendationCopy', () => {
  describe('escalated', () => {
    it('should never recommend a reminder "before any escalation"', () => {
      const copy = rentRecommendationCopy('escalated');
      expect(copy).not.toContain('before any escalation');
    });

    it('should describe escalation as already started', () => {
      const copy = rentRecommendationCopy('escalated');
      expect(copy).toBe(
        'Escalation has started. Next step: record payment if paid offline, approve the next notice, or pause escalation.',
      );
    });
  });

  describe('late', () => {
    it('should return the calm-reminder line', () => {
      expect(rentRecommendationCopy('late')).toBe(CALM_REMINDER_LINE);
    });

    it('should stay stable regardless of opts', () => {
      const copy = rentRecommendationCopy('late', {
        firstName: 'Hannah',
        balanceDollars: 1450,
        daysLate: 3,
      });
      expect(copy).toBe(CALM_REMINDER_LINE);
    });
  });

  describe('escalation_prepared', () => {
    it('should make clear nothing sends without approval', () => {
      expect(rentRecommendationCopy('escalation_prepared')).toBe(
        'Escalation is prepared, but nothing sends until you approve it.',
      );
    });
  });

  describe('past_grace', () => {
    it('should mention the eligible fee when one is provided', () => {
      const copy = rentRecommendationCopy('past_grace', { lateFeeDollars: 75 });
      expect(copy).toContain('$75 late fee is now eligible (not yet applied)');
    });

    it('should never imply the fee is already applied', () => {
      const copy = rentRecommendationCopy('past_grace', { lateFeeDollars: 75 });
      expect(copy).toContain('not yet applied');
    });

    it('should omit a dollar figure when no fee is provided', () => {
      const copy = rentRecommendationCopy('past_grace');
      expect(copy).toContain('a late fee is now eligible (not yet applied)');
    });
  });

  describe('every kind', () => {
    const kinds: RentRecommendationKind[] = [
      'current',
      'due',
      'late',
      'past_grace',
      'on_plan',
      'escalation_prepared',
      'escalated',
    ];

    it('should return a non-empty string for each kind', () => {
      for (const kind of kinds) {
        expect(rentRecommendationCopy(kind).length).toBeGreaterThan(0);
      }
    });
  });
});
