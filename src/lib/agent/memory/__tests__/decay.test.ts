import { beforeEach, describe, expect, it } from 'vitest';

import { decayFacts, effectiveScore, groupByFactType } from '../decay';
import { FACT_TYPE_DEFAULTS, MAX_ACTIVE_FACTS_PER_PROPERTY } from '../types';
import {
  PROPERTY_ID,
  TENANT_ID,
  VENDOR_ID,
  createMockState,
  createSupabaseMock,
  makeFact,
  makeTypedRow,
  resetCounter,
  type MockState,
} from './test-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('effectiveScore', () => {
  it('returns importance for a freshly-created fact', () => {
    const now = Date.parse('2026-04-15T00:00:00Z');
    const fact = makeFact('owner_rule', {
      createdAt: '2026-04-15T00:00:00Z',
      confidence: 0.95,
    });
    expect(effectiveScore(fact, now)).toBeCloseTo(0.95, 4);
  });

  it('decays linearly with days since createdAt', () => {
    const now = Date.parse('2026-04-15T00:00:00Z');
    // tenant_pattern: importance fallback 0.65, decay 0.02/day
    const fact = makeFact('tenant_pattern', {
      createdAt: '2026-04-05T00:00:00Z', // 10 days old
      confidence: 0.65,
    });
    // 0.65 × (1 − 0.02 × 10) = 0.65 × 0.8 = 0.52
    expect(effectiveScore(fact, now)).toBeCloseTo(0.52, 4);
  });

  it('owner_rule decay is near-zero — survives 30 days at near-full score', () => {
    const now = Date.parse('2026-05-15T00:00:00Z');
    const fact = makeFact('owner_rule', {
      createdAt: '2026-04-15T00:00:00Z',
      confidence: 0.95,
    });
    // 0.95 × (1 − 0.001 × 30) = 0.95 × 0.97 ≈ 0.9215
    expect(effectiveScore(fact, now)).toBeCloseTo(0.9215, 3);
  });

  it('clamps to [0, 1]', () => {
    const now = Date.now();
    const fact = makeFact('tenant_pattern', {
      createdAt: new Date(now - 365 * DAY_MS).toISOString(),
      confidence: 0.65,
    });
    expect(effectiveScore(fact, now)).toBe(0);
  });

  it('falls back to per-type importance when confidence is 0/missing', () => {
    const now = Date.parse('2026-04-15T00:00:00Z');
    const fact = makeFact('tenant_pattern', {
      createdAt: '2026-04-15T00:00:00Z',
      confidence: 0,
    });
    expect(effectiveScore(fact, now)).toBeCloseTo(
      FACT_TYPE_DEFAULTS.tenant_pattern.importance,
      4,
    );
  });

  it('handles malformed createdAt gracefully', () => {
    const fact = makeFact('owner_rule', {
      createdAt: 'not-a-date',
      confidence: 0.95,
    });
    expect(effectiveScore(fact, Date.now())).toBeCloseTo(
      FACT_TYPE_DEFAULTS.owner_rule.importance,
      4,
    );
  });
});

