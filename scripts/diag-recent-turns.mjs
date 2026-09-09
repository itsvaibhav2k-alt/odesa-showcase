import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

const since = new Date(Date.now() - 30 * 60_000).toISOString();

const { data: turns, error: e1 } = await supabase
  .from('operator_chat_turns')
  .select('id, chat_id, role, tool_name, body, created_at')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(20);

if (e1) {
  console.log('turns query failed:', e1);
  process.exit(1);
}

console.log(`\noperator_chat_turns (last 30 min) — ${turns?.length ?? 0} rows:`);
for (const t of turns ?? []) {
  const preview = (t.body ?? '').slice(0, 120).replace(/\n/g, ' ');
  console.log(`  ${t.created_at} ${t.role.padEnd(15)} ${(t.tool_name ?? '').padEnd(25)} ${preview}`);
}

const { data: msgs } = await supabase
  .from('messages')
  .select('id, conversation_id, direction, body, draft_status, sent_at, created_at')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(10);

console.log(`\nmessages (last 30 min) — ${msgs?.length ?? 0} rows:`);
for (const m of msgs ?? []) {
  const preview = (m.body ?? '').slice(0, 100).replace(/\n/g, ' ');
  console.log(`  ${m.created_at} ${m.direction.padEnd(8)} ${(m.draft_status ?? '').padEnd(15)} ${preview}`);
}

const { data: props } = await supabase
  .from('action_proposals')
  .select('id, action_type, status, gate_decision, confidence, created_at, committed_at')
  .gte('created_at', since)
  .order('created_at', { ascending: false })
  .limit(10);

console.log(`\naction_proposals (last 30 min) — ${props?.length ?? 0} rows:`);
for (const p of props ?? []) {
  console.log(`  ${p.created_at} ${p.action_type.padEnd(25)} status=${p.status} gate=${p.gate_decision} conf=${p.confidence}`);
}
