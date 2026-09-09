import { describe, expect, it } from 'vitest';

import { advanceRentEvent, daysBetween } from '../state-machine';

describe('advanceRentEvent', () => {
  it('transitions pending → reminder_sent 3 days before due', () => {
    const r = advanceRentEvent({
      current: 'pending',
      daysUntilDue: 3,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('reminder_sent');
    expect(r.sideEffect).toBe('send_reminder');
  });

  it('transitions pending → due_sent on the due date', () => {
    const r = advanceRentEvent({
      current: 'pending',
      daysUntilDue: 0,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('due_sent');
    expect(r.sideEffect).toBe('send_due_notice');
  });

  it('transitions reminder_sent → due_sent on the due date', () => {
    const r = advanceRentEvent({
      current: 'reminder_sent',
      daysUntilDue: 0,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('due_sent');
  });

  it('transitions due_sent → late_1 one day late', () => {
    const r = advanceRentEvent({
      current: 'due_sent',
      daysUntilDue: -1,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('late_1');
    expect(r.sideEffect).toBe('send_late_1_followup');
  });

  it('transitions late_1 → late_3 three days late', () => {
    const r = advanceRentEvent({
      current: 'late_1',
      daysUntilDue: -3,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('late_3');
  });

  it('transitions late_3 → late_7 seven days late', () => {
    const r = advanceRentEvent({
      current: 'late_3',
      daysUntilDue: -7,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('late_7');
  });

  it('transitions late_7 → escalated and emits landlord escalation', () => {
    const r = advanceRentEvent({
      current: 'late_7',
      daysUntilDue: -8,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('escalated');
    expect(r.sideEffect).toBe('escalate_to_landlord');
  });

  it('short-circuits to paid when amount_paid >= amount_due', () => {
    const r = advanceRentEvent({
      current: 'late_3',
      daysUntilDue: -5,
      amountDue: 2400,
      amountPaid: 2400,
    });
    expect(r.next).toBe('paid');
    expect(r.changed).toBe(true);
    expect(r.sideEffect).toBeNull();
  });

  it('does not revert once escalated or paid', () => {
    expect(
      advanceRentEvent({
        current: 'escalated',
        daysUntilDue: -30,
        amountDue: 2400,
        amountPaid: 0,
      }).changed,
    ).toBe(false);
    expect(
      advanceRentEvent({
        current: 'paid',
        daysUntilDue: -30,
        amountDue: 2400,
        amountPaid: 2400,
      }).changed,
    ).toBe(false);
  });

  it('does not advance pending more than 3 days out', () => {
    const r = advanceRentEvent({
      current: 'pending',
      daysUntilDue: 10,
      amountDue: 2400,
      amountPaid: 0,
    });
    expect(r.next).toBe('pending');
    expect(r.changed).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts positive days forward', () => {
    expect(daysBetween('2026-04-01', '2026-04-05')).toBe(4);
  });

  it('counts negative days backward', () => {
    expect(daysBetween('2026-04-10', '2026-04-05')).toBe(-5);
  });
});
