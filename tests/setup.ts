import '@testing-library/jest-dom';

/**
 * Provider credential / feature-flag env keys scrubbed from `process.env` at
 * unit-suite load so the suite is HERMETIC by default: it behaves the same on
 * CI and on a developer's laptop regardless of whatever real provider secrets
 * happen to live in that shell.
 *
 * WHY scrub, per family:
 *   - Retell: a real `RETELL_API_KEY` (or the `RETELL_REQUIRE_SIGNATURE` /
 *     `RETELL_WEBHOOK_SECRET` flags, or the SMS dispatch agent id) flips
 *     `verifyRetellAuth` / `RetellSmsProvider` from the unconfigured branch the
 *     specs assert to the configured one — silently masking the failing path.
 *   - Twilio: `TWILIO_AUTH_TOKEN` is the webhook-HMAC secret (the verifier
 *     falls back to a fixed test token when unset). A shell token changes every
 *     computed signature, so fixed-signature specs would break.
 *   - Stripe: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / the
 *     `BILLING_ENABLED` gate. Set, the webhook route leaves its 503
 *     disabled-branch and tries to build a real Stripe client.
 *   - LLM keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`): a present key flips the
 *     embedding/meta clients from the degraded/no-client branch to constructing
 *     a real client — worst case, a test issues a live, billable API call.
 *   - Linq/Sendblue (`LINQ_API_KEY_ID` / `LINQ_API_SECRET_KEY`): gate
 *     `LinqProvider.send`'s real-`fetch` branch.
 *   - Inngest (`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`): gate the
 *     durable-dispatch and reliability config-sanity branches.
 *
 * NOT scrubbed (the harness / Supabase client need them): MESSAGING_TEST_HOOKS,
 * TEST_HOOKS_SECRET, NODE_ENV, and every SUPABASE_* var.
 *
 * A suite that needs a provider CONFIGURED must inject it in-suite via
 * `vi.stubEnv` (plus `vi.resetModules()` + a dynamic `await import()` when the
 * module captures its env at load time, e.g. `src/lib/agent/retell-auth.ts`
 * reads `RETELL_API_KEY` into a module const at import).
 */
export const SCRUBBED_ENV_KEYS = [
  // Retell (voice + SMS)
  'RETELL_API_KEY',
  'RETELL_REQUIRE_SIGNATURE',
  'RETELL_WEBHOOK_SECRET',
  'RETELL_SMS_DISPATCH_AGENT_ID',
  // Twilio
  'TWILIO_AUTH_TOKEN',
  'TWILIO_ACCOUNT_SID',
  // Stripe billing
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'BILLING_ENABLED',
  // LLM providers
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  // Linq / Sendblue
  'LINQ_API_KEY_ID',
  'LINQ_API_SECRET_KEY',
  'LINQ_WEBHOOK_SECRET',
  // Inngest
  'INNGEST_EVENT_KEY',
  'INNGEST_SIGNING_KEY',
] as const;

// Scrub synchronously at setup-file load. `setupFiles` run BEFORE each test
// file's module graph imports, so these deletions beat any module-load env
// capture (e.g. `src/lib/agent/retell-auth.ts:23`).
for (const key of SCRUBBED_ENV_KEYS) {
  delete process.env[key];
}
