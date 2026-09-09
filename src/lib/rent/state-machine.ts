/**
 * Rent cycle state machine.
 *
 * One rent_event row per lease per cycle. The cron runs daily and
 * advances every event by at most one state per tick based on:
 *  - today's date relative to the due_date
 *  - whether payment has landed (amount_paid ≥ amount_due)
 *
 * Legal transitions (spec §7.1):
 *
 *   pending ─ 3 days before due ─▶ reminder_sent
 *   reminder_sent ─ due_date ─▶ due_sent
 *   due_sent ─ +1d ─▶ late_1
 *   late_1 ─ +2d ─▶ late_3
 *   late_3 ─ +4d ─▶ late_7
 *   late_7 ─ landlord notified ─▶ escalated
 *   any ─ payment received ─▶ paid
 *   any ─ plan accepted ─▶ plan_agreed
 *
 * `advance` is pure: given (state, daysUntilDue, paid), it returns the
 * next state. Wiring the actual side effects (SMS send, landlord SMS,
 * persistence) is the cron's job.
 */

import type { RentEventStatus } from '@/types/database';

export interface RentTickInput {
  current: RentEventStatus;
  daysUntilDue: number; // positive = future, negative = past-due
  amountDue: number;
  amountPaid: number;
}

export interface RentTickOutput {
  next: RentEventStatus;
  changed: boolean;
  sideEffect: RentSideEffect | null;
}

export type RentSideEffect =
  | 'send_reminder'
  | 'send_due_notice'
  | 'send_late_1_followup'
  | 'send_late_3_followup'
  | 'send_late_7_followup'
  | 'escalate_to_landlord'
  | 'none';

const REMINDER_DAYS_BEFORE = 3;

export function advanceRentEvent(input: RentTickInput): RentTickOutput {
  const { current, daysUntilDue, amountDue, amountPaid } = input;

  const paidInFull = amountPaid >= amountDue && amountDue > 0;
  if (paidInFull && current !== 'paid') {
    return { next: 'paid', changed: true, sideEffect: null };
  }

  // Linear transitions based on day offset. We do not skip states so a
  // late cron run still emits each reminder message exactly once.
  switch (current) {
    case 'pending':
      if (daysUntilDue <= REMINDER_DAYS_BEFORE && daysUntilDue > 0) {
        return { next: 'reminder_sent', changed: true, sideEffect: 'send_reminder' };
      }
      if (daysUntilDue <= 0) {
        return { next: 'due_sent', changed: true, sideEffect: 'send_due_notice' };
      }
      return { next: 'pending', changed: false, sideEffect: null };

    case 'reminder_sent':
      if (daysUntilDue <= 0) {
        return { next: 'due_sent', changed: true, sideEffect: 'send_due_notice' };
      }
      return { next: 'reminder_sent', changed: false, sideEffect: null };

    case 'due_sent':
      if (daysUntilDue <= -1) {
        return { next: 'late_1', changed: true, sideEffect: 'send_late_1_followup' };
      }
      return { next: 'due_sent', changed: false, sideEffect: null };

    case 'late_1':
      if (daysUntilDue <= -3) {
        return { next: 'late_3', changed: true, sideEffect: 'send_late_3_followup' };
      }
      return { next: 'late_1', changed: false, sideEffect: null };

    case 'late_3':
      if (daysUntilDue <= -7) {
        return { next: 'late_7', changed: true, sideEffect: 'send_late_7_followup' };
      }
      return { next: 'late_3', changed: false, sideEffect: null };

    case 'late_7':
      if (daysUntilDue <= -7) {
        return { next: 'escalated', changed: true, sideEffect: 'escalate_to_landlord' };
      }
      return { next: 'late_7', changed: false, sideEffect: null };

    case 'paid':
    case 'escalated':
    case 'plan_agreed':
      return { next: current, changed: false, sideEffect: null };

    default:
      return { next: current, changed: false, sideEffect: null };
  }
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso + 'T00:00:00Z').getTime();
  const to = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}
