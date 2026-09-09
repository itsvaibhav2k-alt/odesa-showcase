'use server';

/**
 * Server actions for the /rent ledger — lease / rent-term edits.
 *
 * `updateLeaseTermsAction` edits a lease's terms (rent_amount,
 * rent_due_day, end_date, one-way active→terminated status). Edits are
 * FUTURE-cycle only by design: the 06:00 generator re-reads the lease
 * daily and `uq_rent_events_lease_cycle` makes already-generated rows
 * permanent, while the 08:00 advancer only ever writes
 * `rent_events.status` — so nothing here can race the state machine.
 *
 * Optional "also update this month's unpaid cycle" path: EXACTLY one
 * conditional UPDATE on the current cycle's rent_events row, guarded by
 * `status='pending' AND amount_paid=0`. The WHERE is the CAS — if the
 * advancer flips status between our read and write, the UPDATE matches
 * 0 rows and we report that to the UI ("cycle already in progress").
 * NEVER writes rent_events.status or amount_paid. Note the Stripe
 * webhook reconciles amount_paid atomically alongside status via the
 * reconcile_succeeded_rent_payment RPC (amount_paid clamped at
 * amount_due, status derived from the balance), so BOTH clauses
 * exclude Stripe-paid rows — and both stay load-bearing for partials.
 *
 * Termination does NOT touch the open rent_event: it stays collectible
 * and keeps its reminder schedule until paid/escalated (rent_event_status
 * has no 'cancelled' value). Future generation stops structurally
 * (generateRentCycle filters status='active').
 *
 * All reads/writes go through the SSR client so RLS org-scopes them.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  can,
  FORBIDDEN_MESSAGE,
  type SensitiveCapability,
} from '@/lib/authz/policy';
import { dueDateFor } from '@/lib/rent/generate-cycle';
import { waiveRemainingBalance } from '@/lib/rent/waive';
import { createServerClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types';

interface AuthContext {
  userId: string;
  organizationId: string;
}

/**
 * Resolves the caller and enforces the owner-only role gate for `capability`
 * BEFORE any write. Fail closed: a missing/unknown role is Forbidden.
 */
async function requireAuthContext(
  capability: SensitiveCapability,
): Promise<ApiResponse<AuthContext>> {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: 'Not authenticated' };
  }
  const { data: userRow, error } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (error || !userRow) {
    return { success: false, error: 'User profile not found' };
  }
  if (!can(userRow.role, capability)) {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }
  return {
    success: true,
    data: { userId: user.id, organizationId: userRow.organization_id },
  };
}

function firstZodError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) return 'Validation failed';
  const path = first.path.map(String).join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * numeric(10,2) DOLLARS → integer cents. Defensive: Supabase can hand a
 * numeric column back as a string. All payment math runs in integer cents
 * so the dollars-vs-cents boundary never drifts.
 */
