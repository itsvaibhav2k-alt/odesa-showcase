/**
 * Wave 7 — handler for `update_tenant_preference`.
 *
 * Resolves the tenantRef and UPDATEs only the preference columns
 * supplied in the payload. The handler never clobbers unspecified
 * columns — passing `{ tenantRef, preferredChannel: 'email' }` should
 * leave language, parking_space, pets, etc. untouched.
 *
 * The `pets` payload field is an array of
 *   `{type, name?, depositPaid?}`
 * stored verbatim in `tenants.pets_jsonb`. Empty array clears the
 * stored list; omitting the key leaves the stored list alone.
 *
 * Source override: when the payload sets `source === 'owner'`, the
 * stored `preferences_confidence` is bumped to 1.0 to mark the row as
 * owner-confirmed.
 *
 * Confidence (return value):
 *   - 1.0 when the tenant resolves by UUID.
 *   - 0.8 when by name (single match).
 *   - 0.2 with `error: 'ambiguous_tenant'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveTenant } from '../resolve-refs';
import type { UpdateTenantPreferencePayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

const DEFAULT_CONFIDENCE = 0.7;
const DEFAULT_SOURCE = 'agent';

type TenantUpdate = Database['public']['Tables']['tenants']['Update'];

export async function handleUpdateTenantPreference(
  args: HandlerArgs<UpdateTenantPreferencePayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const resolved = await resolveTenantRef(admin, organizationId, payload);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.reason === 'ambiguous'
        ? 'ambiguous_tenant'
        : 'tenant_not_found',
      confidence: resolved.reason === 'ambiguous' ? 0.2 : 0,
    };
  }

  const tenantId = resolved.id;
  const refByUuid = resolved.byId;

  const updates: TenantUpdate = {};
  if (payload.preferredChannel !== undefined) {
    updates.preferred_channel = payload.preferredChannel;
  }
  if (payload.language !== undefined) {
    updates.language = payload.language;
  }
  if (payload.emergencyContactName !== undefined) {
    updates.emergency_contact_name = payload.emergencyContactName;
  }
  if (payload.emergencyContactPhone !== undefined) {
    updates.emergency_contact_phone = payload.emergencyContactPhone;
  }
  if (payload.parkingSpace !== undefined) {
    updates.parking_space = payload.parkingSpace;
  }
  if (payload.pets !== undefined) {
    // Persist the array verbatim; supabase-js JSON-encodes objects in
    // jsonb columns. Map to snake_case for DB conventions.
    updates.pets_jsonb = payload.pets.map((p) => ({
      type: p.type,
      name: p.name ?? null,
      deposit_paid: p.depositPaid ?? false,
    })) as Database['public']['Tables']['tenants']['Update']['pets_jsonb'];
  }

  // Only stamp source / confidence when ANY preference field was
  // supplied — otherwise the call is a no-op and we shouldn't bump
  // metadata for a phantom write.
  const hasPrefUpdates = Object.keys(updates).length > 0;

  if (hasPrefUpdates) {
    updates.preferences_source = payload.source ?? DEFAULT_SOURCE;
    updates.preferences_confidence =
      payload.source === 'owner'
        ? 1.0
        : payload.confidence ?? DEFAULT_CONFIDENCE;
  } else {
    // Nothing to update — read-back current row and return idempotent.
    const { data: current, error: readError } = await admin
      .from('tenants')
      .select('id, full_name, preferred_channel, language, emergency_contact_name, emergency_contact_phone, parking_space, pets_jsonb, preferences_confidence, preferences_source')
      .eq('organization_id', organizationId)
      .eq('id', tenantId)
      .limit(1)
      .maybeSingle();
    if (readError || !current) {
      return {
        ok: false,
        error: readError?.message ?? 'tenant_not_found',
        confidence: 0,
      };
    }
    return {
      ok: true,
      data: current,
      confidence: refByUuid ? 1.0 : 0.8,
      reasoning: 'No preference fields supplied — tenant unchanged.',
      idempotent: true,
    };
  }

  const { data, error } = await admin
    .from('tenants')
    .update(updates)
    .eq('organization_id', organizationId)
    .eq('id', tenantId)
    .select('id, full_name, preferred_channel, language, emergency_contact_name, emergency_contact_phone, parking_space, pets_jsonb, preferences_confidence, preferences_source')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? 'update_failed',
      confidence: 0,
    };
  }

  const fields = Object.keys(updates).filter(
    (k) => k !== 'preferences_source' && k !== 'preferences_confidence',
  );
  return {
    ok: true,
    data,
    confidence: refByUuid ? 1.0 : 0.8,
    reasoning: `Updated ${data.full_name}'s preferences (${fields.join('/')}).`,
  };
}

// ---------------------------------------------------------------------------
// Ref helper
// ---------------------------------------------------------------------------

interface RefOk {
  ok: true;
  id: string;
  byId: boolean;
}
interface RefErr {
  ok: false;
  reason: 'not_found' | 'ambiguous';
}
type RefResult = RefOk | RefErr;

async function resolveTenantRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: UpdateTenantPreferencePayload,
): Promise<RefResult> {
  const ref = payload.tenantRef;
  if ('tenantId' in ref) {
    const { data, error } = await admin
      .from('tenants')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.tenantId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data.id, byId: true };
  }
  const result = await resolveTenant(admin, organizationId, ref.tenantName);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
