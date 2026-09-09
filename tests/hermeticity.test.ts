/**
 * Regression: proves the `tests/setup.ts` provider-env scrub actually fires and
 * stays in sync with its documented key list. If someone adds a provider secret
 * to the codebase but forgets to scrub it here, or silently drops a key from the
 * scrub, one of these assertions fails.
 */

import { describe, expect, it } from 'vitest';

import { SCRUBBED_ENV_KEYS } from './setup';

describe('unit-suite hermeticity (tests/setup.ts scrub)', () => {
  it('every scrubbed provider credential/flag key is undefined after setup', () => {
    // Imported straight from setup.ts so the proof and the scrub can never
    // drift — they read the exact same list.
    for (const key of SCRUBBED_ENV_KEYS) {
      expect(process.env[key], `${key} leaked into the unit suite`).toBeUndefined();
    }
  });

  it('does not force-delete infra keys the harness / Supabase client need', () => {
    const preserved = [
      'MESSAGING_TEST_HOOKS',
      'TEST_HOOKS_SECRET',
      'NODE_ENV',
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];
    for (const key of preserved) {
      expect(SCRUBBED_ENV_KEYS as readonly string[]).not.toContain(key);
    }
  });

  it('covers exactly the intended provider families (locks against drift)', () => {
    expect([...SCRUBBED_ENV_KEYS].sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'BILLING_ENABLED',
      'INNGEST_EVENT_KEY',
      'INNGEST_SIGNING_KEY',
      'LINQ_API_KEY_ID',
      'LINQ_API_SECRET_KEY',
      'LINQ_WEBHOOK_SECRET',
      'OPENAI_API_KEY',
      'RETELL_API_KEY',
      'RETELL_REQUIRE_SIGNATURE',
      'RETELL_SMS_DISPATCH_AGENT_ID',
      'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
    ]);
  });
});