function dollarsToCents(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const dollars = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/** Integer cents → a 2-decimal DOLLARS number safe to write to numeric(10,2). */
function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

// Lenient UUID shape (mirrors `isUuidLike` in agent/worker/types.ts). zod 4's
// `.uuid()` strictly enforces the RFC-4122 variant nibble, which the seeded
// deterministic fixtures (e.g. 4444…4444) do not satisfy; the RLS-scoped DB
// lookup below is the real authority on whether the lease exists.
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidLike = z.string().regex(UUID_LIKE, 'Invalid UUID');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// rentDueDay caps at 28 to match setLeaseTermsPayloadSchema (the DB CHECK
// allows 1-31) so due-date clamping never diverges from the agent path.
const updateLeaseTermsSchema = z
  .object({
    leaseId: uuidLike,
    // Integer dollars to match setLeaseTermsPayloadSchema — the UI and the
    // agent path must accept the same values.
    rentAmount: z.number().int().positive(),
    rentDueDay: z.number().int().min(1).max(28),
    endDate: z
      .string()
      .regex(ISO_DATE, 'Expected YYYY-MM-DD')
      .nullable()
      .optional(),
    // ONE-WAY active→terminated. The DB enum value is 'terminated', not
    // 'ended' (set-lease-terms.ts maps 'ended'→'terminated').
    status: z.literal('terminated').optional(),
    alsoUpdateCurrentCycle: z.boolean().optional(),
  })
  .refine(
    (v) => !(v.status === 'terminated' && v.alsoUpdateCurrentCycle === true),
    {
      message: 'Cannot touch the current cycle while terminating the lease',
      path: ['alsoUpdateCurrentCycle'],
    },
  );

export interface UpdateLeaseTermsPayload {
  leaseId: string;
  rentAmount: number;
  rentDueDay: number;
  /** 'YYYY-MM-DD' to set, null to clear, undefined to leave unchanged. */
  endDate?: string | null;
  /** One-way: only 'terminated' is accepted. */
  status?: 'terminated';
  /** Also touch this month's rent_events row (pending + unpaid only). */
  alsoUpdateCurrentCycle?: boolean;
}

export interface UpdateLeaseTermsResult {
  leaseId: string;
  /** Whether the caller asked for the current-cycle touch. */
  currentCycleRequested: boolean;
  /** Rows the conditional UPDATE matched (0 = cycle already in progress). */
  currentCycleUpdated: number;
  /** Recomputed due_date written when the cycle row was touched. */
  currentCycleDueDate: string | null;
  /** Lease saved but the cycle touch failed — benign (future-only) but reported. */
  currentCycleError: string | null;
}

/** First-of-current-UTC-month, matching the 06:00 generator's period. */
function currentCycleMonthUtc(now: Date): { year: number; month: number; iso: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return { year, month, iso: `${year}-${String(month).padStart(2, '0')}-01` };
}

/**
 * Edit a lease's rent terms (future cycles) with an optional conditional
 * touch of the current month's still-pending, unpaid rent_events row.
 *
 * @param payload - Lease id + new terms; see `UpdateLeaseTermsPayload`.
 * @returns Affected-cycle accounting; `currentCycleUpdated === 0` with
 *   `currentCycleRequested` means "this month's cycle already in
 *   progress — change applies to future months".
 */
export async function updateLeaseTermsAction(
  payload: UpdateLeaseTermsPayload,
): Promise<ApiResponse<UpdateLeaseTermsResult>> {
  const auth = await requireAuthContext('change_lease_terms');
  if (!auth.success) return auth;

  const parsed = updateLeaseTermsSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const { leaseId, rentAmount, rentDueDay, endDate, status } = parsed.data;
  const alsoUpdateCurrentCycle = parsed.data.alsoUpdateCurrentCycle === true;

  const supabase = await createServerClient();

  // Read the lease first and fail closed: terminated/expired leases are
  // immutable from this surface. RLS hides cross-org leases entirely.
  const { data: leaseRow, error: leaseReadError } = await supabase
    .from('leases')
    .select('id, status')
    .eq('id', leaseId)
    .maybeSingle();

  if (leaseReadError || !leaseRow) {
    return { success: false, error: 'Lease not found' };
  }
  if (leaseRow.status === 'terminated' || leaseRow.status === 'expired') {
    return {
      success: false,
      error: `Lease is ${leaseRow.status} — terms can no longer be edited`,
    };
  }

  // 1. UPDATE leases first (RLS-scoped). No PostgREST transaction with the
  //    optional cycle touch — a lease-success/cycle-fail split is benign
  //    (future-only) and is reported via currentCycleError.
  const leaseUpdate: {
    rent_amount: number;
    rent_due_day: number;
    end_date?: string | null;
    status?: 'terminated';
  } = {
    rent_amount: rentAmount,
    rent_due_day: rentDueDay,
  };
  if (endDate !== undefined) leaseUpdate.end_date = endDate;
  if (status !== undefined) leaseUpdate.status = status;

  //    The status filter makes the write itself the guard: a lease
  //    terminated/expired concurrently (e.g. by the agent's
  //    set_lease_terms handler) between our read and write matches 0
  //    rows instead of being overwritten.
  const { data: updatedLease, error: leaseUpdateError } = await supabase
    .from('leases')
    .update(leaseUpdate)
    .eq('id', leaseId)
    .neq('status', 'terminated')
    .neq('status', 'expired')
    .select('id')
    .maybeSingle();

  if (leaseUpdateError) {
    return { success: false, error: leaseUpdateError.message };
  }
  if (!updatedLease) {
    return {
      success: false,
      error: 'Lease is terminated or expired — terms can no longer be edited',
    };
  }

  // 2. Optional current-cycle touch — EXACTLY one conditional UPDATE.
  //    The WHERE (status='pending' AND amount_paid=0) is the CAS guard:
  //    paid, advanced, partially-paid, and Stripe-paid rows all fall
  //    outside it, so they are never touched. NEVER writes status or
  //    amount_paid here.
  let currentCycleUpdated = 0;
  let currentCycleDueDate: string | null = null;
  let currentCycleError: string | null = null;

  if (alsoUpdateCurrentCycle) {
    const cycle = currentCycleMonthUtc(new Date());
    const clampedDueDate = dueDateFor(cycle.year, cycle.month, rentDueDay);

    const { data: touched, error: cycleUpdateError } = await supabase
      .from('rent_events')
      .update({ amount_due: rentAmount, due_date: clampedDueDate })
      .eq('lease_id', leaseId)
      .eq('cycle_month', cycle.iso)
      .eq('status', 'pending')
      .eq('amount_paid', 0)
      .select('id');

    if (cycleUpdateError) {
      currentCycleError = cycleUpdateError.message;
    } else {
      currentCycleUpdated = touched?.length ?? 0;
      if (currentCycleUpdated > 0) {
        currentCycleDueDate = clampedDueDate;
      }
    }
  }

  revalidatePath('/rent');

  return {
    success: true,
    data: {
      leaseId,
      currentCycleRequested: alsoUpdateCurrentCycle,
      currentCycleUpdated,
      currentCycleDueDate,
      currentCycleError,
    },
  };
}

// =====================================================================
// recordOfflinePaymentAction — record an offline/imported payment
// =====================================================================
//
// Increments `rent_events.amount_paid` (DOLLARS, numeric(10,2)) on the
// current cycle by the recorded amount, clamped at `amount_due` so a row
// can never report more collected than billed. NEVER writes the `status`
// enum: `deriveRentCycleStatus` is balance-first, so driving the balance
// to 0 yields `paid` automatically — the single source of truth is
// preserved. No `rent_payments` (Stripe) rows are created; no money moves.
//
// All math runs in integer cents to keep the dollars boundary honest.

const recordOfflinePaymentSchema = z.object({
  // The EXACT rent_events row the UI displayed — targeting by id (not a
  // recomputed cycle) is what makes the mutation hit the row the owner saw.
  rentEventId: uuidLike,
  leaseId: uuidLike,
  // DOLLARS received (may include cents). Clamped at amount_due in the action.
  amountDollars: z.number().positive(),
});

export interface RecordOfflinePaymentPayload {
  /** rent_events.id of the displayed cycle the payment is recorded against. */
  rentEventId: string;
  leaseId: string;
  /** Dollars received (positive; may include cents). */
  amountDollars: number;
}

export type RecordOfflinePaymentResult =
  | { ok: true; newOutstandingDollars: number }
  | { ok: false; error: string };

/** Bounded compare-and-swap retries before reporting a conflict. */
const PAYMENT_CAS_MAX_ATTEMPTS = 3;

/**
 * Record an offline/imported payment against the displayed rent cycle.
 *
 * Targets the EXACT `rent_events` row by id (+ lease_id for RLS/ownership),
 * never a recomputed current cycle, and increments `amount_paid` (clamped at
 * `amount_due`) with a conflict-safe compare-and-swap: the write only lands
 * when `amount_paid` is unchanged since our read, so two concurrent recordings
 * can never overwrite each other (no lost payments). The `status` enum is
 * never written; no `rent_payments`/Stripe row is created; no money moves.
 *
 * @param payload - `{ rentEventId, leaseId, amountDollars }`; amount positive.
 * @returns `{ ok: true, newOutstandingDollars }` or `{ ok: false, error }`.
 */
export async function recordOfflinePaymentAction(
  payload: RecordOfflinePaymentPayload,
): Promise<RecordOfflinePaymentResult> {
  const auth = await requireAuthContext('record_payment');
  if (!auth.success) return { ok: false, error: auth.error };

  const parsed = recordOfflinePaymentSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error.issues) };
  }

  const { rentEventId, leaseId, amountDollars } = parsed.data;
  const supabase = await createServerClient();

  // Read the lease first (RLS-scoped): fails closed when RLS hides it
  // (cross-org) and yields tenant_id / unit_id for path revalidation.
  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select('id, tenant_id, unit_id')
    .eq('id', leaseId)
    .maybeSingle();

  if (leaseError || !lease) {
    return { ok: false, error: 'Lease not found' };
  }

  const addCents = dollarsToCents(amountDollars);

  // Compare-and-swap with bounded retry. Each attempt re-reads the target
  // row, computes the clamped new paid total in integer cents, and writes
  // ONLY if amount_paid is still the value we read (the `.eq('amount_paid', …)`
  // predicate). A concurrent writer changing amount_paid makes the update match
  // zero rows → we retry; if it never settles we fail honestly rather than
  // silently lose the payment.
  for (let attempt = 0; attempt < PAYMENT_CAS_MAX_ATTEMPTS; attempt += 1) {
    const { data: eventRow, error: eventError } = await supabase
      .from('rent_events')
      .select('id, amount_due, amount_paid')
      .eq('id', rentEventId)
      .eq('lease_id', leaseId)
      .maybeSingle();

    if (eventError) {
      return { ok: false, error: eventError.message };
    }
    if (!eventRow) {
      return { ok: false, error: 'Rent cycle not found' };
    }

    const dueCents = dollarsToCents(eventRow.amount_due);
    const paidCents = dollarsToCents(eventRow.amount_paid);
    const newPaidCents = Math.min(dueCents, paidCents + addCents);
    const newPaidDollars = centsToDollars(newPaidCents);

    // amount_paid ONLY — NEVER status (deriveRentCycleStatus owns the derived
    // state; balance->0 yields 'paid' on its own). CAS predicate uses the exact
    // amount_paid we read so a racing write can't be clobbered.
    const { data: updatedRows, error: updateError } = await supabase
      .from('rent_events')
      .update({ amount_paid: newPaidDollars })
      .eq('id', rentEventId)
      .eq('lease_id', leaseId)
      .eq('amount_paid', eventRow.amount_paid)
      .select('id, amount_due, amount_paid');

    if (updateError) {
      return { ok: false, error: updateError.message };
    }

    // Zero rows => amount_paid moved between read and write. NEVER report
    // success on a no-op update; retry the read/compute/CAS cycle.
    if (!updatedRows || updatedRows.length === 0) {
      continue;
    }

    // Outstanding is derived ONLY from the persisted returned row, never the
    // pre-update computed value.
    const persisted = updatedRows[0]!;
    const newOutstandingDollars = centsToDollars(
      Math.max(
        dollarsToCents(persisted.amount_due) - dollarsToCents(persisted.amount_paid),
        0,
      ),
    );

    // Resolve the unit's property for unit/property revalidation (RLS-scoped).
    const { data: unit } = await supabase
      .from('units')
      .select('id, property_id')
      .eq('id', lease.unit_id)
      .maybeSingle();

    revalidatePath('/rent');
    revalidatePath('/financials');
    revalidatePath('/today');
    revalidatePath(`/tenants/${lease.tenant_id}`);
    if (unit) {
      revalidatePath(`/properties/${unit.property_id}`);
      revalidatePath(`/properties/${unit.property_id}/units/${unit.id}`);
    }

    return { ok: true, newOutstandingDollars };
  }

  // Retries exhausted: the balance kept moving under us. Fail honestly.
  return {
    ok: false,
    error: 'Balance changed while recording payment. Refresh and try again.',
  };
}

