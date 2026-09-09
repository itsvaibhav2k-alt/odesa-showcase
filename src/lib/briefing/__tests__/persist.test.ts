import { describe, expect, it } from 'vitest';

import { mondayOfWeek } from '../persist';

describe('mondayOfWeek', () => {
  it('returns the Monday of the containing ISO week for a Wednesday', () => {
    expect(mondayOfWeek(new Date('2026-04-22T10:00:00Z'))).toBe('2026-04-20');
  });

  it('returns itself when the input is already a Monday', () => {
    expect(mondayOfWeek(new Date('2026-04-20T03:00:00Z'))).toBe('2026-04-20');
  });

  it('wraps back from Sunday to the prior Monday', () => {
    expect(mondayOfWeek(new Date('2026-04-26T23:00:00Z'))).toBe('2026-04-20');
  });
});
