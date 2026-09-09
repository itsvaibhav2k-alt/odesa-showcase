/**
 * Canonical rent-cycle derivation — the ONE place lateness is decided.
 *
 * Pure module — no IO, no hidden clock (`todayIso` is injected). Every
 * page (Tenants, Rent, Properties, Today, Health) must consume this
 * instead of reading the `rent_event_status` enum directly, so the app
 * can never contradict itself about the same cycle.
 *
 * Precedence is BALANCE-FIRST: money facts beat stale enum values, and
 * the calendar beats a stale `pending`/`reminder_sent`/`due_sent` enum.
 *
 * No grace-period invention: `late_fee_policy.grace_days` affects FEES,
 * not status. Calendar past the due date is late; no grace period
 * exists yet.
 *
 * Label responsibility: this module produces canonical SHORT labels
 * only ('Paid', 'Due Jun 1', 'Overdue · 11 days', 'On plan',
 * 'Escalated'). Page-specific longer copy belongs in
 * `standingNarrative`, `buildAttention`, etc. — never here.
 */

import type { RentEventStatus, LeaseStatus } from '@/types/database';

import { diffDays, parseIsoDay } from './dates';

// Re-export the generated enum aliases so domain consumers never reach
// for (or invent) a parallel union.
export type { RentEventStatus, LeaseStatus };

/** Canonical derived state of a rent cycle. */
export type RentCycleKind = 'paid' | 'due' | 'late' | 'on_plan' | 'escalated' | 'unknown';
// 'unknown' is defensive-runtime only (malformed rows reaching the
// adapter); it must never appear from normal typed call sites.

/**
 * Minimum days-late implied by a late-tier enum when the date-derived
 * value is smaller or no due date exists. Date-derived late_3 at 12
 * days → 12; null due_date late_3 → 3; escalated null due_date → 7.
 */
export const LATE_STATUS_DAY_FLOOR = {
  late_1: 1,
  late_3: 3,
  late_7: 7,
  escalated: 7,
} as const;

/** Input for {@link deriveRentCycleStatus}. Money in integer cents. */
export interface RentCycleInput {
  status: RentEventStatus;
  /** 'YYYY-MM-DD' or null. */
  dueDate: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  /** 'YYYY-MM-DD', injected — no hidden clock. */
  todayIso: string;
}

