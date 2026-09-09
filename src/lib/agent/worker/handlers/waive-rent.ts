/**
 * Handler for `waive_rent` — forgive the remaining balance of one cycle.
 *
 * Resolves the leaseRef (UUID short-circuit OR tenant name → active lease),
 * locates the target `rent_events` row for the requested cycle (default:
 * current month), and delegates the mutation to the shared money-path core
 * `waiveRemainingBalance` (src/lib/rent/waive.ts) — the same CAS core the
 * /rent UI action uses, so agent and UI can never drift. Collected stays
 * honest: amount_due drops to amount_paid, the forgiven amount + reason are
 * audited on the row, and the status enum is never written.
 *
 * Idempotency: re-waiving an already-waived cycle returns ok with
 * `idempotent: true` so the dispatcher narrates that nothing changed.
 *
 * Confidence: 1.0 for a verified lease UUID, 0.8 for a unique tenant-name
 * match, 0.2 + `error: 'ambiguous_lease'` on multi-match.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import { waiveRemainingBalance } from '@/lib/rent/waive';

import { resolveLease } from '../resolve-refs';
import type { WaiveRentPayload } from '../types';
import type { HandlerArgs, HandlerResult } from './index';

/** Normalize 'YYYY-MM' / 'YYYY-MM-01' → 'YYYY-MM-01'; default current month (UTC). */
function resolveCycleIso(cycleMonth: string | undefined): string {
  if (cycleMonth) {
    return cycleMonth.length === 7 ? `${cycleMonth}-01` : cycleMonth;
  }
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-01`;
}

export async function handleWaiveRent(
  args: HandlerArgs<WaiveRentPayload>,
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

  const cycleIso = resolveCycleIso(payload.cycleMonth);

  const { data: eventRow, error: eventError } = await admin
    .from('rent_events')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('lease_id', resolved.id)
    .eq('cycle_month', cycleIso)
    .limit(1)
    .maybeSingle();

  if (eventError || !eventRow) {
    return {
      ok: false,
      error: eventError?.message ?? 'rent_cycle_not_found',
      confidence: 0,
    };
  }

  const outcome = await waiveRemainingBalance(admin, {
    rentEventId: eventRow.id,
    leaseId: resolved.id,
    organizationId,
    // Agent-committed waive: no human users.id — the audit actor lives on
    // the action_proposals row this handler runs from; reason names the agent.
    actorUserId: null,
    reason: payload.reason?.trim() || 'Waived via Odesa agent at owner request',
  });

  if (!outcome.ok) {
    return { ok: false, error: outcome.error, confidence: 0 };
  }

  return {
    ok: true,
    data: {
      leaseId: resolved.id,
      rentEventId: eventRow.id,
      cycleMonth: cycleIso,
      waivedDollars: outcome.waivedDollars,
    },
    confidence: resolved.byId ? 1.0 : 0.8,
    reasoning: outcome.alreadyWaived
      ? `Cycle ${cycleIso} was already waived; no change.`
      : `Waived $${outcome.waivedDollars} remaining on cycle ${cycleIso} for lease ${resolved.id}.`,
    idempotent: outcome.alreadyWaived,
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
  payload: WaiveRentPayload,
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
