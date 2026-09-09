/**
 * Marks any action_proposals stuck in status='proposed' /
 * gate_decision='review' as committed (without firing Sendblue).
 *
 * Use case: after lowering a gate threshold, proposals frozen under
 * the old policy don't auto-flip. This script clears the queue without
 * triggering an actual SMS — the owner intends to handle the reply
 * manually (text the tenant from their phone) and just wants the
 * proposal record reconciled.
 *
 * Does NOT touch the linked messages row (the auto-drafted SMS in
 * pending_review). Owner can still Approve & Send / Reject / Edit
 * from /inbox if they want to use the AI's draft.
 */

import { createClient } from '@supabase/supabase-js';

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

const { data: stuck } = await supabase
  .from('action_proposals')
  .select('id, action_type, status, gate_decision, confidence')
  .eq('organization_id', u.organization_id)
  .eq('status', 'proposed')
  .eq('gate_decision', 'review');

console.log(`stuck proposals: ${stuck?.length ?? 0}`);

for (const p of stuck ?? []) {
  console.log(`  flipping ${p.id} (${p.action_type}, conf=${p.confidence}) → committed (no SMS send)`);
  const { error } = await supabase
    .from('action_proposals')
    .update({
      status: 'committed',
      gate_decision: 'auto',
      committed_at: new Date().toISOString(),
      outcome: { committed_via: 'owner_manual_reconcile', sent: false },
    })
    .eq('id', p.id);
  if (error) console.error(`    update failed: ${error.message}`);
}

console.log('done. messages drafts left as pending_review for owner-side action via /inbox.');
