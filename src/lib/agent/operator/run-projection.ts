import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export const DURABLE_RUN_FAILURE_REPLY =
  "Odesa couldn't finish this request. No action is shown as completed—review this thread and Owner Queue before trying again.";

export interface RunTurnProjection {
  chat_id: string;
  organization_id: string;
  turn_id: string;
}

/**
 * Replace the single customer-visible assistant projection for a durable run,
 * or insert it when the provider failed before producing assistant text.
 * Tool/model rows remain immutable audit evidence.
 */
export async function persistCanonicalAssistantTurn(
  db: SupabaseClient<Database>,
  run: RunTurnProjection,
  body: string,
): Promise<void> {
  const { data: existing, error: updateError } = await db
    .from('operator_chat_turns')
    .update({ body })
    .eq('chat_id', run.chat_id)
    .eq('organization_id', run.organization_id)
    .eq('turn_id', run.turn_id)
    .eq('role', 'assistant_text')
    .select('id')
    .maybeSingle();
  if (updateError) {
    throw new Error(
      `durable-run: canonical assistant update failed: ${updateError.message}`,
    );
  }
  if (existing) return;

  const { error: insertError } = await db.from('operator_chat_turns').insert({
    chat_id: run.chat_id,
    organization_id: run.organization_id,
    turn_id: run.turn_id,
    role: 'assistant_text',
    body,
  });
  if (insertError) {
    throw new Error(
      `durable-run: canonical assistant insert failed: ${insertError.message}`,
    );
  }
}
