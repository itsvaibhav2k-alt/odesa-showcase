/**
 * Unit tests for the pure financial math helpers.
 *
 * All money is integer cents; every metric is conservative — missing
 * inputs yield `null`/`unknown`, never an invented number. Work-order
 * count is only ever a risk SIGNAL, never converted to a dollar value.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyRisk,
  collectionRatePct,
  marginPct,
  occupancyRatePct,
  operatingResultCents,
  type RiskInput,
} from '../math';

function risk(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    collectionRatePct: 100,
    occupancyRatePct: 100,
    rentLateCents: 0,
    rentOutstandingCents: 0,
    openWorkOrderCount: 0,
    marginPct: null,
    ...overrides,
  };
}

describe('financials/math', () => {
  describe('collectionRatePct', () => {
    it('should compute collected over billed as a percent', () => {
      expect(collectionRatePct(9500, 10000)).toBe(95);
    });

    it('should allow over-collection above 100 (credits/backpay)', () => {
      expect(collectionRatePct(11000, 10000)).toBe(110);
    });

    it('should return 0 for a fully unpaid month', () => {
      expect(collectionRatePct(0, 10000)).toBe(0);
    });

    it('should return null when nothing was billed', () => {
      expect(collectionRatePct(5000, 0)).toBeNull();
      expect(collectionRatePct(0, 0)).toBeNull();
    });

    it('should round to one decimal place for display', () => {
      expect(collectionRatePct(3333, 10000)).toBe(33.3);
    });
  });

  describe('occupancyRatePct', () => {
    it('should compute occupied over total units', () => {
      expect(occupancyRatePct(3, 4)).toBe(75);
    });

    it('should handle full and empty occupancy', () => {
      expect(occupancyRatePct(4, 4)).toBe(100);
      expect(occupancyRatePct(0, 4)).toBe(0);
    });

    it('should return null when there are no units', () => {
      expect(occupancyRatePct(0, 0)).toBeNull();
    });

    it('should round to one decimal place', () => {
      expect(occupancyRatePct(1, 3)).toBe(33.3);
    });
  });

  describe('operatingResultCents', () => {
    it('should subtract expenses from collected rent', () => {
      expect(operatingResultCents(100000, 40000)).toBe(60000);
    });

    it('should allow a negative operating result', () => {
      expect(operatingResultCents(100000, 120000)).toBe(-20000);
    });

    it('should treat zero expenses as a real (connected) figure', () => {
      expect(operatingResultCents(100000, 0)).toBe(100000);
    });

    it('should return null when expenses are not connected', () => {
      expect(operatingResultCents(100000, null)).toBeNull();
    });
  });

  describe('marginPct', () => {
    it('should compute operating result over collected as a percent', () => {
      expect(marginPct(60000, 100000)).toBe(60);
    });

    it('should allow a negative margin', () => {
      expect(marginPct(-20000, 100000)).toBe(-20);
    });

    it('should return null when the operating result is unknown', () => {
      expect(marginPct(null, 100000)).toBeNull();
    });

    it('should return null when nothing was collected', () => {
      expect(marginPct(50000, 0)).toBeNull();
    });
  });

  describe('classifyRisk', () => {
    it('should be healthy with strong collection, full occupancy, no late', () => {
      const result = classifyRisk(risk());
      expect(result.level).toBe('healthy');
      expect(result.reasons).toEqual([]);
    });

    it('should be watch when collection slips slightly', () => {
      expect(classifyRisk(risk({ collectionRatePct: 90 })).level).toBe('watch');
    });

    it('should be attention when collection is well below target', () => {
      expect(classifyRisk(risk({ collectionRatePct: 70 })).level).toBe('attention');
    });

    it('should be critical when collection is under half', () => {
      const result = classifyRisk(risk({ collectionRatePct: 30 }));
      expect(result.level).toBe('critical');
      expect(result.reasons.some((r) => r.includes('Collection'))).toBe(true);
    });

    it('should be watch on partial occupancy', () => {
      expect(classifyRisk(risk({ occupancyRatePct: 60 })).level).toBe('watch');
    });

    it('should be attention on significant vacancy', () => {
      expect(classifyRisk(risk({ occupancyRatePct: 40 })).level).toBe('attention');
    });

    it('should escalate to watch when there is late rent exposure', () => {
      const result = classifyRisk(risk({ collectionRatePct: 96, rentLateCents: 5000 }));
      expect(result.level).toBe('watch');
      expect(result.reasons.some((r) => r.includes('late'))).toBe(true);
    });

    it('should use open work-order count as a risk signal only (never money)', () => {
      const result = classifyRisk(risk({ openWorkOrderCount: 5 }));
      expect(result.level).toBe('watch');
      expect(result.reasons.some((r) => r.includes('work order'))).toBe(true);
      // No reason should fabricate a dollar amount from a count.
      expect(result.reasons.some((r) => r.includes('$'))).toBe(false);
    });

    it('should escalate to attention on a negative margin when connected', () => {
      expect(classifyRisk(risk({ marginPct: -5 })).level).toBe('attention');
    });

    it('should take the worst signal across multiple factors', () => {
      const result = classifyRisk(risk({ collectionRatePct: 30, occupancyRatePct: 60 }));
      expect(result.level).toBe('critical');
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('should be unknown when there is no rent or occupancy data', () => {
      const result = classifyRisk(
        risk({ collectionRatePct: null, occupancyRatePct: null }),
      );
      expect(result.level).toBe('unknown');
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should still assess occupancy when nothing was billed', () => {
      const result = classifyRisk(
        risk({ collectionRatePct: null, occupancyRatePct: 100 }),
      );
      expect(result.level).toBe('healthy');
    });
  });
});
