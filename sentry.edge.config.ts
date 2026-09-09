/**
 * Sentry edge SDK initialization.
 *
 * Runs in the Next.js Edge runtime (middleware + Edge Route Handlers).
 * Edge runtime has a reduced Node API surface; this config intentionally
 * uses only features supported by `@sentry/nextjs` on the edge.
 *
 * DSN is read from `SENTRY_DSN`. When unset, the SDK initializes in
 * no-op mode.
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

  sendDefaultPii: false,
});
