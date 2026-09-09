import { createClient } from '@supabase/supabase-js';
const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const { data: u } = await s.from('users').select('organization_id').eq('email', 'wave2-demo@odesa.app').single();
const { data: ps } = await s
  .from('action_proposals')
  .select('id, action_type, worker_model, status, gate_decision, confidence, reasoning, created_at, payload')
  .eq('organization_id', u.organization_id)
  .order('created_at', { ascending: false })
  .limit(10);
console.log(`action_proposals for Wave 2 Demo (${ps?.length ?? 0}):`);
for (const p of ps ?? []) {
  console.log(`  [${p.created_at}] ${p.action_type} ${p.status}/${p.gate_decision} conf=${p.confidence} model=${p.worker_model}`);
  console.log(`    reasoning: ${(p.reasoning ?? '').slice(0, 120)}`);
  console.log(`    payload  : ${JSON.stringify(p.payload).slice(0, 200)}`);
}
