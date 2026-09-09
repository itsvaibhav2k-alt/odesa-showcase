/**
 * Compose-to-tenant helpers — owner-initiated conversations.
 *
 * Two responsibilities backing the "Message" / "Compose" affordances:
 *
 *   - `findOrCreateOpenConversation` → resolve the tenant's existing
 *     OPEN sms conversation, or create one. Mirrors the inbound
 *     pipeline's resolver in `messaging/handle-inbound.ts` (same
 *     ordering + insert shape) so owner-initiated threads land in the
 *     exact place an inbound text would.
 *
 *   - `listComposeTenants` → RLS-scoped tenant options for the compose
 *     modal's recipient select. Only tenants with a `phone_e164` are
 *     listed — a tenant we cannot text is not a valid recipient.
 *
 * The actual send is NOT here: `composeToTenantAction` (in
 * `app/(dashboard)/inbox/compose-actions.ts`) resolves the conversation
 * via this module, then delegates to `sendOwnerMessageAction`, whose
 * insert-before-send machinery is reused untouched.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { createServerClient } from '@/lib/supabase/server';

type AdminClient = SupabaseClient<Database>;

/** One recipient option for the compose modal's tenant select. */
export interface ComposeTenantOption {
  id: string;
  name: string;
}

/**
 * Find the tenant's most recent OPEN sms conversation in the org, or
 * create one. Mirrors `findOrCreateOpenConversation` in
 * `messaging/handle-inbound.ts` so owner-initiated and tenant-initiated
 * threads converge on the same row.
 *
 * @returns `{ id, created }` — `created` is true when a new row was
 *   inserted — or `null` when both the lookup and the insert failed.
 */
export async function findOrCreateOpenConversation(
  admin: AdminClient,
  organizationId: string,
  tenantId: string,
): Promise<{ id: string; created: boolean } | null> {
  const { data: open } = await admin
    .from('conversations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('tenant_id', tenantId)
    .eq('channel', 'sms')
    .eq('status', 'open')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (open) return { id: open.id, created: false };

  const { data: created, error } = await admin
    .from('conversations')
    .insert({
      organization_id: organizationId,
      tenant_id: tenantId,
      channel: 'sms',
      status: 'open',
    })
    .select('id')
    .single();
  if (error || !created) return null;
  return { id: created.id, created: true };
}

/**
 * Tenant options for the compose modal, scoped to the caller's org via
 * the SSR (RLS-bound) client. Tenants without a `phone_e164` are
 * excluded — there is no channel to reach them on.
 */
export async function listComposeTenants(): Promise<ComposeTenantOption[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('tenants')
    .select('id, full_name, phone_e164')
    .not('phone_e164', 'is', null)
    .order('full_name', { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name ?? 'Unknown tenant',
  }));
}
