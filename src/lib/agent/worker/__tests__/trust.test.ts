import { describe, expect, it } from 'vitest';

import {
  AUTONOMY_DELTAS,
  graduateAutonomy,
  resolveOutcomeKind,
  type ProposalOutcomeKind,
} from '../trust';

describe('graduateAutonomy', () => {
  it.each<[ProposalOutcomeKind, number]>([
    ['committed', 0.01],
    ['committed_after_review', 0.005],
    ['edited', -0.02],
    ['rejected', -0.05],
    ['expired', 0],
  ])('applies the %s delta of %s', (kind, expectedDelta) => {
    const r = graduateAutonomy(0.5, kind);
    expect(r.delta).toBeCloseTo(expectedDelta, 6);
    expect(r.next).toBeCloseTo(0.5 + expectedDelta, 6);
    expect(r.clamped).toBe(false);
  });

  it('clamps positive overshoot at 1.0', () => {
    const r = graduateAutonomy(0.999, 'committed');
    expect(r.next).toBe(1);
    expect(r.clamped).toBe(true);
  });

  it('clamps negative undershoot at 0.0', () => {
    const r = graduateAutonomy(0.01, 'rejected');
    expect(r.next).toBe(0);
    expect(r.clamped).toBe(true);
  });

  it('expired produces a no-op (delta=0, not clamped)', () => {
    const r = graduateAutonomy(0.5, 'expired');
    expect(r.delta).toBe(0);
    expect(r.next).toBe(0.5);
    expect(r.clamped).toBe(false);
  });

  it('synthetic outcome history converges to clamped result deterministically', () => {
    // 60 committed → +0.6 (clamps at 1.0 mid-way, since starting at 0.5)
    // 20 edited    → -0.4
    // 10 rejected  → -0.5
    // 10 expired   → 0
    // Without clamp: 0.5 + 0.6 - 0.4 - 0.5 = 0.2
    // With clamp at 1.0 partway through commits: end ~= 1.0 - 0.4 - 0.5 = 0.1
    let level = 0.5;
    for (let i = 0; i < 60; i++) level = graduateAutonomy(level, 'committed').next;
    for (let i = 0; i < 20; i++) level = graduateAutonomy(level, 'edited').next;
    for (let i = 0; i < 10; i++) level = graduateAutonomy(level, 'rejected').next;
    for (let i = 0; i < 10; i++) level = graduateAutonomy(level, 'expired').next;
    // floating-point drift: just check approximately 0.1
    expect(level).toBeCloseTo(0.1, 5);
  });

  it('graduates from 0 to auto threshold (0.7) with ~70 clean committeds', () => {
    let level = 0;
    let n = 0;
    while (level < 0.7 && n < 200) {
      level = graduateAutonomy(level, 'committed').next;
      n++;
    }
    expect(n).toBe(70);
    expect(level).toBeCloseTo(0.7, 6);
  });

  it('one rejection wipes out roughly five clean commits', () => {
    let a = 0.5;
    for (let i = 0; i < 5; i++) a = graduateAutonomy(a, 'committed').next; // +0.05
    expect(a).toBeCloseTo(0.55, 6);
    a = graduateAutonomy(a, 'rejected').next; // -0.05
    expect(a).toBeCloseTo(0.5, 6);
  });

  it('does not mutate caller-supplied state (functional)', () => {
    const before = 0.5;
    const r = graduateAutonomy(before, 'committed');
    expect(before).toBe(0.5);
    expect(r.next).not.toBe(before);
  });

  // sanity: the constant table matches the documented contract
  it('exposes documented deltas via AUTONOMY_DELTAS', () => {
    expect(AUTONOMY_DELTAS.committed).toBe(0.01);
    expect(AUTONOMY_DELTAS.committed_after_review).toBe(0.005);
    expect(AUTONOMY_DELTAS.edited).toBe(-0.02);
    expect(AUTONOMY_DELTAS.rejected).toBe(-0.05);
    expect(AUTONOMY_DELTAS.expired).toBe(0);
  });
});

describe('resolveOutcomeKind', () => {
  it('lifts committed/auto into committed', () => {
    expect(resolveOutcomeKind('auto', 'committed')).toBe('committed');
  });

  it('lifts committed/review into committed_after_review', () => {
    expect(resolveOutcomeKind('review', 'committed')).toBe('committed_after_review');
  });

  it('passes through rejected', () => {
    expect(resolveOutcomeKind('auto', 'rejected')).toBe('rejected');
    expect(resolveOutcomeKind('review', 'rejected')).toBe('rejected');
  });

  it('passes through edited', () => {
    expect(resolveOutcomeKind('auto', 'edited')).toBe('edited');
  });

  it('passes through expired', () => {
    expect(resolveOutcomeKind('review', 'expired')).toBe('expired');
  });
});
