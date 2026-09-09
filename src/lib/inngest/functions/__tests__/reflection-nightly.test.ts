/**
 * Smoke test for the nightly reflection cron — asserts the Inngest
 * function is exported with the correct id and cron expression.
 *
 * The cron handler itself is exercised end-to-end via a Playwright spec
 * (e2e/agent/reflection.spec.ts); here we only verify the registration
 * contract because Inngest's runtime requires an active dev server.
 */

import { describe, expect, it } from 'vitest';

import { reflectionNightlyCron } from '../reflection-nightly';

describe('reflectionNightlyCron registration', () => {
  it('exposes the expected id', () => {
    expect(reflectionNightlyCron.id()).toBe('reflection-nightly');
  });

  it('is registered as a cron with the nightly expression', () => {
    const triggers = reflectionNightlyCron.opts.triggers ?? [];
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ cron: '0 2 * * *' });
  });
});
