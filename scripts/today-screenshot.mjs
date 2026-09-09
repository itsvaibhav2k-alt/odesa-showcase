/**
 * Standalone Today screenshot harness (Wave 7 QA).
 *
 * Bypasses the (currently WIP-broken) /login route by minting a Supabase
 * session via supabase-js and injecting the @supabase/ssr auth cookie
 * directly, then navigating straight to /today. Captures the seeded
 * Galaxy state and the empty-org state.
 *
 * Usage: BASE_URL=http://localhost:3100 node scripts/today-screenshot.mjs
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
const OUT_DIR = '/tmp/odesa_refs';

const admin = createClient(SUPABASE_URL, SVC, { auth: { persistSession: false } });

/** Encode a Supabase session the way @supabase/ssr stores it (base64- prefix). */
function encodeSession(session) {
  const json = JSON.stringify(session);
  return 'base64-' + Buffer.from(json).toString('base64');
}

async function signInSession(email, password) {
  const cli = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signin: ${error.message}`);
  return data.session;
}

async function provision({ galaxy }) {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `${galaxy ? 'shot.galaxy' : 'shot.fresh'}.${stamp}.${rand}@today.test`;
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
    .from('users').select('organization_id').eq('id', userId).single();
  const stubOrg = before?.organization_id ?? null;
  let orgId = stubOrg;

  if (galaxy) {
    const { error: upd } = await admin
      .from('users')
      .update({ organization_id: GALAXY_ORG_ID, role: 'owner', display_name: 'Shot Owner', full_name: 'Shot Owner', email })
      .eq('id', userId);
    if (upd) throw new Error(`repoint: ${upd.message}`);
    orgId = GALAXY_ORG_ID;
  } else if (orgId) {
    // Fresh org: seed one bare property so the onboarding guard passes
    // and /today renders its empty state.
    await admin.from('properties').insert({ organization_id: orgId, name: 'Empty Property' });
  }

  const teardown = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (stubOrg && stubOrg !== GALAXY_ORG_ID) {
      await admin.from('properties').delete().eq('organization_id', stubOrg).catch(() => {});
      await admin.from('organizations').delete().eq('id', stubOrg).catch(() => {});
    }
  };
  return { email, password, orgId, teardown };
}

async function shoot(context, label) {
  const page = await context.newPage();
  const resp = await page.goto(`${BASE_URL}/today`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200); // let count-up + tab content settle
  const url = page.url();
  const path = `${OUT_DIR}/today-redesigned${label}.png`;
  await page.fullScreenshot?.();
  await page.screenshot({ path, fullPage: true });
  const hasGrid = await page.locator('[data-testid="today-two-col-grid"]').count();
  const hasBriefing = await page.locator('[data-testid="today-briefing-sentence"]').count();
  const briefingText = hasBriefing
    ? (await page.locator('[data-testid="today-briefing-sentence"]').first().textContent())?.trim()
    : null;
  await page.close();
  return { label, status: resp?.status(), finalUrl: url, hasGrid, briefingText, path };
}

(async () => {
  const fs = await import('node:fs');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  const tornDown = [];
  try {
    for (const variant of [{ galaxy: true, label: '' }, { galaxy: false, label: '-empty' }]) {
      const owner = await provision(variant);
      tornDown.push(owner.teardown);
      const session = await signInSession(owner.email, owner.password);
      const context = await browser.newContext();
      const domain = new URL(BASE_URL).hostname;
      await context.addCookies([{
        name: COOKIE,
        value: encodeSession(session),
        domain,
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      }]);
      results.push(await shoot(context, variant.label));
      await context.close();
    }
  } finally {
    for (const t of tornDown) await t().catch(() => {});
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
