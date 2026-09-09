import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  recordOutcome,
  OutcomeProposalNotFoundError,
  OutcomeRecordError,
  type MemoryExtractHook,
} from '../outcome';

const ORG = '00000000-0000-0000-0000-000000000001';
const PROP = '00000000-0000-0000-0000-000000000002';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000003';

type Row = Database['public']['Tables']['action_proposals']['Row'];

const baseRow = (overrides: Partial<Row> = {}): Row => ({
  id: PROPOSAL_ID,
  organization_id: ORG,
  property_id: PROP,
  worker_model: 'haiku-4-5',
  action_type: 'draft_sms_reply',
  payload: { body: 'hi', tone: 'warm' } as unknown as Row['payload'],
  reasoning: 'r',
  confidence: 0.9,
  context_fact_ids: [],
  gate_decision: 'auto',
  status: 'proposed',
  created_at: '2026-04-28T12:00:00Z',
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
});

// ---------------------------------------------------------------------------
// Mock builder. outcome.ts call order:
//   1. db.from('action_proposals').select(...).eq('id').maybeSingle()
//   2. db.from('action_proposals').update(...).eq('id').select().single()
//   3. db.from('properties').select('autonomy_level').eq('id').eq('organization_id').maybeSingle()
//   4. (optional) db.from('properties').update({ autonomy_level }).eq('id').eq('organization_id')
// ---------------------------------------------------------------------------

interface DbScript {
  loadProposal: { data: Row | null; error: null | { message: string } };
  updateProposal: { data: Row | null; error: null | { message: string } };
  loadProperty: { data: { autonomy_level: number } | null; error: null | { message: string } };
  updateProperty?: { error: null | { message: string } };
}

function buildDb(script: DbScript) {
  let proposalIdx = 0;
  let propertyIdx = 0;
  const updateProposalArg: { value: unknown } = { value: null };
  const updateProposalEqs: Array<[string, unknown]> = [];
  const updatePropertyArg: { value: unknown } = { value: null };

  const from = vi.fn((table: string) => {
    if (table === 'action_proposals') {
      const idx = proposalIdx++;
      if (idx === 0) {
        const maybeSingle = vi.fn(async () => script.loadProposal);
        const eq = vi.fn(() => ({ maybeSingle }));
        const select = vi.fn(() => ({ eq }));
        return { select };
      }
      const maybeSingle = vi.fn(async () => script.updateProposal);
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((column: string, value: unknown) => {
        updateProposalEqs.push([column, value]);
        return chain;
      });
      chain.maybeSingle = maybeSingle;
      const update = vi.fn((value) => {
        updateProposalArg.value = value;
        return chain;
      });
      return { update };
    }
    if (table === 'properties') {
      const idx = propertyIdx++;
      if (idx === 0) {
        // load autonomy_level
        const maybeSingle = vi.fn(async () => script.loadProperty);
        const eq2 = vi.fn(() => ({ maybeSingle }));
        const eq1 = vi.fn(() => ({ eq: eq2 }));
        const select = vi.fn(() => ({ eq: eq1 }));
        return { select };
      }
      // update autonomy_level
      const finalCall = vi.fn(async () => script.updateProperty ?? { error: null });
      const eq2 = vi.fn(() => finalCall());
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const update = vi.fn((value) => {
        updatePropertyArg.value = value;
        return { eq: eq1 };
      });
      return { update };
    }
    throw new Error(`unexpected from(${table})`);
  });

  const db = { from } as unknown as SupabaseClient<Database>;
  return {
    db,
    from,
    updateProposalArg,
    updateProposalEqs,
    updatePropertyArg,
  };
}

// ---------------------------------------------------------------------------

