/**
 * Unit tests for `buildOdesaLine` + `extractDraftVerb`.
 *
 * Exhaustively covers the priority ladder (review → escalated →
 * handled → default) plus the verb-extraction table. Every branch has
 * at least one positive and one "this should NOT fire" assertion so a
 * regression that flips priorities is caught.
 */
import { describe, expect, it } from 'vitest';

import {
  buildOdesaLine,
  extractDraftVerb,
} from '@/lib/inbox/odesa-line';
import type {
  PaymentSummary,
  WorkOrderSummary,
} from '@/lib/inbox/case-context';

const EMPTY_PAYMENTS: PaymentSummary = {
  onTimeCount: 0,
  totalRecent: 0,
  balanceCents: 0,
  daysLateTier: null,
};

function makeWorkOrder(
  overrides: Partial<WorkOrderSummary> = {},
): WorkOrderSummary {
  return {
    id: 'wo-1',
    category: 'plumbing',
    urgency: 'routine',
    status: 'open',
    openedAt: '2026-05-20T10:00:00.000Z',
    vendor: null,
    backupVendor: null,
    slaState: 'on_track',
    ...overrides,
  };
}

describe('extractDraftVerb', () => {
  it('returns "dispatch" for a body mentioning dispatch', () => {
    expect(extractDraftVerb('I will dispatch a plumber tomorrow.')).toBe(
      'dispatch',
    );
  });

  it('returns "scheduling" for schedul* bodies', () => {
    expect(extractDraftVerb('Scheduling the repair for Tuesday.')).toBe(
      'scheduling',
    );
  });

  it('returns "refund" for refund bodies', () => {
    expect(extractDraftVerb('We will issue a refund of $50.')).toBe('refund');
  });

  it('returns "cancellation" for cancel* bodies', () => {
    expect(extractDraftVerb('I will cancel the service request.')).toBe(
      'cancellation',
    );
  });

  it('returns "confirmation" for confirm* bodies', () => {
    expect(extractDraftVerb('Confirming your appointment for 2pm.')).toBe(
      'confirmation',
    );
  });

  it('returns "reminder" for remind* bodies', () => {
    expect(extractDraftVerb('A friendly reminder about the payment.')).toBe(
      'reminder',
    );
  });

  it('returns "follow-up" for follow-up bodies (hyphen, space, or compound)', () => {
    expect(extractDraftVerb('I will follow-up tomorrow.')).toBe('follow-up');
    expect(extractDraftVerb('I will follow up tomorrow.')).toBe('follow-up');
    expect(extractDraftVerb('Sending a followup soon.')).toBe('follow-up');
  });

  it('returns "question" for ask* bodies', () => {
    expect(extractDraftVerb('Asking about your preferences.')).toBe(
      'question',
    );
  });

  it('returns "apology" for apolog* bodies', () => {
    expect(extractDraftVerb('I apologize for the delay.')).toBe('apology');
  });

  it('returns "nudge" for nudg* bodies', () => {
    expect(extractDraftVerb('Sending a quick nudge.')).toBe('nudge');
  });

  it('returns "quote" for quote bodies', () => {
    expect(extractDraftVerb('Here is the quote for the work.')).toBe('quote');
  });

  it('returns "escalation" for escalat* bodies', () => {
    expect(extractDraftVerb('Escalating to the property manager.')).toBe(
      'escalation',
    );
  });

  it('prefers dispatch over send when both are present', () => {
    expect(
      extractDraftVerb('I will send the technician and dispatch the team.'),
    ).toBe('dispatch');
  });

  it('returns "reply" for bodies with no recognised verb', () => {
    expect(extractDraftVerb('Thanks for your message.')).toBe('reply');
  });

  it('returns "reply" for empty body', () => {
    expect(extractDraftVerb('')).toBe('reply');
  });
});

describe('buildOdesaLine', () => {
  describe('review branch', () => {
    it('returns Drafted a {verb} — awaiting your approval for pending draft', () => {
      const out = buildOdesaLine({
        pendingDraft: { body: 'Scheduling the repair.', reasoning: null },
        status: 'review',
        workOrder: null,
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe('Drafted a scheduling — awaiting your approval.');
      expect(out.emphasis).toEqual(['scheduling']);
    });

    it('names owner approval for a VA audience', () => {
      const out = buildOdesaLine({
        pendingDraft: { body: 'Drafting a reminder.', reasoning: null },
        status: 'review',
        workOrder: null,
        payments: EMPTY_PAYMENTS,
        audience: 'va',
      });

      expect(out.text).toBe('Drafted a reminder — awaiting owner approval.');
    });

    it('wins over escalated when both apply', () => {
      const out = buildOdesaLine({
        pendingDraft: { body: 'Confirming dispatch.', reasoning: null },
        status: 'review',
        workOrder: makeWorkOrder({ slaState: 'breached' }),
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toMatch(/^Drafted a dispatch/);
    });

    it('falls through when status is not review even with pendingDraft', () => {
      const out = buildOdesaLine({
        pendingDraft: { body: 'Hello', reasoning: null },
        status: 'handled',
        workOrder: null,
        payments: EMPTY_PAYMENTS,
      });
      // pending draft + status=handled → handled branch wins
      expect(out.text).toBe('Resolved. Watching for follow-up.');
    });
  });

  describe('escalated branch', () => {
    it('fires when status=escalated and SLA breached', () => {
      const out = buildOdesaLine({
        pendingDraft: null,
        status: 'escalated',
        workOrder: makeWorkOrder({ slaState: 'breached' }),
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe(
        'Vendor is past their ETA. Follow-up needs review.',
      );
      expect(out.emphasis).toContain('past their ETA');
      expect(out.emphasis).toContain('needs review');
    });

    it('does not fire if work order slaState is at_risk', () => {
      const out = buildOdesaLine({
        pendingDraft: null,
        status: 'escalated',
        workOrder: makeWorkOrder({ slaState: 'at_risk' }),
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe('Watching this thread.');
    });

    it('does not fire if work order is null', () => {
      const out = buildOdesaLine({
        pendingDraft: null,
        status: 'escalated',
        workOrder: null,
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe('Watching this thread.');
    });
  });

  describe('handled branch', () => {
    it('returns the resolved line when status=handled', () => {
      const out = buildOdesaLine({
        pendingDraft: null,
        status: 'handled',
        workOrder: null,
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe('Resolved. Watching for follow-up.');
      expect(out.emphasis).toEqual(['Resolved']);
    });
  });

  describe('default branch', () => {
    it('returns Watching this thread for status=draft', () => {
      const out = buildOdesaLine({
        pendingDraft: null,
        status: 'draft',
        workOrder: null,
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe('Watching this thread.');
      expect(out.emphasis).toEqual([]);
    });

    it('returns Watching this thread for status=escalated without breach', () => {
      const out = buildOdesaLine({
        pendingDraft: null,
        status: 'escalated',
        workOrder: makeWorkOrder({ slaState: 'on_track' }),
        payments: EMPTY_PAYMENTS,
      });
      expect(out.text).toBe('Watching this thread.');
    });
  });
});
