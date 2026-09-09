/**
 * Unit tests for the nightly reflection loop.
 *
 * Mocks Anthropic + Supabase; asserts:
 *   - the right model + prompt are sent
 *   - vendor_signals → vendor_relationship facts with correct evidence
 *   - tenant patterns ≥0.6 confidence are recorded
 *   - low-confidence observations are dropped
 *   - reflection does NOT auto-record edits_worth_learning (synthesis owns
 *     that path)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runReflection } from '../reflection';
import {
  ORG_ID,
  PROPERTY_ID,
  VENDOR_ID,
  TENANT_ID,
  createMockState,
  createSupabaseMock,
  installAnthropicMock,
  makeProposalRow,
  resetCounter,
  uninstallAnthropicMock,
  type AnthropicMockState,
  type MockState,
} from './test-utils';
import { REFLECTION_MODEL } from '../llm';

describe('runReflection', () => {
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

  it('returns zeros when no proposals exist in the lookback window', async () => {
    const db = createSupabaseMock(state);

    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(result.proposalsScanned).toBe(0);
    expect(result.factsCreated).toBe(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('records vendor_relationship facts from vendor_signals', async () => {
    const proposal1 = makeProposalRow({
      action_type: 'dispatch_vendor',
      payload: { vendorId: VENDOR_ID, smsBody: 'AC unit on call' },
      status: 'committed',
    });
    state.actionProposals.push(proposal1);

    llm.responses.push(
      JSON.stringify({
        patterns_observed: [],
        edit_classifications: [],
        vendor_signals: [
          {
            vendor_id: VENDOR_ID,
            signal: 'owner_preferred',
            evidence_proposal_ids: [proposal1.id],
            notes: 'fast same-day response',
          },
        ],
        edits_worth_learning: [],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(result.proposalsScanned).toBe(1);
    expect(result.factsCreated).toBe(1);

    const inserted = state.inserts.find((i) => i.table === 'memory_facts');
    expect(inserted).toBeDefined();
    expect(inserted!.row.fact_type).toBe('vendor_relationship');
    expect(inserted!.row.subject_id).toBe(VENDOR_ID);
    expect(inserted!.row.source).toBe('observed');
    expect(inserted!.row.evidence_proposal_ids).toEqual([proposal1.id]);
    const content = inserted!.row.content as { owner_preferred: boolean };
    expect(content.owner_preferred).toBe(true);
  });

  it('uses the Haiku model and reflection system prompt', async () => {
    state.actionProposals.push(makeProposalRow());
    llm.responses.push('{"patterns_observed":[],"edit_classifications":[],"vendor_signals":[],"edits_worth_learning":[]}');

    const db = createSupabaseMock(state);
    await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.model).toBe(REFLECTION_MODEL);
    expect(llm.calls[0]!.system).toMatch(/property-management reflection agent/i);
    expect(llm.calls[0]!.userPrompt).toContain(`Property ID: ${PROPERTY_ID}`);
  });

  it('records tenant_pattern facts with ≥0.6 confidence', async () => {
    const proposal = makeProposalRow({
      action_type: 'draft_sms_reply',
      status: 'edited',
      edit_diff: { from: 'apologetic', to: 'firm' },
    });
    state.actionProposals.push(proposal);

    llm.responses.push(
      JSON.stringify({
        patterns_observed: [
          {
            subject_type: 'tenant',
            subject_id: TENANT_ID,
            pattern: 'prefers terse messaging without apologies',
            evidence_proposal_ids: [proposal.id],
            confidence: 0.75,
          },
        ],
        edit_classifications: [],
        vendor_signals: [],
        edits_worth_learning: [],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(result.factsCreated).toBe(1);
    const inserted = state.inserts.find((i) => i.table === 'memory_facts')!;
    expect(inserted.row.fact_type).toBe('tenant_pattern');
    expect(inserted.row.subject_id).toBe(TENANT_ID);
    expect(Number(inserted.row.confidence)).toBeCloseTo(0.75, 2);
  });

  it('drops observations with confidence < 0.6', async () => {
    state.actionProposals.push(makeProposalRow());
    llm.responses.push(
      JSON.stringify({
        patterns_observed: [
          {
            subject_type: 'tenant',
            subject_id: TENANT_ID,
            pattern: 'speculative',
            evidence_proposal_ids: ['p-1'],
            confidence: 0.4,
          },
        ],
        edit_classifications: [],
        vendor_signals: [],
        edits_worth_learning: [],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(result.factsCreated).toBe(0);
    expect(state.inserts.filter((i) => i.table === 'memory_facts')).toHaveLength(0);
  });

  it('does NOT auto-create memory_facts from edits_worth_learning', async () => {
    const proposal = makeProposalRow();
    state.actionProposals.push(proposal);

    llm.responses.push(
      JSON.stringify({
        patterns_observed: [],
        edit_classifications: [],
        vendor_signals: [],
        edits_worth_learning: [
          {
            rule_text: 'do not waive late fees',
            evidence_proposal_ids: [proposal.id],
            confidence: 0.9,
          },
        ],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    // edits_worth_learning is observation-only — synthesis owns rule writes.
    expect(result.factsCreated).toBe(0);
    expect(state.inserts.filter((i) => i.table === 'memory_facts')).toHaveLength(0);
    expect(result.journal?.edits_worth_learning).toHaveLength(1);
  });

  it('drops vendor_signals without a vendor_id', async () => {
    state.actionProposals.push(makeProposalRow());
    llm.responses.push(
      JSON.stringify({
        patterns_observed: [],
        edit_classifications: [],
        vendor_signals: [
          {
            vendor_id: '',
            signal: 'accepted',
            evidence_proposal_ids: ['p-1'],
            notes: 'no id',
          },
        ],
        edits_worth_learning: [],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(result.factsCreated).toBe(0);
  });

  it('survives malformed model JSON', async () => {
    state.actionProposals.push(makeProposalRow());
    llm.responses.push('not json at all');

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    expect(result.proposalsScanned).toBe(1);
    expect(result.factsCreated).toBe(0);
    expect(result.journal).toBeNull();
  });

  it('only scans the lookbackHours window', async () => {
    const oldProposal = makeProposalRow({
      id: '00000000-0000-0000-0000-00000000aa01',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    });
    const recentProposal = makeProposalRow({
      id: '00000000-0000-0000-0000-00000000aa02',
      created_at: new Date().toISOString(),
    });
    state.actionProposals.push(oldProposal, recentProposal);

    llm.responses.push('{"patterns_observed":[],"edit_classifications":[],"vendor_signals":[],"edits_worth_learning":[]}');

    const db = createSupabaseMock(state);
    const result = await runReflection({ db: db, propertyId: PROPERTY_ID });

    // lookback default 24h → only 1 proposal counted
    expect(result.proposalsScanned).toBe(1);
    expect(llm.calls[0]!.userPrompt).toContain(recentProposal.id);
    expect(llm.calls[0]!.userPrompt).not.toContain(oldProposal.id);
  });

  it('passes ORG_ID through via property lookup chain', async () => {
    state.actionProposals.push(makeProposalRow());

    llm.responses.push(
      JSON.stringify({
        patterns_observed: [
          {
            subject_type: 'building',
            subject_id: null,
            pattern: 'boiler kicks off below 10F',
            evidence_proposal_ids: ['p-1'],
            confidence: 0.7,
          },
        ],
        edit_classifications: [],
        vendor_signals: [],
        edits_worth_learning: [],
      }),
    );

    const db = createSupabaseMock(state);
    await runReflection({ db: db, propertyId: PROPERTY_ID });

    const inserted = state.inserts.find((i) => i.table === 'memory_facts')!;
    expect(inserted.row.organization_id).toBe(ORG_ID);
    expect(inserted.row.fact_type).toBe('building_quirk');
  });
});
