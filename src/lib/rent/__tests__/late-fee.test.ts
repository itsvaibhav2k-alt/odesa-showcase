import { describe, expect, it } from 'vitest';

import { computeLateFee } from '../late-fee';

describe('computeLateFee', () => {
  it('returns 0 when daysLate ≤ 0', () => {
    expect(computeLateFee({ policy: { kind: 'flat', amount: 50 }, daysLate: 0 })).toBe(0);
    expect(computeLateFee({ policy: { kind: 'flat', amount: 50 }, daysLate: -2 })).toBe(0);
  });

  it('returns 0 on waived policy regardless of days late', () => {
    expect(computeLateFee({ policy: { waived: true }, daysLate: 30 })).toBe(0);
  });

  it('honors flat-policy grace period', () => {
    const policy = { kind: 'flat', amount: 50, graceDays: 5 };
    expect(computeLateFee({ policy, daysLate: 3 })).toBe(0);
    expect(computeLateFee({ policy, daysLate: 5 })).toBe(0);
    expect(computeLateFee({ policy, daysLate: 6 })).toBe(50);
    expect(computeLateFee({ policy, daysLate: 20 })).toBe(50);
  });

  it('returns the highest-matching tier for tiered policies', () => {
    const policy = {
      kind: 'tiered',
      graceDays: 3,
      tiers: [
        { afterDays: 3, amount: 25 },
        { afterDays: 7, amount: 75 },
      ],
    };
    expect(computeLateFee({ policy, daysLate: 3 })).toBe(0);
    expect(computeLateFee({ policy, daysLate: 4 })).toBe(25);
    expect(computeLateFee({ policy, daysLate: 7 })).toBe(25);
    expect(computeLateFee({ policy, daysLate: 8 })).toBe(75);
    expect(computeLateFee({ policy, daysLate: 30 })).toBe(75);
  });

  it('returns 0 for an unknown policy shape rather than throwing', () => {
    expect(computeLateFee({ policy: {}, daysLate: 10 })).toBe(0);
    expect(computeLateFee({ policy: null, daysLate: 10 })).toBe(0);
    expect(computeLateFee({ policy: 'nope', daysLate: 10 })).toBe(0);
    expect(computeLateFee({ policy: { kind: 'weird' }, daysLate: 10 })).toBe(0);
  });

  it('ignores malformed tier entries within a tiered policy', () => {
    const policy = {
      kind: 'tiered',
      tiers: [
        { afterDays: 3, amount: 25 },
        { bogus: true }, // dropped
        { afterDays: 10, amount: 100 },
      ],
    };
    expect(computeLateFee({ policy, daysLate: 4 })).toBe(25);
    expect(computeLateFee({ policy, daysLate: 15 })).toBe(100);
  });
});
