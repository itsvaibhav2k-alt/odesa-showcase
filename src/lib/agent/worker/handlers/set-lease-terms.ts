/**
 * Wave 6 — handler for `set_lease_terms`.
 *
 * Resolves a lease via one of three refs:
 *   - leaseId (UUID short-circuit, verified in-org)
 *   - tenantId + unitId (look up active/pending lease for the pair;
 *     INSERT if missing)
 *   - tenantName, with optional unitLabel:
 *       * tenantName + unitLabel → resolve unit, look up
 *         active/pending lease for the (tenant, unit) pair, INSERT if
 *         missing (mirrors the tenantId+unitId behavior).
 *       * tenantName alone → if exactly one active/pending lease exists
 *         for this tenant, UPDATE it. Zero leases →
 *         `lease_not_found_attach_unit_first` so the dispatcher tells
 *         the operator to attach a unit first. Multiple leases →
 *         `ambiguous_lease`.
 *
 * Status mapping: payload accepts 'active' | 'pending' | 'ended'. The
 * DB enum is 'active' | 'pending' | 'expired' | 'terminated', so 'ended'
 * maps to 'terminated'. The other two pass through.
 *
 * Confidence:
 *   - 1.0 when ref resolves by ID (leaseId or tenantId+unitId).
 *   - 0.8 when ref resolves by tenant name (single-match) or by
 *     tenantName+unitLabel (one name lookup).
 *   - 0.2 with `error: 'ambiguous_lease'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveTenant, resolveUnit } from '../resolve-refs';
import type { SetLeaseTermsPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

type LeaseStatus = Database['public']['Enums']['lease_status'];

function mapStatus(s: SetLeaseTermsPayload['status']): LeaseStatus | undefined {
  if (s === undefined) return undefined;
  if (s === 'ended') return 'terminated';
  return s;
}

export async function handleSetLeaseTerms(
  args: HandlerArgs<SetLeaseTermsPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const resolved = await resolveLeaseRef(admin, organizationId, payload);
  if (!resolved.ok) {
    if (resolved.reason === 'ambiguous') {
      return { ok: false, error: 'ambiguous_lease', confidence: 0.2 };
    }
    if (resolved.reason === 'cannot_create') {
      // Tenant exists but has no active/pending lease — the dispatcher
      // ran add_tenant without a unitRef, so there's no draft lease to
      // update. Surface a distinct error so the narration prompts the
      // operator to attach a unit first instead of swallowing silently.
      return {
        ok: false,
        error: 'lease_not_found_attach_unit_first',
        confidence: 0,
      };
    }
    return { ok: false, error: 'lease_not_found', confidence: 0 };
  }

  // When set_lease_terms is invoked with explicit rent/start, treat it
  // as a lease confirmation: default status to 'active' so the dashboard
  // counts it for occupancy/MRR. Pending stays only if caller asks for
  // it explicitly. Mirrors the INSERT branch below.
  const baseTerms = {
    rent_amount: payload.rentAmount,
    rent_due_day: payload.rentDueDay,
    start_date: payload.startDate,
    end_date: payload.endDate ?? null,
    status: (mapStatus(payload.status) ?? 'active') as LeaseStatus,
  };

  if (resolved.kind === 'update') {
    const { data, error } = await admin
      .from('leases')
      .update(baseTerms)
      .eq('organization_id', organizationId)
      .eq('id', resolved.leaseId)
      .select('id, tenant_id, unit_id, rent_amount, rent_due_day, start_date, end_date, status')
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
      reasoning: `Updated lease ${resolved.leaseId} terms.`,
      idempotent: false,
    };
  }

  // INSERT path — caller passed tenantId + unitId (or tenantName +
  // unitLabel resolved to the same pair) and no active/pending lease
  // exists yet for that pair.
  const { data, error } = await admin
    .from('leases')
    .insert({
      organization_id: organizationId,
      tenant_id: resolved.tenantId,
      unit_id: resolved.unitId,
      rent_amount: payload.rentAmount,
      rent_due_day: payload.rentDueDay,
      start_date: payload.startDate,
      end_date: payload.endDate ?? null,
      status: mapStatus(payload.status) ?? 'active',
    })
    .select('id, tenant_id, unit_id, rent_amount, rent_due_day, start_date, end_date, status')
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: error?.message ?? 'insert_failed',
      confidence: 0,
    };
  }

  return {
    ok: true,
    data,
    confidence: resolved.byId ? 1.0 : 0.8,
    reasoning: `Created lease for tenant ${resolved.tenantId} on unit ${resolved.unitId}.`,
  };
}

type ResolveLeaseRefResult =
  | { ok: true; kind: 'update'; leaseId: string; byId: boolean }
  | { ok: true; kind: 'insert'; tenantId: string; unitId: string; byId: boolean }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'cannot_create' };

async function resolveLeaseRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: SetLeaseTermsPayload,
): Promise<ResolveLeaseRefResult> {
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
    return { ok: true, kind: 'update', leaseId: data.id, byId: true };
  }

  if ('tenantId' in ref && 'unitId' in ref) {
    // Look for an existing lease for this tenant+unit pair (any status
    // other than terminated/expired) so re-running set_lease_terms
    // updates rather than duplicates.
    const { data: existing, error: existErr } = await admin
      .from('leases')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('tenant_id', ref.tenantId)
      .eq('unit_id', ref.unitId)
      .in('status', ['active', 'pending'])
      .limit(1)
      .maybeSingle();

    if (existErr) return { ok: false, reason: 'not_found' };
    if (existing) {
      return { ok: true, kind: 'update', leaseId: existing.id, byId: true };
    }
    return {
      ok: true,
      kind: 'insert',
      tenantId: ref.tenantId,
      unitId: ref.unitId,
      byId: true,
    };
  }

  // tenantName variant. The schema permits an optional unitLabel — when
  // present, behave like the tenantId+unitId branch (UPDATE if a lease
  // exists for the pair, otherwise INSERT). When absent, fall back to
  // the single-pending-lease search.
  const tenant = await resolveTenant(admin, organizationId, ref.tenantName);
  if (!tenant.ok) return { ok: false, reason: tenant.reason };

  if ('unitLabel' in ref && typeof ref.unitLabel === 'string') {
    const unit = await resolveUnit(admin, organizationId, ref.unitLabel);
    if (!unit.ok) return { ok: false, reason: unit.reason };

    const { data: pairLease, error: pairErr } = await admin
      .from('leases')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('tenant_id', tenant.id)
      .eq('unit_id', unit.id)
      .in('status', ['active', 'pending'])
      .limit(1)
      .maybeSingle();

    if (pairErr) return { ok: false, reason: 'not_found' };
    if (pairLease) {
      return { ok: true, kind: 'update', leaseId: pairLease.id, byId: false };
    }
    return {
      ok: true,
      kind: 'insert',
      tenantId: tenant.id,
      unitId: unit.id,
      byId: false,
    };
  }

  const { data, error } = await admin
    .from('leases')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('tenant_id', tenant.id)
    .in('status', ['active', 'pending'])
    .limit(2);

  if (error) return { ok: false, reason: 'not_found' };
  if (!data || data.length === 0) {
    return { ok: false, reason: 'cannot_create' };
  }
  if (data.length > 1) return { ok: false, reason: 'ambiguous' };

  return { ok: true, kind: 'update', leaseId: data[0].id, byId: false };
}
