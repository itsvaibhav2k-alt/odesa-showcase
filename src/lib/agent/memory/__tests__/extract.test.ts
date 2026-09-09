import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractFactsFromOutcome,
  type AnthropicMessageContract,
  type ProposalForExtraction,
} from '../extract';
import {
  PROPERTY_ID,
  TENANT_ID,
  VENDOR_ID,
  createMockState,
  createSupabaseMock,
  resetCounter,
  type MockState,
} from './test-utils';

const PROPOSAL: ProposalForExtraction = {
  id: 'proposal-1',
  propertyId: PROPERTY_ID,
  action_type: 'dispatch_vendor',
  // candidateIndex points into DispatchVendorInput.candidateVendorIds;
  // the orchestrator resolves it → routing.vendorId.
  payload: { candidateIndex: 0, smsBody: 'Hi Pete — water leak at 3rd floor unit B.' },
  routing: { vendorId: VENDOR_ID, workOrderId: 'wo-99' },
  reasoning: "Pete's Plumbing accepted last 4/4 dispatches",
  confidence: 0.85,
  context_fact_ids: [],
};

interface MockMessage {
  content: { type: 'text'; text: string }[];
}

function makeAnthropic(text: string): AnthropicMessageContract {
  const create = vi.fn(async () => ({ content: [{ type: 'text', text }] }) as MockMessage);
  return { messages: { create } } as unknown as AnthropicMessageContract;
}

describe('extractFactsFromOutcome', () => {
  let state: MockState;

  beforeEach(() => {
    resetCounter();
    state = createMockState();
  });

  it('records a vendor_relationship fact extracted from a committed dispatch', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(
      JSON.stringify({
        facts: [
          {
            factType: 'vendor_relationship',
            subjectId: VENDOR_ID,
            content: {
              acceptance_rate: 1.0,
              last_used_at: '2026-04-15T00:00:00Z',
              owner_preferred: true,
              performance_notes: '4/4 same-day acceptance',
            },
            confidence: 0.9,
            rationale: 'Sustained acceptance pattern',
          },
        ],
      }),
    );

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });

    expect(result.recorded).toHaveLength(1);
    expect(result.skipped).toBe(0);
    const fact = result.recorded[0]!;
    expect(fact.factType).toBe('vendor_relationship');
    if (fact.factType === 'vendor_relationship') {
      expect(fact.content.acceptance_rate).toBe(1);
      expect(fact.content.owner_preferred).toBe(true);
    }
    expect(fact.evidenceProposalIds).toEqual(['proposal-1']);
    expect(fact.source).toBe('observed');

    // Anthropic was called with Haiku 4.5
    const create = anthropic.messages.create as unknown as ReturnType<typeof vi.fn>;
    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0]![0] as {
      model: string;
      messages: Array<{ content: string }>;
    };
    expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
    // routing flows through to the prompt so the LLM can resolve
    // candidateIndex → vendorId for vendor_relationship subjectId.
    expect(callArgs.messages[0]!.content).toContain('"vendorId"');
    expect(callArgs.messages[0]!.content).toContain(VENDOR_ID);
  });

  it('records a derived_rule fact when owner edits show a pattern', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(
      JSON.stringify({
        facts: [
          {
            factType: 'derived_rule',
            subjectId: null,
            content: {
              rule_text: 'be direct, no apologies',
              supersedes_rule_id: null,
              evidence_count: 4,
            },
            confidence: 0.7,
          },
        ],
      }),
    );

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: { ...PROPOSAL, action_type: 'draft_sms_reply' },
      outcome: {
        status: 'edited',
        editDiff: { removed: 'sorry, ' },
      },
    });

    expect(result.recorded).toHaveLength(1);
    if (result.recorded[0]!.factType === 'derived_rule') {
      expect(result.recorded[0]!.content.rule_text).toBe('be direct, no apologies');
      expect(result.recorded[0]!.content.evidence_count).toBe(4);
    }
  });

  it('skips facts with invalid factType', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(
      JSON.stringify({
        facts: [
          { factType: 'made_up_type', subjectId: null, content: {} },
          {
            factType: 'building_quirk',
            subjectId: null,
            content: {
              description: 'noisy radiator on second floor',
              season: 'winter',
              recurring: true,
              severity: 0.5,
            },
            confidence: 0.6,
          },
        ],
      }),
    );

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });

    expect(result.recorded).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.recorded[0]!.factType).toBe('building_quirk');
  });

  it('refuses to extract owner_rule (those come from rulebook editor)', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(
      JSON.stringify({
        facts: [
          {
            factType: 'owner_rule',
            subjectId: null,
            content: { rule_text: 'never waive late fees', source_text: null },
          },
        ],
      }),
    );

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });
    expect(result.recorded).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('skips vendor_relationship without subjectId', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(
      JSON.stringify({
        facts: [
          {
            factType: 'vendor_relationship',
            subjectId: null,
            content: {
              acceptance_rate: 0.9,
              last_used_at: null,
              owner_preferred: false,
              performance_notes: '',
            },
          },
        ],
      }),
    );

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });
    expect(result.recorded).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('returns empty result when LLM returns no facts', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(JSON.stringify({ facts: [] }));

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'rejected' },
    });
    expect(result.recorded).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it('returns empty result when LLM returns garbage', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic('this is not json at all');

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });
    expect(result.recorded).toHaveLength(0);
  });

  it('swallows Anthropic errors — never aborts the caller', async () => {
    const db = createSupabaseMock(state);
    const anthropic: AnthropicMessageContract = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('rate limited')),
      } as unknown as AnthropicMessageContract['messages'],
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });
    expect(result.recorded).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('throws when proposal.id is null (only persisted proposals can be extracted)', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic('{"facts":[]}');

    await expect(
      extractFactsFromOutcome({
        db,
        anthropic,
        propertyId: PROPERTY_ID,
        proposal: { ...PROPOSAL, id: null },
        outcome: { status: 'committed' },
      }),
    ).rejects.toThrow(/proposal\.id is null/);
  });

  it('clamps caller-supplied confidence to [0, 1] in extracted tenant_pattern', async () => {
    const db = createSupabaseMock(state);
    const anthropic = makeAnthropic(
      JSON.stringify({
        facts: [
          {
            factType: 'tenant_pattern',
            subjectId: TENANT_ID,
            content: {
              payment_cadence: 'pays the day before due',
              communication_style: 'verbose',
              complaint_themes: ['noise'],
              last_observed_at: '2026-04-15T00:00:00Z',
            },
            confidence: 1.5,
          },
        ],
      }),
    );

    const result = await extractFactsFromOutcome({
      db,
      anthropic,
      propertyId: PROPERTY_ID,
      proposal: PROPOSAL,
      outcome: { status: 'committed' },
    });
    expect(result.recorded[0]!.confidence).toBe(1);
  });
});
