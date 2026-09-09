/**
 * Wave 7 — handler for `set_property_vendor`.
 *
 * Resolves propertyRef + vendorRef, then UPSERTs into property_vendors
 * keyed on the table's PK `(organization_id, property_id, category)`.
 * On conflict we UPDATE notes/source/confidence (and vendor_id if it
 * changed) so re-running with a different vendor reassigns the slot.
 *
 * Idempotency:
 *   - same (org, property, category) + same vendor + same notes/source
 *     /confidence → return existing with `idempotent: true`.
 *   - same key + different fields → UPDATE; return `idempotent: false`.
 *   - no match → INSERT.
 *
 * Defaults: `confidence: 0.7`, `source: 'agent'` when omitted.
 *
 * Confidence (return value, NOT the persisted column):
 *   - 1.0 when both refs resolve by UUID.
 *   - 0.8 when any ref resolves by name.
 *   - 0.2 with `error: 'ambiguous_*'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveProperty, resolveVendor } from '../resolve-refs';
import type { SetPropertyVendorPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

const DEFAULT_CONFIDENCE = 0.7;
const DEFAULT_SOURCE = 'agent';

export async function handleSetPropertyVendor(
  args: HandlerArgs<SetPropertyVendorPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const propertyResult = await resolvePropertyRef(admin, organizationId, payload);
  if (!propertyResult.ok) {
    return {
      ok: false,
      error: propertyResult.reason === 'ambiguous'
        ? 'ambiguous_property'
        : 'property_not_found',
      confidence: propertyResult.reason === 'ambiguous' ? 0.2 : 0,
    };
  }

  const vendorResult = await resolveVendorRef(admin, organizationId, payload);
  if (!vendorResult.ok) {
    return {
      ok: false,
      error: vendorResult.reason === 'ambiguous'
        ? 'ambiguous_vendor'
        : 'vendor_not_found',
      confidence: vendorResult.reason === 'ambiguous' ? 0.2 : 0,
    };
  }

  const propertyId = propertyResult.id;
  const vendorId = vendorResult.id;
  const confidence =
    propertyResult.byId && vendorResult.byId ? 1.0 : 0.8;

  const writeConfidence = payload.confidence ?? DEFAULT_CONFIDENCE;
  const writeSource = payload.source ?? DEFAULT_SOURCE;
  const writeNotes = payload.notes ?? null;

  // Idempotency lookup — PK is (org, property, category).
  const { data: existing, error: lookupError } = await admin
    .from('property_vendors')
    .select('vendor_id, notes, confidence, source')
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .eq('category', payload.category)
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
    const updates: Record<string, unknown> = {};
    if (existing.vendor_id !== vendorId) {
      updates.vendor_id = vendorId;
    }
    // Only update notes when the caller supplied a value — preserves
    // existing notes when payload omits the key.
    if (payload.notes !== undefined && existing.notes !== payload.notes) {
      updates.notes = payload.notes;
    }
    if (
      payload.confidence !== undefined &&
      existing.confidence !== payload.confidence
    ) {
      updates.confidence = payload.confidence;
    }
    if (payload.source !== undefined && existing.source !== payload.source) {
      updates.source = payload.source;
    }

    if (Object.keys(updates).length === 0) {
      return {
        ok: true,
        data: {
          property_id: propertyId,
          category: payload.category,
          vendor_id: existing.vendor_id,
          notes: existing.notes,
          confidence: existing.confidence,
          source: existing.source,
        },
        confidence,
        reasoning: `Vendor for ${payload.category} unchanged on this property.`,
        idempotent: true,
      };
    }

    const { data: updated, error: updateError } = await admin
      .from('property_vendors')
      .update(updates)
      .eq('organization_id', organizationId)
      .eq('property_id', propertyId)
      .eq('category', payload.category)
      .select('vendor_id, notes, confidence, source, property_id, category')
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
      reasoning: `Updated ${payload.category} vendor on this property.`,
      idempotent: false,
    };
  }

  const insertValues: Database['public']['Tables']['property_vendors']['Insert'] = {
    organization_id: organizationId,
    property_id: propertyId,
    category: payload.category,
    vendor_id: vendorId,
    notes: writeNotes,
    confidence: writeConfidence,
    source: writeSource,
  };

  const { data, error } = await admin
    .from('property_vendors')
    .insert(insertValues)
    .select('vendor_id, notes, confidence, source, property_id, category')
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
    reasoning: `Set ${payload.category} vendor on this property.`,
  };
}

// ---------------------------------------------------------------------------
// Ref helpers
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

async function resolvePropertyRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: SetPropertyVendorPayload,
): Promise<RefResult> {
  const ref = payload.propertyRef;
  if ('propertyId' in ref) {
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

async function resolveVendorRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: SetPropertyVendorPayload,
): Promise<RefResult> {
  const ref = payload.vendorRef;
  if ('vendorId' in ref) {
    const result = await resolveVendor(admin, organizationId, {
      vendorId: ref.vendorId,
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, id: result.id, byId: true };
  }
  const result = await resolveVendor(admin, organizationId, {
    vendorName: ref.vendorName,
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
