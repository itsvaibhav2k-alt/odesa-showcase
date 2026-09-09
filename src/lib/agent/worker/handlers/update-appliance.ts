/**
 * Wave 7 — handler for `update_appliance`.
 *
 * Resolves the applianceRef via `resolveAppliance` (UUID or fuzzy
 * `{propertyName, unitLabel?, type}` triple) and UPDATEs only the
 * fields supplied in the payload — never clobber unspecified columns
 * with null.
 *
 * Confidence semantics:
 *   - 1.0 when the row resolves by applianceId (UUID) AND the caller
 *     didn't override `confidence`.
 *   - 0.8 when the row resolves by name (single match) AND the caller
 *     didn't override `confidence`.
 *   - 0.2 with `error: 'ambiguous_appliance'` on multi-match.
 *
 * Source override: when the payload sets `source === 'owner'`, the
 * stored `confidence` is bumped to 1.0 to mark the row as
 * owner-confirmed (regardless of what the caller put in the payload's
 * `confidence` field).
 */

import type { Database } from '@/types/database';

import { resolveAppliance } from '../resolve-refs';
import type { UpdateAppliancePayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

type ApplianceUpdate =
  Database['public']['Tables']['appliances']['Update'];

export async function handleUpdateAppliance(
  args: HandlerArgs<UpdateAppliancePayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  const resolved = await resolveAppliance(
    admin,
    organizationId,
    payload.applianceRef,
  );
  if (!resolved.ok) {
    return {
      ok: false,
      error: resolved.reason === 'ambiguous'
        ? 'ambiguous_appliance'
        : 'appliance_not_found',
      confidence: resolved.reason === 'ambiguous' ? 0.2 : 0,
    };
  }

  const applianceId = resolved.id;
  const refByUuid = 'applianceId' in payload.applianceRef;

  // Build the UPDATE patch from ONLY the fields the caller supplied.
  const updates: ApplianceUpdate = {};
  if (payload.type !== undefined) updates.type = payload.type;
  if (payload.make !== undefined) updates.make = payload.make;
  if (payload.model !== undefined) updates.model = payload.model;
  if (payload.serialNumber !== undefined) {
    updates.serial_number = payload.serialNumber;
  }
  if (payload.installDate !== undefined) {
    updates.install_date = payload.installDate;
  }
  if (payload.lastServiceDate !== undefined) {
    updates.last_service_date = payload.lastServiceDate;
  }
  if (payload.warrantyExpiresAt !== undefined) {
    updates.warranty_expires_at = payload.warrantyExpiresAt;
  }
  if (payload.notes !== undefined) updates.notes = payload.notes;

  // Source / confidence — owner-source bumps confidence to 1.0 per the
  // wave-7 contract (handler-side enforcement, not just UI).
  if (payload.source !== undefined) {
    updates.source = payload.source;
  }
  if (payload.source === 'owner') {
    updates.confidence = 1.0;
  } else if (payload.confidence !== undefined) {
    updates.confidence = payload.confidence;
  }

  // Pure ref → no field updates: nothing to persist, but still report
  // the row's current state so the dispatcher can narrate.
  if (Object.keys(updates).length === 0) {
    const { data: current, error: readError } = await admin
      .from('appliances')
      .select('id, type, make, model, serial_number, install_date, last_service_date, warranty_expires_at, notes, confidence, source, unit_id, property_id')
      .eq('organization_id', organizationId)
      .eq('id', applianceId)
      .limit(1)
      .maybeSingle();
    if (readError || !current) {
      return {
        ok: false,
        error: readError?.message ?? 'appliance_not_found',
        confidence: 0,
      };
    }
    return {
      ok: true,
      data: current,
      confidence: refByUuid ? 1.0 : 0.8,
      reasoning: 'No fields supplied — appliance unchanged.',
      idempotent: true,
    };
  }

  const { data, error } = await admin
    .from('appliances')
    .update(updates)
    .eq('organization_id', organizationId)
    .eq('id', applianceId)
    .select('id, type, make, model, serial_number, install_date, last_service_date, warranty_expires_at, notes, confidence, source, unit_id, property_id')
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
    confidence: refByUuid ? 1.0 : 0.8,
    reasoning: `Updated appliance ${applianceId} — ${Object.keys(updates).join('/')}.`,
  };
}
