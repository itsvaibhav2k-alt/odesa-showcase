import { describe, it, expect } from 'vitest';
import {
  deriveRentCycleStatus,
  rentCycleFromRow,
  LATE_STATUS_DAY_FLOOR,
  type RentCycleInput,
  type RentEventStatus,
} from '@/lib/domain/rent-cycle';

/** Convenience builder with sane defaults; override per test. */
function input(overrides: Partial<RentCycleInput>): RentCycleInput {
  return {
    status: 'pending',
    dueDate: '2026-06-01',
    amountDueCents: 2000_00,
    amountPaidCents: 0,
    todayIso: '2026-06-12',
    ...overrides,
  };
}

describe('rent-cycle', () => {
  describe('LATE_STATUS_DAY_FLOOR', () => {
    it('should map each late tier to its day floor', () => {
      expect(LATE_STATUS_DAY_FLOOR.late_1).toBe(1);
      expect(LATE_STATUS_DAY_FLOOR.late_3).toBe(3);
      expect(LATE_STATUS_DAY_FLOOR.late_7).toBe(7);
      expect(LATE_STATUS_DAY_FLOOR.escalated).toBe(7);
    });
  });

  describe('deriveRentCycleStatus', () => {
    it('should derive late for the audit case: unpaid past-due pending is never current', () => {
      // Arrange — the Vaibhav case: due Jun 1, today Jun 12, $2,000 due, $0 paid.
      const cycle = input({ status: 'pending' });

      // Act
      const result = deriveRentCycleStatus(cycle);

      // Assert
      expect(result.kind).toBe('late');
      expect(result.isLate).toBe(true);
      expect(result.isOutstanding).toBe(true);
      expect(result.daysLate).toBe(11);
      expect(result.balanceCents).toBe(2000_00);
      expect(result.label).toBe('Overdue · 11 days');
    });

    it('should derive late when a stale paid enum has a partial balance past due', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'paid', amountPaidCents: 500_00 }),
      );

      expect(result.kind).toBe('late');
      expect(result.isLate).toBe(true);
      expect(result.balanceCents).toBe(1500_00);
      expect(result.daysLate).toBe(11);
    });

    it('should derive paid when a pending enum is fully paid', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'pending', amountPaidCents: 2000_00 }),
      );

      expect(result.kind).toBe('paid');
      expect(result.label).toBe('Paid');
      expect(result.isLate).toBe(false);
      expect(result.isOutstanding).toBe(false);
      expect(result.daysLate).toBe(0);
      expect(result.balanceCents).toBe(0);
    });

    it('should derive paid when overpaid (balance clamps to zero)', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'pending', amountPaidCents: 2500_00 }),
      );

      expect(result.kind).toBe('paid');
      expect(result.balanceCents).toBe(0);
    });

    it('should derive on_plan, never late, for plan_agreed with a past-due balance', () => {
      const result = deriveRentCycleStatus(input({ status: 'plan_agreed' }));

      expect(result.kind).toBe('on_plan');
      expect(result.label).toBe('On plan');
      expect(result.isOnPlan).toBe(true);
      expect(result.isOutstanding).toBe(true);
      expect(result.isLate).toBe(false);
      expect(result.daysLate).toBe(0);
    });

    it('should derive paid for an escalated enum with zero balance', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'escalated', amountPaidCents: 2000_00 }),
      );

      expect(result.kind).toBe('paid');
      expect(result.isEscalated).toBe(false);
      expect(result.isLate).toBe(false);
    });

    it('should floor escalated daysLate at 7 when due_date is null', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'escalated', dueDate: null }),
      );

      expect(result.kind).toBe('escalated');
      expect(result.label).toBe('Escalated');
      expect(result.isEscalated).toBe(true);
      expect(result.isLate).toBe(true);
      expect(result.daysLate).toBe(7);
    });

    it('should use the date-derived daysLate for escalated when it exceeds the floor', () => {
      const result = deriveRentCycleStatus(input({ status: 'escalated' }));

      expect(result.kind).toBe('escalated');
      expect(result.daysLate).toBe(11);
    });

    it('should derive due, not late, when due_date is today', () => {
      const result = deriveRentCycleStatus(input({ todayIso: '2026-06-01' }));

      expect(result.kind).toBe('due');
      expect(result.label).toBe('Due Jun 1');
      expect(result.isLate).toBe(false);
      expect(result.isOutstanding).toBe(true);
      expect(result.daysLate).toBe(0);
    });

    it('should derive due with a dated label when due_date is in the future', () => {
      const result = deriveRentCycleStatus(input({ todayIso: '2026-05-20' }));

      expect(result.kind).toBe('due');
      expect(result.label).toBe('Due Jun 1');
      expect(result.isLate).toBe(false);
    });

    it('should derive due, not late, for a pending enum with null due_date', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'pending', dueDate: null }),
      );

      expect(result.kind).toBe('due');
      expect(result.label).toBe('Due');
      expect(result.isLate).toBe(false);
      expect(result.daysLate).toBe(0);
    });

    it('should derive late with the tier floor for late_3 and null due_date', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'late_3', dueDate: null }),
      );

      expect(result.kind).toBe('late');
      expect(result.isLate).toBe(true);
      expect(result.daysLate).toBe(3);
    });

    it('should take the max of tier floor and date-derived days: late_3 at 12 days is 12', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'late_3', dueDate: '2026-05-31' }),
      );

      expect(result.kind).toBe('late');
      expect(result.daysLate).toBe(12);
    });

    it('should take the tier floor when it exceeds the date-derived days: late_7 at 2 days is 7', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'late_7', dueDate: '2026-06-10' }),
      );

      expect(result.kind).toBe('late');
      expect(result.daysLate).toBe(7);
    });

    it('should treat calendar past due date as late; no grace period exists yet', () => {
      // grace_days affects fees only, not status — one day past due is late.
      const result = deriveRentCycleStatus(
        input({ status: 'pending', dueDate: '2026-06-11' }),
      );

      expect(result.kind).toBe('late');
      expect(result.isLate).toBe(true);
      expect(result.daysLate).toBe(1);
      expect(result.label).toBe('Overdue · 1 day');
    });

    it('should let the date win over stale reminder_sent and due_sent enums', () => {
      for (const status of ['reminder_sent', 'due_sent'] as RentEventStatus[]) {
        const result = deriveRentCycleStatus(input({ status }));
        expect(result.kind).toBe('late');
        expect(result.daysLate).toBe(11);
      }
    });

    it('should derive unknown for an unrecognized status with balance and null due_date', () => {
      // Defensive runtime only — malformed rows reaching the adapter.
      const result = deriveRentCycleStatus(
        input({ status: 'bogus_status' as RentEventStatus, dueDate: null }),
      );

      expect(result.kind).toBe('unknown');
      expect(result.isOutstanding).toBe(true);
      expect(result.isLate).toBe(false);
      expect(result.daysLate).toBe(0);
    });

    it('should never date-late without a date: stale paid enum, balance, null due_date is unknown', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'paid', dueDate: null, amountPaidCents: 500_00 }),
      );

      expect(result.kind).toBe('unknown');
      expect(result.isLate).toBe(false);
    });

    it('should treat a malformed due_date as null (rule 6 path)', () => {
      const result = deriveRentCycleStatus(
        input({ status: 'pending', dueDate: 'not-a-date' }),
      );

      expect(result.kind).toBe('due');
      expect(result.isLate).toBe(false);
    });
  });

  describe('rentCycleFromRow', () => {
    it('should convert numeric dollar amounts to cents (the audit row)', () => {
      const result = rentCycleFromRow(
        {
          status: 'pending',
          due_date: '2026-06-01',
          amount_due: 2000,
          amount_paid: 0,
        },
        '2026-06-12',
      );

      expect(result.kind).toBe('late');
      expect(result.daysLate).toBe(11);
      expect(result.balanceCents).toBe(2000_00);
    });

    it('should tolerate string numerics from Supabase', () => {
      const result = rentCycleFromRow(
        {
          status: 'pending',
          due_date: '2026-06-01',
          amount_due: '2000.00',
          amount_paid: '500.50',
        },
        '2026-06-12',
      );

      expect(result.kind).toBe('late');
      expect(result.balanceCents).toBe(1499_50);
    });

    it('should treat null amounts as zero', () => {
      const result = rentCycleFromRow(
        { status: 'pending', due_date: null, amount_due: null, amount_paid: null },
        '2026-06-12',
      );

      expect(result.kind).toBe('paid');
      expect(result.balanceCents).toBe(0);
    });

    it('should derive unknown for a malformed status with a balance and no date', () => {
      const result = rentCycleFromRow(
        { status: 'something_new', due_date: null, amount_due: 100, amount_paid: 0 },
        '2026-06-12',
      );

      expect(result.kind).toBe('unknown');
      expect(result.isOutstanding).toBe(true);
      expect(result.isLate).toBe(false);
    });

    it('should treat non-numeric amount strings as zero, not NaN', () => {
      const result = rentCycleFromRow(
        { status: 'pending', due_date: null, amount_due: 'oops', amount_paid: null },
        '2026-06-12',
      );

      expect(result.balanceCents).toBe(0);
      expect(result.kind).toBe('paid');
    });
  });
});
