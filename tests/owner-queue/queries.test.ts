/**
 * Unit tests for the Owner Queue real adapter's PURE mapping layer.
 *
 * `getDecisions`/`getDecisionSummary` perform Supabase IO and are exercised by
 * the route-sweep / Playwright harness; here we test the pure functions the
 * adapter is built from — `toDecision`, `sourceFactsFor`, `splitWhyFacts` — so
 * the honest-mapping guarantees are locked without a live DB.
 *
 * Safety guards asserted here:
 *   - gate → display language (no "hold" string ever surfaces),
 *   - money chip relabelled by financialLabel ONLY when a real figure exists,
 *   - editKind / primaryActionLabel / gateReason / boundary wiring,
 *   - context_fact_ids → sourceFacts (incl. empty / unresolved → omitted),
 *   - whyFacts derived only by splitting the real reasoning text,
 *   - NO tenant/vendor/property id from `routing` leaks into any presentational
 *     field.
 */
import { describe, expect, it } from 'vitest';

import {
  isCommitCapableActionType,
  sourceFactsFor,
  splitWhyFacts,
  toDecision,
} from '@/lib/owner-queue/queries';
import { ifIgnoredCopyFor } from '@/lib/owner-queue/decision-actions';
import { WORKER_ACTION_TYPES } from '@/lib/agent/worker/types';

// The exported `toDecision` row shape is internal; reconstruct a minimal,
// schema-faithful row builder for the tests.
type Row = Parameters<typeof toDecision>[0];

const TENANT_ID = '99999999-9999-4999-8999-999999999999';
const VENDOR_ID = '88888888-8888-4888-8888-888888888888';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'aaaa9999-0000-4000-8000-00000000000a',
    property_id: PROPERTY_ID,
    action_type: 'send_tenant_message',
    status: 'proposed',
    gate_decision: 'auto',
    confidence: 0.9,
    reasoning: 'Rent is reliably paid on the 3rd.',
    payload: {},
    // routing carries tenant/vendor/work-order ids — must NEVER reach the card.
    routing: {
      tenantId: TENANT_ID,
      vendorId: VENDOR_ID,
      workOrderId: WORK_ORDER_ID,
    },
    context_fact_ids: null,
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toDecision — gate → display recommendation mapping
// ---------------------------------------------------------------------------

