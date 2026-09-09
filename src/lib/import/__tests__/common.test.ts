/**
 * Unit tests for shared importer parsing utilities.
 */

import { describe, expect, it } from 'vitest';

import {
  normalizePhoneE164,
  parseAddress,
  parseCurrencyToCents,
  parseDate,
  parseFloatOrNull,
  parseIntOrNull,
  pickColumn,
  slugify,
} from '../common';

describe('normalizePhoneE164', () => {
  it('returns E.164 for a hyphenated US number', () => {
    expect(normalizePhoneE164('202-555-0101')).toBe('+12025550101');
  });

  it('returns E.164 for parens-and-space format', () => {
    expect(normalizePhoneE164('(202) 555-0101')).toBe('+12025550101');
  });

  it('keeps an already-E.164 US number', () => {
    expect(normalizePhoneE164('+12025550101')).toBe('+12025550101');
  });

  it('handles 11-digit with leading 1', () => {
    expect(normalizePhoneE164('12025550101')).toBe('+12025550101');
  });

  it('returns null for unparseable input', () => {
    expect(normalizePhoneE164('abc')).toBeNull();
    expect(normalizePhoneE164('')).toBeNull();
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
  });

  it('rejects non-US country codes', () => {
    expect(normalizePhoneE164('+447911123456')).toBeNull();
  });
});

describe('parseAddress', () => {
  it('parses a full US address with state + zip', () => {
    expect(parseAddress('123 Main St, Arlington, VA 22201')).toEqual({
      street: '123 Main St',
      city: 'Arlington',
      state: 'VA',
      zip: '22201',
    });
  });

  it('parses without a zip', () => {
    expect(parseAddress('55 Elm St, Springfield, VA')).toEqual({
      street: '55 Elm St',
      city: 'Springfield',
      state: 'VA',
      zip: null,
    });
  });

  it('returns street-only for a single-token input', () => {
    expect(parseAddress('123 Main St')).toEqual({
      street: '123 Main St',
      city: null,
      state: null,
      zip: null,
    });
  });

  it('returns null for empty / nullish input', () => {
    expect(parseAddress(null)).toBeNull();
    expect(parseAddress('')).toBeNull();
    expect(parseAddress('   ')).toBeNull();
  });
});

describe('parseDate', () => {
  it('passes through ISO YYYY-MM-DD', () => {
    expect(parseDate('2026-05-08')).toBe('2026-05-08');
  });

  it('parses US m/d/yyyy', () => {
    expect(parseDate('5/8/2026')).toBe('2026-05-08');
    expect(parseDate('05/08/2026')).toBe('2026-05-08');
  });

  it('parses yyyy/m/d', () => {
    expect(parseDate('2026/5/8')).toBe('2026-05-08');
  });

  it('parses long-form via Date.parse', () => {
    expect(parseDate('May 8, 2026')).toBe('2026-05-08');
  });

  it('returns null on garbage', () => {
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseCurrencyToCents', () => {
  it('parses "$1,800.00" → 180000', () => {
    expect(parseCurrencyToCents('$1,800.00')).toBe(180000);
  });

  it('parses "1800" → 180000', () => {
    expect(parseCurrencyToCents('1800')).toBe(180000);
  });

  it('parses "1,800.5" → 180050', () => {
    expect(parseCurrencyToCents('1,800.5')).toBe(180050);
  });

  it('returns null on empty / unparseable', () => {
    expect(parseCurrencyToCents('')).toBeNull();
    expect(parseCurrencyToCents(null)).toBeNull();
    expect(parseCurrencyToCents('abc')).toBeNull();
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Vaba House')).toBe('vaba-house');
  });

  it('strips punctuation', () => {
    expect(slugify('Vaba House #2')).toBe('vaba-house-2');
  });

  it('trims edge hyphens', () => {
    expect(slugify('--foo--bar--')).toBe('foo-bar');
  });

  it('returns empty string for nullish input', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('pickColumn', () => {
  it('matches case-insensitively', () => {
    const row = { 'Property Name': 'Vaba', 'Other': 'x' };
    expect(pickColumn(row, ['property name'])).toBe('Vaba');
  });

  it('trims whitespace from header keys', () => {
    const row = { '  Property Name  ': 'Vaba' };
    expect(pickColumn(row, ['Property Name'])).toBe('Vaba');
  });

  it('falls back through candidates', () => {
    const row = { 'Phone': '202-555-0101' };
    expect(pickColumn(row, ['Tenant Phone', 'Phone'])).toBe('202-555-0101');
  });

  it('returns "" if no candidate matches', () => {
    const row = { 'A': '1' };
    expect(pickColumn(row, ['B'])).toBe('');
  });
});

describe('parseIntOrNull / parseFloatOrNull', () => {
  it('parseIntOrNull parses integers', () => {
    expect(parseIntOrNull('3')).toBe(3);
    expect(parseIntOrNull('')).toBeNull();
    expect(parseIntOrNull('abc')).toBeNull();
  });

  it('parseFloatOrNull parses decimals', () => {
    expect(parseFloatOrNull('1.5')).toBe(1.5);
    expect(parseFloatOrNull('')).toBeNull();
  });
});
