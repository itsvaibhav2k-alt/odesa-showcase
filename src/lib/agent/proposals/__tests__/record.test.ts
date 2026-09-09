import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  ProposalRecordError,
  recordProposal,
  rowToActionProposal,
} from '../record';
import type { DraftSmsReplyPayload } from '@/lib/agent/worker/types';

// ---------------------------------------------------------------------------
// Tiny Supabase mock — only the shape used by record.ts.
// ---------------------------------------------------------------------------
//
// from(...).insert(...).select(...).single()  → { data, error }

type SingleResult<T> = { data: T | null; error: null | { message: string } };

function makeInsertMock<T>(result: SingleResult<T>) {
  // Typed mocks so `mock.calls[0]![0]` is a one-tuple of the actual
  // call argument (insert row, select column-string, etc.). vi.fn()
  // with no arg infers `() => void`, which is why a bare vi.fn() loses
  // call args at the type level.
  const single = vi.fn(async () => result);
  const select = vi.fn<(cols: string) => { single: typeof single }>(() => ({
    single,
  }));
  const insert = vi.fn<(row: unknown) => { select: typeof select }>(() => ({
    select,
  }));
  const from = vi.fn<(table: string) => { insert: typeof insert }>(() => ({
    insert,
  }));
  const db = { from } as unknown as SupabaseClient<Database>;
  return { db, from, insert, select, single };
}

const ORG = '00000000-0000-0000-0000-000000000001';
const PROP = '00000000-0000-0000-0000-000000000002';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000003';
const TENANT = '00000000-0000-0000-0000-000000000004';
const CONV = '00000000-0000-0000-0000-000000000005';

const draftPayload: DraftSmsReplyPayload = { body: 'hi there', tone: 'warm' };
const createPropertyPayload = {
  name: 'Test Property',
  addressStreet: '1 Main St',
  addressCity: 'Arlington',
  addressState: 'VA',
  addressZip: '22201',
};

// Full row shape from the regenerated Database types. Used by tests
// that need a literal row to feed into rowToActionProposal or to seed
// the insert-mock's `data` field.
type Row = Database['public']['Tables']['action_proposals']['Row'];

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: PROPOSAL_ID,
    organization_id: ORG,
    property_id: PROP,
    worker_model: 'haiku-4-5',
    action_type: 'draft_sms_reply',
    payload: draftPayload as unknown as Row['payload'],
    reasoning: 'r',
    confidence: 0.9,
    context_fact_ids: null,
    gate_decision: 'auto',
    status: 'proposed',
    created_at: '2026-04-28T12:00:00.000Z',
    committed_at: null,
    rejected_at: null,
    edit_diff: null,
    execution_evidence: null,
    outcome: null,
    routing: null,
    retell_artifact_key: null,
    retryable: false,
    last_attempted_at: null,
    ...overrides,
  };
}