// =====================================================================
// waiveRentAction — forgive the remaining balance of one rent cycle
// =====================================================================
//
// Thin wrapper over the shared money-path core `waiveRemainingBalance`
// (src/lib/rent/waive.ts) — the same core the agent's `waive_rent` worker
// handler commits through, so UI and agent can never drift. Collected
// stays honest: amount_due drops to amount_paid (no fabricated payment),
// the forgiven amount + who/when/why land on the waive audit columns,
// and the status enum is never written (balance-first derivation).

const waiveRentSchema = z.object({
  // The EXACT rent_events row the UI displayed.
  rentEventId: uuidLike,
  leaseId: uuidLike,
  // Required audit trail — waiving is money forgiveness.
  reason: z.string().trim().min(3, 'Give a short reason').max(500),
});

export interface WaiveRentPayload {
  /** rent_events.id of the displayed cycle being waived. */
  rentEventId: string;
  leaseId: string;
  /** Why the month is forgiven (audit trail; 3-500 chars). */
  reason: string;
}

export type WaiveRentResult =
  | { ok: true; waivedDollars: number; alreadyWaived: boolean }
  | { ok: false; error: string };

/**
 * Waive (forgive) the outstanding balance of the displayed rent cycle.
 *
 * Targets the EXACT `rent_events` row by id (+ lease_id, RLS org scope) and
 * delegates to the shared CAS core: `amount_due` drops to `amount_paid`, the
 * forgiven amount is snapshotted with who/when/why, `status`/`amount_paid`
 * are never written, and concurrent payments can't be clobbered. No money
 * moves. Idempotent: re-waiving reports ok with `alreadyWaived`.
 *
 * @param payload - `{ rentEventId, leaseId, reason }`.
 * @returns `{ ok: true, waivedDollars, alreadyWaived }` or `{ ok, error }`.
 */
