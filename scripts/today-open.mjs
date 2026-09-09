/**
 * Open the redesigned /today in a VISIBLE browser, already authenticated.
 *
 * The /login route is WIP-broken on the dev server, so this mints a Supabase
 * session via supabase-js, injects the @supabase/ssr auth cookie, and opens a
 * headed browser straight on /today (seeded Galaxy org). The window stays open
 * until you Ctrl-C this process; the temp user is torn down on exit.
 *
 * Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local scripts/today-open.mjs
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

const admin = createClient(SUPABASE_URL, SVC, { auth: { persistSession: false } });

function encodeSession(session) {
  return 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64');
}

async function provisionGalaxy() {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `view.galaxy.${stamp}.${rand}@today.test`;
  const password = `view-${rand}-secret`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { organization_name: `View Org ${stamp}`, full_name: 'Viewer' },
  });
  if (error || !created.user) throw new Error(`create: ${error?.message}`);
  const userId = created.user.id;
  const { data: before } = await admin.from('users').select('organization_id').eq('id', userId).single();
  const stubOrg = before?.organization_id ?? null;
  const { error: upd } = await admin.from('users')
    .update({ organization_id: GALAXY_ORG_ID, role: 'owner', display_name: 'Viewer', full_name: 'Viewer', email })
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

async function signIn(email, password) {
  const cli = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signin: ${error.message}`);
  return data.session;
}

(async () => {
  const owner = await provisionGalaxy();
  const session = await signIn(owner.email, owner.password);

  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel: 'chrome' });
  } catch {
    browser = await chromium.launch({ headless: false });
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{
    name: COOKIE, value: encodeSession(session),
    domain: new URL(BASE_URL).hostname, path: '/', httpOnly: true, sameSite: 'Lax',
  }]);
  const page = await context.newPage();
  const resp = await page.goto(`${BASE_URL}/today`, { waitUntil: 'networkidle', timeout: 30000 });
  console.log(`[today-open] opened ${page.url()} (HTTP ${resp?.status()}) as ${owner.email}`);
  console.log('[today-open] window is open — Ctrl-C here to close + clean up the temp user.');

  const cleanup = async () => {
    console.log('\n[today-open] tearing down…');
    await browser.close().catch(() => {});
    await owner.teardown();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  // Also clean up if the user just closes the browser window.
  browser.on('disconnected', async () => { await owner.teardown(); process.exit(0); });
  await new Promise(() => {}); // keep alive
})().catch((e) => { console.error('[today-open] failed:', e.message); process.exit(1); });
