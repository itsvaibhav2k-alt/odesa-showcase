/**
 * Wave 7 — handler for `add_appliance`.
 *
 * Resolves the propertyRef (UUID short-circuit OR name lookup) and the
 * optional unitRef (when omitted, the appliance is property-wide;
 * `unit_id` stays NULL — e.g. shared HVAC). Inserts an appliances row
 * scoped to the dispatcher-provided org.
 *
 * Idempotency: natural key is
 *   (organization_id, property_id, unit_id, type, make, model)
 *
 *   - same row + same fields → return existing with `idempotent: true`.
 *   - same row + different non-null fields in payload → UPDATE the
 *     drifted fields, return `idempotent: false`.
 *   - no match → INSERT.
 *
 * Defaults: `confidence: 0.7`, `source: 'agent'` when payload omits.
 *
 * Confidence semantics:
 *   - 1.0 when both refs resolve by UUID.
 *   - 0.8 when any ref resolves by name.
 *   - 0.2 with `ok: false, error: 'ambiguous_*'` on multi-match.
 *   - The `confidence` STORED on the row honors the payload override
 *     (owner UI saves 1.0 / source='owner'); the handler-return
 *     `confidence` reflects ref-resolution certainty for the dispatcher.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveProperty, resolveUnit } from '../resolve-refs';
import type { AddAppliancePayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

const DEFAULT_CONFIDENCE = 0.7;
const DEFAULT_SOURCE = 'agent';

type ApplianceRow = Database['public']['Tables']['appliances']['Row'];

export async function handleAddAppliance(
  args: HandlerArgs<AddAppliancePayload>,
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

  let unitId: string | null = null;
  let unitByName = false;
  if (payload.unitRef !== undefined) {
    const unitResult = await resolveUnitRef(admin, organizationId, payload);
    if (!unitResult.ok) {
      return {
        ok: false,
        error: unitResult.reason === 'ambiguous'
          ? 'ambiguous_unit'
          : 'unit_not_found',
        confidence: unitResult.reason === 'ambiguous' ? 0.2 : 0,
      };
    }
    unitId = unitResult.id;
    unitByName = !unitResult.byId;
  }

  const propertyId = propertyResult.id;
  const confidence =
    propertyResult.byId && !unitByName ? 1.0 : 0.8;

  // Idempotency lookup — natural key (org, property, unit, type, make, model).
  let lookup = admin
    .from('appliances')
    .select('id, type, make, model, serial_number, install_date, last_service_date, warranty_expires_at, notes, confidence, source, unit_id, property_id')
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .eq('type', payload.type);

  // unit_id NULL is the "property-wide" sentinel — match it explicitly so
  // re-running the same property-wide insert doesn't INSERT a duplicate.
  if (unitId === null) {
    lookup = lookup.is('unit_id', null);
  } else {
    lookup = lookup.eq('unit_id', unitId);
  }

  // make/model are part of the natural key — coalesce undefined → null
  // so the equality matches existing rows where the column is null.
  if (payload.make !== undefined) {
    lookup = lookup.eq('make', payload.make);
  } else {
    lookup = lookup.is('make', null);
  }
  if (payload.model !== undefined) {
    lookup = lookup.eq('model', payload.model);
  } else {
    lookup = lookup.is('model', null);
  }

  const { data: existing, error: lookupError } = await lookup
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    return {
      ok: false,
      error: `lookup_failed: ${lookupError.message}`,
      confidence: 0,
    };
  }

  const writeConfidence = payload.confidence ?? DEFAULT_CONFIDENCE;
  const writeSource = payload.source ?? DEFAULT_SOURCE;

  if (existing) {
    // Compute drift — only fields the payload supplied AND that differ
    // from what's already on the row. Don't clobber existing data with
    // null when the caller didn't set the field.
    const updates: Record<string, unknown> = {};
    if (
      payload.serialNumber !== undefined &&
      existing.serial_number !== payload.serialNumber
    ) {
      updates.serial_number = payload.serialNumber;
    }
    if (
      payload.installDate !== undefined &&
      existing.install_date !== payload.installDate
    ) {
      updates.install_date = payload.installDate;
    }
    if (
      payload.lastServiceDate !== undefined &&
      existing.last_service_date !== payload.lastServiceDate
    ) {
      updates.last_service_date = payload.lastServiceDate;
    }
    if (
      payload.warrantyExpiresAt !== undefined &&
      existing.warranty_expires_at !== payload.warrantyExpiresAt
    ) {
      updates.warranty_expires_at = payload.warrantyExpiresAt;
    }
    if (payload.notes !== undefined && existing.notes !== payload.notes) {
      updates.notes = payload.notes;
    }
    // Confidence + source: when the caller explicitly passes them, honor
    // the override (owner-confirm path → 1.0 / 'owner'). Otherwise leave
    // the existing row alone.
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
        data: existing,
        confidence,
        reasoning: `Found existing ${describeAppliance(payload)}.`,
        idempotent: true,
      };
    }

    const { data: updated, error: updateError } = await admin
      .from('appliances')
      .update(updates)
      .eq('organization_id', organizationId)
      .eq('id', existing.id)
      .select('id, type, make, model, serial_number, install_date, last_service_date, warranty_expires_at, notes, confidence, source, unit_id, property_id')
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
      reasoning: `Updated existing ${describeAppliance(payload)} with new ${Object.keys(
        updates,
      ).join('/')}.`,
      idempotent: false,
    };
  }

  const insertValues: Database['public']['Tables']['appliances']['Insert'] = {
    organization_id: organizationId,
    property_id: propertyId,
    unit_id: unitId,
    type: payload.type,
    make: payload.make ?? null,
    model: payload.model ?? null,
    serial_number: payload.serialNumber ?? null,
    install_date: payload.installDate ?? null,
    last_service_date: payload.lastServiceDate ?? null,
    warranty_expires_at: payload.warrantyExpiresAt ?? null,
    notes: payload.notes ?? null,
    confidence: writeConfidence,
    source: writeSource,
  };

  const { data, error } = await admin
    .from('appliances')
    .insert(insertValues)
    .select('id, type, make, model, serial_number, install_date, last_service_date, warranty_expires_at, notes, confidence, source, unit_id, property_id')
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
    data: data as ApplianceRow,
    confidence,
    reasoning: `Logged ${describeAppliance(payload)}.`,
  };
}

function describeAppliance(payload: AddAppliancePayload): string {
  const tail = [payload.make, payload.model].filter(Boolean).join(' ');
  return tail ? `${payload.type}: ${tail}` : `${payload.type}`;
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
  payload: AddAppliancePayload,
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

async function resolveUnitRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: AddAppliancePayload,
): Promise<RefResult> {
  const ref = payload.unitRef;
  if (ref === undefined) return { ok: false, reason: 'not_found' };
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
