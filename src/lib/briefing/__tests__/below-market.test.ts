import { describe, expect, it } from 'vitest';

import { medianRentForZip } from '../below-market';

describe('medianRentForZip', () => {
  it('returns the seeded DMV rate for known zips', () => {
    expect(medianRentForZip('20001')).toBe(2400);
    expect(medianRentForZip('22209')).toBe(2750);
  });

  it('falls back to default for unknown zips', () => {
    expect(medianRentForZip('99999')).toBe(2500);
    expect(medianRentForZip(null)).toBe(2500);
    expect(medianRentForZip(undefined)).toBe(2500);
  });
});
