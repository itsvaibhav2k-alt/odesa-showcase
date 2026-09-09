/**
 * Sentry server SDK initialization.
 *
 * Runs in the Node.js server runtime (Route Handlers, Server Actions,
 * Server Components, middleware-adjacent code). Captures unhandled errors
 * and performance traces for server requests.
 *
 * DSN is read from `SENTRY_DSN` (server-only; no `NEXT_PUBLIC_` prefix).
 * When unset, the SDK initializes in no-op mode.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
const release = process.env.SENTRY_RELEASE;

const tracesSampleRate = environment === 'production' ? 0.1 : 1.0;

Sentry.init({
  dsn,
  environment,
  release,
  enabled: Boolean(dsn),

  tracesSampleRate,

  // Never forward user PII by default. Explicit opt-in per event if needed.
  sendDefaultPii: false,
});
