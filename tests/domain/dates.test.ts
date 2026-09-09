import { describe, it, expect } from 'vitest';
import { parseIsoDay, dayNumber, diffDays } from '@/lib/domain/dates';

describe('dates', () => {
  describe('parseIsoDay', () => {
    it('should parse a valid YYYY-MM-DD string into parts', () => {
      expect(parseIsoDay('2026-06-01')).toEqual({ y: 2026, m: 6, d: 1 });
    });

    it('should parse a leap-day date', () => {
      expect(parseIsoDay('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
    });

    it('should return null for a malformed string', () => {
      expect(parseIsoDay('June 1, 2026')).toBeNull();
      expect(parseIsoDay('2026-6-1')).toBeNull();
      expect(parseIsoDay('')).toBeNull();
      expect(parseIsoDay('2026-06-01T00:00:00Z')).toBeNull();
    });

    it('should return null for impossible month or day values', () => {
      expect(parseIsoDay('2026-13-01')).toBeNull();
      expect(parseIsoDay('2026-00-10')).toBeNull();
      expect(parseIsoDay('2026-06-32')).toBeNull();
      expect(parseIsoDay('2026-06-00')).toBeNull();
    });
  });

  describe('dayNumber', () => {
    it('should return the epoch day count for a date', () => {
      // 1970-01-01 is day 0.
      expect(dayNumber('1970-01-01')).toBe(0);
      expect(dayNumber('1970-01-02')).toBe(1);
    });

    it('should return NaN for a malformed string', () => {
      expect(dayNumber('not-a-date')).toBeNaN();
    });
  });

  describe('diffDays', () => {
    it('should return 11 for the audit window (Jun 1 to Jun 12)', () => {
      expect(diffDays('2026-06-12', '2026-06-01')).toBe(11);
    });

    it('should return 1 for consecutive days (no UTC-shift bug)', () => {
      expect(diffDays('2026-06-02', '2026-06-01')).toBe(1);
    });

    it('should return 0 for the same day', () => {
      expect(diffDays('2026-06-01', '2026-06-01')).toBe(0);
    });

    it('should cross month boundaries correctly', () => {
      expect(diffDays('2026-07-01', '2026-06-30')).toBe(1);
    });

    it('should cross year boundaries correctly', () => {
      expect(diffDays('2026-01-01', '2025-12-31')).toBe(1);
    });

    it('should handle leap years correctly', () => {
      expect(diffDays('2024-03-01', '2024-02-28')).toBe(2);
      expect(diffDays('2026-03-01', '2026-02-28')).toBe(1);
    });

    it('should return a negative diff when a is before b', () => {
      expect(diffDays('2026-06-01', '2026-06-12')).toBe(-11);
    });

    it('should return NaN when either input is malformed', () => {
      expect(diffDays('garbage', '2026-06-01')).toBeNaN();
      expect(diffDays('2026-06-01', 'garbage')).toBeNaN();
    });
  });
});
