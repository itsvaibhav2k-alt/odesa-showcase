/**
 * Validated environment configuration.
 *
 * Imports of this module (via instrumentation.ts) run at server startup.
 * Any missing required var throws immediately with a clear message so
 * the deploy fails fast rather than crashing mid-request.
 *
 * Usage:
 *   import { env } from '@/lib/env';
 *   env.ANTHROPIC_API_KEY   // string — guaranteed present
 *   env.BILLING_ENABLED     // boolean — default false
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // AI
  ANTHROPIC_API_KEY: z.string().min(1),

  // Supabase
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // Messaging
  RETELL_API_KEY: z.string().min(1),
  // Voice Operator (all optional — Retell runs in local simulation until synced).
  // RETELL_REQUIRE_SIGNATURE gates HMAC enforcement on webhook events.
  RETELL_AGENT_ID: z.string().optional(),
  RETELL_PHONE_NUMBER: z.string().optional(),
  RETELL_REQUIRE_SIGNATURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  // Public app base URL — Retell needs a reachable target for webhooks.
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  // Retell SMS unification (all optional — SMS stays dark until agents +
  // A2P exist). RETELL_SMS_AGENT_ID answers tenant texts; the dispatch
  // agent sends approved drafts verbatim. RETELL_SMS_A2P_APPROVED is the
  // deployment-level A2P flag read by readiness ('1'/'true' when approved).
  RETELL_SMS_AGENT_ID: z.string().optional(),
  RETELL_SMS_DISPATCH_AGENT_ID: z.string().optional(),
  RETELL_SMS_A2P_APPROVED: z.string().optional(),
  LINQ_API_KEY_ID: z.string().min(1),
  LINQ_API_SECRET_KEY: z.string().min(1),
  LINQ_WEBHOOK_SECRET: z.string().min(1),

  // Billing (optional — Stripe is deferred at launch)
  BILLING_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Sentry (all optional — no-ops gracefully when absent)
  SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),

  // Tenant portal (optional — portal session mint/verify and OTP hashing
  // fail closed in src/lib/portal/* when unset, so staff deploys without
  // the portal keep working).
  PORTAL_SESSION_SECRET: z.string().optional(),

  // Google OAuth (per-route checks fine; optional here)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),

  // T2b (2026-05-17, additive): pool low-alert threshold.
  // When the available sendblue_number_pool count drops to or below this value
  // after a successful assignment, a Sentry warning is emitted.
  // Defaults to 3 when absent.
  PHONE_POOL_LOW_THRESHOLD: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 3)),

  // T2b (2026-05-17, additive): comma-separated list of emails allowed to
  // access /admin/** routes. Falls back to a no-op (no one allowed) if unset.
  // Example: ADMIN_EMAILS=alice@example.com,bob@example.com
  ADMIN_EMAILS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Validation — called once at startup via instrumentation.ts
// ---------------------------------------------------------------------------

/**
 * Parse and validate process.env against the schema.
 *
 * Throws a descriptive Error when any required var is absent or invalid
 * so the server refuses to start rather than surfacing a runtime crash
 * mid-request.
 *
 * Also enforces a cross-field rule: STRIPE_WEBHOOK_SECRET is required
 * when BILLING_ENABLED is true.
 */
export function validateEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => {
        const key = issue.path.join('.');
        return `Missing required env var: ${key}`;
      })
      .join('\n');
    throw new Error(missing);
  }

  const parsed = result.data;

  // Cross-field validation: Stripe secret required when billing is on.
  if (parsed.BILLING_ENABLED && !parsed.STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      'Missing required env var: STRIPE_WEBHOOK_SECRET (required when BILLING_ENABLED=true)',
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Singleton — validated once, exported as `env`
// ---------------------------------------------------------------------------

// Lazy singleton so test files that import this module but don't need
// validation can override process.env before the first access.
let _env: Env | null = null;

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!_env) {
      _env = validateEnv();
    }
    return (_env as Record<string, unknown>)[prop];
  },
});

/**
 * Reset the cached env singleton. Used in tests to force re-validation
 * after patching process.env.
 *
 * @internal — test use only.
 */
export function _resetEnvCache(): void {
  _env = null;
}