describe('decayFacts', () => {
  let state: MockState;
  const now = Date.parse('2026-04-15T00:00:00Z');

  beforeEach(() => {
    resetCounter();
    state = createMockState();
  });

  it('archives facts under ARCHIVE_THRESHOLD but above PRUNE_THRESHOLD', async () => {
    const db = createSupabaseMock(state);
    // tenant_pattern: importance 0.65, decay 0.02/day
    // To land in [0.05, 0.15): 0.65×(1−0.02d) ∈ [0.05, 0.15)
    // d > 38.46  → score < 0.15
    // d ≥ 46.15  → score ≤ 0.05
    // 40 days old → score = 0.65×0.2 = 0.13 → archive
    const survivor = makeTypedRow('tenant_pattern', {
      created_at: '2026-04-14T00:00:00Z', // 1 day old → 0.65×0.98 ≈ 0.637
      subject_id: TENANT_ID,
    });
    const archive = makeTypedRow('tenant_pattern', {
      created_at: '2026-03-06T00:00:00Z', // 40 days old → 0.13
      subject_id: TENANT_ID,
    });
    state.rows.push(survivor, archive);

    const result = await decayFacts({ db, propertyId: PROPERTY_ID, now });

    expect(result.scanned).toBe(2);
    expect(result.archived).toBe(1);
    expect(result.pruned).toBe(0);
    expect(result.capArchived).toBe(0);
    // The archive call mutated the row in-place
    expect(archive.superseded_at).not.toBeNull();
    expect(survivor.superseded_at).toBeNull();
  });

  it('prunes facts under PRUNE_THRESHOLD', async () => {
    const db = createSupabaseMock(state);
    // 50 days old → 0.65 × (1 − 0.02×50) = 0.65 × 0 = 0 → prune
    const prune = makeTypedRow('tenant_pattern', {
      created_at: '2026-02-24T00:00:00Z',
      subject_id: TENANT_ID,
    });
    state.rows.push(prune);

    const result = await decayFacts({ db, propertyId: PROPERTY_ID, now });
    expect(result.pruned).toBe(1);
    expect(result.archived).toBe(0);
    expect(prune.superseded_at).not.toBeNull();
  });

  it('never decays owner_rule via threshold (only via cap or supersession)', async () => {
    const db = createSupabaseMock(state);
    // owner_rule with confidence 0.95 has decay 0.001/day → barely moves.
    // Even on a 365-day-old row, score ≈ 0.95 × 0.635 ≈ 0.6 — still active.
    const ancient = makeTypedRow('owner_rule', {
      created_at: '2025-04-15T00:00:00Z',
    });
    state.rows.push(ancient);

    const result = await decayFacts({ db, propertyId: PROPERTY_ID, now });
    expect(result.archived).toBe(0);
    expect(result.pruned).toBe(0);
    expect(ancient.superseded_at).toBeNull();
  });

  it('caps active facts at MAX_ACTIVE_FACTS_PER_PROPERTY by archiving oldest non-owner-rule', async () => {
    const db = createSupabaseMock(state);
    // Seed cap+5 fresh tenant_pattern rows + 1 owner_rule. Total active
    // survivors after threshold pass = cap+6 → cap-eviction must remove 6.
    const tenantOverflow = 5;
    const baseDay = now - 1 * DAY_MS;
    for (let i = 0; i < MAX_ACTIVE_FACTS_PER_PROPERTY + tenantOverflow; i++) {
      state.rows.push(
        makeTypedRow('tenant_pattern', {
          // Spread by 1 hour each so ordering is stable but all under
          // the 1-day threshold (score stays well above 0.15).
          created_at: new Date(baseDay - i * 3600_000).toISOString(),
          subject_id: TENANT_ID,
        }),
      );
    }
    // Add one owner_rule that would otherwise be the oldest — must NOT be
    // chosen for cap eviction.
    const ownerRule = makeTypedRow('owner_rule', {
      created_at: new Date(baseDay - 1000 * 3600_000).toISOString(),
    });
    state.rows.push(ownerRule);

    const result = await decayFacts({ db, propertyId: PROPERTY_ID, now });

    expect(result.archived).toBe(0);
    expect(result.pruned).toBe(0);
    // overflow = (cap + 5 tenant) + 1 owner_rule − cap = 6
    expect(result.capArchived).toBe(tenantOverflow + 1);
    // owner_rule still active — never chosen for cap eviction
    expect(ownerRule.superseded_at).toBeNull();

    // After eviction: total active = cap, owner_rule still in there.
    const remainingActive = state.rows.filter((r) => r.superseded_at === null);
    expect(remainingActive.length).toBe(MAX_ACTIVE_FACTS_PER_PROPERTY);
    expect(remainingActive.some((r) => r.id === ownerRule.id)).toBe(true);
  });

  it('returns zeros when there are no active facts', async () => {
    const db = createSupabaseMock(state);
    const result = await decayFacts({ db, propertyId: PROPERTY_ID, now });
    expect(result).toEqual({ scanned: 0, archived: 0, pruned: 0, capArchived: 0 });
  });

  it('handles vendor / tenant / building / derived rule decay paths', async () => {
    const db = createSupabaseMock(state);
    // vendor_relationship 0.7, decay 0.015 → archive at d≈52 (0.7×0.22=0.154)
    state.rows.push(
      makeTypedRow('vendor_relationship', {
        created_at: '2026-02-20T00:00:00Z', // ~54 days
        subject_id: VENDOR_ID,
      }),
    );
    // building_quirk 0.75, decay 0.01 → archive at d≈81 (0.75×0.19=0.143)
    state.rows.push(
      makeTypedRow('building_quirk', { created_at: '2026-01-22T00:00:00Z' }), // ~83 days
    );
    // derived_rule 0.85, decay 0.005 → barely decays in a few weeks, stays active
    state.rows.push(makeTypedRow('derived_rule', { created_at: '2026-04-01T00:00:00Z' }));

    const result = await decayFacts({ db, propertyId: PROPERTY_ID, now });
    expect(result.archived).toBe(2);
    expect(result.pruned).toBe(0);
  });
});

describe('groupByFactType', () => {
  it('partitions facts by discriminator', () => {
    const facts = [
      makeFact('vendor_relationship'),
      makeFact('tenant_pattern'),
      makeFact('tenant_pattern'),
      makeFact('owner_rule'),
    ];
    const grouped = groupByFactType(facts);
    expect(grouped.vendor_relationship).toHaveLength(1);
    expect(grouped.tenant_pattern).toHaveLength(2);
    expect(grouped.building_quirk).toHaveLength(0);
    expect(grouped.derived_rule).toHaveLength(0);
    expect(grouped.owner_rule).toHaveLength(1);
  });
});
