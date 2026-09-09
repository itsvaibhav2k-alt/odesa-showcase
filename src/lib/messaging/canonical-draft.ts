import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

/**
 * Voice tooling writes a message evidence row (`…:message`) and, when the
 * property is known, the canonical Owner Queue proposal (`…:proposal`). This
 * helper prevents the evidence row from becoming a second approval ledger.
 */
export function proposalArtifactKeyForMessage(
  messageArtifactKey: string | null,
): string | null {
  if (!messageArtifactKey?.endsWith(':message')) return null;
  return `${messageArtifactKey.slice(0, -':message'.length)}:proposal`;
}

export type CanonicalProposalLookup =
  | { ok: true; linked: boolean }
  | { ok: false };

export async function lookupCanonicalProposalForMessage(
  db: SupabaseClient<Database>,
  messageArtifactKey: string | null,
  organizationId: string,
): Promise<CanonicalProposalLookup> {
  const proposalKey = proposalArtifactKeyForMessage(messageArtifactKey);
  if (!proposalKey) return { ok: true, linked: false };
  const { data, error } = await db
    .from('action_proposals')
    .select('id')
    .eq('retell_artifact_key', proposalKey)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, linked: Boolean(data) };
}
