import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmbedFactContent } = vi.hoisted(() => ({
  mockEmbedFactContent: vi.fn(),
}));

vi.mock('../embed', () => ({
  embedFactContent: mockEmbedFactContent,
}));

import { recordFact } from '../record';
import {
  ORG_ID,
  PROPERTY_ID,
  TENANT_ID,
  VENDOR_ID,
  createMockState,
  createSupabaseMock,
  resetCounter,
  setForcedError,
  type MockState,
} from './test-utils';

describe('recordFact', () => {
  let state: MockState;

  beforeEach(() => {
    resetCounter();
    state = createMockState();
    mockEmbedFactContent.mockReset().mockResolvedValue(null);
  });

  it('inserts a vendor_relationship fact and returns the typed row', async () => {
    const db = createSupabaseMock(state);

    const fact = await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'vendor_relationship',
        subjectId: VENDOR_ID,
        content: {
          acceptance_rate: 0.9,
          last_used_at: '2026-04-15T00:00:00Z',
          owner_preferred: true,
          performance_notes: 'two same-day jobs',
        },
        source: 'observed',
        evidenceProposalIds: ['p-1', 'p-2'],
      },
    });

    expect(fact.factType).toBe('vendor_relationship');
    if (fact.factType === 'vendor_relationship') {
      expect(fact.content.acceptance_rate).toBe(0.9);
      expect(fact.content.owner_preferred).toBe(true);
    }
    expect(fact.organizationId).toBe(ORG_ID);
    expect(fact.propertyId).toBe(PROPERTY_ID);
    expect(fact.evidenceProposalIds).toEqual(['p-1', 'p-2']);

    expect(state.inserts).toHaveLength(1);
    const inserted = state.inserts[0]!.row;
    expect(inserted.organization_id).toBe(ORG_ID);
    expect(inserted.property_id).toBe(PROPERTY_ID);
    expect(inserted.fact_type).toBe('vendor_relationship');
    expect(inserted.subject_id).toBe(VENDOR_ID);
    expect(inserted.source).toBe('observed');
    expect(inserted.evidence_proposal_ids).toEqual(['p-1', 'p-2']);
  });

  it('embeds centrally when no explicit embedding is supplied', async () => {
    const db = createSupabaseMock(state);
    const content = {
      description: 'radiator knocks below freezing',
      season: 'winter' as const,
      recurring: true,
      severity: 0.4,
    };
    mockEmbedFactContent.mockResolvedValue([0.1, 0.2, 0.3]);

    await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'building_quirk',
        subjectId: null,
        content,
        source: 'observed',
      },
    });

    expect(mockEmbedFactContent).toHaveBeenCalledTimes(1);
    expect(mockEmbedFactContent).toHaveBeenCalledWith(content);
    expect(state.inserts[0]!.row.embedding).toBe('[0.1,0.2,0.3]');
  });

  it.each([
    { label: 'an explicit vector', embedding: [0.4, 0.5] as const, expected: '[0.4,0.5]' },
    { label: 'explicit null', embedding: null, expected: undefined },
  ])('does not duplicate embedding work for $label', async ({ embedding, expected }) => {
    const db = createSupabaseMock(state);

    await recordFact({
      db,
      propertyId: PROPERTY_ID,
      embedding,
      fact: {
        factType: 'building_quirk',
        subjectId: null,
        content: {
          description: 'entry buzzer is intermittent',
          season: null,
          recurring: true,
          severity: 0.2,
        },
        source: 'observed',
      },
    });

    expect(mockEmbedFactContent).not.toHaveBeenCalled();
    expect(state.inserts[0]!.row.embedding).toBe(expected);
  });

  it('persists with a null embedding if the central embedding attempt throws', async () => {
    const db = createSupabaseMock(state);
    mockEmbedFactContent.mockRejectedValue(new Error('provider unavailable'));

    await expect(recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'building_quirk',
        subjectId: null,
        content: {
          description: 'boiler reset procedure unknown',
          season: null,
          recurring: false,
          severity: 0.3,
        },
        source: 'observed',
      },
    })).resolves.toBeDefined();
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.row.embedding).toBeUndefined();
  });

  it('defaults confidence to per-fact-type importance when caller omits it', async () => {
    const db = createSupabaseMock(state);

    const fact = await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'tenant_pattern',
        subjectId: TENANT_ID,
        content: {
          payment_cadence: 'pays on the 5th',
          communication_style: 'terse',
          complaint_themes: [],
          last_observed_at: null,
        },
        source: 'observed',
      },
    });

    // tenant_pattern default importance = 0.65
    expect(fact.confidence).toBeCloseTo(0.65, 2);
  });

  it('clamps caller-supplied confidence to [0, 1]', async () => {
    const db = createSupabaseMock(state);

    const high = await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'building_quirk',
        subjectId: null,
        content: {
          description: 'top-floor heat',
          season: 'summer',
          recurring: true,
          severity: 0.8,
        },
        source: 'observed',
        confidence: 5,
      },
    });
    expect(high.confidence).toBe(1);

    const low = await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'building_quirk',
        subjectId: null,
        content: {
          description: 'top-floor heat',
          season: 'summer',
          recurring: true,
          severity: 0.8,
        },
        source: 'observed',
        confidence: -1,
      },
    });
    expect(low.confidence).toBe(0);
  });

  it('persists owner_rule facts (subjectId null) end-to-end', async () => {
    const db = createSupabaseMock(state);

    const fact = await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'owner_rule',
        subjectId: null,
        content: {
          rule_text: 'never waive late fees',
          source_text: 'rulebook v1',
        },
        source: 'owner_stated',
      },
    });

    expect(fact.factType).toBe('owner_rule');
    expect(fact.subjectId).toBeNull();
    expect(state.inserts[0]!.row.subject_id).toBeNull();
    expect(state.inserts[0]!.row.source).toBe('owner_stated');
  });

  it('defaults evidence_proposal_ids to [] when caller omits it', async () => {
    const db = createSupabaseMock(state);

    await recordFact({
      db,
      propertyId: PROPERTY_ID,
      fact: {
        factType: 'derived_rule',
        subjectId: null,
        content: {
          rule_text: 'send rent reminders 5 days early',
          supersedes_rule_id: null,
          evidence_count: 2,
        },
        source: 'derived',
      },
    });

    expect(state.inserts[0]!.row.evidence_proposal_ids).toEqual([]);
  });

  it('throws when the property cannot be found', async () => {
    const db = createSupabaseMock(state);

    await expect(
      recordFact({
        db,
        propertyId: '00000000-0000-0000-0000-deadbeefdead',
        fact: {
          factType: 'building_quirk',
          subjectId: null,
          content: {
            description: 'noisy boiler',
            season: null,
            recurring: false,
            severity: 0.3,
          },
          source: 'observed',
        },
      }),
    ).rejects.toThrow(/not found|property lookup failed/);
  });

  it('throws with a helpful message when insert fails', async () => {
    const db = createSupabaseMock(state);
    setForcedError(state, 'memory_facts', 'insert', 'unique violation');

    await expect(
      recordFact({
        db,
        propertyId: PROPERTY_ID,
        fact: {
          factType: 'building_quirk',
          subjectId: null,
          content: {
            description: 'leaky window',
            season: 'winter',
            recurring: true,
            severity: 0.4,
          },
          source: 'observed',
        },
      }),
    ).rejects.toThrow(/insert failed.*unique violation/);
  });
});