/** Canonical derived rent-cycle status consumed by every page. */
export interface DerivedRentCycleStatus {
  kind: RentCycleKind;
  /** Canonical short display label, e.g. 'Paid' | 'Due Jun 1' | 'Overdue · 11 days'. */
  label: string;
  /** balanceCents > 0. */
  isOutstanding: boolean;
  isLate: boolean;
  isEscalated: boolean;
  isOnPlan: boolean;
  /** 0 when not late. */
  daysLate: number;
  /** max(due - paid, 0). */
  balanceCents: number;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const LATE_TIER_STATUSES = ['late_1', 'late_3', 'late_7'] as const;
const NOT_YET_DUE_STATUSES = ['pending', 'reminder_sent', 'due_sent'] as const;

type LateTierStatus = (typeof LATE_TIER_STATUSES)[number];

function isLateTier(status: string): status is LateTierStatus {
  return (LATE_TIER_STATUSES as readonly string[]).includes(status);
}

/** 'Due Jun 1' from already-validated parts. */
function dueLabel(dueDate: string): string {
  const parts = parseIsoDay(dueDate);
  if (parts === null) return 'Due';
  return `Due ${MONTH_SHORT[parts.m - 1]} ${parts.d}`;
}

/** 'Overdue · 11 days' (singular-aware). */
function overdueLabel(daysLate: number): string {
  return `Overdue · ${daysLate} day${daysLate === 1 ? '' : 's'}`;
}

function lateResult(daysLate: number, balanceCents: number): DerivedRentCycleStatus {
  return {
    kind: 'late',
    label: overdueLabel(daysLate),
    isOutstanding: true,
    isLate: true,
    isEscalated: false,
    isOnPlan: false,
    daysLate,
    balanceCents,
  };
}

/**
 * Derives the canonical rent-cycle status with balance-first precedence:
 *
 * 1. balance <= 0 → paid, regardless of stale enum (incl. stale
 *    `escalated`). A `paid` enum with `amount_paid < amount_due` is NOT
 *    trusted and falls through.
 * 2. `plan_agreed` with balance → on_plan. plan_agreed is never late,
 *    everywhere.
 * 3. `escalated` with balance → escalated, daysLate = max(7,
 *    date-derived when dueDate exists).
 * 4. balance, dueDate, today > dueDate → late. The date wins over a
 *    stale `pending`/`reminder_sent`/`due_sent` enum; for `late_*`
 *    enums, daysLate = max(tier floor, date-derived).
 * 5. balance, dueDate, today <= dueDate → due (due today is not late).
 * 6. balance, no dueDate → enum-derived only: `late_*` → late with the
 *    tier floor; `pending`/`reminder_sent`/`due_sent` → due; anything
 *    unrecognized → unknown. Never date-late without a date.
 *
 * @param input - Cycle facts; money in cents, dates as ISO days.
 * @returns The single derived status every surface must read from.
 */
export function deriveRentCycleStatus(input: RentCycleInput): DerivedRentCycleStatus {
  const balanceCents = Math.max(input.amountDueCents - input.amountPaidCents, 0);

  // Rule 1 — money wins: nothing owed is paid, full stop.
  if (balanceCents <= 0) {
    return {
      kind: 'paid',
      label: 'Paid',
      isOutstanding: false,
      isLate: false,
      isEscalated: false,
      isOnPlan: false,
      daysLate: 0,
      balanceCents: 0,
    };
  }

  // Defensive runtime: the adapter can hand us unrecognized strings.
  const status: string = input.status;

  // A malformed due date is treated as absent (rule 6 path).
  const dueDate =
    input.dueDate !== null && parseIsoDay(input.dueDate) !== null ? input.dueDate : null;
  const todayValid = parseIsoDay(input.todayIso) !== null;

  // Rule 2 — plan_agreed is never late, everywhere.
  if (status === 'plan_agreed') {
    return {
      kind: 'on_plan',
      label: 'On plan',
      isOutstanding: true,
      isLate: false,
      isEscalated: false,
      isOnPlan: true,
      daysLate: 0,
      balanceCents,
    };
  }

  const dateDaysLate =
    dueDate !== null && todayValid && input.todayIso > dueDate
      ? diffDays(input.todayIso, dueDate)
      : 0;

  // Rule 3 — escalated with a balance.
  if (status === 'escalated') {
    return {
      kind: 'escalated',
      label: 'Escalated',
      isOutstanding: true,
      isLate: true,
      isEscalated: true,
      isOnPlan: false,
      daysLate: Math.max(LATE_STATUS_DAY_FLOOR.escalated, dateDaysLate),
      balanceCents,
    };
  }

  if (dueDate !== null && todayValid) {
    // Rule 4 — calendar past due is late; the date wins over a stale enum.
    if (input.todayIso > dueDate) {
      const floor = isLateTier(status) ? LATE_STATUS_DAY_FLOOR[status] : 0;
      return lateResult(Math.max(dateDaysLate, floor), balanceCents);
    }

    // Rule 5 — due today (or later) is not late.
    return {
      kind: 'due',
      label: dueLabel(dueDate),
      isOutstanding: true,
      isLate: false,
      isEscalated: false,
      isOnPlan: false,
      daysLate: 0,
      balanceCents,
    };
  }

  // Rule 6 — no due date: enum-derived only. Never date-late without a date.
  if (isLateTier(status)) {
    return lateResult(LATE_STATUS_DAY_FLOOR[status], balanceCents);
  }

  if ((NOT_YET_DUE_STATUSES as readonly string[]).includes(status)) {
    return {
      kind: 'due',
      label: 'Due',
      isOutstanding: true,
      isLate: false,
      isEscalated: false,
      isOnPlan: false,
      daysLate: 0,
      balanceCents,
    };
  }

  return {
    kind: 'unknown',
    label: 'Unknown',
    isOutstanding: true,
    isLate: false,
    isEscalated: false,
    isOnPlan: false,
    daysLate: 0,
    balanceCents,
  };
}

/** DB row shape accepted by {@link rentCycleFromRow}. */
export interface RentCycleRow {
  status: string | null;
  due_date: string | null;
  /** DB numeric DOLLARS — may arrive as a string from Supabase. */
  amount_due: number | string | null;
  /** DB numeric DOLLARS — may arrive as a string from Supabase. */
  amount_paid: number | string | null;
}

/** Numeric dollars (number or Supabase string numeric) → integer cents. */
function dollarsToCents(value: number | string | null): number {
  if (value === null) return 0;
  const dollars = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

/**
 * Adapter for DB rows so call sites can't fumble units: converts the
 * numeric-dollar columns to cents and tolerates Supabase string
 * numerics, then defers to {@link deriveRentCycleStatus}.
 *
 * @param row - Raw `rent_events` columns (dollars).
 * @param todayIso - 'YYYY-MM-DD', injected — no hidden clock.
 * @returns The canonical derived status.
 */
export function rentCycleFromRow(row: RentCycleRow, todayIso: string): DerivedRentCycleStatus {
  return deriveRentCycleStatus({
    status: (row.status ?? 'unknown') as RentEventStatus,
    dueDate: row.due_date,
    amountDueCents: dollarsToCents(row.amount_due),
    amountPaidCents: dollarsToCents(row.amount_paid),
    todayIso,
  });
}
