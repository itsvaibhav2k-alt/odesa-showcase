/**
 * Monthly rent-cycle generator — the missing producer for `rent_events`.
 *
 * The seed (scripts/seed-cloud-galaxy.mjs) creates three historical
 * cycles per lease, but nothing rolled the ledger forward each month.
 * `generateRentCycle` closes that gap: for every ACTIVE lease whose
 * term overlaps the requested period it inserts one `rent_events` row
 * shaped exactly like the seed's —
 *
 *   { organization_id, lease_id, cycle_month: 'YYYY-MM-01',
 *     amount_due: rent_amount, amount_paid: 0, status: 'pending',
 *     due_date: 'YYYY-MM-<rent_due_day clamped to month length>' }
 *
 * so `listRentLedger()` (which matches on cycle_month = first of
 * month) and every downstream consumer read generated rows and seeded
 * rows identically.
 *
 * Semantics:
 *   - "active lease" = status='active' AND start_date/end_date (when
 *     set) overlap the period. The seed keeps ended leases at
 *     status='active' (e.g. Galaxy lease #10 / Jessica Kim is
 *     intentionally seeded already-expired relative to CURRENT_DATE), so
 *     the date check is load-bearing, not belt-and-braces.
 *   - No proration in v1: a lease ending mid-month still owes the full
 *     rent_amount for that cycle.
 *   - Leases with a null rent_amount are counted as `skippedNoAmount`
 *     — visible gaps for the operator, not errors. (The column is NOT
 *     NULL today; this guards future imports that relax it.)
 *
 * Idempotency is structural: `uq_rent_events_lease_cycle` — the unique
 * index on (lease_id, cycle_month) from the initial migration — makes
 * duplicate cycles impossible. We pre-read existing pairs to keep
 * re-runs write-free, and treat a 23505 on insert (a concurrent run
 * won the race) as "already generated".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export interface GenerateRentCycleOptions {
  /** Calendar month to generate, as 'YYYY-MM'. */
  period: string;
  /** Restrict to a single organization; omit to cover every org. */
  organizationId?: string;
}

export interface GenerateRentCycleResult {
  /** Echo of the requested period ('YYYY-MM'). */
  period: string;
  /** The rent_events.cycle_month value used ('YYYY-MM-01'). */
  cycleMonth: string;
  /** Active leases whose term overlaps the period (created+skipped+skippedNoAmount). */
  leases: number;
  /** Rows inserted by this run. */
  created: number;
  /** Cycles that already existed (pre-read hit or 23505 race). */
  skipped: number;
  /** In-term active leases with no rent_amount — visible gaps, not errors. */
  skippedNoAmount: number;
  /** status='active' leases whose start/end dates do not overlap the period. */
  skippedOutOfTerm: number;
}

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

interface EligibleLease {
  id: string;
  organization_id: string;
  rent_amount: number | null;
  rent_due_day: number;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Generate the given month's rent_events for every eligible lease.
 *
 * @param db - Service-role (or otherwise lease-readable) supabase client.
 * @param options - Period ('YYYY-MM') and optional organization scope.
 * @returns Per-bucket counts; created+skipped+skippedNoAmount === leases.
 * @throws {Error} On malformed period or any non-23505 database error.
 */
export async function generateRentCycle(
  db: SupabaseClient<Database>,
  options: GenerateRentCycleOptions,
): Promise<GenerateRentCycleResult> {
  const { period, organizationId } = options;
  const match = PERIOD_PATTERN.exec(period);
  if (!match) {
    throw new Error(
      `generate-rent-cycle: invalid period "${period}" — expected YYYY-MM`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const cycleMonth = `${period}-01`;
  const periodEnd = `${period}-${pad2(daysInMonth(year, month))}`;

  // 1. Every status='active' lease (optionally org-scoped).
  let leaseQuery = db
    .from('leases')
    .select('id, organization_id, rent_amount, rent_due_day, start_date, end_date')
    .eq('status', 'active');
  if (organizationId) {
    leaseQuery = leaseQuery.eq('organization_id', organizationId);
  }
  const { data: activeLeases, error: leaseError } = await leaseQuery;
  if (leaseError) {
    throw new Error(`generate-rent-cycle: lease query failed: ${leaseError.message}`);
  }

  // 2. Date-overlap filter: a lease is in term for the period when
  //    start_date (if set) is on/before the period's last day AND
  //    end_date (if set) is on/after the period's first day.
  const all = (activeLeases ?? []) as EligibleLease[];
  const inTerm = all.filter(
    (l) =>
      (l.start_date == null || l.start_date <= periodEnd)
      && (l.end_date == null || l.end_date >= cycleMonth),
  );
  const skippedOutOfTerm = all.length - inTerm.length;

  const billable = inTerm.filter((l) => l.rent_amount != null);
  const skippedNoAmount = inTerm.length - billable.length;

  // 3. Pre-read existing (lease_id, cycle_month) pairs so a re-run is
  //    write-free. The unique index backstops any race we miss here.
  let existingIds = new Set<string>();
  if (billable.length > 0) {
    const { data: existing, error: existingError } = await db
      .from('rent_events')
      .select('lease_id')
      .eq('cycle_month', cycleMonth)
      .in('lease_id', billable.map((l) => l.id));
    if (existingError) {
      throw new Error(
        `generate-rent-cycle: existing-cycle lookup failed: ${existingError.message}`,
      );
    }
    existingIds = new Set((existing ?? []).map((r) => r.lease_id));
  }

  // 4. Insert per-lease so one 23505 (concurrent generator won the
  //    race) can be counted as skipped without aborting the batch.
  let created = 0;
  let skipped = 0;
  for (const leaseRow of billable) {
    if (existingIds.has(leaseRow.id)) {
      skipped += 1;
      continue;
    }
    const { error: insertError } = await db.from('rent_events').insert({
      organization_id: leaseRow.organization_id,
      lease_id: leaseRow.id,
      cycle_month: cycleMonth,
      amount_due: leaseRow.rent_amount as number,
      amount_paid: 0,
      status: 'pending',
      due_date: dueDateFor(year, month, leaseRow.rent_due_day),
    });
    if (insertError) {
      if (insertError.code === '23505') {
        skipped += 1;
        continue;
      }
      throw new Error(
        `generate-rent-cycle: insert failed for lease ${leaseRow.id}: ${insertError.message}`,
      );
    }
    created += 1;
  }

  return {
    period,
    cycleMonth,
    leases: inTerm.length,
    created,
    skipped,
    skippedNoAmount,
    skippedOutOfTerm,
  };
}

/** Days in the given month; `month` is 1-based. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Due date for the cycle: rent_due_day clamped to the month's length
 * (31 → Jun 30). Exported so the lease-terms edit action recomputes the
 * current cycle's due_date with the exact same clamp the generator uses.
 *
 * @param year - Calendar year (e.g. 2026).
 * @param month - 1-based calendar month.
 * @param rentDueDay - Configured day-of-month rent is due.
 * @returns 'YYYY-MM-DD' due date for that month.
 */
export function dueDateFor(year: number, month: number, rentDueDay: number): string {
  const day = Math.min(Math.max(rentDueDay || 1, 1), daysInMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
