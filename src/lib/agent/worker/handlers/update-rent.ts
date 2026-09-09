/**
 * Wave 6 — handler for `update_rent`.
 *
 * Resolves the leaseRef (UUID short-circuit OR tenant name → active
 * lease) and UPDATEs leases.rent_amount. No history table — the audit
 * trail lives on the action_proposals row this handler runs from.
 *
 * Idempotency: idempotent by definition — if the rent is already the
 * requested value, the UPDATE writes the same value and we tag the
 * result with `idempotent: true` so the dispatcher can narrate that
 * nothing changed.
 *
 * Confidence:
 *   - 1.0 when leaseRef is a UUID we verify in-org.
 *   - 0.8 when leaseRef is a tenantName resolving to a single active lease.
 *   - 0.2 returned with `error: 'ambiguous_lease'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveLease } from '../resolve-refs';
import type { UpdateRentPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

export async function handleUpdateRent(
  args: HandlerArgs<UpdateRentPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const resolved = await resolveLeaseRef(admin, organizationId, payload);
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.reason === 'ambiguous'
        ? 'ambiguous_lease'
        : 'lease_not_found',
      confidence: resolved.reason === 'ambiguous' ? 0.2 : 0,
    };
  }

  // Read current rent for idempotency tagging.
  const { data: current, error: readError } = await admin
    .from('leases')
    .select('id, rent_amount')
    .eq('organization_id', organizationId)
    .eq('id', resolved.id)
    .limit(1)
    .maybeSingle();

  if (readError || !current) {
    return {
      ok: false,
      error: readError?.message ?? 'lease_not_found',
      confidence: 0,
    };
  }

  const idempotent = current.rent_amount === payload.rentAmount;

  const { data, error } = await admin
    .from('leases')
    .update({ rent_amount: payload.rentAmount })
    .eq('organization_id', organizationId)
    .eq('id', resolved.id)
    .select('id, rent_amount, tenant_id, unit_id')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? 'update_failed',
      confidence: 0,
    };
  }

  return {
    ok: true,
    data,
    confidence: resolved.byId ? 1.0 : 0.8,
    reasoning: idempotent
      ? `Rent already ${payload.rentAmount}; no change.`
      : `Updated lease ${resolved.id} rent to ${payload.rentAmount}.`,
    idempotent,
  };
}

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

async function resolveLeaseRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: UpdateRentPayload,
): Promise<RefResult> {
  const ref = payload.leaseRef;

  if ('leaseId' in ref) {
    const { data, error } = await admin
      .from('leases')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.leaseId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data.id, byId: true };
  }

  const result = await resolveLease(admin, organizationId, ref.tenantName);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
