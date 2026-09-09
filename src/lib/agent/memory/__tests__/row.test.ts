import { describe, expect, it } from 'vitest';

import { rowToFact } from '../row';
import { makeTypedRow, VENDOR_ID } from './test-utils';

describe('rowToFact', () => {
  it('hydrates each fact_type into the correct discriminated branch', () => {
    const types = [
      'vendor_relationship',
      'tenant_pattern',
      'building_quirk',
      'derived_rule',
      'owner_rule',
    ] as const;

    for (const t of types) {
      const fact = rowToFact(makeTypedRow(t));
      expect(fact.factType).toBe(t);
    }
  });

  it('coerces string-encoded numeric confidence to number', () => {
    const row = makeTypedRow('vendor_relationship', { confidence: 0.42 });
    // Simulate the driver path that returns numerics as strings
    (row as unknown as { confidence: string }).confidence = '0.42';
    const fact = rowToFact(row);
    expect(typeof fact.confidence).toBe('number');
    expect(fact.confidence).toBeCloseTo(0.42, 4);
  });

  it('defaults evidence_proposal_ids to [] when null', () => {
    const row = makeTypedRow('vendor_relationship', {
      evidence_proposal_ids: null,
      subject_id: VENDOR_ID,
    });
    const fact = rowToFact(row);
    expect(fact.evidenceProposalIds).toEqual([]);
  });

  it('preserves supersededAt + supersededBy', () => {
    const row = makeTypedRow('tenant_pattern', {
      superseded_at: '2026-04-15T00:00:00Z',
      superseded_by: '00000000-0000-0000-0000-deadbeefdead',
    });
    const fact = rowToFact(row);
    expect(fact.supersededAt).toBe('2026-04-15T00:00:00Z');
    expect(fact.supersededBy).toBe('00000000-0000-0000-0000-deadbeefdead');
  });

  it('hydrates a fact_type=building_quirk content shape correctly', () => {
    const row = makeTypedRow('building_quirk');
    const fact = rowToFact(row);
    if (fact.factType === 'building_quirk') {
      expect(fact.content.description).toBe('boiler kicks off below 10F');
      expect(fact.content.season).toBe('winter');
      expect(fact.content.recurring).toBe(true);
      expect(fact.content.severity).toBe(0.6);
    } else {
      throw new Error('expected building_quirk');
    }
  });
});
