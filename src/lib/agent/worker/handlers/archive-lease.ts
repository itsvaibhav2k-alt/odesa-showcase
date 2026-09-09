/**
 * Wave 6 — handler for `archive_lease`.
 *
 * Resolves the leaseRef (UUID short-circuit OR tenant name → active
 * lease) and UPDATEs leases.status='terminated' + end_date=NOW(). The
 * payload exposes 'ended' as the user-facing status (matching set_lease_terms);
 * we map to the DB enum 'terminated' here.
 *
 * Idempotency: if the lease is already terminated, return idempotent: true
 * and leave end_date untouched.
 *
 * Confidence:
 *   - 1.0 when leaseRef is a UUID we verify in-org.
 *   - 0.8 when leaseRef is a tenantName resolving to a single active lease.
 *   - 0.2 with `error: 'ambiguous_lease'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveLease } from '../resolve-refs';
import type { ArchiveLeasePayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

export async function handleArchiveLease(
  args: HandlerArgs<ArchiveLeasePayload>,
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

  const { data: current, error: readError } = await admin
    .from('leases')
    .select('id, status, end_date, tenant_id, unit_id')
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

  if (current.status === 'terminated') {
    return {
      ok: true,
      data: current,
      confidence: resolved.byId ? 1.0 : 0.8,
      reasoning: `Lease ${resolved.id} already terminated.`,
      idempotent: true,
    };
  }

  const endDate = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from('leases')
    .update({
      status: 'terminated',
      end_date: endDate,
    })
    .eq('organization_id', organizationId)
    .eq('id', resolved.id)
    .select('id, status, end_date, tenant_id, unit_id')
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
    reasoning: payload.reason
      ? `Archived lease ${resolved.id}: ${payload.reason}.`
      : `Archived lease ${resolved.id}.`,
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
  payload: ArchiveLeasePayload,
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
