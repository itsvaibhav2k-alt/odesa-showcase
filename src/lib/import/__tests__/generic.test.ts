/**
 * Unit tests for the generic CSV mapper.
 */

import { describe, expect, it } from 'vitest';

import { mapGenericCsv } from '../generic';

const baseRow = {
  property_name: 'Vaba House',
  property_address: '123 Main St, Arlington, VA 22201',
  unit_label: '1',
  tenant_first_name: 'Test',
  tenant_last_name: 'Person',
  tenant_phone: '(202) 555-0101',
  tenant_email: 'test@example.com',
  lease_rent: '1800',
  lease_start: '2025-06-01',
  lease_due_day: '1',
};

describe('mapGenericCsv', () => {
  it('maps a single row into one of each draft', () => {
    const result = mapGenericCsv([{ ...baseRow }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.properties).toHaveLength(1);
    expect(result.plan.units).toHaveLength(1);
    expect(result.plan.tenants).toHaveLength(1);
    expect(result.plan.leases).toHaveLength(1);
    expect(result.plan.tenants[0].data.phoneE164).toBe('+12025550101');
    expect(result.plan.leases[0].data.rentAmount).toBe(1800);
    expect(result.plan.properties[0].data.addressStreet).toBe('123 Main St');
    expect(result.plan.properties[0].data.addressZip).toBe('22201');
  });

  it('rolls up multiple units of the same property', () => {
    const result = mapGenericCsv([
      { ...baseRow, unit_label: '1', tenant_phone: '(703) 555-0101' },
      { ...baseRow, unit_label: '2', tenant_phone: '(703) 555-0102' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.properties).toHaveLength(1);
    expect(result.plan.units).toHaveLength(2);
    expect(result.plan.tenants).toHaveLength(2);
  });

  it('returns missing-columns error when required headers absent', () => {
    const partial = { property_name: 'X', unit_label: '1' };
    const result = mapGenericCsv([partial as Record<string, string>]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Missing required columns');
    expect(result.error).toContain('tenant_phone');
  });

  it('warns and skips a row with an un-normalizable phone', () => {
    const result = mapGenericCsv([{ ...baseRow, tenant_phone: 'not-a-phone' }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.tenants).toHaveLength(0);
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.[0]).toContain("couldn't be normalized");
  });

  it('normalizes lease_due_day out of range to a skip', () => {
    const result = mapGenericCsv([{ ...baseRow, lease_due_day: '99' }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;
    expect(result.plan.leases).toHaveLength(0);
    expect(result.warnings?.some((w) => w.includes('lease_due_day'))).toBe(true);
  });
});
