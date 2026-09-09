import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';

import { defineConfig, devices } from '@playwright/test';

// LOCAL PROD-SERVER E2E ONLY: Playwright must mirror the env precedence
// of `npm run build && npm start` (.env.production.local beats
// .env.local) when testing an already-built local server, or the test
// admin client and the server resolve DIFFERENT Supabase instances and
// every write-assertion "disappears". Turbopack bakes
// NEXT_PUBLIC_SUPABASE_URL into server chunks at build time, so the
// served DB is decided by the files present at build — the test side
// must follow the same rule. .env.production.local is gitignored,
// holds the LOCAL stack keys, and MUST be deleted before building for
// cloud/Vercel-like testing. process.loadEnvFile never overrides
// already-set vars: first-loaded wins, explicit CLI env beats both.
if (fs.existsSync('.env.production.local')) {
  try {
    process.loadEnvFile('.env.production.local');
  } catch {
    // Same fallback contract as the .env.local block below.
  }
}

// Load .env.local before anything reads process.env, so a bare
// `npx playwright test e2e/route-sweep` gets the Supabase/auth vars and
// the 30 authenticated routes can't silently skip-and-report-green.
// `process.loadEnvFile` (Node >= 20.12; this repo runs 22.x) never
// overrides already-set variables — verified: explicit CLI env wins —
// so `BASE_URL=… npx playwright test` keeps working unchanged.
if (fs.existsSync('.env.local')) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // Malformed file or an older Node without loadEnvFile: fall through —
    // explicitly exported env vars still work as before.
  }
}

/**
 * Playwright config for Odesa.
 *
 * - `e2e/` is the canonical test directory.
 * - CI runs chromium-only by default. Set `ALL_BROWSERS=1` to exercise
 *   firefox + webkit too (used on release branches).
 * - webServer runs `npm run build && npm start` against a preview env;
 *   reuses an existing server locally for fast iteration.
 * - Visual regression baselines live in `e2e/__snapshots__/` and tolerate
 *   up to 2% pixel diff to absorb GPU/font-rendering variance across
 *   dev machines and CI runners.
 */

const ALL_BROWSERS = process.env.ALL_BROWSERS === '1';
// `playwright test` runs EVERY defined project by default, so the headed
// manual explorer is only joined into the suite when explicitly requested.
const MANUAL_OPEN = process.env.PLAYWRIGHT_MANUAL === '1';

const suppliedBaseUrl = process.env.BASE_URL;
const managedServerUrl =
  process.env.PLAYWRIGHT_WEB_SERVER_URL || 'http://localhost:3000';

