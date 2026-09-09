/**
 * Unit tests for the RentRedi CSV mapper.
 */

import { describe, expect, it } from 'vitest';

import { mapRentrediCsv } from '../rentredi';

const rentrediRow = {
  Property: 'Vaba House',
  'Property Address': '123 Main St, Arlington, VA 22201',
  Unit: '1',
  'Tenant Name': 'Test Person',
  'Tenant Phone': '202-555-0101',
  'Tenant Email': 'test@example.com',
  'Rent Amount': '1800',
  'Lease Start': '2025-06-01',
  'Lease End': '2026-05-31',
};

describe('mapRentrediCsv', () => {
  it('maps a happy-path RentRedi row', () => {
    const result = mapRentrediCsv([{ ...rentrediRow }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.properties[0].data.name).toBe('Vaba House');
    expect(result.plan.tenants[0].data.phoneE164).toBe('+12025550101');
    expect(result.plan.leases[0].data.rentAmount).toBe(1800);
  });

  it('rolls up two units of the same property', () => {
    const result = mapRentrediCsv([
      { ...rentrediRow, Unit: '1', 'Tenant Phone': '703-555-0101' },
      { ...rentrediRow, Unit: '2', 'Tenant Phone': '703-555-0102' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.properties).toHaveLength(1);
    expect(result.plan.units).toHaveLength(2);
  });

  it('warns and skips a row with bad phone', () => {
    const result = mapRentrediCsv([{ ...rentrediRow, 'Tenant Phone': 'nope' }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.tenants).toHaveLength(0);
    expect(result.warnings?.[0]).toContain("couldn't be normalized");
  });

  it('returns empty plan on no input', () => {
    const result = mapRentrediCsv([]);
    expect(result.ok).toBe(true);
    expect(result.plan?.properties).toHaveLength(0);
  });
});
