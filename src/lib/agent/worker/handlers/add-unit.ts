/**
 * Wave 6 — handler for `add_unit`.
 *
 * Resolves the propertyRef (UUID short-circuit; otherwise name lookup
 * via resolveProperty) and inserts a units row. Mirrors the column
 * shape of `createUnitAction` in
 * `src/app/(dashboard)/onboarding/actions.ts:163`.
 *
 * Idempotency: natural key is (property_id, label). Re-running the
 * same payload returns the existing row with `idempotent: true`. If
 * the existing row has different bedrooms/bathrooms/square_feet than
 * the new payload, we UPDATE the row in place (idempotent: false) so
 * the operator can correct an earlier "1br/1ba" placeholder by saying
 * "unit 1 should be 3br/2ba" — common in iMessage stress tests where
 * an earlier add_unit landed wrong values.
 *
 * Confidence:
 *   - 1.0 when propertyRef is a UUID (no resolution risk).
 *   - 0.8 when propertyRef is a name and we resolved exactly one row.
 *   - 0.2 returned with `ok: false, error: 'ambiguous_property'` when
 *     the name matched multiple properties — dispatcher prompts user.
 *   - 0.2 returned with `ok: false, error: 'label_looks_like_tenant_name'`
 *     when the label matches a same-org tenant's name (see guard below) —
 *     dispatcher asks the owner for the real unit number.
 *
 * Tenant-name guard: the LLM sometimes composes a unit label from the
 * tenant it is onboarding ("Unit Vaibhav Maddhi"). We reject a label
 * when, after normalization (trim, lowercase, collapse whitespace,
 * strip punctuation), it EQUALS a same-org tenant's full name, equals
 * the tenant's first+last tokens joined (with or without a space), or
 * is two alphabetic words that both match tenant name tokens. Equality
 * only — NO substring matching — so short identifiers like "A", "B",
 * "101", "Unit A", "Apt 4" are never blocked.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveProperty } from '../resolve-refs';
import type { AddUnitPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

export async function handleAddUnit(
  args: HandlerArgs<AddUnitPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const refResult = await resolvePropertyRef(admin, organizationId, payload);
  if (!refResult.ok) {
    return {
      ok: false,
      error: refResult.reason === 'ambiguous'
        ? 'ambiguous_property'
        : 'property_not_found',
      confidence: refResult.reason === 'ambiguous' ? 0.2 : 0.0,
    };
  }

  const propertyId = refResult.id;
  const confidence = refResult.byId ? 1.0 : 0.8;

  // Tenant-name guard — only when the label contains letters (a pure
  // numeric label like "101" can never equal a person's name).
  const labelNorm = normalizeLabel(payload.label);
  if (/\p{L}/u.test(labelNorm)) {
    const { data: tenants, error: tenantsError } = await admin
      .from('tenants')
      .select('id, full_name')
      .eq('organization_id', organizationId);

    if (tenantsError) {
      return {
        ok: false,
        error: `tenant_lookup_failed: ${tenantsError.message}`,
        confidence: 0,
      };
    }

    const collision = (tenants ?? []).find((tenant) =>
      labelMatchesTenantName(labelNorm, normalizeLabel(tenant.full_name)),
    );
    if (collision) {
      return {
        ok: false,
        error: 'label_looks_like_tenant_name',
        confidence: 0.2,
      };
    }
  }

  // Idempotency check — same property + label.
  const { data: existing, error: lookupError } = await admin
    .from('units')
    .select('id, label, bedrooms, bathrooms, square_feet, property_id')
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .eq('label', payload.label)
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
    // Compute fields that drift between existing row and new payload.
    // squareFeet is optional — only treat as a diff when payload supplies
    // a value AND it differs (don't clobber an existing value with null).
    const updates: Record<string, number | null> = {};
    if (existing.bedrooms !== payload.bedrooms) {
      updates.bedrooms = payload.bedrooms;
    }
    if (existing.bathrooms !== payload.bathrooms) {
      updates.bathrooms = payload.bathrooms;
    }
    if (
      payload.squareFeet !== undefined &&
      existing.square_feet !== payload.squareFeet
    ) {
      updates.square_feet = payload.squareFeet;
    }

    if (Object.keys(updates).length === 0) {
      return {
        ok: true,
        data: existing,
        confidence,
        reasoning: `Found existing unit "${payload.label}" on this property.`,
        idempotent: true,
      };
    }

    const { data: updated, error: updateError } = await admin
      .from('units')
      .update(updates)
      .eq('organization_id', organizationId)
      .eq('id', existing.id)
      .select('id, label, bedrooms, bathrooms, square_feet, property_id')
      .single();

    if (updateError || !updated) {
      return {
        ok: false,
        error: updateError?.message ?? 'update_failed',
        confidence: 0,
      };
    }

    return {
      ok: true,
      data: updated,
      confidence,
      reasoning: `Updated existing unit "${payload.label}" with new ${Object.keys(updates).join('/')}.`,
      idempotent: false,
    };
  }

  const { data, error } = await admin
    .from('units')
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      label: payload.label,
      bedrooms: payload.bedrooms,
      bathrooms: payload.bathrooms,
      square_feet: payload.squareFeet ?? null,
    })
    .select('id, label, bedrooms, bathrooms, square_feet, property_id')
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
    confidence,
    reasoning: `Added unit "${payload.label}" to property ${propertyId}.`,
  };
}

/**
 * Normalize a label or tenant name for comparison: lowercase, replace
 * every run of punctuation/whitespace with a single space, trim.
 * Keep in sync with `scripts/repair-org-data.mjs`.
 */
function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when a normalized unit label looks like a tenant's name.
 * Equality-based only (no substring matching):
 *   1. label equals the full normalized name;
 *   2. label equals first+last name tokens joined by a space or
 *      concatenated (catches "HannahAnders" and middle-name skips);
 *   3. label is exactly two distinct alphabetic words that both match
 *      tokens of the tenant's name (catches "Anders Hannah").
 */
function labelMatchesTenantName(
  labelNorm: string,
  nameNorm: string,
): boolean {
  if (labelNorm.length === 0 || nameNorm.length === 0) return false;
  if (labelNorm === nameNorm) return true;

  const nameTokens = nameNorm.split(' ');
  if (nameTokens.length < 2) return false;

  const first = nameTokens[0];
  const last = nameTokens[nameTokens.length - 1];
  if (labelNorm === `${first} ${last}`) return true;
  if (labelNorm === `${first}${last}`) return true;

  const labelTokens = labelNorm.split(' ');
  const isTwoAlphaWords =
    labelTokens.length === 2 &&
    labelTokens[0] !== labelTokens[1] &&
    labelTokens.every((token) => /^\p{L}+$/u.test(token));
  if (
    isTwoAlphaWords &&
    labelTokens.every((token) => nameTokens.includes(token))
  ) {
    return true;
  }

  return false;
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

async function resolvePropertyRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: AddUnitPayload,
): Promise<RefResult> {
  const ref = payload.propertyRef;

  if ('propertyId' in ref) {
    // Defense in depth — verify the UUID belongs to this org.
    const { data, error } = await admin
      .from('properties')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('id', ref.propertyId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return { ok: false, reason: 'not_found' };
    return { ok: true, id: data.id, byId: true };
  }

  const result = await resolveProperty(admin, organizationId, ref.propertyName);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
