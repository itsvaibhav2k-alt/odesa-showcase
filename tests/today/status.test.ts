import { describe, it, expect } from 'vitest';
import {
  statusColor,
  occupancyTone,
  rentCollectionTone,
  lateTenantsTone,
  type StatusTone,
} from '@/lib/today/status';

describe('status', () => {
  describe('statusColor', () => {
    it('should map each tone to its CSS variable', () => {
      // Arrange
      const cases: Array<[StatusTone, string]> = [
        ['healthy', 'var(--success-600)'],
        ['review', 'var(--gold-500)'],
        ['attention', 'var(--error-600)'],
        ['watching', 'var(--navy-500)'],
        ['neutral', 'var(--ink-500)'],
      ];

      // Act + Assert
      for (const [tone, expected] of cases) {
        expect(statusColor(tone)).toBe(expected);
      }
    });

    it('should return a var() string for every tone', () => {
      const tones: StatusTone[] = ['healthy', 'review', 'attention', 'watching', 'neutral'];
      for (const tone of tones) {
        expect(statusColor(tone)).toMatch(/^var\(--[a-z0-9-]+\)$/);
      }
    });
  });

  describe('occupancyTone', () => {
    it('should be healthy at full occupancy', () => {
      expect(occupancyTone(100)).toBe('healthy');
    });

    it('should be healthy at the 95% threshold', () => {
      expect(occupancyTone(95)).toBe('healthy');
    });

    it('should be neutral for a soft dip', () => {
      expect(occupancyTone(90)).toBe('neutral');
    });

    it('should ask for review at meaningful vacancy', () => {
      expect(occupancyTone(80)).toBe('review');
    });

    it('should ask for review at 0% occupancy', () => {
      expect(occupancyTone(0)).toBe('review');
    });

    it('should be neutral for non-finite input', () => {
      expect(occupancyTone(Number.NaN)).toBe('neutral');
    });
  });

  describe('rentCollectionTone', () => {
    it('should be healthy when fully collected', () => {
      expect(rentCollectionTone(500_00, 500_00)).toBe('healthy');
    });

    it('should be healthy when overcollected', () => {
      expect(rentCollectionTone(600_00, 500_00)).toBe('healthy');
    });

    it('should be neutral for a partial balance', () => {
      expect(rentCollectionTone(250_00, 500_00)).toBe('neutral');
    });

    it('should ask for review when nothing is collected against a real bill', () => {
      expect(rentCollectionTone(0, 500_00)).toBe('review');
    });

    it('should be neutral when nothing is billed yet', () => {
      expect(rentCollectionTone(0, 0)).toBe('neutral');
    });

    it('should be neutral for non-finite input', () => {
      expect(rentCollectionTone(Number.NaN, 500_00)).toBe('neutral');
    });
  });

  describe('lateTenantsTone', () => {
    it('should be healthy with zero late tenants', () => {
      expect(lateTenantsTone(0)).toBe('healthy');
    });

    it('should ask for review with one late tenant', () => {
      expect(lateTenantsTone(1)).toBe('review');
    });

    it('should be attention with several late tenants', () => {
      expect(lateTenantsTone(3)).toBe('attention');
    });

    it('should treat negative counts as healthy', () => {
      expect(lateTenantsTone(-1)).toBe('healthy');
    });

    it('should be healthy for non-finite input', () => {
      expect(lateTenantsTone(Number.NaN)).toBe('healthy');
    });
  });
});
