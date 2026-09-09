/**
 * resolveTenantProperty — pure helper that resolves the property + org
 * a tenant belongs to via their active lease.
 *
 * Join path: `tenants -> leases (status='active') -> units.property_id`.
 * A tenant with multiple active leases (rare; happens when a guarantor
 * signs across two units) returns the most-recently-started lease.
 *
 * Returns `null` when the tenant has no active lease — the caller
 * (e.g., claude-draft worker wrap) should fall back to the deterministic
 * path rather than refuse to draft a reply.
 *
 * v1.5: written fresh because no existing helper joins through leases.
 * Lives in `messaging/` because the first caller is the inbound SMS
 * worker; voice tools already have propertyId from the Retell payload.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

type AdminClient = SupabaseClient<Database>;

export interface ResolvedTenantProperty {
  propertyId: string;
  organizationId: string;
  leaseId: string;
  unitId: string;
}

export async function resolveTenantProperty(
  admin: AdminClient,
  tenantId: string,
): Promise<ResolvedTenantProperty | null> {
  const { data: lease } = await admin
    .from('leases')
    .select('id, organization_id, unit_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('start_date', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (!lease) return null;

  const { data: unit } = await admin
    .from('units')
    .select('property_id')
    .eq('id', lease.unit_id)
    .maybeSingle();

  if (!unit?.property_id) return null;

  return {
    propertyId: unit.property_id,
    organizationId: lease.organization_id,
    leaseId: lease.id,
    unitId: lease.unit_id,
  };
}
