/**
 * waiveRemainingBalance — forgive the outstanding balance of ONE rent cycle.
 *
 * The single money-path core shared by the /rent server action (RLS client)
 * and the agent worker handler (admin client + explicit org scope). Waive
 * semantics keep the financials honest:
 *
 *   - `amount_due` is lowered to `amount_paid` — collected never inflates
 *     (a waived month is NOT "paid"; no fabricated payment is recorded).
 *   - The forgiven amount + who/when/why land on the waive audit columns,
 *     so the original obligation is never lost.
 *   - `status` is NEVER written: deriveRentCycleStatus is balance-first,
 *     so balance→0 clears lateness everywhere on its own. The ledger shows
 *     "Waived" from `waived_at`, not from the enum.
 *
 * Concurrency: same bounded compare-and-swap as recordOfflinePaymentAction —
 * the UPDATE only lands while BOTH amount_due and amount_paid still hold the
 * values we read, so a racing payment/waive can never be clobbered. Zero rows
 * matched ⇒ retry; retries exhausted ⇒ honest error, never silent success.
 * Re-waiving an already-waived row reports ok with `alreadyWaived: true`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/** numeric(10,2) DOLLARS → integer cents (Supabase may return strings). */
function dollarsToCents(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const dollars = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/** Integer cents → 2-decimal DOLLARS safe for numeric(10,2). */
function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

const WAIVE_CAS_MAX_ATTEMPTS = 3;

export interface WaiveRentParams {
  /** The EXACT rent_events row the caller displayed/resolved. */
  rentEventId: string;
  leaseId: string;
  /** Org scope — load-bearing for the admin (service-role) client path. */
  organizationId: string;
  /** users.id of the human actor; null when the agent waives on request. */
  actorUserId: string | null;
  /** Why the month was forgiven — required; this is the audit trail. */
  reason: string;
}

export type WaiveRentOutcome =
  | { ok: true; waivedDollars: number; alreadyWaived: boolean }
  | { ok: false; error: string };

export async function waiveRemainingBalance(
  client: SupabaseClient<Database>,
  params: WaiveRentParams,
): Promise<WaiveRentOutcome> {
  const { rentEventId, leaseId, organizationId, actorUserId, reason } = params;

  for (let attempt = 0; attempt < WAIVE_CAS_MAX_ATTEMPTS; attempt += 1) {
    const { data: row, error: readError } = await client
      .from('rent_events')
      .select('id, amount_due, amount_paid, waived_at, waived_amount')
      .eq('id', rentEventId)
      .eq('lease_id', leaseId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (readError) return { ok: false, error: readError.message };
    if (!row) return { ok: false, error: 'Rent cycle not found' };

    if (row.waived_at) {
      return {
        ok: true,
        waivedDollars: centsToDollars(dollarsToCents(row.waived_amount)),
        alreadyWaived: true,
      };
    }

    const dueCents = dollarsToCents(row.amount_due);
    const paidCents = dollarsToCents(row.amount_paid);
    const balanceCents = dueCents - paidCents;

    if (balanceCents <= 0) {
      return { ok: false, error: 'Nothing outstanding to waive on this cycle' };
    }

    // amount_due drops to what was actually paid; the forgiven amount is
    // snapshotted. NEVER writes status or amount_paid. CAS predicate pins
    // BOTH money columns to the values we read.
    const { data: updated, error: updateError } = await client
      .from('rent_events')
      .update({
        amount_due: centsToDollars(paidCents),
        waived_at: new Date().toISOString(),
        waived_by: actorUserId,
        waived_reason: reason,
        waived_amount: centsToDollars(balanceCents),
      })
      .eq('id', rentEventId)
      .eq('lease_id', leaseId)
      .eq('organization_id', organizationId)
      .eq('amount_due', row.amount_due)
      .eq('amount_paid', row.amount_paid)
      .select('id, waived_amount');

    if (updateError) return { ok: false, error: updateError.message };

    // Zero rows ⇒ a concurrent payment/waive moved the balance. Retry.
    if (!updated || updated.length === 0) continue;

    return {
      ok: true,
      waivedDollars: centsToDollars(dollarsToCents(updated[0]!.waived_amount)),
      alreadyWaived: false,
    };
  }

  return {
    ok: false,
    error: 'Balance changed while waiving. Refresh and try again.',
  };
}
