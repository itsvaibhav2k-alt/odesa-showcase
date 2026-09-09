/**
 * Preflight: test-hook endpoints must be fail-closed.
 *
 * Runs against the managed prod webServer (NODE_ENV=production), which sets
 * `MESSAGING_TEST_HOOKS=1` + `TEST_HOOKS_SECRET`. The positive path sends the
 * secret header explicitly (`TEST_HOOKS_HEADERS`), so it succeeds. The negative
 * path uses a BARE context that carries no secret, proving both endpoints 404
 * without (or with a wrong) secret — and that the agent route no longer opens
 * on `NODE_ENV` alone.
 *
 * Lives under `e2e/preflight/` so it runs as the `preflight` project. Leaves
 * the messaging mock uninstalled + state reset so it can't pollute later suites.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  TEST_HOOKS_HEADERS,
  TEST_HOOKS_SECRET,
} from '../fixtures/manifest';

const MESSAGING_HOOKS = '/api/messaging/test-hooks';
const AGENT_HOOKS = '/api/agent/test-hooks';

test.describe('preflight: test-hook fail-closed contract', () => {
  const managedLocalSuite = process.env.ODESA_MANAGED_LOCAL_E2E === '1';

  test('managed local suite has every required hook prerequisite', () => {
    test.skip(
      !managedLocalSuite,
      'manual/external discovery does not own server prerequisites',
    );
    const missing = [
      !HAVE_SUPABASE &&
        'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, and anon key',
      !TEST_HOOKS_SECRET && 'TEST_HOOKS_SECRET',
    ].filter(Boolean);
    expect(
      missing,
      `Managed local Playwright preflight is not configured: ${missing.join('; ')}`,
    ).toEqual([]);
  });

  test('valid secret succeeds: messaging GET + install/uninstall, agent GET parity', async ({
    request,
  }) => {
    test.skip(
      !HAVE_SUPABASE || !TEST_HOOKS_SECRET,
      'manual discovery requires explicit Supabase and hook configuration',
    );
    // GET with the explicit secret header → 200 success.
    const initial = await request.get(MESSAGING_HOOKS, {
      headers: TEST_HOOKS_HEADERS,
    });
    expect(initial.status()).toBe(200);
    expect((await initial.json()).success).toBe(true);

    // POST install → GET reflects installed:true.
    const install = await request.post(MESSAGING_HOOKS, {
      headers: TEST_HOOKS_HEADERS,
      data: { action: 'install', scripts: [] },
    });
    expect(install.status()).toBe(200);

    const afterInstall = await request.get(MESSAGING_HOOKS, {
      headers: TEST_HOOKS_HEADERS,
    });
    expect(afterInstall.status()).toBe(200);
    expect((await afterInstall.json()).data.installed).toBe(true);

    // Agent route must ALSO authorize on the secret (asymmetry fix + parity).
    const agent = await request.get(AGENT_HOOKS, {
      headers: TEST_HOOKS_HEADERS,
    });
    expect(agent.status()).toBe(200);
    expect((await agent.json()).success).toBe(true);

    // Leave clean: uninstall + reset the messaging mock.
    const uninstall = await request.post(MESSAGING_HOOKS, {
      headers: TEST_HOOKS_HEADERS,
      data: { action: 'uninstall' },
    });
    expect(uninstall.status()).toBe(200);
    const reset = await request.post(MESSAGING_HOOKS, {
      headers: TEST_HOOKS_HEADERS,
      data: { action: 'reset' },
    });
    expect(reset.status()).toBe(200);
  });

  // The negative cases MUST issue a truly header-less (or wrong-header)
  // request. Playwright's `request` fixture AND `playwright.request.newContext`
  // both inherit `use.extraHTTPHeaders` (the auto-sent secret) in this version,
  // so a "bare" Playwright context is not actually bare. Node's global `fetch`
  // sends exactly the headers we specify and nothing else — the unambiguous
  // way to prove the endpoints reject a missing/incorrect secret.
  const BASE = process.env.ODESA_E2E_BASE_URL || 'http://localhost:3000';

  test('missing secret rejected: both endpoints 404 without the header', async () => {
    const msg = await fetch(`${BASE}${MESSAGING_HOOKS}`);
    expect(msg.status).toBe(404);
    const agent = await fetch(`${BASE}${AGENT_HOOKS}`);
    expect(agent.status).toBe(404);
  });

  test('wrong secret rejected: both endpoints 404 with a bad header', async () => {
    const headers = { 'x-test-hooks-secret': 'nope' };
    const msg = await fetch(`${BASE}${MESSAGING_HOOKS}`, { headers });
    expect(msg.status).toBe(404);
    const agent = await fetch(`${BASE}${AGENT_HOOKS}`, { headers });
    expect(agent.status).toBe(404);
  });
});
