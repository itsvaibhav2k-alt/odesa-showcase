import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['shoshana-infusive-thomas.ngrok-free.dev'],

  // Pin the Turbopack workspace root to this app directory. Without it, Next
  // infers the root from the nearest ancestor lockfile and picks the wrong one
  // (`/Users/vaibhav/bun.lock`), emitting an "inferred your workspace root"
  // warning on every build/dev start. `__dirname` is the app root here.
  turbopack: {
    root: __dirname,
  },

  // DO NOT try to bundle the Claude Agent SDK's native binary into
  // Vercel functions. @anthropic-ai/claude-agent-sdk-linux-x64 is
  // 248.7MB unpacked vs Vercel's 250MB per-function cap — tracing it in
  // (serverExternalPackages + outputFileTracingIncludes) makes every
  // dispatcher function exceed the limit and the whole deploy ERROR.
  // The operator dispatcher therefore cannot run on Vercel serverless
  // as long as it spawns the CLI binary; it needs either a non-Vercel
  // worker host or a Messages-API-native dispatcher implementation.

  // The old property sub-pages (`/properties/[id]/{units,appliances,vendors,
  // maintenance,payments,rulebook}`) are now URL-synced room drawers on the
  // interior overview (`/properties/[id]?room=<room>`). Redirect the legacy
  // routes into the drawer URLs; query params (e.g. legacy `?unit=`) pass
  // through automatically, and `/properties/:id/units/:unitId` is NOT matched
  // (exact segment count) so the unit-brief page survives.
  //
  // Shipped as `permanent: false` (307) first; flip to 308 in a follow-up once
  // the `?room=` scheme is verified in QA (308s cache aggressively in browsers).
  async redirects() {
    const rooms = [
      'units',
      'appliances',
      'vendors',
      'maintenance',
      'payments',
      'rulebook',
    ];
    return rooms.map((room) => ({
      source: `/properties/:id/${room}`,
      destination: `/properties/:id?room=${room}`,
      permanent: false,
    }));
  },
};

/**
 * Sentry build plugin options. Source maps upload only runs when
 * `SENTRY_AUTH_TOKEN` is set (CI/production); local `npm run build`
 * succeeds without a token.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps only when a token is available (avoids build breaks
  // on forks/PRs that don't have access to the secret).
  silent: !process.env.CI,
  widenClientFileUpload: true,

  // Route browser-side Sentry requests through a Next.js rewrite so ad
  // blockers don't drop them. Safe default; can be disabled per-env.
  tunnelRoute: '/monitoring',

  // Skip source map upload entirely if no auth token is present.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