describe('recordProposal', () => {
  it('inserts with gate_decision=auto when thresholds clear', async () => {
    const { db, from, insert } = makeInsertMock({
      data: baseRow({
        action_type: 'create_property',
        payload: createPropertyPayload as unknown as Row['payload'],
        reasoning: 'owner asked to record a property',
        context_fact_ids: [],
      }),
      error: null,
    });

    const result = await recordProposal(db, {
      organizationId: ORG,
      propertyId: PROP,
      workerModel: 'haiku-4-5',
      actionType: 'create_property',
      payload: createPropertyPayload,
      reasoning: 'owner asked to record a property',
      confidence: 0.9,
      contextFactIds: [],
      autonomyLevel: 0.8,
      privacyMode: 'hosted',
      routing: null,
    });

    expect(from).toHaveBeenCalledWith('action_proposals');
    const insertedRow = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertedRow).toMatchObject({
      organization_id: ORG,
      property_id: PROP,
      worker_model: 'haiku-4-5',
      action_type: 'create_property',
      reasoning: 'owner asked to record a property',
      confidence: 0.9,
      gate_decision: 'auto',
      status: 'proposed',
    });
    // empty arrays come through as null per record.ts contract
    expect(insertedRow.context_fact_ids).toBeNull();
    expect(result.proposal.id).toBe(PROPOSAL_ID);
    expect(result.proposal.gate_decision).toBe('auto');
    expect(result.decision.outcome).toBe('auto');
  });

  it('inserts with gate_decision=review when confidence is below threshold', async () => {
    const { db, insert } = makeInsertMock({
      data: baseRow({
        reasoning: 'tenant asked rent total',
        context_fact_ids: ['fact-a'],
        gate_decision: 'review',
      }),
      error: null,
    });

    const result = await recordProposal(db, {
      organizationId: ORG,
      propertyId: PROP,
      workerModel: 'haiku-4-5',
      actionType: 'draft_sms_reply',
      payload: draftPayload,
      reasoning: 'tenant asked rent total',
      confidence: 0.2,
      contextFactIds: ['fact-a'],
      autonomyLevel: 0.5,
      privacyMode: 'hosted',
      routing: { tenantId: TENANT, conversationId: CONV },
    });

    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.gate_decision).toBe('review');
    expect(row.context_fact_ids).toEqual(['fact-a']);
    expect(result.decision.outcome).toBe('review');
  });

  it('throws ProposalRecordError when insert returns an error', async () => {
    const { db } = makeInsertMock({
      data: null,
      error: { message: 'rls denied' },
    });

    await expect(
      recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'draft_sms_reply',
        payload: draftPayload,
        reasoning: 'x',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.9,
        privacyMode: 'hosted',
        routing: { tenantId: TENANT, conversationId: CONV },
      }),
    ).rejects.toBeInstanceOf(ProposalRecordError);
  });

  it('throws when insert returns no row', async () => {
    const { db } = makeInsertMock({ data: null, error: null });
    await expect(
      recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'draft_sms_reply',
        payload: draftPayload,
        reasoning: 'x',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.9,
        privacyMode: 'hosted',
        routing: { tenantId: TENANT, conversationId: CONV },
      }),
    ).rejects.toThrow(/no row returned/);
  });

  it('caps the on-prem autonomy signal without lowering policy thresholds', async () => {
    const { db, insert } = makeInsertMock({
      data: baseRow({
        worker_model: 'ollama-llama3.3',
        action_type: 'polish_briefing',
        payload: { prose: 'A concise briefing.' } as unknown as Row['payload'],
        confidence: 0.95,
      }),
      error: null,
    });

    const result = await recordProposal(db, {
      organizationId: ORG,
      propertyId: PROP,
      workerModel: 'ollama-llama3.3',
      actionType: 'polish_briefing',
      payload: { prose: 'A concise briefing.' },
      reasoning: 'r',
      confidence: 0.95,
      contextFactIds: [],
      autonomyLevel: 1,
      privacyMode: 'on_prem',
      routing: { weeklyReportId: 'report-1' },
    });

    const row = insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(row.gate_decision).toBe('auto');
    expect(result.decision.appliedThreshold.autonomy).toBe(0.5);
    expect(result.decision.reason).toContain('autonomy 0.70 >= 0.5');
  });

  // -------------------------------------------------------------------------
  // Citation enforcement integration (ODESA_CITATION_ENFORCEMENT)
  // -------------------------------------------------------------------------
  //
  // The validator lives in worker/types.ts and the gate runs it through
  // commit-gate.gateProposal. recordProposal builds the citation input
  // unconditionally (contextFacts defaults to []) so the validator runs
  // on EVERY record path — including tenant-SMS (claude-draft.ts) and
  // scheduled (spawn-for-schedule.ts) callers that never had the fact
  // set in scope. Phase C of the reliability plan.

  it('routes ungrounded fact-shaped reasoning to review when flag is on', async () => {
    const prev = process.env.ODESA_CITATION_ENFORCEMENT;
    process.env.ODESA_CITATION_ENFORCEMENT = 'true';

    try {
      const { db, insert } = makeInsertMock({
        data: baseRow({
          action_type: 'create_property',
          payload: createPropertyPayload as unknown as Row['payload'],
          reasoning:
            'Marcus Lee usually pays late, so we should wait until end of month.',
          context_fact_ids: null,
          gate_decision: 'review',
        }),
        error: null,
      });

      const result = await recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'create_property',
        payload: createPropertyPayload,
        reasoning:
          'Marcus Lee usually pays late, so we should wait until end of month.',
        confidence: 0.9,
        contextFactIds: [],
        // contextFacts present → validator runs. Empty fact set means the
        // reasoning's name-mentioned tenant pattern has no citation to back
        // it; under the flag this forces review.
        contextFacts: [],
        autonomyLevel: 0.95,
        privacyMode: 'hosted',
        routing: null,
      });

      expect(result.decision.outcome).toBe('review');
      const row = insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(row.gate_decision).toBe('review');
    } finally {
      if (prev === undefined) {
        delete process.env.ODESA_CITATION_ENFORCEMENT;
      } else {
        process.env.ODESA_CITATION_ENFORCEMENT = prev;
      }
    }
  });

  it('runs the validator even when contextFacts is omitted (flag on → review)', async () => {
    const prev = process.env.ODESA_CITATION_ENFORCEMENT;
    process.env.ODESA_CITATION_ENFORCEMENT = 'true';

    try {
      const { db } = makeInsertMock({
        data: baseRow({
          action_type: 'create_property',
          payload: createPropertyPayload as unknown as Row['payload'],
          reasoning:
            'Marcus Lee usually pays late, so we should wait until end of month.',
          context_fact_ids: null,
          gate_decision: 'review',
        }),
        error: null,
      });

      // Same fact-shaped reasoning, contextFacts undefined — the
      // citation input is built unconditionally (facts default to []),
      // so under the flag the uncited claim still forces review. This
      // is the tenant-SMS / scheduled path shape: those callers never
      // pass contextFacts.
      const result = await recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'create_property',
        payload: createPropertyPayload,
        reasoning:
          'Marcus Lee usually pays late, so we should wait until end of month.',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.95,
        privacyMode: 'hosted',
        routing: null,
      });

      expect(result.decision.outcome).toBe('review');
    } finally {
      if (prev === undefined) {
        delete process.env.ODESA_CITATION_ENFORCEMENT;
      } else {
        process.env.ODESA_CITATION_ENFORCEMENT = prev;
      }
    }
  });

  it('fires the greppable shadow warn on a contextFacts-less call when the flag is off', async () => {
    const prev = process.env.ODESA_CITATION_ENFORCEMENT;
    delete process.env.ODESA_CITATION_ENFORCEMENT;
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const { db } = makeInsertMock({
        data: baseRow({
          action_type: 'create_property',
          payload: createPropertyPayload as unknown as Row['payload'],
          reasoning:
            'Marcus Lee usually pays late, so we should wait until end of month.',
          context_fact_ids: null,
          gate_decision: 'auto',
        }),
        error: null,
      });

      // Shadow mode (flag default-off): the validator runs even though
      // the caller supplied no contextFacts, logs the greppable
      // '[citation-enforcement:shadow]' warn for the 2-3 day
      // measurement, and leaves the base 'auto' outcome untouched.
      const result = await recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'create_property',
        payload: createPropertyPayload,
        reasoning:
          'Marcus Lee usually pays late, so we should wait until end of month.',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.95,
        privacyMode: 'hosted',
        routing: null,
      });

      expect(result.decision.outcome).toBe('auto');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]![0])).toContain(
        '[citation-enforcement:shadow]',
      );
    } finally {
      warnSpy.mockRestore();
      if (prev === undefined) {
        delete process.env.ODESA_CITATION_ENFORCEMENT;
      } else {
        process.env.ODESA_CITATION_ENFORCEMENT = prev;
      }
    }
  });
  // -------------------------------------------------------------------------
  // forceReview (Phase A4 — numeric grounding demotion)
  // -------------------------------------------------------------------------
  //
  // `forceReview` is a deterministic caller-side override: an 'auto'
  // gate outcome demotes to 'review' with the reason recorded; 'review'
  // (and 'block') outcomes pass through untouched. It never escalates.

  describe('forceReview', () => {
    it('should demote an auto outcome to review and record the reason', async () => {
      const { db, insert } = makeInsertMock({
        data: baseRow({
          action_type: 'create_property',
          payload: createPropertyPayload as unknown as Row['payload'],
          gate_decision: 'review',
        }),
        error: null,
      });

      const result = await recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'create_property',
        payload: createPropertyPayload,
        reasoning: 'owner asked to record a property',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.8,
        privacyMode: 'hosted',
        forceReview: { reason: 'ungrounded currency amounts in draft: $1,450' },
        routing: null,
      });

      expect(result.decision.outcome).toBe('review');
      expect(result.decision.reason).toContain(
        'ungrounded currency amounts in draft: $1,450',
      );
      const row = insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(row.gate_decision).toBe('review');
    });

    it('should leave a review outcome unchanged (no double demotion)', async () => {
      const { db, insert } = makeInsertMock({
        data: baseRow({ gate_decision: 'review' }),
        error: null,
      });

      // update_rulebook is review_only — base decision is already review.
      const result = await recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'update_rulebook',
        payload: { newRulebook: 'rules', diffSummary: 'd' },
        reasoning: 'r',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.9,
        privacyMode: 'hosted',
        forceReview: { reason: 'ungrounded currency amounts in draft: $50' },
        routing: null,
      });

      expect(result.decision.outcome).toBe('review');
      // The base review reason stands — forceReview did not rewrite it.
      expect(result.decision.reason).toBe('update_rulebook requires owner review');
      const row = insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(row.gate_decision).toBe('review');
    });

    it('should not change anything when forceReview is omitted', async () => {
      const { db } = makeInsertMock({
        data: baseRow({
          action_type: 'create_property',
          payload: createPropertyPayload as unknown as Row['payload'],
        }),
        error: null,
      });

      const result = await recordProposal(db, {
        organizationId: ORG,
        propertyId: PROP,
        workerModel: 'haiku-4-5',
        actionType: 'create_property',
        payload: createPropertyPayload,
        reasoning: 'r',
        confidence: 0.9,
        contextFactIds: [],
        autonomyLevel: 0.8,
        privacyMode: 'hosted',
        routing: null,
      });

      expect(result.decision.outcome).toBe('auto');
    });
  });
});

