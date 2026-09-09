/**
 * One-shot operations script:
 *   1. Verify the Wave 2 Demo Estates org + its onboarding-added property
 *      are still intact in cloud Supabase.
 *   2. Free Galaxy Estates' assigned Sendblue number — set the pool row
 *      back to status='available', clear `assigned_to_organization_id`,
 *      and null out Galaxy's `odesa_phone_number` so Wave 2 Demo can
 *      claim the number from /onboarding/messaging.
 *
 * Uses the service-role admin client (RLS bypassed). Loads env from
 * .env.local. Idempotent — safe to re-run.
 *
 *   node --env-file=.env.local scripts/transfer-sendblue-number.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_EMAIL = 'wave2-demo@odesa.app';
const GALAXY_NAME = 'Galaxy Estates';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) Verify Wave 2 Demo org + its property are intact.
// ---------------------------------------------------------------------------

console.log('--- Wave 2 Demo Estates: integrity check ---');

const { data: demoUserRow, error: demoUserErr } = await supabase
  .from('users')
  .select('id, organization_id, email')
  .eq('email', DEMO_EMAIL)
  .single();
if (demoUserErr || !demoUserRow) {
  fail(`Could not find user ${DEMO_EMAIL}: ${demoUserErr?.message ?? 'no row'}`);
}
console.log(`user id           : ${demoUserRow.id}`);
console.log(`organization_id   : ${demoUserRow.organization_id}`);

const { data: demoOrg, error: demoOrgErr } = await supabase
  .from('organizations')
  .select('id, name, odesa_phone_number, messaging_primary, plan, timezone')
  .eq('id', demoUserRow.organization_id)
  .single();
if (demoOrgErr || !demoOrg) {
  fail(`Could not load Wave 2 Demo org: ${demoOrgErr?.message ?? 'no row'}`);
}
console.log(`org name          : ${demoOrg.name}`);
console.log(`odesa_phone_number: ${demoOrg.odesa_phone_number ?? '(none)'}`);

const { data: demoProps, error: demoPropsErr } = await supabase
  .from('properties')
  .select('id, name, address_street, address_city, address_state, address_zip, timezone')
  .eq('organization_id', demoOrg.id);
if (demoPropsErr) fail(`properties query: ${demoPropsErr.message}`);
console.log(`properties        : ${demoProps?.length ?? 0}`);
for (const p of demoProps ?? []) {
  console.log(
    `  - ${p.name} | ${p.address_street}, ${p.address_city}, ${p.address_state} ${p.address_zip} ` +
      `(${p.timezone}) [id=${p.id}]`,
  );
}
if (!demoProps || demoProps.length === 0) {
  console.warn('  (no properties found — onboarding may have been incomplete)');
}

// ---------------------------------------------------------------------------
// 2) Look up Galaxy + its assigned number.
// ---------------------------------------------------------------------------

console.log('\n--- Galaxy Estates: locate assigned number ---');

const { data: galaxy, error: galaxyErr } = await supabase
  .from('organizations')
  .select('id, name, odesa_phone_number, messaging_primary')
  .eq('name', GALAXY_NAME)
  .maybeSingle();
if (galaxyErr) fail(`Galaxy lookup: ${galaxyErr.message}`);
if (!galaxy) {
  console.warn(`No org named "${GALAXY_NAME}". Looking for any assigned number to free instead...`);
}
const galaxyId = galaxy?.id ?? null;
const galaxyNumber = galaxy?.odesa_phone_number ?? null;
console.log(`galaxy org id     : ${galaxyId ?? '(none)'}`);
console.log(`galaxy phone      : ${galaxyNumber ?? '(none)'}`);

// Also see what's in the pool — useful diagnostic.
const { data: poolRows, error: poolErr } = await supabase
  .from('sendblue_number_pool')
  .select('e164, status, assigned_to_organization_id, assigned_at');
if (poolErr) fail(`pool list: ${poolErr.message}`);
console.log(`\npool snapshot     : ${poolRows?.length ?? 0} rows`);
for (const r of poolRows ?? []) {
  console.log(
    `  - ${r.e164} status=${r.status} ` +
      `assigned_to=${r.assigned_to_organization_id ?? '(none)'}`,
  );
}

// ---------------------------------------------------------------------------
// 3) Free the number.
// ---------------------------------------------------------------------------

// We always free the actual assigned pool row — Galaxy's
// odesa_phone_number was a seeded fake (+15715550101) and not
// represented in sendblue_number_pool, so freeing it doesn't
// help the pool. The real pool row may be claimed by a different
// (older test) org; free that.
const assignedRow = (poolRows ?? []).find((r) => r.status === 'assigned');
if (!assignedRow) {
  fail('No pool row is currently assigned. Add numbers via seed-sendblue-number-pool.ts.');
}
const targetE164 = assignedRow.e164;
console.log(`\nReal pool target  : ${targetE164} (currently assigned to ` +
  `${assignedRow.assigned_to_organization_id})`);

// Identify which org currently holds this pool row so we can clear
// odesa_phone_number on that org too.
if (assignedRow.assigned_to_organization_id) {
  const { data: holderOrg } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', assignedRow.assigned_to_organization_id)
    .maybeSingle();
  if (holderOrg) {
    console.log(`current holder    : ${holderOrg.name} (id=${holderOrg.id})`);
  }
}

console.log(`\n--- Freeing ${targetE164} ---`);

// 3a) Pool row back to available.
const { data: pollFlip, error: poolFlipErr } = await supabase
  .from('sendblue_number_pool')
  .update({
    status: 'available',
    assigned_to_organization_id: null,
    assigned_at: null,
  })
  .eq('e164', targetE164)
  .select('e164, status');
if (poolFlipErr) fail(`pool flip: ${poolFlipErr.message}`);
console.log(`pool row → ${pollFlip?.[0]?.status ?? '(no rows updated)'}`);

// 3b) Clear odesa_phone_number on whichever org currently holds it.
const { data: clearedOrgs, error: clearOrgErr } = await supabase
  .from('organizations')
  .update({ odesa_phone_number: null })
  .eq('odesa_phone_number', targetE164)
  .select('id, name');
if (clearOrgErr) fail(`org clear: ${clearOrgErr.message}`);
console.log(`orgs cleared      : ${clearedOrgs?.length ?? 0}`);
for (const o of clearedOrgs ?? []) {
  console.log(`  - ${o.name} (id=${o.id}) → odesa_phone_number=NULL`);
}

console.log('\nDone. You can now claim the number from /onboarding/messaging.');
