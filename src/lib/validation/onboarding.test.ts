import { describe, expect, it } from 'vitest';

import { normalizePhoneE164 } from './onboarding';

describe('normalizePhoneE164', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['not-a-phone', null],
    ['+', null],
    ['12345', null],
    ['0000000000', null],
    ['+10000000000', null],
    ['(571) 555-1234', '+15715551234'],
    ['+44 7911 123456', '+447911123456'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizePhoneE164(raw)).toBe(expected);
  });
});