describe('rowToActionProposal', () => {
  it('parses a typical row into ActionProposal', () => {
    const proposal = rowToActionProposal(baseRow({ context_fact_ids: ['a', 'b'] }));
    expect(proposal.id).toBe(PROPOSAL_ID);
    expect(proposal.action_type).toBe('draft_sms_reply');
    expect(proposal.gate_decision).toBe('auto');
    expect(proposal.status).toBe('proposed');
    expect(proposal.context_fact_ids).toEqual(['a', 'b']);
  });

  it('coerces null context_fact_ids to []', () => {
    const proposal = rowToActionProposal(baseRow({ context_fact_ids: null }));
    expect(proposal.context_fact_ids).toEqual([]);
  });

  it('throws on unknown action_type', () => {
    expect(() => rowToActionProposal(baseRow({ action_type: 'unknown_verb' }))).toThrow(
      /unknown action_type/,
    );
  });

  it('throws on unknown status', () => {
    expect(() => rowToActionProposal(baseRow({ status: 'in_orbit' }))).toThrow(
      /unknown status/,
    );
  });

  it('throws on unknown gate_decision', () => {
    expect(() => rowToActionProposal(baseRow({ gate_decision: 'maybe' }))).toThrow(
      /unknown gate_decision/,
    );
  });
});
