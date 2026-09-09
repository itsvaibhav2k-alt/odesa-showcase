/**
 * Unit tests for owner-notification quiet hours. Fixed clocks only —
 * every case pins `now` and asserts either immediate delivery (null)
 * or the exact next-09:00-local instant.
 */

import { describe, expect, it } from 'vitest';

import { resolveOwnerNotifyDeferral } from '../quiet-hours';

const TZ_NY = 'America/New_York';

describe('resolveOwnerNotifyDeferral', () => {
  it('should defer the 08:00 UTC rent escalation (4am ET) to 9am ET', () => {
    // 2026-06-11T08:00:00Z = 04:00 EDT → next 9am EDT = 13:00 UTC.
    const now = new Date('2026-06-11T08:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, TZ_NY)).toBe(
      '2026-06-11T13:00:00.000Z',
    );
  });

  it('should deliver immediately inside the 9am-9pm local window', () => {
    // 15:00 UTC = 11:00 EDT.
    const now = new Date('2026-06-11T15:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, TZ_NY)).toBeNull();
  });

  it('should defer a late-evening alert to the next morning', () => {
    // 01:30 UTC = 21:30 EDT the previous evening → 9am EDT = 13:00 UTC.
    const now = new Date('2026-06-12T01:30:00Z');
    expect(resolveOwnerNotifyDeferral(now, TZ_NY)).toBe(
      '2026-06-12T13:00:00.000Z',
    );
  });

  it('should treat exactly 9am local as deliverable', () => {
    // 13:00 UTC = 09:00 EDT.
    const now = new Date('2026-06-11T13:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, TZ_NY)).toBeNull();
  });

  it('should defer exactly 9pm local to the next morning', () => {
    // 2026-06-12T01:00:00Z = 21:00 EDT → next 9am = 12h later.
    const now = new Date('2026-06-12T01:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, TZ_NY)).toBe(
      '2026-06-12T13:00:00.000Z',
    );
  });

  it('should respect a non-US org timezone', () => {
    // 10:00 UTC = 11:00 in London (BST) — within window.
    const now = new Date('2026-06-11T10:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, 'Europe/London')).toBeNull();
  });

  it('should fall back to America/New_York for an unparseable timezone', () => {
    const now = new Date('2026-06-11T08:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, 'Not/AZone')).toBe(
      '2026-06-11T13:00:00.000Z',
    );
  });

  it('should fall back to America/New_York for an empty timezone', () => {
    const now = new Date('2026-06-11T08:00:00Z');
    expect(resolveOwnerNotifyDeferral(now, '')).toBe(
      '2026-06-11T13:00:00.000Z',
    );
  });
});