function requireLoopbackUrl(rawUrl: string, source: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${source} must be an absolute URL; received ${rawUrl}`);
  }

  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(
      `${source} must target localhost or 127.0.0.1. Refusing to configure ` +
        `test hooks for non-loopback host ${parsed.hostname}.`,
    );
  }
  return parsed;
}

let testHooksSecret: string;
let baseUrl: string;

if (suppliedBaseUrl) {
  baseUrl = requireLoopbackUrl(suppliedBaseUrl, 'BASE_URL').toString();
  testHooksSecret = process.env.TEST_HOOKS_SECRET ?? '';
  if (!testHooksSecret) {
    throw new Error(
      'BASE_URL was supplied for a local external server, but ' +
        'TEST_HOOKS_SECRET is missing. Refusing to run or send hook requests.',
    );
  }
} else {
  baseUrl = requireLoopbackUrl(
    managedServerUrl,
    'PLAYWRIGHT_WEB_SERVER_URL',
  ).toString();
  testHooksSecret =
    process.env.TEST_HOOKS_SECRET ?? randomBytes(32).toString('base64url');
  // Specs import the manifest after this config is evaluated, so the managed
  // server and every request helper receive this same per-run value.
  process.env.TEST_HOOKS_SECRET = testHooksSecret;
  process.env.ODESA_MANAGED_LOCAL_E2E = '1';
}
process.env.ODESA_E2E_BASE_URL = baseUrl;

// Non-automated spec dirs the browser projects must never sweep:
//  - manual/       headed open-dev explorer (env-gated manual-open project)
//  - preflight/    runs once as a project dependency (below), not per-browser
//  - legacy-mock/  quarantined mock-era specs (dir may not exist yet)
// Ignoring globs that match nothing is harmless.
const NON_AUTOMATED_DIRS = [
  '**/manual/**',
  '**/preflight/**',
  '**/legacy-mock/**',
];

// Preflight runs once before the browser projects (each depends on it via
// `dependencies: ['preflight']`), so shared setup does not multiply across
// the parallel browser sweep. It is the sole runner of e2e/preflight/* and
// therefore carries NO testIgnore and NO dependencies of its own.
const preflightProject = {
  name: 'preflight',
  testMatch: /e2e\/preflight\/.*\.spec\.ts/,
  use: { ...devices['Desktop Chrome'] },
};

const baseBrowserProjects = [
  {
    name: 'chromium',
    testIgnore: NON_AUTOMATED_DIRS,
    dependencies: ['preflight'],
    use: {
      ...devices['Desktop Chrome'],
      // Grant clipboard access so flows that call
      // `navigator.clipboard.writeText` (e.g. one-time API-key reveal) can
      // toggle their "Copied" affordance in headless runs.
      permissions: ['clipboard-read', 'clipboard-write'],
    },
  },
];

const extraBrowserProjects = [
  {
    name: 'firefox',
    testIgnore: NON_AUTOMATED_DIRS,
    dependencies: ['preflight'],
    use: { ...devices['Desktop Firefox'] },
  },
  {
    name: 'webkit',
    testIgnore: NON_AUTOMATED_DIRS,
    dependencies: ['preflight'],
    use: { ...devices['Desktop Safari'] },
  },
];

// Headed, authenticated explorer (e2e/manual/open-dev.spec.ts). Only spread
// into the projects array when PLAYWRIGHT_MANUAL=1 so the default automation
// run never launches it.
const manualOpenProject = {
  name: 'manual-open',
  testMatch: /e2e\/manual\/.*\.spec\.ts/,
  use: { ...devices['Desktop Chrome'] },
};

const browserProjects = ALL_BROWSERS
  ? [...baseBrowserProjects, ...extraBrowserProjects]
  : baseBrowserProjects;

export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__snapshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-results.xml' }],
    ['json', { outputFile: 'playwright-results.json' }],
    ['list'],
  ],
  use: {
    baseURL: baseUrl,
    extraHTTPHeaders: { 'x-test-hooks-secret': testHooksSecret },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  // preflight (once) + browser projects always; manual-open only when the
  // PLAYWRIGHT_MANUAL flag is set.
  projects: [
    preflightProject,
    ...browserProjects,
    ...(MANUAL_OPEN ? [manualOpenProject] : []),
  ],
  // Skip the managed webServer when the caller supplies a loopback BASE_URL
  // and an explicit matching secret. Remote hosts are rejected above so a
  // hook credential can never be attached to arbitrary network requests.
  // When BASE_URL is absent, spin up a local Next.js build+start.
  // Next.js 16 moved middleware compilation into the server process;
  // the startup can take >2 min on cold runners so we use 240 s and
  // allow reuse locally to skip the rebuild on repeated runs.
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command:
            process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ||
            'npm run build && npm start',
          url: managedServerUrl,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
          // The build+start server runs as NODE_ENV=production, which would
          // 404 the in-process messaging test-hooks endpoint. This explicit
          // opt-in re-enables it for the e2e suite only (merged over
          // process.env, so .env.local Supabase/Linq vars are preserved). A
          // real deploy never sets this flag, so production stays inert.
          env: {
            MESSAGING_TEST_HOOKS: '1',
            TEST_HOOKS_SECRET: testHooksSecret,
            // Deterministic Retell harness: the managed server and the
            // spec process MUST share one test secret. Explicit (not
            // inherit-only) so an env-loading change can never split
            // them again — the e2e 401s of 2026-07-09 were exactly that
            // drift on an externally started server.
            ...(process.env.RETELL_API_KEY
              ? { RETELL_API_KEY: process.env.RETELL_API_KEY }
              : {}),
          },
        },
      }),
});