describe('recordOutcome', () => {
  it('persists committed outcome, graduates autonomy, and runs memory hook', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const committed = baseRow({ status: 'committed', committed_at: '2026-04-28T12:01:00Z' });

    const { db, updateProposalArg, updatePropertyArg } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: committed, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
      updateProperty: { error: null },
    });

    const memoryHook: MemoryExtractHook = vi.fn(async () => undefined);
    const result = await recordOutcome(
      db,
      { proposalId: PROPOSAL_ID, outcome: { kind: 'committed' } },
      memoryHook,
    );

    // Update payload structure
    expect((updateProposalArg.value as { status: string }).status).toBe('committed');
    expect((updateProposalArg.value as { committed_at?: string }).committed_at).toBeDefined();

    // Auto gate + committed status → +0.01
    expect(result.outcomeKind).toBe('committed');
    expect(result.graduation.delta).toBeCloseTo(0.01, 6);
    expect(result.graduation.next).toBeCloseTo(0.51, 6);
    expect((updatePropertyArg.value as { autonomy_level: number }).autonomy_level).toBeCloseTo(0.51, 6);
    expect(memoryHook).toHaveBeenCalledTimes(1);
  });

  it('lifts committed-after-review when gate_decision was review', async () => {
    const proposed = baseRow({ gate_decision: 'review' });
    const committed = baseRow({ gate_decision: 'review', status: 'committed' });

    const { db } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: committed, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
      updateProperty: { error: null },
    });

    const result = await recordOutcome(db, {
      proposalId: PROPOSAL_ID,
      outcome: { kind: 'committed' },
    });
    expect(result.outcomeKind).toBe('committed_after_review');
    expect(result.graduation.delta).toBeCloseTo(0.005, 6);
  });

  it('rejected outcome graduates autonomy down by 0.05', async () => {
    const proposed = baseRow();
    const rejected = baseRow({ status: 'rejected', rejected_at: 'now' });

    const { db, updateProposalArg } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: rejected, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
      updateProperty: { error: null },
    });

    const result = await recordOutcome(db, {
      proposalId: PROPOSAL_ID,
      outcome: { kind: 'rejected', reason: 'wrong tone' },
    });
    expect(result.outcomeKind).toBe('rejected');
    expect(result.graduation.delta).toBeCloseTo(-0.05, 6);
    expect(result.graduation.next).toBeCloseTo(0.45, 6);
    // outcome JSONB carries the reason
    const outcomeBlob = (updateProposalArg.value as { outcome: { reason?: string } }).outcome;
    expect(outcomeBlob.reason).toBe('wrong tone');
  });

  it('fails closed when a proposal changes after load and before rejection', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const { db, from, updateProposalEqs } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: null, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
    });

    await expect(
      recordOutcome(db, {
        proposalId: PROPOSAL_ID,
        outcome: { kind: 'rejected' },
      }),
    ).rejects.toThrow('proposal changed while being decided');

    expect(updateProposalEqs).toContainEqual(['status', 'proposed']);
    expect(
      from.mock.calls.filter(([table]) => table === 'properties'),
    ).toHaveLength(0);
  });

  it('never rewrites a terminal committed proposal as rejected', async () => {
    const committed = baseRow({
      status: 'committed',
      committed_at: '2026-04-28T12:01:00Z',
    });
    const { db, from } = buildDb({
      loadProposal: { data: committed, error: null },
      updateProposal: { data: null, error: { message: 'must not update' } },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
    });

    await expect(
      recordOutcome(db, {
        proposalId: PROPOSAL_ID,
        outcome: { kind: 'rejected', reason: 'late decision' },
      }),
    ).rejects.toBeInstanceOf(OutcomeRecordError);

    expect(
      from.mock.calls.filter(([table]) => table === 'action_proposals'),
    ).toHaveLength(1);
    expect(
      from.mock.calls.filter(([table]) => table === 'properties'),
    ).toHaveLength(0);
  });

  it('edited outcome stores edit_diff and graduates down by 0.02', async () => {
    const proposed = baseRow();
    const edited = baseRow({ status: 'edited', edit_diff: { body: ['old', 'new'] } as unknown as Row['edit_diff'] });

    const { db, updateProposalArg } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: edited, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
      updateProperty: { error: null },
    });

    const result = await recordOutcome(db, {
      proposalId: PROPOSAL_ID,
      outcome: { kind: 'edited', editDiff: { body: ['old', 'new'] } },
    });
    expect(result.outcomeKind).toBe('edited');
    expect(result.graduation.delta).toBeCloseTo(-0.02, 6);
    // edit_diff persisted
    expect(
      (updateProposalArg.value as { edit_diff?: { body: string[] } }).edit_diff,
    ).toEqual({ body: ['old', 'new'] });
  });

  it('expired outcome does NOT update properties.autonomy_level (delta=0)', async () => {
    const proposed = baseRow();
    const expired = baseRow({ status: 'expired' });

    const { db, from } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: expired, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
    });

    const result = await recordOutcome(db, {
      proposalId: PROPOSAL_ID,
      outcome: { kind: 'expired' },
    });
    expect(result.outcomeKind).toBe('expired');
    expect(result.graduation.delta).toBe(0);
    expect(result.autonomyPersisted).toBe(false);
    // properties.update should NOT have been called
    const propertiesUpdates = from.mock.calls
      .filter(([table]) => table === 'properties')
      .length;
    expect(propertiesUpdates).toBe(1); // only the load, not the update
  });

  it('throws OutcomeProposalNotFoundError when proposal is missing', async () => {
    const { db } = buildDb({
      loadProposal: { data: null, error: null },
      updateProposal: { data: null, error: null },
      loadProperty: { data: null, error: null },
    });
    await expect(
      recordOutcome(db, { proposalId: PROPOSAL_ID, outcome: { kind: 'committed' } }),
    ).rejects.toBeInstanceOf(OutcomeProposalNotFoundError);
  });

  it('refuses to record an outcome for a blocked proposal', async () => {
    // Blocked proposals never had a side effect; recording an outcome
    // would synthesize a fake observation and contaminate the trust
    // curve. The function should throw before persisting anything.
    const blocked = baseRow({ gate_decision: 'block' });
    const { db, from } = buildDb({
      loadProposal: { data: blocked, error: null },
      updateProposal: { data: null, error: { message: 'should not be reached' } },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
    });
    await expect(
      recordOutcome(db, { proposalId: PROPOSAL_ID, outcome: { kind: 'committed' } }),
    ).rejects.toBeInstanceOf(OutcomeRecordError);
    // exactly one action_proposals call (the load); no update.
    const proposalCalls = from.mock.calls
      .filter(([table]) => table === 'action_proposals')
      .length;
    expect(proposalCalls).toBe(1);
  });

  it('swallows memory-hook errors so the outcome record still wins', async () => {
    const proposed = baseRow();
    const committed = baseRow({ status: 'committed' });

    const { db } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: committed, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
      updateProperty: { error: null },
    });

    const memoryHook: MemoryExtractHook = vi.fn(async () => {
      throw new Error('memory module exploded');
    });

    // Should NOT throw — failure is swallowed.
    const result = await recordOutcome(
      db,
      { proposalId: PROPOSAL_ID, outcome: { kind: 'committed' } },
      memoryHook,
    );
    expect(result.outcomeKind).toBe('committed');
    expect(result.graduation.delta).toBeCloseTo(0.01, 6);
    expect(memoryHook).toHaveBeenCalled();
  });

  it('surfaces OutcomeRecordError when properties row is missing', async () => {
    const proposed = baseRow();
    const committed = baseRow({ status: 'committed' });

    const { db } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: committed, error: null },
      loadProperty: { data: null, error: null },
    });

    await expect(
      recordOutcome(db, { proposalId: PROPOSAL_ID, outcome: { kind: 'committed' } }),
    ).rejects.toBeInstanceOf(OutcomeRecordError);
  });

  it('persists outcomeMeta merged into the outcome JSONB', async () => {
    const proposed = baseRow();
    const committed = baseRow({ status: 'committed' });

    const { db, updateProposalArg } = buildDb({
      loadProposal: { data: proposed, error: null },
      updateProposal: { data: committed, error: null },
      loadProperty: { data: { autonomy_level: 0.5 }, error: null },
      updateProperty: { error: null },
    });

    await recordOutcome(db, {
      proposalId: PROPOSAL_ID,
      outcome: { kind: 'committed' },
      outcomeMeta: { tenantReplied: true, latencyMs: 1200 },
    });
    const outcome = (updateProposalArg.value as {
      outcome: { kind: string; tenantReplied?: boolean; latencyMs?: number };
    }).outcome;
    expect(outcome.kind).toBe('committed');
    expect(outcome.tenantReplied).toBe(true);
    expect(outcome.latencyMs).toBe(1200);
  });
});
