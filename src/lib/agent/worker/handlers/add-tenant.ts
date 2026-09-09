/**
 * Wave 6 — handler for `add_tenant`.
 *
 * Inserts a tenants row scoped to the dispatcher-provided org. When
 * `payload.unitRef` is supplied, also inserts a draft lease row
 * (status='pending', rent_amount=0, rent_due_day=1) so the tenant has
 * a unit assigned. The owner can fill terms later via `set_lease_terms`.
 *
 * Idempotency: natural key for tenants is (phone_e164, organization_id).
 * If the tenant already exists, we return that row with `idempotent: true`.
 * When `unitRef` is also supplied AND the tenant has no active/pending
 * lease for that unit yet, we still INSERT a draft lease so the
 * subsequent `set_lease_terms` has a row to UPDATE. This unblocks the
 * common iMessage flow: prior "add_tenant Test Person" landed without a
 * unit, then "link Test Person to unit 1" needs to attach them. Without
 * this re-attach behavior, set_lease_terms returns
 * `lease_not_found_attach_unit_first` and the chain stalls.
 *
 * Confidence:
 *   - 1.0 when no unitRef OR unitRef carries a UUID we verify in-org.
 *   - 0.8 when unitRef carries a unit label + property name we resolve
 *     successfully.
 *   - 0.2 with `ok: false, error: 'ambiguous_unit'` on ambiguous unit
 *     resolution — the dispatcher asks the operator to disambiguate.
 *
 * Why a draft lease instead of just a tenant: the operator's intent
 * "add tenant Alice to unit 2B" implies linkage. Without a row in
 * `leases`, the tenant has no unit assignment and won't show up in
 * unit-scoped views. Status='pending' + rent_amount=0 keeps the row
 * obvious as a placeholder until terms are filled.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveUnit } from '../resolve-refs';
import type { AddTenantPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

const DRAFT_LEASE_RENT_DUE_DAY = 1;
const DRAFT_LEASE_RENT_AMOUNT = 0;

export async function handleAddTenant(
  args: HandlerArgs<AddTenantPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  // Resolve unit ref first — fail fast on ambiguity before creating
  // the tenant row, so the dispatcher can ask the operator without
  // leaving a half-state behind.
  let unitId: string | null = null;
  let unitByName = false;
  if (payload.unitRef !== undefined) {
    const resolved = await resolveUnitRef(admin, organizationId, payload);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.reason === 'ambiguous'
          ? 'ambiguous_unit'
          : 'unit_not_found',
        confidence: resolved.reason === 'ambiguous' ? 0.2 : 0.0,
      };
    }
    unitId = resolved.id;
    unitByName = !resolved.byId;
  }

  // Idempotency lookup — phone + org is the natural key.
  const { data: existing, error: lookupError } = await admin
    .from('tenants')
    .select('id, full_name, phone_e164, email, date_of_birth')
    .eq('organization_id', organizationId)
    .eq('phone_e164', payload.phoneE164)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      error: `lookup_failed: ${lookupError.message}`,
      confidence: 0,
    };
  }

  if (existing) {
    // Even when the tenant already exists, if the operator passed a
    // unitRef we need to make sure there's a pending/active lease for
    // (tenant, unit) so a follow-up set_lease_terms has somewhere to
    // land. If not, INSERT a draft lease just like the new-tenant path.
    let draftLeaseId: string | null = null;
    if (unitId !== null) {
      const { data: existingLease, error: leaseLookupErr } = await admin
        .from('leases')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('tenant_id', existing.id)
        .eq('unit_id', unitId)
        .in('status', ['active', 'pending'])
        .limit(1)
        .maybeSingle();

      if (leaseLookupErr) {
        return {
          ok: false,
          error: `lease_lookup_failed: ${leaseLookupErr.message}`,
          confidence: 0,
        };
      }

      if (existingLease) {
        draftLeaseId = existingLease.id;
      } else {
        const { data: lease, error: leaseError } = await admin
          .from('leases')
          .insert({
            organization_id: organizationId,
            tenant_id: existing.id,
            unit_id: unitId,
            rent_amount: DRAFT_LEASE_RENT_AMOUNT,
            rent_due_day: DRAFT_LEASE_RENT_DUE_DAY,
            status: 'pending',
          })
          .select('id')
          .single();

        if (leaseError || !lease) {
          return {
            ok: false,
            error: `lease_insert_failed: ${leaseError?.message ?? 'unknown'}`,
            confidence: 0,
          };
        }
        draftLeaseId = lease.id;
      }
    }

    const confidence = unitId === null || !unitByName ? 1.0 : 0.8;
    return {
      ok: true,
      data: { ...existing, draftLeaseId },
      confidence,
      reasoning: draftLeaseId
        ? `Found existing tenant "${payload.fullName}" — ensured draft lease ${draftLeaseId}.`
        : `Found existing tenant "${payload.fullName}" by phone.`,
      // Tenant row itself wasn't changed — only the lease side may have
      // been created. Mark idempotent only when no new lease was made.
      idempotent: unitId === null,
    };
  }

  const { data: tenant, error: insertError } = await admin
    .from('tenants')
    .insert({
      organization_id: organizationId,
      full_name: payload.fullName,
      phone_e164: payload.phoneE164,
      email: payload.email ?? null,
      date_of_birth: payload.dateOfBirth ?? null,
    })
    .select('id, full_name, phone_e164, email, date_of_birth')
    .single();

  if (insertError || !tenant) {
    return {
      ok: false,
      error: insertError?.message ?? 'insert_failed',
      confidence: 0,
    };
  }

  // Optional draft lease for unit linkage.
  let draftLeaseId: string | null = null;
  if (unitId !== null) {
    const { data: lease, error: leaseError } = await admin
      .from('leases')
      .insert({
        organization_id: organizationId,
        tenant_id: tenant.id,
        unit_id: unitId,
        rent_amount: DRAFT_LEASE_RENT_AMOUNT,
        rent_due_day: DRAFT_LEASE_RENT_DUE_DAY,
        status: 'pending',
      })
      .select('id')
      .single();

    if (leaseError || !lease) {
      return {
        ok: false,
        error: `lease_insert_failed: ${leaseError?.message ?? 'unknown'}`,
        confidence: 0,
      };
    }
    draftLeaseId = lease.id;
  }

  const confidence = unitId === null || !unitByName ? 1.0 : 0.8;

  return {
    ok: true,
    data: { ...tenant, draftLeaseId },
    confidence,
    reasoning: draftLeaseId
      ? `Added tenant "${payload.fullName}" with draft lease ${draftLeaseId}.`
      : `Added tenant "${payload.fullName}".`,
  };
}

interface UnitRefOk {
  ok: true;
  id: string;
  byId: boolean;
}
interface UnitRefErr {
  ok: false;
  reason: 'not_found' | 'ambiguous';
}
type UnitRefResult = UnitRefOk | UnitRefErr;

async function resolveUnitRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: AddTenantPayload,
): Promise<UnitRefResult> {
  const ref = payload.unitRef;
  if (ref === undefined) {
    // Caller checks payload.unitRef before calling — defensive.
    return { ok: false, reason: 'not_found' };
  }

  if ('unitId' in ref) {
    const { data, error } = await admin
      .from('units')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.unitId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data.id, byId: true };
  }

  // Forgiving variant — propertyName is optional now (the LLM sometimes
  // omits it when only one property exists). resolveUnit falls back to
  // org-wide label match when propertyName is undefined.
  const propertyName =
    'propertyName' in ref && typeof ref.propertyName === 'string'
      ? ref.propertyName
      : undefined;
  const result = await resolveUnit(
    admin,
    organizationId,
    ref.unitLabel,
    propertyName,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