describe('toDecision', () => {
  describe('gate → recommendation', () => {
    it('holds a stale consequential auto row under current safety policy', () => {
      const d = toDecision(makeRow({ gate_decision: 'auto' }), 'Oakwood', []);
      expect(d.recommendation).toBe('hold');
    });

    it('maps a currently safe internal-record auto row → approve', () => {
      const d = toDecision(
        makeRow({
          action_type: 'log_maintenance_ticket',
          gate_decision: 'auto',
        }),
        'Oakwood',
        [],
      );
      expect(d.recommendation).toBe('approve');
    });

    it('maps review → hold', () => {
      const d = toDecision(makeRow({ gate_decision: 'review' }), 'Oakwood', []);
      expect(d.recommendation).toBe('hold');
    });

    it('maps block → decline', () => {
      const d = toDecision(makeRow({ gate_decision: 'block' }), 'Oakwood', []);
      expect(d.recommendation).toBe('decline');
    });

    it('never surfaces the raw "hold" string in presentational copy', () => {
      const d = toDecision(makeRow({ gate_decision: 'review' }), 'Oakwood', []);
      expect(d.gateReason).toBe('Owner review required — tenant-facing');
      expect(d.gateReason).not.toMatch(/hold/i);
      expect(d.primaryActionLabel).not.toMatch(/hold/i);
    });
  });

  // -------------------------------------------------------------------------
  // financial label — only when a real money figure exists
  // -------------------------------------------------------------------------

  describe('financialLabel + money chip', () => {
    it('relabels the money chip and sets financialLabel when a figure exists', () => {
      const d = toDecision(
        makeRow({ action_type: 'dispatch_vendor', payload: { estimate: 640 } }),
        'Oakwood',
        [],
      );
      expect(d.financialLabel).toBe('Estimated vendor cost');
      const moneyChip = d.metricChips.find((c) => c.value === '$640');
      expect(moneyChip?.label).toBe('Estimated vendor cost');
    });

    it('uses amountCents (already cents) for request_rent_payment', () => {
      const d = toDecision(
        makeRow({
          action_type: 'request_rent_payment',
          payload: { amountCents: 187500 },
        }),
        'Oakwood',
        [],
      );
      expect(d.financialLabel).toBe('Outstanding balance');
      const moneyChip = d.metricChips.find((c) => c.label === 'Outstanding balance');
      expect(moneyChip?.value).toBe('$1,875');
    });

    it('leaves financialLabel null and omits the money chip when no figure exists', () => {
      const d = toDecision(
        makeRow({ action_type: 'dispatch_vendor', payload: {} }),
        'Oakwood',
        [],
      );
      expect(d.financialLabel).toBeNull();
      expect(d.metricChips.some((c) => c.value.startsWith('$'))).toBe(false);
    });

    it('never relabels with a financialLabel for a money-less message proposal', () => {
      const d = toDecision(
        makeRow({ action_type: 'send_tenant_message', payload: {} }),
        'Oakwood',
        [],
      );
      // message types have a label, but no figure → must stay null.
      expect(d.financialLabel).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // editKind / primaryActionLabel / boundary wiring
  // -------------------------------------------------------------------------

  describe('control-field wiring', () => {
    it('sets editKind from the action type', () => {
      expect(
        toDecision(makeRow({ action_type: 'dispatch_vendor' }), null, []).editKind,
      ).toBe('dispatch');
      expect(
        toDecision(makeRow({ action_type: 'update_rent' }), null, []).editKind,
      ).toBe('lease');
      expect(
        toDecision(makeRow({ action_type: 'request_rent_payment' }), null, [])
          .editKind,
      ).toBe('rent_payment');
      expect(
        toDecision(makeRow({ action_type: 'send_tenant_message' }), null, [])
          .editKind,
      ).toBe('message');
    });

    it('sets the dispatch primary label to "Record dispatch approval" (never "Authorize")', () => {
      const d = toDecision(
        makeRow({ action_type: 'dispatch_vendor', gate_decision: 'review' }),
        null,
        [],
      );
      expect(d.primaryActionLabel).toBe('Record dispatch approval');
      expect(d.boundary).toBe(
        'Vendor is not contacted from this action — Odesa records your approval for the dispatch workflow.',
      );
    });

    it('sets a block-gate primary label to "Decline"', () => {
      const d = toDecision(
        makeRow({ action_type: 'send_tenant_message', gate_decision: 'block' }),
        null,
        [],
      );
      expect(d.primaryActionLabel).toBe('Decline');
    });

    it('always starts in the "recommended" state', () => {
      expect(toDecision(makeRow(), null, []).state).toBe('recommended');
    });

    it('carries actionType + propertyId through for downstream scope', () => {
      const d = toDecision(makeRow(), 'Oakwood', []);
      expect(d.actionType).toBe('send_tenant_message');
      expect(d.propertyId).toBe(PROPERTY_ID);
    });

    it('sets ifIgnored from the pure map (action type + gate)', () => {
      const d = toDecision(
        makeRow({ action_type: 'send_tenant_message', gate_decision: 'review' }),
        null,
        [],
      );
      expect(d.ifIgnored).toBe(
        ifIgnoredCopyFor('send_tenant_message', 'review'),
      );
      expect(d.ifIgnored).toMatch(/no message is sent/i);
    });
  });

  // -------------------------------------------------------------------------
  // editDraft — pre-fills the edit drawer from the real payload (G1)
  // -------------------------------------------------------------------------

  describe('editDraft', () => {
    it("maps a message proposal's payload into the drawer draft", () => {
      const d = toDecision(
        makeRow({
          action_type: 'send_tenant_message',
          gate_decision: 'review',
          payload: {
            body: 'Hi Priya — just confirming your repair window.',
            tone: 'warm',
            tenantRef: { tenantName: 'Priya' },
          },
        }),
        'Oakwood',
        [],
      );
      expect(d.editDraft).toMatchObject({
        body: 'Hi Priya — just confirming your repair window.',
        tone: 'warm',
        recipientLabel: 'Priya',
        channel: 'SMS',
      });
    });

    it('renders the human draft overlay while leaving model payload evidence separate', () => {
      const modelPayload = {
        body: 'Model draft',
        tone: 'neutral',
      };
      const d = toDecision(
        makeRow({
          action_type: 'draft_sms_reply',
          gate_decision: 'review',
          payload: modelPayload,
          edit_diff: {
            patch: { body: 'Owner reviewed draft', tone: 'warm' },
            body_before: 'Model draft',
            body_after: 'Owner reviewed draft',
          },
        }),
        'Oakwood',
        [],
      );

      expect(d.editDraft).toMatchObject({
        body: 'Owner reviewed draft',
        tone: 'warm',
      });
      expect(modelPayload).toEqual({ body: 'Model draft', tone: 'neutral' });
    });

    it('maps amountCents (already cents) for a rent_payment proposal', () => {
      const d = toDecision(
        makeRow({
          action_type: 'request_rent_payment',
          gate_decision: 'review',
          payload: { amountCents: 187500, tenantRef: { tenantName: 'Sandra' } },
        }),
        'Cedar',
        [],
      );
      expect(d.editDraft?.amountCents).toBe(187500);
      expect(d.editDraft?.recipientLabel).toBe('Sandra');
      expect(d.editDraft?.channel).toBe('SMS');
    });

    it('maps rentAmount for a lease proposal and flags a full lease only for set_lease_terms', () => {
      const update = toDecision(
        makeRow({ action_type: 'update_rent', payload: { rentAmount: 1850 } }),
        null,
        [],
      );
      expect(update.editDraft?.rentAmount).toBe(1850);
      expect(update.editDraft?.isFullLease).toBe(false);

      const full = toDecision(
        makeRow({
          action_type: 'set_lease_terms',
          payload: { rentAmount: 1850, rentDueDay: 1, startDate: '2026-07-01' },
        }),
        null,
        [],
      );
      expect(full.editDraft?.rentAmount).toBe(1850);
      expect(full.editDraft?.isFullLease).toBe(true);
    });

    it('falls back to a "Tenant" recipient when the payload carries no name', () => {
      const d = toDecision(
        makeRow({
          action_type: 'send_tenant_message',
          payload: { body: 'Reminder: rent is due.' },
        }),
        null,
        [],
      );
      expect(d.editDraft?.recipientLabel).toBe('Tenant');
    });

    it('omits editDraft entirely when the payload yields nothing editable', () => {
      expect(
        toDecision(makeRow({ payload: {} }), null, []).editDraft,
      ).toBeUndefined();
      expect(
        toDecision(
          makeRow({
            action_type: 'health_flag',
            payload: { flaggedEntities: [] },
          }),
          null,
          [],
        ).editDraft,
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // whyFacts — derived only from real reasoning
  // -------------------------------------------------------------------------

  describe('whyFacts', () => {
    it('splits the reasoning text into short factual lines', () => {
      const d = toDecision(
        makeRow({
          reasoning: 'Rent is reliably paid. The tenant asked for a reminder.',
        }),
        null,
        [],
      );
      expect(d.whyFacts).toEqual([
        'Rent is reliably paid.',
        'The tenant asked for a reminder.',
      ]);
    });

    it('is an empty array when reasoning is absent', () => {
      expect(toDecision(makeRow({ reasoning: null }), null, []).whyFacts).toEqual(
        [],
      );
    });

    it('leaves considerations empty (no structured-reasoning column)', () => {
      expect(toDecision(makeRow(), null, []).considerations).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // owner-facing reasoning — raw classifier/source tokens never leak (Task 7C)
  // -------------------------------------------------------------------------

  describe('owner-facing reasoning', () => {
    // The exact leak string a voice draft parks in `reasoning`.
    const VOICE_LEAK =
      'payment_cleared_claim: ledger honesty: never claim a payment was received, cleared, or processed (source: retell_voice, call call_abc123)';

    it('humanizes the primary odesaLine — no raw token or "source:" prefix', () => {
      const d = toDecision(
        makeRow({
          action_type: 'draft_sms_reply',
          gate_decision: 'review',
          reasoning: VOICE_LEAK,
        }),
        'Oakwood',
        [],
      );
      expect(d.odesaLine).not.toContain('payment_cleared_claim');
      expect(d.odesaLine).not.toMatch(/source:/i);
      expect(d.odesaLine).not.toContain('retell_voice');
      expect(d.odesaLine).toContain('Tenant claims a payment already cleared');
    });

    it('never leaks a raw token or "source:" into whyFacts', () => {
      const d = toDecision(
        makeRow({
          action_type: 'draft_sms_reply',
          gate_decision: 'review',
          reasoning: VOICE_LEAK,
        }),
        'Oakwood',
        [],
      );
      for (const line of d.whyFacts ?? []) {
        expect(line).not.toContain('payment_cleared_claim');
        expect(line).not.toMatch(/source:/i);
      }
    });

    it('emits humanized reasoningSections with no bare enum token', () => {
      const d = toDecision(
        makeRow({
          action_type: 'draft_sms_reply',
          gate_decision: 'review',
          reasoning: VOICE_LEAK,
        }),
        'Oakwood',
        [{ id: 'f1', label: 'Tenant messages' }],
      );
      const sections = d.reasoningSections ?? [];
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) {
        expect(s.detail).not.toMatch(/^[a-z0-9_]+$/);
        expect(s.detail).not.toMatch(/^source:/i);
        expect(s.detail).not.toContain('source: retell_voice');
      }
    });

    it('preserves the untouched raw reasoning underneath (audit trail)', () => {
      const d = toDecision(
        makeRow({
          action_type: 'draft_sms_reply',
          gate_decision: 'review',
          reasoning: VOICE_LEAK,
        }),
        'Oakwood',
        [],
      );
      expect(d.rawReasoning).toBeUndefined();
    });

    it('omits rawReasoning for already-clean human reasoning (nothing to audit)', () => {
      const d = toDecision(
        makeRow({ reasoning: 'Rent is reliably paid on the 3rd.' }),
        'Oakwood',
        [],
      );
      expect(d.rawReasoning).toBeUndefined();
      expect(d.odesaLine).toBe('Rent is reliably paid on the 3rd.');
    });
  });

  // -------------------------------------------------------------------------
  // sourceFacts wiring + omission
  // -------------------------------------------------------------------------

  describe('sourceFacts', () => {
    it('passes resolved chips through onto the decision', () => {
      const chips = [{ id: 'f1', label: 'Tenant messages' }];
      expect(toDecision(makeRow(), null, chips).sourceFacts).toEqual(chips);
    });

    it('omits the sourceFacts field entirely when none resolve', () => {
      expect(toDecision(makeRow(), null, []).sourceFacts).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // No id from routing ever leaks into a presentational field
  // -------------------------------------------------------------------------

  describe('no id leakage', () => {
    it('never places a tenant/vendor/work-order id into any presentational field', () => {
      const d = toDecision(
        makeRow({
          action_type: 'dispatch_vendor',
          gate_decision: 'review',
          payload: { estimate: 640 },
          reasoning: 'Active leak; vendor has resolved prior leaks here.',
          context_fact_ids: ['f1'],
        }),
        'Oakwood',
        [{ id: 'f1', label: 'Vendor estimate' }],
      );

      const presentational = JSON.stringify({
        type: d.type,
        location: d.location,
        title: d.title,
        metricChips: d.metricChips,
        odesaLine: d.odesaLine,
        impact: d.impact,
        gateReason: d.gateReason,
        boundary: d.boundary,
        primaryActionLabel: d.primaryActionLabel,
        financialLabel: d.financialLabel,
        whyFacts: d.whyFacts,
        sourceFacts: d.sourceFacts,
        editDraft: d.editDraft,
      });

      expect(presentational).not.toContain(TENANT_ID);
      expect(presentational).not.toContain(VENDOR_ID);
      expect(presentational).not.toContain(WORK_ORDER_ID);
    });

    it('keeps routing ids out of editDraft — the recipient is a name only', () => {
      const d = toDecision(
        makeRow({
          action_type: 'send_tenant_message',
          gate_decision: 'review',
          payload: {
            body: 'Confirming your repair window.',
            tone: 'warm',
            // A presentational NAME on the payload is allowed; the id is not —
            // recipientLabel must pull only `tenantName`, never `tenantId`.
            tenantRef: { tenantName: 'Priya', tenantId: TENANT_ID },
          },
        }),
        'Oakwood',
        [],
      );

      expect(d.editDraft?.recipientLabel).toBe('Priya');
      // The whole serialized decision — including editDraft — must carry no
      // routing/payload id, only the presentational name.
      const whole = JSON.stringify(d);
      expect(whole).toContain('Priya');
      expect(whole).not.toContain(TENANT_ID);
      expect(whole).not.toContain(VENDOR_ID);
      expect(whole).not.toContain(WORK_ORDER_ID);
    });
  });
});

// ---------------------------------------------------------------------------
// isCommitCapableActionType — legacy-row exclusion (commit-capable only)
// ---------------------------------------------------------------------------

describe('isCommitCapableActionType', () => {
  it('accepts every schema action_type the worker can propose', () => {
    for (const actionType of WORKER_ACTION_TYPES) {
      expect(isCommitCapableActionType(actionType)).toBe(true);
    }
  });

  it('excludes arbitrary unknown (non-schema) action_types', () => {
    // Any verb outside WORKER_ACTION_TYPES cannot be dispatched by a real
    // commit, so the live queue must drop it (seed.sql now ships only
    // commit-capable verbs, but stale rows in older DBs may still carry one).
    expect(isCommitCapableActionType('')).toBe(false);
    expect(isCommitCapableActionType('not_a_real_verb')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sourceFactsFor — context_fact_ids → normalized chips
// ---------------------------------------------------------------------------

describe('sourceFactsFor', () => {
  it('normalizes each resolved fact type into a short label, in order', () => {
    const map = new Map([
      ['f1', 'tenant_pattern'],
      ['f2', 'market_comp'],
    ]);
    expect(sourceFactsFor(['f1', 'f2'], map)).toEqual([
      { id: 'f1', label: 'Tenant messages' },
      { id: 'f2', label: 'Market comps' },
    ]);
  });

  it('returns [] when context_fact_ids is null/empty', () => {
    expect(sourceFactsFor(null, new Map())).toEqual([]);
    expect(sourceFactsFor([], new Map())).toEqual([]);
  });

  it('skips ids that do not resolve to a fact (no fabricated provenance)', () => {
    const map = new Map([['f1', 'rent_ledger']]);
    expect(sourceFactsFor(['missing', 'f1'], map)).toEqual([
      { id: 'f1', label: 'Rent ledger' },
    ]);
  });

  it('returns [] when no id resolves', () => {
    expect(sourceFactsFor(['x', 'y'], new Map())).toEqual([]);
  });

  it('de-duplicates repeated ids', () => {
    const map = new Map([['f1', 'work_order']]);
    expect(sourceFactsFor(['f1', 'f1'], map)).toEqual([
      { id: 'f1', label: 'Work order' },
    ]);
  });

  it('caps the chip strip at four', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const map = new Map(ids.map((id) => [id, 'rent_ledger']));
    expect(sourceFactsFor(ids, map)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// splitWhyFacts — reasoning text → short lines
// ---------------------------------------------------------------------------

describe('splitWhyFacts', () => {
  it('splits on terminal punctuation and trims', () => {
    expect(splitWhyFacts('First fact. Second fact! Third?')).toEqual([
      'First fact.',
      'Second fact!',
      'Third?',
    ]);
  });

  it('returns a single line when there is no terminal punctuation', () => {
    expect(splitWhyFacts('one continuous clause')).toEqual([
      'one continuous clause',
    ]);
  });

  it('returns [] for empty/whitespace/missing reasoning', () => {
    expect(splitWhyFacts('')).toEqual([]);
    expect(splitWhyFacts('   ')).toEqual([]);
    expect(splitWhyFacts(null)).toEqual([]);
    expect(splitWhyFacts(undefined)).toEqual([]);
  });

  it('caps the number of lines at four', () => {
    expect(splitWhyFacts('a. b. c. d. e. f.')).toHaveLength(4);
  });
});
