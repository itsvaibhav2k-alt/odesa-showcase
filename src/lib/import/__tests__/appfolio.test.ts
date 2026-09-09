/**
 * Unit tests for the AppFolio CSV mapper.
 */

import { describe, expect, it } from 'vitest';

import { mapAppfolioCsv } from '../appfolio';

const appfolioRow = {
  'Property Name': 'Vaba House',
  'Property Address': '123 Main St, Arlington, VA 22201',
  'Unit Number': '1',
  'Tenant First Name': 'Test',
  'Tenant Last Name': 'Person',
  'Tenant Phone': '(202) 555-0101',
  'Tenant Email': 'test@example.com',
  'Lease Rent': '$1,800.00',
  'Lease Start Date': '2025-06-01',
  'Lease End Date': '2026-05-31',
  'Lease Status': 'active',
  'Rent Due Day': '1',
  Bedrooms: '2',
  Bathrooms: '1',
};

describe('mapAppfolioCsv', () => {
  it('maps a happy-path AppFolio rent-roll row', () => {
    const result = mapAppfolioCsv([{ ...appfolioRow }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;

    expect(result.plan.properties[0].data.name).toBe('Vaba House');
    expect(result.plan.units[0].data.label).toBe('1');
    expect(result.plan.units[0].data.bedrooms).toBe(2);
    expect(result.plan.tenants[0].data.fullName).toBe('Test Person');
    expect(result.plan.tenants[0].data.phoneE164).toBe('+12025550101');
    expect(result.plan.leases[0].data.rentAmount).toBe(1800);
    expect(result.plan.leases[0].data.status).toBe('active');
  });

  it('handles "expired" lease status → maps to expired enum', () => {
    const result = mapAppfolioCsv([{ ...appfolioRow, 'Lease Status': 'expired' }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.leases[0].data.status).toBe('expired');
  });

  it('skips row + warns on missing Tenant Phone', () => {
    const result = mapAppfolioCsv([{ ...appfolioRow, 'Tenant Phone': '' }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.tenants).toHaveLength(0);
    expect(result.warnings?.[0]).toContain('Tenant Phone');
  });

  it('returns empty plan + warning when given no rows', () => {
    const result = mapAppfolioCsv([]);
    expect(result.ok).toBe(true);
    expect(result.plan?.properties).toHaveLength(0);
    expect(result.warnings).toContain('CSV had no data rows');
  });
});
