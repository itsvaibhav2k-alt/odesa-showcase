/**
 * Smoke test for the weekly synthesis cron registration.
 */

import { describe, expect, it } from 'vitest';

import { synthesisWeeklyCron } from '../synthesis-weekly';

describe('synthesisWeeklyCron registration', () => {
  it('exposes the expected id', () => {
    expect(synthesisWeeklyCron.id()).toBe('synthesis-weekly-monday');
  });

  it('is registered as a cron with the Monday-3am expression', () => {
    const triggers = synthesisWeeklyCron.opts.triggers ?? [];
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ cron: '0 3 * * 1' });
  });
});
