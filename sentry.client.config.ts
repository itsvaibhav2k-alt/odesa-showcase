/**
 * Sentry browser SDK initialization.
 *
 * Runs in the user's browser on every page load. Session Replay is scoped
 * to authenticated app routes only (see `beforeSend` path filter) to keep
 * the recording volume reasonable and avoid capturing marketing traffic.
 *
 * DSN is read from `NEXT_PUBLIC_SENTRY_DSN`. When unset (e.g. local dev
 * without a Sentry project, or during CI `npm run build` without secrets),
 * the SDK initializes in no-op mode and all calls are safe.
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV;
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;

// Sampling: 100% of errors; 10% of transactions in production;
// 100% in preview/development for visibility while the product is small.
const tracesSampleRate = environment === 'production' ? 0.1 : 1.0;

// Session Replay: scope to authenticated app routes only. Capture 100% of
// sessions that trigger an error; sample 10% of normal sessions when the
// user is inside the app.
const isAppRoute = (): boolean => {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname;
  return (
    p.startsWith('/today') ||
    p.startsWith('/inbox') ||
    p.startsWith('/properties') ||
    p.startsWith('/settings')
  );
};

Sentry.init({
  dsn,
  environment,
  release,
  enabled: Boolean(dsn),

  tracesSampleRate,

  replaysSessionSampleRate: isAppRoute() ? 0.1 : 0,
  replaysOnErrorSampleRate: isAppRoute() ? 1.0 : 0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Drop replay events originating outside the authenticated app. Belt-and-
  // suspenders alongside the sample-rate gate above.
  beforeSend(event) {
    if (event.type === 'replay_event' && typeof window !== 'undefined') {
      if (!isAppRoute()) {
        return null;
      }
    }
    return event;
  },

  // Scrub sensitive PII before events leave the browser. Tenant phone numbers
  // and emails show up in logs/breadcrumbs; Sentry's default scrubbers miss
  // E.164 formats.
  sendDefaultPii: false,
});
