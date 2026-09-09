/**
 * Inbox debug — checks what state Wave 2 Demo Estates is in after
 * a manual iMessage test. Prints:
 *   - The org's currently-assigned odesa_phone_number
 *   - The most recent N messages (inbound + outbound) for the org
 *   - The most recent N conversations
 *   - The most recent N tenants
 *
 * If the inbound webhook fired, you'll see new rows here. If it
 * didn't, the table will be empty — meaning Sendblue never reached
 * the app (webhook URL config or ngrok tunnel issue).
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_EMAIL = 'wave2-demo@odesa.app';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: u } = await supabase
  .from('users')
  .select('organization_id')
  .eq('email', DEMO_EMAIL)
  .single();
const orgId = u.organization_id;

const { data: org } = await supabase
  .from('organizations')
  .select('id, name, odesa_phone_number, messaging_primary, assistant_name')
  .eq('id', orgId)
  .single();
console.log('--- Org state ---');
console.log(`name              : ${org.name}`);
console.log(`odesa_phone_number: ${org.odesa_phone_number ?? '(NOT ASSIGNED)'}`);
console.log(`messaging_primary : ${org.messaging_primary ?? '(none)'}`);
console.log(`assistant_name    : ${org.assistant_name ?? '(none)'}`);

const { data: pool } = await supabase
  .from('sendblue_number_pool')
  .select('e164, status, assigned_to_organization_id, assigned_at');
console.log('\n--- Pool ---');
for (const r of pool ?? []) {
  console.log(`  ${r.e164} status=${r.status} assigned=${r.assigned_to_organization_id ?? '-'}`);
}

const { data: convs } = await supabase
  .from('conversations')
  .select('id, channel, status, last_message_at, tenant_id, created_at')
  .eq('organization_id', orgId)
  .order('created_at', { ascending: false })
  .limit(5);
console.log(`\n--- Conversations for ${org.name} (${convs?.length ?? 0}) ---`);
for (const c of convs ?? []) {
  console.log(`  [${c.created_at}] ${c.channel} status=${c.status} tenant=${c.tenant_id ?? '-'} id=${c.id}`);
}

const { data: msgs } = await supabase
  .from('messages')
  .select('id, direction, draft_status, body, provider, sent_at, created_at, conversation_id')
  .eq('organization_id', orgId)
  .order('created_at', { ascending: false })
  .limit(10);
console.log(`\n--- Messages for ${org.name} (${msgs?.length ?? 0}) ---`);
for (const m of msgs ?? []) {
  const preview = (m.body ?? '').slice(0, 60).replace(/\n/g, ' ');
  console.log(
    `  [${m.created_at}] ${m.direction} ${m.draft_status} provider=${m.provider} ` +
      `sent_at=${m.sent_at ?? '-'} | "${preview}${(m.body?.length ?? 0) > 60 ? '...' : ''}"`,
  );
}

const { data: tens } = await supabase
  .from('tenants')
  .select('id, full_name, phone_e164, created_at')
  .eq('organization_id', orgId)
  .order('created_at', { ascending: false })
  .limit(5);
console.log(`\n--- Tenants for ${org.name} (${tens?.length ?? 0}) ---`);
for (const t of tens ?? []) {
  console.log(`  [${t.created_at}] ${t.full_name} | ${t.phone_e164}`);
}
