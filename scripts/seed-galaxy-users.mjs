/**
 * Idempotently provisions the standing Galaxy Estates test users that the
 * e2e contract expects to exist in the LOCAL database (see
 * e2e/fixtures/galaxy.ts): owner/manager/va @galaxy-estates.test, all wired
 * to the seeded Galaxy org. `supabase db reset` wipes auth users (seed.sql
 * seeds no auth rows), so run this after every reset:
 *
 *   npx supabase db reset && node scripts/seed-galaxy-users.mjs
 *
 * LOCAL ONLY: reads .env.production.local (local Supabase). Never point
 * this at the cloud project.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const GALAXY_ORG_ID = '11111111-1111-1111-1111-111111111101';

const USERS = [
  { email: 'owner@galaxy-estates.test', password: 'galaxy-test-owner-password', fullName: 'Galaxy Owner', role: 'owner' },
  { email: 'manager@galaxy-estates.test', password: 'galaxy-test-manager-password', fullName: 'Galaxy Manager', role: 'manager' },
  { email: 'va@galaxy-estates.test', password: 'galaxy-test-va-password', fullName: 'Galaxy VA', role: 'va' },
  // Interactive demo login (kept alongside the fixture users so one script
  // restores the whole standing local login set).
  { email: 'demo@galaxy.test', password: 'galaxy-demo-2026', fullName: 'Vaibhav (Demo Owner)', role: 'owner' },
];

const env = {};
for (const line of readFileSync(new URL('../.env.production.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

if (!env.SUPABASE_URL || !env.SUPABASE_URL.includes('127.0.0.1')) {
  console.error('Refusing to run: SUPABASE_URL is not the local instance.');
  process.exit(1);
}

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function ensureUser({ email, password, fullName, role }) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_name: `Bootstrap ${fullName}`, full_name: fullName },
  });

  if (error) {
    if (/already.*(registered|exists)/i.test(error.message)) {
      console.log(`ok (exists): ${email}`);
      return;
    }
    throw new Error(`createUser ${email}: ${error.message}`);
  }

  const uid = created.user.id;
  // The signup trigger minted a throwaway org; rewire to Galaxy and set the
  // fixture role. Service role legitimately bypasses the escalation guard.
  const { data: row } = await admin.from('users').select('organization_id').eq('id', uid).single();
  const { error: updErr } = await admin
    .from('users')
    .update({ organization_id: GALAXY_ORG_ID, role, full_name: fullName })
    .eq('id', uid);
  if (updErr) throw new Error(`rewire ${email}: ${updErr.message}`);
  if (row && row.organization_id !== GALAXY_ORG_ID) {
    await admin.from('organizations').delete().eq('id', row.organization_id);
  }
  console.log(`created: ${email} (${role})`);
}

for (const user of USERS) {
  // Retry: right after `db reset` the local auth service can take ~60s.
  let lastErr;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await ensureUser(user);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
  }
  if (lastErr) {
    console.error(String(lastErr));
    process.exit(1);
  }
}
console.log('Galaxy standing users ready.');
