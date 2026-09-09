/**
 * Phase A4 — deterministic currency grounding.
 *
 * `validateNumericGrounding` is the pure guard that runs between the
 * worker drafting a tenant-facing body and `recordProposal`. Every
 * dollar amount the draft states must appear (cents-normalized) in the
 * allowed source texts; ungrounded amounts demote auto → review.
 *
 * Currency only — dates are deliberately out of scope in v1.
 */

import { describe, expect, it } from 'vitest';

import {
  extractCurrencyTokens,
  normalizeCurrencyToCents,
  validateNumericGrounding,
} from '../types';

describe('extractCurrencyTokens', () => {
  it('should extract $-prefixed amounts with commas and decimals', () => {
    const tokens = extractCurrencyTokens(
      'Your rent is $1,200 and the fee is $45.50.',
    );
    expect(tokens).toEqual(['$1,200', '$45.50']);
  });

  it('should extract "N dollars" phrasing', () => {
    const tokens = extractCurrencyTokens('That will be 1200 dollars total.');
    expect(tokens).toEqual(['1200 dollars']);
  });

  it('should ignore plain numbers without a currency cue', () => {
    expect(extractCurrencyTokens('Unit 2A, ticket 4512, due on the 5th')).toEqual([]);
  });

  it('should return empty for text with no numbers', () => {
    expect(extractCurrencyTokens('Thanks, will do!')).toEqual([]);
  });
});

describe('normalizeCurrencyToCents', () => {
  it('should normalize $1,200 and 1200.00 to the same cents value', () => {
    expect(normalizeCurrencyToCents('$1,200')).toBe(120000);
    expect(normalizeCurrencyToCents('1200.00')).toBe(120000);
  });

  it('should normalize "1200 dollars" to 120000 cents', () => {
    expect(normalizeCurrencyToCents('1200 dollars')).toBe(120000);
  });

  it('should keep cents precision ($45.50 → 4550)', () => {
    expect(normalizeCurrencyToCents('$45.50')).toBe(4550);
  });

  it('should return null for non-numeric residue', () => {
    expect(normalizeCurrencyToCents('$one hundred')).toBeNull();
    expect(normalizeCurrencyToCents('')).toBeNull();
  });
});

describe('validateNumericGrounding', () => {
  it('should pass a draft with no currency tokens untouched', () => {
    const result = validateNumericGrounding(
      'I will send the plumber tomorrow morning.',
      [],
    );
    expect(result.ok).toBe(true);
    expect(result.ungrounded).toEqual([]);
  });

  it('should pass when the amount is echoed from the inbound body', () => {
    const result = validateNumericGrounding(
      'Yes, your rent is $1,200 this month.',
      ['is my rent still 1200?'],
    );
    expect(result.ok).toBe(true);
  });

  it('should pass when the amount appears in a history turn', () => {
    const result = validateNumericGrounding(
      'As mentioned, the late fee is $50.',
      ['hi', 'The late fee is $50 after the grace period.'],
    );
    expect(result.ok).toBe(true);
  });

  it('should match $1,200 against a raw 1200.00 rendering', () => {
    const result = validateNumericGrounding('Rent is $1,200.', ['1200.00']);
    expect(result.ok).toBe(true);
  });

  it('should match "1200 dollars" in the draft against $1,200 in context', () => {
    const result = validateNumericGrounding('You owe 1200 dollars.', ['$1,200']);
    expect(result.ok).toBe(true);
  });

  it('should fail an invented amount and list it in ungrounded', () => {
    const result = validateNumericGrounding(
      'Your rent is $1,450 and is due Friday.',
      ['is my rent due?', 'rent is 1200', 'Rulebook: grace period 5 days'],
    );
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toEqual(['$1,450']);
  });

  it('should fail only the ungrounded token when the draft mixes amounts', () => {
    const result = validateNumericGrounding(
      'Rent is $1,200 plus a $99 admin fee.',
      ['rent is 1200'],
    );
    expect(result.ok).toBe(false);
    expect(result.ungrounded).toEqual(['$99']);
  });

  it('should dedupe repeated ungrounded tokens', () => {
    const result = validateNumericGrounding(
      'Pay $99 now. I repeat: $99.',
      [],
    );
    expect(result.ungrounded).toEqual(['$99']);
  });
});
