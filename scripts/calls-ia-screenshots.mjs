/**
 * Standalone /calls IA-polish screenshot harness.
 *
 * Mirrors scripts/today-screenshot.mjs: mints a Galaxy owner via supabase-js
 * (service role), injects the @supabase/ssr auth cookie, then navigates to each
 * of the four Calls routes and captures a full-page screenshot. Tears the owner
 * down afterward. No external providers are contacted.
 *
 * Usage (local stack):
 *   BASE_URL=http://localhost:3100 node scripts/calls-ia-screenshots.mjs
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const COOKIE = `sb-${REF}-auth-token`;
const GALAXY_ORG_ID = '11111111-1111-1111-1111-111111111101';
const OUT_DIR = 'design/voice-operator-ia-polish-2026-07-07';

const admin = createClient(SUPABASE_URL, SVC, { auth: { persistSession: false } });

/** Encode a Supabase session the way @supabase/ssr stores it (base64- prefix). */
function encodeSession(session) {
  return 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64');
}

async function signInSession(email, password) {
  const cli = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signin: ${error.message}`);
  return data.session;
}

async function provisionGalaxyOwner() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `shot.calls.${stamp}.${rand}@calls.test`;
  const password = `shot-${rand}-secret`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_name: `Shot Org ${stamp}`, full_name: 'Shot Owner' },
  });
  if (error || !created.user) throw new Error(`create: ${error?.message}`);
  const userId = created.user.id;

  const { data: before } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  const stubOrg = before?.organization_id ?? null;

  const { error: upd } = await admin
    .from('users')
    .update({
      organization_id: GALAXY_ORG_ID,
      role: 'owner',
      display_name: 'Shot Owner',
      full_name: 'Shot Owner',
      email,
    })
    .eq('id', userId);
  if (upd) throw new Error(`repoint: ${upd.message}`);

  const teardown = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (stubOrg && stubOrg !== GALAXY_ORG_ID) {
      await admin.from('organizations').delete().eq('id', stubOrg).catch(() => {});
    }
  };
  return { email, password, teardown };
}

const ROUTES = [
  { route: '/calls', file: 'calls-overview.png', expand: null },
  { route: '/calls/settings', file: 'calls-settings.png', expand: null },
  // Expand the first script row so the locked-vs-editable split is visible.
  { route: '/calls/scripts', file: 'calls-scripts.png', expand: '[data-testid="call-script-row-maintenance_request"] button' },
  { route: '/calls/test', file: 'calls-test.png', expand: null },
];

async function shoot(context, spec) {
  const page = await context.newPage();
  const resp = await page.goto(`${BASE_URL}${spec.route}`, {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(900);
  if (spec.expand) {
    await page.locator(spec.expand).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const path = `${OUT_DIR}/${spec.file}`;
  await page.screenshot({ path, fullPage: true });
  const finalUrl = page.url();
  await page.close();
  return { route: spec.route, status: resp?.status(), finalUrl, path };
}

(async () => {
  const fs = await import('node:fs');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  let owner;
  try {
    owner = await provisionGalaxyOwner();
    const session = await signInSession(owner.email, owner.password);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies([
      {
        name: COOKIE,
        value: encodeSession(session),
        domain: new URL(BASE_URL).hostname,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    for (const spec of ROUTES) results.push(await shoot(context, spec));
    await context.close();
  } finally {
    if (owner) await owner.teardown().catch(() => {});
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
  const bad = results.filter((r) => r.status !== 200 || /\/login/.test(r.finalUrl));
  if (bad.length) {
    console.error('NON-200 or login-redirect:', JSON.stringify(bad));
    process.exit(1);
  }
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
