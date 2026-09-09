/**
 * Wire the user's actual phone to the onboarding-created tenant + lease
 * so the agent loop fires on the next inbound text. Also bump the
 * property's autonomy_level to 0.8 so the gate decides 'auto' for
 * high-confidence draft_sms_reply outputs.
 *
 *   node --env-file=.env.local scripts/wire-test-tenant.mjs +12025550101
 */

import { createClient } from '@supabase/supabase-js';

const phone = process.argv[2];
if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
  console.error('Usage: node scripts/wire-test-tenant.mjs <E.164 phone>');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const DEMO_EMAIL = 'wave2-demo@odesa.app';

const { data: u } = await supabase
  .from('users')
  .select('organization_id')
  .eq('email', DEMO_EMAIL)
  .single();
const orgId = u.organization_id;
console.log(`org id            : ${orgId}`);

// 1) Find the original tenant from onboarding (the one with a lease).
//    Prefer the one that has an active lease.
const { data: tens } = await supabase
  .from('tenants')
  .select('id, full_name, phone_e164, leases!inner(id, status)')
  .eq('organization_id', orgId)
  .eq('leases.status', 'active');

const realTenant = (tens ?? []).find(
  (t) => !t.full_name?.startsWith('Unknown'),
);
if (!realTenant) {
  console.error('No tenant with an active lease found. Finish onboarding first.');
  process.exit(1);
}
console.log(`tenant w/ lease   : ${realTenant.full_name} | ${realTenant.phone_e164} | id=${realTenant.id}`);

// 2) Find any auto-created "Unknown <phone>" tenant for THIS phone — we'll
//    reassign their conversation to the real tenant and delete them.
const { data: unknownTens } = await supabase
  .from('tenants')
  .select('id, full_name, phone_e164')
  .eq('organization_id', orgId)
  .eq('phone_e164', phone);

for (const t of unknownTens ?? []) {
  if (t.id === realTenant.id) continue;
  console.log(`reassigning conv from "Unknown" tenant ${t.id} → ${realTenant.id}`);
  await supabase
    .from('conversations')
    .update({ tenant_id: realTenant.id })
    .eq('tenant_id', t.id);
  await supabase.from('tenants').delete().eq('id', t.id);
}

// 3) Set the real tenant's phone to the user's actual phone.
const { error: updErr } = await supabase
  .from('tenants')
  .update({ phone_e164: phone })
  .eq('id', realTenant.id);
if (updErr) {
  console.error(`tenant phone update failed: ${updErr.message}`);
  process.exit(1);
}
console.log(`tenant phone      : ${phone} (was ${realTenant.phone_e164})`);

// 4) Find the property for this org and bump autonomy_level.
const { data: props } = await supabase
  .from('properties')
  .select('id, name, autonomy_level')
  .eq('organization_id', orgId);

for (const p of props ?? []) {
  const { error } = await supabase
    .from('properties')
    .update({ autonomy_level: 0.8 })
    .eq('id', p.id);
  if (error) {
    console.warn(`autonomy bump failed for ${p.name}: ${error.message}`);
  } else {
    console.log(`property "${p.name}": autonomy ${p.autonomy_level} → 0.80`);
  }
}

console.log('\nDone. Re-text the Sendblue number — agent loop will fire end-to-end.');
console.log('  - high confidence (≥0.85) → auto-sends without /inbox');
console.log('  - lower confidence       → draft appears in /inbox for approve/edit');
