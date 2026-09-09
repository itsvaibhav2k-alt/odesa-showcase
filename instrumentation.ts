/**
 * Next.js instrumentation hook. Runs once per runtime (Node, Edge) at
 * server startup. We:
 *   1. Validate required environment variables via src/lib/env.ts — any
 *      missing required var throws immediately with a clear message naming
 *      the missing variable (e.g. "Missing required env var: ANTHROPIC_API_KEY").
 *   2. Delegate to the Sentry config files per runtime.
 *
 * Reference: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  // Env validation runs in the Node.js runtime only. The edge runtime has
  // a restricted API surface (no full process.env access for all vars) and
  // uses only SENTRY_DSN which no-ops gracefully when absent.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Dynamic import keeps the heavy Zod parse out of the edge bundle.
    const { validateEnv } = await import('./src/lib/env');
    // Throws with a descriptive message if any required var is missing,
    // failing the process startup before any requests are served.
    validateEnv(process.env);

    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
