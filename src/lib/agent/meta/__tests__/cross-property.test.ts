/**
 * Unit tests for the monthly cross-property meta-learning loop.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCrossProperty } from '../cross-property';
import {
  ORG_ID,
  PROPERTY_ID,
  PROPERTY_2_ID,
  PROPERTY_3_ID,
  PROPERTY_4_ID,
  PROPERTY_5_ID,
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
import { CROSS_PROPERTY_MODEL } from '../llm';

describe('runCrossProperty', () => {
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

  it('skips the LLM call when fewer than 3 distinct properties are present', async () => {
    state.memoryFacts.push(makeFactRow({ property_id: PROPERTY_ID }));
    state.memoryFacts.push(makeFactRow({ property_id: PROPERTY_2_ID }));

    const db = createSupabaseMock(state);
    const result = await runCrossProperty({ db: db, organizationId: ORG_ID });

    expect(llm.calls).toHaveLength(0);
    expect(result.insightsEmitted).toBe(0);
  });

  it('emits a meta_insight covering all 5 properties for a shared AC pattern', async () => {
    const ids = [PROPERTY_ID, PROPERTY_2_ID, PROPERTY_3_ID, PROPERTY_4_ID, PROPERTY_5_ID];
    for (const propertyId of ids) {
      state.memoryFacts.push(
        makeFactRow({
          property_id: propertyId,
          fact_type: 'tenant_pattern',
          content: { complaint_themes: ['AC'] },
        }),
      );
      state.actionProposals.push(
        makeProposalRow({
          property_id: propertyId,
          payload: { topic: 'AC complaint' },
        }),
      );
    }

    llm.responses.push(
      JSON.stringify({
        insights: [
          {
            pattern_type: 'seasonal_complaint_spike',
            affected_property_ids: ids,
            insight: 'AC complaints spiking across all 5 properties in week 3 of July',
            recommended_action: {
              kind: 'send_proactive_message',
              details: { topic: 'thermostat tips', timing: 'next July week 2' },
            },
            evidence_summary: 'every property logged ≥1 AC complaint within the period',
          },
        ],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runCrossProperty({ db: db, organizationId: ORG_ID });

    expect(result.insightsEmitted).toBe(1);
    expect(result.insightIds).toHaveLength(1);

    const inserted = state.inserts.find((i) => i.table === 'meta_insights')!;
    expect(inserted.row.organization_id).toBe(ORG_ID);
    expect(inserted.row.pattern_type).toBe('seasonal_complaint_spike');
    expect(inserted.row.affected_property_ids).toEqual(ids);
  });

  it('uses the Opus model and cross-property prompt', async () => {
    for (const id of [PROPERTY_ID, PROPERTY_2_ID, PROPERTY_3_ID]) {
      state.memoryFacts.push(makeFactRow({ property_id: id }));
    }
    llm.responses.push(JSON.stringify({ insights: [] }));

    const db = createSupabaseMock(state);
    await runCrossProperty({ db: db, organizationId: ORG_ID });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.model).toBe(CROSS_PROPERTY_MODEL);
    expect(llm.calls[0]!.system).toMatch(/portfolio-level meta-learning agent/i);
  });

  it('drops insights that touch fewer than 3 properties (defensive)', async () => {
    for (const id of [PROPERTY_ID, PROPERTY_2_ID, PROPERTY_3_ID]) {
      state.memoryFacts.push(makeFactRow({ property_id: id }));
    }

    llm.responses.push(
      JSON.stringify({
        insights: [
          {
            pattern_type: 'narrow',
            affected_property_ids: [PROPERTY_ID, PROPERTY_2_ID],
            insight: 'only 2 properties',
            recommended_action: null,
          },
          {
            pattern_type: 'wide',
            affected_property_ids: [PROPERTY_ID, PROPERTY_2_ID, PROPERTY_3_ID],
            insight: 'three properties',
            recommended_action: null,
          },
        ],
      }),
    );

    const db = createSupabaseMock(state);
    const result = await runCrossProperty({ db: db, organizationId: ORG_ID });

    expect(result.insightsEmitted).toBe(1);
    const inserted = state.inserts.find((i) => i.table === 'meta_insights')!;
    expect(inserted.row.pattern_type).toBe('wide');
  });

  it('returns zero insights when the model returns nothing', async () => {
    for (const id of [PROPERTY_ID, PROPERTY_2_ID, PROPERTY_3_ID]) {
      state.memoryFacts.push(makeFactRow({ property_id: id }));
    }
    llm.responses.push(JSON.stringify({ insights: [] }));

    const db = createSupabaseMock(state);
    const result = await runCrossProperty({ db: db, organizationId: ORG_ID });

    expect(result.insightsEmitted).toBe(0);
    expect(state.inserts.filter((i) => i.table === 'meta_insights')).toHaveLength(0);
  });

  it('survives malformed model JSON', async () => {
    for (const id of [PROPERTY_ID, PROPERTY_2_ID, PROPERTY_3_ID]) {
      state.memoryFacts.push(makeFactRow({ property_id: id }));
    }
    llm.responses.push('not json');

    const db = createSupabaseMock(state);
    const result = await runCrossProperty({ db: db, organizationId: ORG_ID });

    expect(result.insightsEmitted).toBe(0);
  });
});
