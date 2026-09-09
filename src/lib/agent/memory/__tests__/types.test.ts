import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_THRESHOLD,
  FACT_TYPE_DEFAULTS,
  MAX_ACTIVE_FACTS_PER_PROPERTY,
  PRUNE_THRESHOLD,
} from '../types';

describe('FACT_TYPE_DEFAULTS', () => {
  it('orders importance: owner_rule > derived_rule > building_quirk > vendor > tenant', () => {
    const d = FACT_TYPE_DEFAULTS;
    expect(d.owner_rule.importance).toBeGreaterThan(d.derived_rule.importance);
    expect(d.derived_rule.importance).toBeGreaterThan(d.building_quirk.importance);
    expect(d.building_quirk.importance).toBeGreaterThan(d.vendor_relationship.importance);
    expect(d.vendor_relationship.importance).toBeGreaterThan(d.tenant_pattern.importance);
  });

  it('orders decayRate inversely: tenant decays fastest, owner_rule slowest', () => {
    const d = FACT_TYPE_DEFAULTS;
    expect(d.tenant_pattern.decayRate).toBeGreaterThan(d.vendor_relationship.decayRate);
    expect(d.vendor_relationship.decayRate).toBeGreaterThan(d.building_quirk.decayRate);
    expect(d.building_quirk.decayRate).toBeGreaterThan(d.derived_rule.decayRate);
    expect(d.derived_rule.decayRate).toBeGreaterThan(d.owner_rule.decayRate);
  });

  it('keeps importance in (0, 1] and decayRate in [0, 1)', () => {
    for (const v of Object.values(FACT_TYPE_DEFAULTS)) {
      expect(v.importance).toBeGreaterThan(0);
      expect(v.importance).toBeLessThanOrEqual(1);
      expect(v.decayRate).toBeGreaterThanOrEqual(0);
      expect(v.decayRate).toBeLessThan(1);
    }
  });
});

describe('thresholds', () => {
  it('PRUNE_THRESHOLD < ARCHIVE_THRESHOLD < 1', () => {
    expect(PRUNE_THRESHOLD).toBeLessThan(ARCHIVE_THRESHOLD);
    expect(ARCHIVE_THRESHOLD).toBeLessThan(1);
  });

  it('matches Boop-derived constants', () => {
    expect(PRUNE_THRESHOLD).toBe(0.05);
    expect(ARCHIVE_THRESHOLD).toBe(0.15);
  });
});

describe('MAX_ACTIVE_FACTS_PER_PROPERTY', () => {
  it('matches the v1.5 risk-mitigation cap', () => {
    expect(MAX_ACTIVE_FACTS_PER_PROPERTY).toBe(200);
  });
});
