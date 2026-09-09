/**
 * One-time mirror of local Supabase → cloud Supabase.
 *
 * Pulls each critical table from LOCAL_URL/LOCAL_KEY and upserts (by id)
 * into CLOUD_URL/CLOUD_KEY. auth.users is bootstrapped via the admin API
 * since public.users has a FK to it.
 *
 * Idempotent: re-running is a no-op if data is already in sync (UPSERT).
 *
 * Usage:
 *   node scripts/mirror-local-to-cloud.mjs
 *
 * Reads:
 *   LOCAL  — process.env.LOCAL_URL / LOCAL_KEY (set explicitly)
 *   CLOUD  — process.env.CLOUD_URL / CLOUD_KEY (set explicitly)
 */

import { createClient } from '@supabase/supabase-js';

// Required before either client is created or any remote operation begins.
const GALAXY_SENDBLUE_E164 = process.env.GALAXY_SENDBLUE_E164;
if (!/^\+1[2-9]\d{9}$/.test(GALAXY_SENDBLUE_E164 ?? '') || /^\+1\d{3}55501\d{2}$/.test(GALAXY_SENDBLUE_E164)) {
  throw new Error('Set GALAXY_SENDBLUE_E164 to your provisioned US sender; fictional examples are not allowed.');
}

const LOCAL = createClient(process.env.LOCAL_URL, process.env.LOCAL_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const CLOUD = createClient(process.env.CLOUD_URL, process.env.CLOUD_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`LOCAL: ${process.env.LOCAL_URL}`);
console.log(`CLOUD: ${process.env.CLOUD_URL}`);

async function pull(table) {
  const { data, error } = await LOCAL.from(table).select('*');
  if (error) throw new Error(`pull ${table}: ${error.message}`);
  return data ?? [];
}

async function upsert(table, rows, opts = {}) {
  if (!rows.length) {
    console.log(`  ${table.padEnd(25)} 0 rows (skip)`);
    return;
  }
  const { error, count } = await CLOUD.from(table)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: false, ...opts });
  if (error) {
    console.log(`  ${table.padEnd(25)} ❌ ${error.code}: ${error.message}`);
    throw error;
  }
  console.log(`  ${table.padEnd(25)} ✓ ${rows.length} rows upserted`);
}

async function ensureAuthUsers(localUsers) {
  for (const u of localUsers) {
    const { data: existing } = await CLOUD.auth.admin.getUserById(u.id);
    if (existing?.user) {
      console.log(`  auth.users ${u.id.slice(0, 8)}…  exists, skip`);
      continue;
    }
    const { error } = await CLOUD.auth.admin.createUser({
      id: u.id,
      email: u.email ?? `${u.id}@odesa.app`,
      email_confirm: true,
      password: crypto.randomUUID().replace(/-/g, ''),
      user_metadata: { mirrored_from_local: true, local_phone_e164: u.phone_e164 ?? null },
    });
    if (error) {
      console.log(`  auth.users ${u.id.slice(0, 8)}…  ❌ ${error.message}`);
      throw error;
    }
    console.log(`  auth.users ${u.id.slice(0, 8)}…  ✓ created`);
  }
}

console.log('\n--- pulling local rows ---');
const orgs = await pull('organizations');
const users = await pull('users');
const props = await pull('properties');
const units = await pull('units');
const tenants = await pull('tenants');
const leases = await pull('leases');
const convs = await pull('conversations');
const chats = await pull('operator_chats');
const turns = await pull('operator_chat_turns');
const msgs = await pull('messages');
const facts = await pull('memory_facts');
const props2 = await pull('action_proposals');
const sched = await pull('scheduled_actions');
const phoneVerifs = await pull('phone_verifications');
console.log(
  `pulled: orgs=${orgs.length} users=${users.length} props=${props.length} ` +
  `units=${units.length} tenants=${tenants.length} leases=${leases.length} ` +
  `convs=${convs.length} chats=${chats.length} turns=${turns.length} ` +
  `msgs=${msgs.length} facts=${facts.length} proposals=${props2.length} ` +
  `sched=${sched.length} phoneVerifs=${phoneVerifs.length}`,
);

// Preserve the explicitly configured sender when replacing the local fixture.
// Never substitute a publication example number for a provisioned sender.
const GALAXY_ORG_ID = '11111111-1111-1111-1111-111111111101';
for (const o of orgs) {
  if (o.id === GALAXY_ORG_ID && o.odesa_phone_number === '+15715550101') {
    o.odesa_phone_number = GALAXY_SENDBLUE_E164;
    console.log('  organizations            ↳ Galaxy from-number preserved from explicit configuration');
  }
}

console.log('\n--- pushing to cloud (dependency order) ---');
await upsert('organizations', orgs);
await ensureAuthUsers(users);
await upsert('users', users);
await upsert('properties', props);
await upsert('units', units);
await upsert('tenants', tenants);
await upsert('leases', leases);
await upsert('conversations', convs);
await upsert('operator_chats', chats);
await upsert('messages', msgs);
await upsert('action_proposals', props2);
await upsert('memory_facts', facts);
await upsert('scheduled_actions', sched);
await upsert('phone_verifications', phoneVerifs);
await upsert('operator_chat_turns', turns);

console.log('\n✓ mirror complete.');
