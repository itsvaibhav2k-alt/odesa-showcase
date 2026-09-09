/**
 * Unit tests for the Buildium CSV mapper.
 */

import { describe, expect, it } from 'vitest';

import { mapBuildiumCsv } from '../buildium';

const buildiumRow = {
  Property: 'Vaba House',
  'Property Address': '123 Main St, Arlington, VA 22201',
  Unit: '1',
  Tenant: 'Test Person',
  Phone: '202-555-0101',
  Email: 'test@example.com',
  Rent: '$1,800.00',
  'Lease From': '6/1/2025',
  'Lease To': '5/31/2026',
};

describe('mapBuildiumCsv', () => {
  it('maps a happy-path Buildium rent-roll row', () => {
    const result = mapBuildiumCsv([{ ...buildiumRow }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.properties[0].data.name).toBe('Vaba House');
    expect(result.plan.units[0].data.label).toBe('1');
    expect(result.plan.tenants[0].data.fullName).toBe('Test Person');
    expect(result.plan.tenants[0].data.phoneE164).toBe('+12025550101');
    expect(result.plan.leases[0].data.rentAmount).toBe(1800);
    expect(result.plan.leases[0].data.startDate).toBe('2025-06-01');
  });

  it('splits a "Tenant" single column into first/last', () => {
    const result = mapBuildiumCsv([
      { ...buildiumRow, Tenant: 'Maria Garcia Lopez' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.tenants[0].data.fullName).toBe('Maria Garcia Lopez');
  });

  it('warns and skips a row with bad phone', () => {
    const result = mapBuildiumCsv([{ ...buildiumRow, Phone: 'xxx' }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.tenants).toHaveLength(0);
    expect(result.warnings?.some((w) => w.includes("couldn't be normalized"))).toBe(true);
  });

  it('returns empty plan on empty input', () => {
    const result = mapBuildiumCsv([]);
    expect(result.ok).toBe(true);
    expect(result.plan?.properties).toHaveLength(0);
  });
});
