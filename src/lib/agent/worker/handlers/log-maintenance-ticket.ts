/**
 * Wave 6 — handler for `log_maintenance_ticket`.
 *
 * Resolves the unitRef (UUID short-circuit OR label/property name
 * lookup), reads `units.property_id` to fan out the ticket onto both
 * the property and unit, then INSERTs a maintenance_tickets row. The
 * table is intentionally lighter than work_orders — one summary line,
 * a coarse severity, photos array, status flow open → resolved.
 *
 * Idempotency: same (organization_id, unit_id, summary) within a
 * 5-minute window returns the existing row with `idempotent: true`.
 * Picked over a hash on (summary + severity + reportedBy) because in
 * practice the operator's intent "log a leaky faucet at 2B" is likely
 * to fire twice within seconds (typo, retry) and the simplest natural
 * key catches that without false negatives on minor wording drift.
 *
 * Confidence:
 *   - 1.0 when unitRef carries a UUID we verify in-org.
 *   - 0.8 when unitRef is a label (+ optional property) resolving uniquely.
 *   - 0.2 with `error: 'ambiguous_unit'` on multi-match.
 *   - 0.0 on unit_not_found / insert_failed.
 *
 * Stable error strings (for dispatcher narration):
 *   - 'unit_not_found'
 *   - 'ambiguous_unit'
 *   - 'unit_missing_property'
 *   - 'insert_failed: <message>'
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { resolveUnit } from '../resolve-refs';
import type { LogMaintenanceTicketPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

/** Window inside which a duplicate (org, unit, summary) is treated as idempotent. */
const IDEMPOTENCY_WINDOW_MS = 5 * 60_000;

const DEFAULT_SEVERITY = 'medium' as const;

export async function handleLogMaintenanceTicket(
  args: HandlerArgs<LogMaintenanceTicketPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  // 1. Resolve unitRef → unit id.
  const refResult = await resolveUnitRef(admin, organizationId, payload);
  if (!refResult.ok) {
    return {
      ok: false,
      error: refResult.reason === 'ambiguous'
        ? 'ambiguous_unit'
        : 'unit_not_found',
      confidence: refResult.reason === 'ambiguous' ? 0.2 : 0,
    };
  }
  const unitId = refResult.id;
  const refConfidence = refResult.byId ? 1.0 : 0.8;

  // 2. Look up the unit's property_id + label so we can scope the
  //    ticket and surface a friendly label in the response.
  const { data: unit, error: unitErr } = await admin
    .from('units')
    .select('id, label, property_id')
    .eq('organization_id', organizationId)
    .eq('id', unitId)
    .limit(1)
    .maybeSingle();

  if (unitErr || !unit) {
    return { ok: false, error: 'unit_not_found', confidence: 0 };
  }
  if (!unit.property_id) {
    return { ok: false, error: 'unit_missing_property', confidence: 0 };
  }

  const severity = payload.severity ?? DEFAULT_SEVERITY;

  // 3. Idempotency check — same (org, unit, summary) in the window.
  const sinceIso = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
  const { data: dupes } = await admin
    .from('maintenance_tickets')
    .select('id, summary, severity, status')
    .eq('organization_id', organizationId)
    .eq('unit_id', unitId)
    .eq('summary', payload.summary)
    .gte('created_at', sinceIso)
    .limit(1);

  if (dupes && dupes.length > 0) {
    const existing = dupes[0];
    return {
      ok: true,
      data: {
        ticketId: existing.id,
        unitLabel: unit.label,
        summary: existing.summary,
        severity: existing.severity,
        status: existing.status,
      },
      confidence: refConfidence,
      reasoning:
        `Skipped duplicate ticket on unit ${unit.label} ` +
        `(same summary within ${IDEMPOTENCY_WINDOW_MS / 60_000}m).`,
      idempotent: true,
    };
  }

  // 4. Insert the ticket.
  const { data: inserted, error: insertErr } = await admin
    .from('maintenance_tickets')
    .insert({
      organization_id: organizationId,
      property_id: unit.property_id,
      unit_id: unitId,
      summary: payload.summary,
      severity,
      reported_by: payload.reportedBy ?? null,
      status: 'open',
    })
    .select('id, summary, severity, status')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: `insert_failed: ${insertErr?.message ?? 'unknown'}`,
      confidence: 0,
    };
  }

  return {
    ok: true,
    data: {
      ticketId: inserted.id,
      unitLabel: unit.label,
      summary: inserted.summary,
      severity: inserted.severity,
      status: inserted.status,
    },
    confidence: refConfidence,
    reasoning:
      `Logged ${severity} ticket on unit ${unit.label}: "${payload.summary}".`,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
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

async function resolveUnitRef(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: LogMaintenanceTicketPayload,
): Promise<RefResult> {
  const ref = payload.unitRef;

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

  const result = await resolveUnit(
    admin,
    organizationId,
    ref.unitLabel,
    ref.propertyName,
  );
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, id: result.id, byId: false };
}
