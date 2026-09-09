/**
 * Smoke test for the monthly meta-learning cron registration.
 */

import { describe, expect, it } from 'vitest';

import { metaLearningMonthlyCron } from '../meta-learning-monthly';

describe('metaLearningMonthlyCron registration', () => {
  it('exposes the expected id', () => {
    expect(metaLearningMonthlyCron.id()).toBe('meta-learning-monthly');
  });

  it('is registered as a cron with the 1st-of-month expression', () => {
    const triggers = metaLearningMonthlyCron.opts.triggers ?? [];
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ cron: '0 4 1 * *' });
  });
});
