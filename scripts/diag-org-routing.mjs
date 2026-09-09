import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

console.log('CLOUD URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

const { data: orgs, error } = await supabase
  .from('organizations')
  .select('id, name, odesa_phone_number')
  .limit(10);

if (error) { console.log('ERR:', error); process.exit(1); }

console.log(`\norganizations (up to 10):`);
for (const o of orgs ?? []) {
  console.log(`  ${o.id}  name="${o.name}"  phone=${o.odesa_phone_number ?? 'NULL'}  autonomy=${o.autonomy_level}`);
}

const { data: users } = await supabase
  .from('users')
  .select('id, email, phone_e164, phone_verified_at, organization_id')
  .not('phone_verified_at', 'is', null)
  .limit(10);

console.log(`\nverified-phone users (up to 10):`);
for (const u of users ?? []) {
  console.log(`  ${u.id.slice(0, 8)}…  email=${u.email}  phone=${u.phone_e164}  verified=${u.phone_verified_at}  org=${u.organization_id?.slice(0, 8) ?? 'null'}…`);
}

const { data: convs } = await supabase
  .from('conversations')
  .select('id, organization_id, tenant_id, last_message_at')
  .order('last_message_at', { ascending: false, nullsLast: true })
  .limit(5);

console.log(`\nconversations (top 5 by last_message_at):`);
for (const c of convs ?? []) {
  console.log(`  ${c.id.slice(0, 8)}…  org=${c.organization_id?.slice(0, 8)}…  last=${c.last_message_at}`);
}
