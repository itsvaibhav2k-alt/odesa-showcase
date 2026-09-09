/**
 * Route sweep — loads every route in the manifest against the seeded
 * Galaxy org and asserts it renders without runtime errors. This is the
 * fast, comprehensive "does every page actually work?" gate: one spec,
 * data-driven from `ROUTE_MANIFEST`, authenticating once via storageState
 * so each route test gets a fresh authenticated page.
 *
 * Run: `npx playwright test e2e/route-sweep`
 * Strict demo-string enforcement (Phase 4): `SWEEP_ENFORCE_REAL=1 npx playwright test e2e/route-sweep`
 */

import { test, expect, type Page } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../properties/helpers';
import {
  PUBLIC_ROUTES,
  AUTHED_ROUTES,
  type RouteCase,
} from './manifest';
import {
  isBenignConsoleError,
  isIgnorableRequestFailure,
  findBannedStrings,
  ERROR_BOUNDARY_PATTERN,
} from './console-guard';

const STORAGE_STATE = 'test-results/route-sweep/galaxy-owner-storage.json';
const ENFORCE_REAL = process.env.SWEEP_ENFORCE_REAL === '1';

function slugify(path: string): string {
  return path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
}

interface Capture {
  consoleErrors: string[];
  requestFailures: string[];
  pageErrors: string[];
}

function attach(page: Page): Capture {
  const cap: Capture = { consoleErrors: [], requestFailures: [], pageErrors: [] };
  page.on('console', (m) => {
    if (m.type() === 'error' && !isBenignConsoleError(m.text())) {
      cap.consoleErrors.push(m.text());
    }
  });
  page.on('requestfailed', (r) => {
    const url = r.url();
    const errorText = r.failure()?.errorText ?? '';
    if (!isIgnorableRequestFailure(url, errorText)) {
      cap.requestFailures.push(`${r.method()} ${url} :: ${errorText}`);
    }
  });
  page.on('pageerror', (e) => cap.pageErrors.push(e.message));
  return cap;
}

/**
 * Screenshot after the page has settled. The evidence PNGs must show
 * resolved pages, not loading skeletons — so we capture only once the
 * root is visible (the caller does that wait) plus a bounded
 * network-idle buffer to absorb client-side data swaps (Financials
 * charts, property rooms) that land after hydration. The idle wait is
 * timeout-bounded and swallowed so realtime pages (persistent Supabase
 * sockets never go idle) can't hold the sweep hostage.
 */
async function captureScreenshot(page: Page, route: RouteCase): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  await page
    .screenshot({ path: `test-results/route-sweep/${slugify(route.path)}.png`, fullPage: true })
    .catch(() => {});
}

async function sweepRoute(page: Page, route: RouteCase): Promise<void> {
  const cap = attach(page);
  const resp = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
  const status = resp?.status() ?? 0;

  if (route.lenient) {
    // Access/status is environment-dependent (admin role, minted key, prod
    // build) — only guarantee the server didn't 500. No root-visibility
    // gate here (some lenient routes 404 by design), so the screenshot
    // rides on the bounded idle buffer alone.
    expect(status, `status for ${route.path}`).toBeLessThan(500);
    await captureScreenshot(page, route);
    return;
  }

  // 1. HTTP status is a real success.
  expect(status, `status for ${route.path}`).toBeLessThan(400);

  // 2. No Next.js error-boundary / not-found signature.
  await expect(
    page.getByText(ERROR_BOUNDARY_PATTERN),
    `error boundary on ${route.path}`,
  ).toHaveCount(0);

  // 3. Primary content rendered (not an empty shell).
  if (route.rootTestId) {
    await expect(
      page.getByTestId(route.rootTestId).first(),
      `root testid "${route.rootTestId}" on ${route.path}`,
    ).toBeVisible({ timeout: 30_000 });
  } else if (route.rootFallback) {
    await expect(
      page.locator(route.rootFallback).first(),
      `root fallback "${route.rootFallback}" on ${route.path}`,
    ).toBeVisible({ timeout: 30_000 });
  }

  // 3b. Capture AFTER the root-visibility gate + bounded idle buffer, so
  //     the screenshot shows a resolved page rather than a skeleton.
  await captureScreenshot(page, route);

  // 4. No uncaught console errors / request failures / page errors.
  expect(cap.consoleErrors, `console errors on ${route.path}`).toEqual([]);
  expect(cap.pageErrors, `page errors on ${route.path}`).toEqual([]);
  expect(cap.requestFailures, `request failures on ${route.path}`).toEqual([]);

  // 5. Demo-string leak — hard gate only under SWEEP_ENFORCE_REAL; otherwise
  //    annotate (the pre-wiring baseline legitimately shows mock strings).
  if (route.category === 'customer-data') {
    const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
    const banned = findBannedStrings(body);
    if (ENFORCE_REAL) {
      expect(banned, `demo strings leaked on ${route.path}`).toEqual([]);
    } else if (banned.length) {
      test.info().annotations.push({
        type: 'demo-strings',
        description: `${route.path}: ${banned.join(', ')}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public surface — runs without Supabase so CI always gets signal.
// ---------------------------------------------------------------------------

test.describe('route-sweep: public surface', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`route smoke: ${route.pattern}`, async ({ page }) => {
      await sweepRoute(page, route);
    });
  }
});

// ---------------------------------------------------------------------------
// Authenticated surface — provisions a Galaxy owner once, reuses storageState.
// ---------------------------------------------------------------------------

test.describe('route-sweep: authenticated surface', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );
  // 'default' (not 'serial'): provision once via beforeAll + reuse storageState,
  // run routes sequentially in one worker, but DON'T abort the rest when one
  // route fails — a sweep must report every route. Generous timeout absorbs
  // first-hit Turbopack compile of heavy pages in dev.
  test.describe.configure({ mode: 'default', timeout: 90_000 });
  test.use({ storageState: STORAGE_STATE });

  let owner: SeededOwner | undefined;

  test.beforeAll(async ({ browser }) => {
    if (!HAVE_SUPABASE) return;
    owner = await provisionGalaxyOwner();
    // Explicitly clear storageState: the describe-level `test.use({ storageState })`
    // would otherwise make this setup context try to read the file we haven't
    // written yet.
    const ctx = await browser.newContext({ storageState: undefined });
    const page = await ctx.newPage();
    await signIn(page, { email: owner.email, password: owner.password });
    await ctx.storageState({ path: STORAGE_STATE });
    await ctx.close();
  });

  test.afterAll(async () => {
    if (owner) await owner.teardown();
  });

  for (const route of AUTHED_ROUTES) {
    test(`route smoke: ${route.pattern}`, async ({ page }) => {
      await sweepRoute(page, route);
    });
  }
});
