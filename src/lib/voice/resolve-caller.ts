/**
 * Caller resolution — phone number → who is actually on the line.
 *
 * WHY this is its own module instead of extending resolveCallContext:
 *   - The 8 existing Retell tool routes (and their e2e contract) depend on
 *     resolveCallContext's exact behavior; the voice engine needs a richer
 *     answer (owner/tenant/vendor/ambiguous + linked ids + display name)
 *     without touching that shared path.
 *   - Disclosure policy keys off CallerKind: 'unknown_caller' and 'ambiguous'
 *     get ZERO private data. Resolution must therefore be deterministic and
 *     fail toward less trust — a phone matching more than one entity class is
 *     'ambiguous' (all ids nulled), and lookup misses never throw; only a
 *     to_number with no routed organization rejects (returns null).
 *
 * Lookups mirror existing repo paths exactly:
 *   - org:    organizations.odesa_phone_number == to_number (retell-auth.ts)
 *   - owner:  users role='owner' phone_e164 (messaging/notify.ts)
 *   - tenant: tenants (organization_id, phone_e164) + active-lease unit join
 *             (tools/lookup_tenant_by_phone/route.ts)
 *   - vendor: vendors (organization_id, phone_e164)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { CallerKind } from './types';

/** Resolved identity for a live call; feeds session init and disclosure policy. */
export interface ResolvedCaller {
  callerKind: CallerKind;
  organizationId: string;
  tenantId: string | null;
  vendorId: string | null;
  propertyId: string | null;
  unitId: string | null;
  displayName: string | null;
}

/**
 * Resolve who is calling `toNumber` from `fromNumber`.
 *
 * @param db - Service-role client (tool routes have no user session).
 * @param fromNumber - Caller's E.164 number.
 * @param toNumber - The org-routed Odesa number that was dialed.
 * @returns ResolvedCaller, or null when no organization routes `toNumber`.
 */
export async function resolveCaller(
  db: SupabaseClient<Database>,
  fromNumber: string,
  toNumber: string,
): Promise<ResolvedCaller | null> {
  const { data: org, error: orgErr } = await db
    .from('organizations')
    .select('id')
    .eq('odesa_phone_number', toNumber)
    .maybeSingle();
  if (orgErr || !org) return null;

  // Entity lookups are independent — run in parallel. Errors on any single
  // lookup are treated as "no match" (never throw on lookup misses).
  const [ownerRes, tenantRes, vendorRes] = await Promise.all([
    db
      .from('users')
      .select('id, display_name, full_name')
      .eq('organization_id', org.id)
      .eq('role', 'owner')
      .eq('phone_e164', fromNumber)
      .limit(1)
      .maybeSingle(),
    db
      .from('tenants')
      .select('id, full_name')
      .eq('organization_id', org.id)
      .eq('phone_e164', fromNumber)
      .limit(1)
      .maybeSingle(),
    db
      .from('vendors')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('phone_e164', fromNumber)
      .limit(1)
      .maybeSingle(),
  ]);

  const owner = ownerRes.data ?? null;
  const tenant = tenantRes.data ?? null;
  const vendor = vendorRes.data ?? null;

  const none: Omit<ResolvedCaller, 'callerKind'> = {
    organizationId: org.id,
    tenantId: null,
    vendorId: null,
    propertyId: null,
    unitId: null,
    displayName: null,
  };

  const matchCount = [owner, tenant, vendor].filter(Boolean).length;
  if (matchCount > 1) {
    // One phone, multiple identity classes — fail toward less trust.
    return { callerKind: 'ambiguous', ...none };
  }
  if (matchCount === 0) {
    return { callerKind: 'unknown_caller', ...none };
  }

  if (owner) {
    return {
      callerKind: 'verified_owner',
      ...none,
      displayName: owner.display_name ?? owner.full_name ?? null,
    };
  }

  if (vendor) {
    return {
      callerKind: 'known_vendor',
      ...none,
      vendorId: vendor.id,
      displayName: vendor.name,
    };
  }

  // Tenant: link unit/property via the active lease (mirror lookup_tenant_by_phone).
  let unitId: string | null = null;
  let propertyId: string | null = null;
  const { data: lease } = await db
    .from('leases')
    .select('id, unit_id')
    .eq('tenant_id', tenant!.id)
    .eq('status', 'active')
    .maybeSingle();
  if (lease) {
    unitId = lease.unit_id;
    const { data: unit } = await db
      .from('units')
      .select('property_id')
      .eq('id', lease.unit_id)
      .maybeSingle();
    propertyId = unit?.property_id ?? null;
  }

  return {
    callerKind: 'verified_tenant',
    ...none,
    tenantId: tenant!.id,
    unitId,
    propertyId,
    displayName: tenant!.full_name,
  };
}