export async function waiveRentAction(
  payload: WaiveRentPayload,
): Promise<WaiveRentResult> {
  const auth = await requireAuthContext('waive_balance');
  if (!auth.success) return { ok: false, error: auth.error };

  const parsed = waiveRentSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: firstZodError(parsed.error.issues) };
  }

  const { rentEventId, leaseId, reason } = parsed.data;
  const supabase = await createServerClient();

  // Read the lease first (RLS-scoped): fails closed cross-org and yields
  // tenant/unit ids for path revalidation.
  const { data: lease, error: leaseError } = await supabase
    .from('leases')
    .select('id, tenant_id, unit_id')
    .eq('id', leaseId)
    .maybeSingle();

  if (leaseError || !lease) {
    return { ok: false, error: 'Lease not found' };
  }

  const outcome = await waiveRemainingBalance(supabase, {
    rentEventId,
    leaseId,
    organizationId: auth.data.organizationId,
    actorUserId: auth.data.userId,
    reason,
  });

  if (!outcome.ok) return outcome;

  const { data: unit } = await supabase
    .from('units')
    .select('id, property_id')
    .eq('id', lease.unit_id)
    .maybeSingle();

  revalidatePath('/rent');
  revalidatePath('/financials');
  revalidatePath('/today');
  revalidatePath(`/tenants/${lease.tenant_id}`);
  if (unit) {
    revalidatePath(`/properties/${unit.property_id}`);
    revalidatePath(`/properties/${unit.property_id}/units/${unit.id}`);
  }

  return outcome;
}
