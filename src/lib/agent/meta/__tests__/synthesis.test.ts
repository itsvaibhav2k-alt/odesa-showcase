/**
 * Unit tests for the weekly synthesis loop.
 *
 * Covers the full Boop-ported 3-phase pipeline:
 *   - Phase 1 (Sonnet proposer) emits proposals
 *   - Phase 2 (Haiku adversary) returns challenges in correct order
 *   - Phase 3 (Sonnet judge) approves / rejects
 *
 * Assertions:
 *   - calls happen in the right order with the right models
 *   - merge writes new fact + supersedes the old ones
 *   - prune marks the fact superseded with no replacement
 *   - derive_rule queues an `update_rulebook` ActionProposal with
 *     gate_decision='review' (NEVER auto-applied)
 *   - rejected proposals are NOT applied
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSynthesis } from '../synthesis';
import {
  ORG_ID,
  PROPERTY_ID,
  VENDOR_ID,
  createMockState,
  createSupabaseMock,
  installAnthropicMock,
  makeFactRow,
  makeProposalRow,
  resetCounter,
  uninstallAnthropicMock,
  type AnthropicMockState,
  type MockState,
} from './test-utils';
import {
  SYNTHESIS_ADVERSARY_MODEL,
  SYNTHESIS_JUDGE_MODEL,
  SYNTHESIS_PROPOSER_MODEL,
} from '../llm';

describe('runSynthesis', () => {
  let state: MockState;
  let llm: AnthropicMockState;

  beforeEach(() => {
    resetCounter();
    state = createMockState();
    llm = installAnthropicMock();
  });

  afterEach(() => {
    uninstallAnthropicMock();
  });

  it('returns zeros when no facts exist', async () => {
    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.factsScanned).toBe(0);
    expect(result.proposalsCount).toBe(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('runs the three phases in proposer→adversary→judge order with the right models', async () => {
    state.memoryFacts.push(
      makeFactRow({
        fact_type: 'vendor_relationship',
        subject_id: VENDOR_ID,
        content: { acceptance_rate: 0.9, owner_preferred: true, performance_notes: '', last_used_at: null },
      }),
    );
    state.actionProposals.push(makeProposalRow());

    llm.responses.push(
      JSON.stringify({ proposals: [{ verb: 'prune', fact_id: state.memoryFacts[0]!.id, rationale: 'redundant' }] }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: null, severity: 'low' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: true, rationale: 'clean' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(llm.calls).toHaveLength(3);
    expect(llm.calls[0]!.model).toBe(SYNTHESIS_PROPOSER_MODEL);
    expect(llm.calls[1]!.model).toBe(SYNTHESIS_ADVERSARY_MODEL);
    expect(llm.calls[2]!.model).toBe(SYNTHESIS_JUDGE_MODEL);

    expect(llm.calls[0]!.system).toMatch(/property-memory consolidation proposer/i);
    expect(llm.calls[1]!.system).toMatch(/property-memory consolidation adversary/i);
    expect(llm.calls[2]!.system).toMatch(/property-memory consolidation judge/i);

    expect(result.pruned).toBe(1);
    expect(result.approvedCount).toBe(1);
  });

  it('applies merge: writes new fact and supersedes both keep + absorbed', async () => {
    const keepRow = makeFactRow({
      fact_type: 'vendor_relationship',
      subject_id: VENDOR_ID,
      content: { acceptance_rate: 0.8, owner_preferred: false, performance_notes: 'ok', last_used_at: null },
    });
    const absorbRow = makeFactRow({
      fact_type: 'vendor_relationship',
      subject_id: VENDOR_ID,
      content: { acceptance_rate: 0.7, owner_preferred: false, performance_notes: 'ok2', last_used_at: null },
    });
    state.memoryFacts.push(keepRow, absorbRow);

    llm.responses.push(
      JSON.stringify({
        proposals: [
          {
            verb: 'merge',
            keep_fact_id: keepRow.id,
            absorb_fact_ids: [absorbRow.id],
            rewrite_content: {
              acceptance_rate: 0.9,
              owner_preferred: true,
              performance_notes: 'consolidated; reliable',
              last_used_at: null,
            },
            rationale: 'identical vendor, refined notes',
          },
        ],
      }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: null, severity: 'low' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: true, rationale: 'clean merge' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.merged).toBe(1);

    // New fact persisted
    const inserts = state.inserts.filter((i) => i.table === 'memory_facts');
    expect(inserts).toHaveLength(1);
    const newRow = inserts[0]!.row as { content: { performance_notes: string } };
    expect(newRow.content.performance_notes).toBe('consolidated; reliable');

    // Both old rows superseded
    const updates = state.updates.filter((u) => u.table === 'memory_facts');
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const supersededRows = state.memoryFacts.filter((r) => r.superseded_at !== null);
    expect(supersededRows.map((r) => r.id).sort()).toEqual([keepRow.id, absorbRow.id].sort());
  });

  it('drops merge when absorb_fact_ids contains keep_fact_id (defensive)', async () => {
    const keepRow = makeFactRow({ fact_type: 'tenant_pattern' });
    state.memoryFacts.push(keepRow);

    llm.responses.push(
      JSON.stringify({
        proposals: [
          {
            verb: 'merge',
            keep_fact_id: keepRow.id,
            absorb_fact_ids: [keepRow.id],
            rewrite_content: keepRow.content,
            rationale: 'invalid',
          },
        ],
      }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: null, severity: 'low' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: true, rationale: 'ok' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.merged).toBe(0);
  });

  it('applies prune by marking superseded_at without a replacement', async () => {
    const row = makeFactRow({ fact_type: 'tenant_pattern' });
    state.memoryFacts.push(row);

    llm.responses.push(
      JSON.stringify({
        proposals: [{ verb: 'prune', fact_id: row.id, rationale: 'wrong fact' }],
      }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: null, severity: 'low' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: true, rationale: 'ok' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.pruned).toBe(1);
    const pruned = state.memoryFacts.find((r) => r.id === row.id)!;
    expect(pruned.superseded_at).not.toBeNull();
    expect(pruned.superseded_by).toBeNull();
  });

  it('does NOT apply rejected proposals', async () => {
    const row = makeFactRow({ fact_type: 'owner_rule' });
    state.memoryFacts.push(row);

    llm.responses.push(
      JSON.stringify({
        proposals: [{ verb: 'prune', fact_id: row.id, rationale: 'wants to drop owner rule' }],
      }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: 'cannot prune owner_rule', severity: 'high' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: false, rationale: 'rejected: owner rule' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.pruned).toBe(0);
    expect(result.rejectedCount).toBe(1);
    const stillActive = state.memoryFacts.find((r) => r.id === row.id)!;
    expect(stillActive.superseded_at).toBeNull();
  });

  it('rejects approved model IDs outside the property/org and protected owner rules', async () => {
    const local = makeFactRow({ fact_type: 'tenant_pattern' });
    const ownerRule = makeFactRow({
      fact_type: 'owner_rule',
      source: 'owner_stated',
      content: { rule_text: 'Never waive late fees.' },
    });
    const otherProperty = makeFactRow({
      property_id: '00000000-0000-0000-0000-000000000099',
      fact_type: 'tenant_pattern',
    });
    const otherOrganization = makeFactRow({
      organization_id: '00000000-0000-0000-0000-000000000099',
      property_id: PROPERTY_ID,
      fact_type: 'tenant_pattern',
    });
    state.memoryFacts.push(
      local,
      ownerRule,
      otherProperty,
      otherOrganization,
    );

    llm.responses.push(
      JSON.stringify({
        proposals: [
          { verb: 'prune', fact_id: otherProperty.id, rationale: 'hallucinated scope' },
          { verb: 'prune', fact_id: otherOrganization.id, rationale: 'wrong org' },
          { verb: 'prune', fact_id: ownerRule.id, rationale: 'drop owner contract' },
        ],
      }),
      JSON.stringify({ challenges: [] }),
      JSON.stringify({
        decisions: [
          { proposal_index: 0, approve: true, rationale: 'approved' },
          { proposal_index: 1, approve: true, rationale: 'approved' },
          { proposal_index: 2, approve: true, rationale: 'approved' },
        ],
      }),
    );

    const result = await runSynthesis({
      db: createSupabaseMock(state),
      propertyId: PROPERTY_ID,
    });

    expect(result.pruned).toBe(0);
    expect(state.updates).toHaveLength(0);
    expect(
      state.memoryFacts.every((fact) => fact.superseded_at === null),
    ).toBe(true);
  });

  it('only supersedes an owner rule with a newer owner-stated owner rule', async () => {
    const older = makeFactRow({
      fact_type: 'owner_rule',
      source: 'owner_stated',
      created_at: '2026-04-01T00:00:00.000Z',
      content: { rule_text: 'Old owner rule.' },
    });
    const newer = makeFactRow({
      fact_type: 'owner_rule',
      source: 'owner_stated',
      created_at: '2026-05-01T00:00:00.000Z',
      content: { rule_text: 'New owner rule.' },
    });
    state.memoryFacts.push(older, newer);
    llm.responses.push(
      JSON.stringify({
        proposals: [
          {
            verb: 'supersede',
            newer_fact_id: newer.id,
            older_fact_ids: [older.id],
            rationale: 'explicit owner correction',
          },
        ],
      }),
      JSON.stringify({ challenges: [] }),
      JSON.stringify({
        decisions: [
          { proposal_index: 0, approve: true, rationale: 'valid correction' },
        ],
      }),
    );

    const result = await runSynthesis({
      db: createSupabaseMock(state),
      propertyId: PROPERTY_ID,
    });

    expect(result.superseded).toBe(1);
    expect(older.superseded_by).toBe(newer.id);
    expect(newer.superseded_at).toBeNull();
  });

  it('queues an update_rulebook ActionProposal for derive_rule (gate_decision=review)', async () => {
    state.memoryFacts.push(makeFactRow({ fact_type: 'tenant_pattern' }));
    state.actionProposals.push(makeProposalRow({ status: 'edited' }));

    llm.responses.push(
      JSON.stringify({
        proposals: [
          {
            verb: 'derive_rule',
            rule_text: 'never apologize in late-fee SMS',
            evidence_proposal_ids: ['p-1', 'p-2', 'p-3'],
            rationale: '3+ owner edits removed apologies',
          },
        ],
      }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: null, severity: 'low' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: true, rationale: 'good evidence' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.rulesQueued).toBe(1);

    const queuedProposals = state.inserts.filter((i) => i.table === 'action_proposals');
    expect(queuedProposals).toHaveLength(1);
    const queued = queuedProposals[0]!.row as {
      action_type: string;
      gate_decision: string;
      status: string;
      organization_id: string;
      property_id: string;
    };
    expect(queued.action_type).toBe('update_rulebook');
    expect(queued.gate_decision).toBe('review');
    expect(queued.status).toBe('proposed');
    expect(queued.organization_id).toBe(ORG_ID);
    expect(queued.property_id).toBe(PROPERTY_ID);
  });

  it('passes the adversary all proposal indices and the judge sees the challenges', async () => {
    state.memoryFacts.push(
      makeFactRow({ fact_type: 'tenant_pattern' }),
      makeFactRow({ fact_type: 'building_quirk' }),
    );

    const fact1 = state.memoryFacts[0]!;
    const fact2 = state.memoryFacts[1]!;

    llm.responses.push(
      JSON.stringify({
        proposals: [
          { verb: 'prune', fact_id: fact1.id, rationale: 'r1' },
          { verb: 'prune', fact_id: fact2.id, rationale: 'r2' },
        ],
      }),
      JSON.stringify({
        challenges: [
          { proposal_index: 0, objection: null, severity: 'low' },
          { proposal_index: 1, objection: 'building quirks decay slow', severity: 'medium' },
        ],
      }),
      JSON.stringify({
        decisions: [
          { proposal_index: 0, approve: true, rationale: 'ok' },
          { proposal_index: 1, approve: false, rationale: 'keep quirk' },
        ],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.pruned).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.approvedCount).toBe(1);

    // Adversary user prompt includes both proposals
    expect(llm.calls[1]!.userPrompt).toContain('#0:');
    expect(llm.calls[1]!.userPrompt).toContain('#1:');
    // Judge user prompt should contain the challenge objection text
    expect(llm.calls[2]!.userPrompt).toContain('building quirks decay slow');
  });

  it('returns trace data for upstream observability', async () => {
    state.memoryFacts.push(makeFactRow({ fact_type: 'tenant_pattern' }));

    const proposal = { verb: 'prune', fact_id: state.memoryFacts[0]!.id, rationale: 'r' };
    llm.responses.push(
      JSON.stringify({ proposals: [proposal] }),
      JSON.stringify({ challenges: [{ proposal_index: 0, objection: null, severity: 'low' }] }),
      JSON.stringify({ decisions: [{ proposal_index: 0, approve: true, rationale: 'ok' }] }),
    );

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.trace.proposals).toHaveLength(1);
    expect(result.trace.challenges).toHaveLength(1);
    expect(result.trace.decisions).toHaveLength(1);
    expect(result.trace.decisions[0]!.approve).toBe(true);
  });

  it('survives malformed proposer JSON by returning zero results', async () => {
    state.memoryFacts.push(makeFactRow({ fact_type: 'tenant_pattern' }));

    llm.responses.push('garbage');
    // No further responses queued — adversary/judge should not be called

    const db = createSupabaseMock(state);
    const result = await runSynthesis({ db: db, propertyId: PROPERTY_ID });

    expect(result.proposalsCount).toBe(0);
    expect(llm.calls).toHaveLength(1);
  });
});
