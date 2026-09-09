/**
 * Privacy-gated Retell dynamic variables — the FIRST disclosure channel of a
 * call (they land in the agent prompt before a word is spoken), so every value
 * here is gated by caller kind through `disclosureAllowed`.
 *
 * WHY this is its own module (extracted from webhook/route.ts):
 *   - The verified Retell contract injects `dynamic_variables` from the
 *     `call_inbound` webhook response, NOT the `call_started` event response
 *     (research note §3e / M6). Both the inbound route and the legacy
 *     call_started response therefore need the identical gated builder — one
 *     source of truth, reused, so the two channels can never diverge and leak.
 *   - The gate is deterministic: `unknown_caller` and `ambiguous` (and any kind
 *     lacking the matching grant) get `{}` — zero names, balances, unit labels,
 *     or owner facts. `buildDynamicVariables` is PURE so that invariant is
 *     unit-testable without a database.
 *
 * ALL values are strings (Retell dynamic variables are string-valued).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { disclosureAllowed, type DisclosureGrant } from './policy';
import type { ResolvedCaller } from './resolve-caller';

type Db = SupabaseClient<Database>;

/**
 * Pre-fetched, caller-scoped facts the pure builder assembles into string
 * variables. All fields optional: an absent fact simply omits its variable.
 */
export interface DynamicVariableFacts {
  resolved: ResolvedCaller;
  grant: DisclosureGrant;
  /** Verified tenant's active-lease unit label, when the unit has one. */
  unitLabel?: string | null;
  /** Ledger-honest status line for a verified tenant (always set for them). */
  ledgerStatusLine?: string | null;
  /** Open assignment count for a known vendor. */
  openJobCount?: number | null;
}

/**
 * Assemble the privacy-gated dynamic variables — PURE, no I/O.
 *
 * The gate mirrors the pre-extraction inline builder exactly:
 *   - verified_owner + ownerPortfolio  → caller_name?, briefing_hint
 *   - verified_tenant + ledger         → caller_name?, unit_label?, ledger_status_line
 *   - known_vendor   + vendorJobContext→ vendor_name?, open_job_count
 *   - everything else (unknown/ambiguous/missing grant) → {} (zero private data)
 *
 * @returns A string→string record; `{}` when the caller may hear nothing.
 */
export function buildDynamicVariables(facts: DynamicVariableFacts): Record<string, string> {
  const { resolved, grant } = facts;

  if (resolved.callerKind === 'verified_owner' && grant.ownerPortfolio) {
    return {
      ...(resolved.displayName ? { caller_name: resolved.displayName } : {}),
      briefing_hint: 'owner briefing available',
    };
  }

  if (resolved.callerKind === 'verified_tenant' && grant.ledger) {
    return {
      ...(resolved.displayName ? { caller_name: resolved.displayName } : {}),
      ...(facts.unitLabel ? { unit_label: facts.unitLabel } : {}),
      ...(facts.ledgerStatusLine != null ? { ledger_status_line: facts.ledgerStatusLine } : {}),
    };
  }

  if (resolved.callerKind === 'known_vendor' && grant.vendorJobContext) {
    return {
      ...(resolved.displayName ? { vendor_name: resolved.displayName } : {}),
      open_job_count: String(facts.openJobCount ?? 0),
    };
  }

  return {};
}

/**
 * Fetch the caller-scoped facts and build the gated variables. Used by BOTH
 * the `call_inbound` webhook and the legacy `call_started` response so the two
 * disclosure channels stay byte-identical. Only fetches what the grant permits
 * — an unknown/ambiguous caller triggers no private reads at all.
 */
export async function resolveDynamicVariables(
  db: Db,
  resolved: ResolvedCaller,
): Promise<Record<string, string>> {
  const grant = disclosureAllowed(resolved.callerKind);

  if (resolved.callerKind === 'verified_tenant' && grant.ledger) {
    const [unitLabel, ledgerLine] = await Promise.all([
      tenantUnitLabel(db, resolved.unitId),
      ledgerStatusLine(db, resolved.tenantId),
    ]);
    return buildDynamicVariables({ resolved, grant, unitLabel, ledgerStatusLine: ledgerLine });
  }

  if (resolved.callerKind === 'known_vendor' && grant.vendorJobContext) {
    return buildDynamicVariables({ resolved, grant, openJobCount: await openJobCount(db, resolved) });
  }

  // verified_owner needs no lookups; everyone else gets {}.
  return buildDynamicVariables({ resolved, grant });
}

async function tenantUnitLabel(db: Db, unitId: string | null): Promise<string | null> {
  if (!unitId) return null;
  const { data: unit } = await db.from('units').select('label').eq('id', unitId).maybeSingle();
  return unit?.label ?? null;
}

/**
 * Honest ledger phrasing, mirroring get_rent_status: "the ledger currently
 * shows …", NEVER a payment date — rent_events has no paid_at and updated_at
 * is mutation time, not payment evidence (Financials investigation 2026-07).
 */
async function ledgerStatusLine(db: Db, tenantId: string | null): Promise<string> {
  if (!tenantId) return 'no active lease on file';
  const { data: lease } = await db
    .from('leases')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  if (!lease) return 'no active lease on file';

  const { data: events } = await db
    .from('rent_events')
    .select('status, due_date, amount_due, amount_paid')
    .eq('lease_id', lease.id)
    .order('due_date', { ascending: false })
    .limit(1);
  const latest = events?.[0];
  if (!latest) return 'the ledger has no rent entries yet';

  if (latest.status === 'paid') {
    return `the ledger currently shows paid for ${latest.due_date}`;
  }
  const outstanding = Number(latest.amount_due) - Number(latest.amount_paid ?? 0);
  return `the ledger currently shows ${latest.status} for ${latest.due_date}; $${outstanding} outstanding`;
}

async function openJobCount(db: Db, resolved: ResolvedCaller): Promise<number> {
  if (!resolved.vendorId) return 0;
  const { count } = await db
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', resolved.organizationId)
    .eq('vendor_id', resolved.vendorId)
    .in('status', ['open', 'assigned', 'in_progress']);
  return count ?? 0;
}
