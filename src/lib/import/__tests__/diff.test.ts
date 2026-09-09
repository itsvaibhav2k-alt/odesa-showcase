/**
 * Unit tests for `annotatePlan` — the dedup pass that tags ImportPlan
 * items as `will_insert` vs `will_skip` based on existing DB rows.
 */

import { describe, expect, it } from 'vitest';

import { mapGenericCsv } from '../generic';
import { annotatePlan, summarize } from '../diff';
import {
  ORG_ID,
  PROPERTY_ID,
  TENANT_ID,
  UNIT_ID,
  makeAdmin,
} from '@/lib/agent/worker/handlers/__tests__/__helpers';

const baseRow = {
  property_name: 'Vaba House',
  property_address: '123 Main St, Arlington, VA 22201',
  unit_label: '1',
  tenant_first_name: 'Test',
  tenant_last_name: 'Person',
  tenant_phone: '(202) 555-0101',
  lease_rent: '1800',
  lease_start: '2025-06-01',
  lease_due_day: '1',
};

describe('annotatePlan', () => {
  it('tags everything will_insert when no DB rows match', async () => {
    const result = mapGenericCsv([{ ...baseRow }]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.plan) return;

    const { admin } = makeAdmin({
      properties: [{ data: null, error: null }],
      units: [{ data: null, error: null }],
      tenants: [{ data: null, error: null }],
      leases: [{ data: null, error: null }],
    });

    const annotated = await annotatePlan(admin, ORG_ID, result.plan);
    expect(annotated.properties[0].action).toBe('will_insert');
    expect(annotated.units[0].action).toBe('will_insert');
    expect(annotated.tenants[0].action).toBe('will_insert');
    expect(annotated.leases[0].action).toBe('will_insert');
  });

  it('tags rows will_skip when natural key matches existing DB rows', async () => {
    const result = mapGenericCsv([{ ...baseRow }]);
    if (!result.ok || !result.plan) return;

    const { admin } = makeAdmin({
      properties: [{ data: { id: PROPERTY_ID }, error: null }],
      units: [{ data: { id: UNIT_ID }, error: null }],
      tenants: [{ data: { id: TENANT_ID }, error: null }],
      // Lease lookup uses .eq()s + .maybeSingle()
      leases: [{ data: { id: 'lease-1' }, error: null }],
    });

    const annotated = await annotatePlan(admin, ORG_ID, result.plan);
    expect(annotated.properties[0].action).toBe('will_skip');
    expect(annotated.properties[0].existingId).toBe(PROPERTY_ID);
    expect(annotated.units[0].action).toBe('will_skip');
    expect(annotated.tenants[0].action).toBe('will_skip');
    expect(annotated.leases[0].action).toBe('will_skip');
  });

  it('summarizes counts correctly', () => {
    expect(
      summarize([
        { naturalKey: 'a', data: 1, action: 'will_insert' },
        { naturalKey: 'b', data: 2, action: 'will_skip' },
        { naturalKey: 'c', data: 3, action: 'will_skip' },
      ]),
    ).toEqual({ willInsert: 1, willSkip: 2, willUpdate: 0 });
  });

  it('falls back to email when phone lookup misses', async () => {
    const result = mapGenericCsv([
      { ...baseRow, tenant_email: 'test@example.com' },
    ]);
    if (!result.ok || !result.plan) return;

    const { admin, calls } = makeAdmin({
      properties: [{ data: null, error: null }],
      units: [{ data: null, error: null }],
      tenants: [
        { data: null, error: null }, // phone miss
        { data: { id: TENANT_ID }, error: null }, // email hit
      ],
      leases: [{ data: null, error: null }],
    });

    const annotated = await annotatePlan(admin, ORG_ID, result.plan);
    expect(annotated.tenants[0].action).toBe('will_skip');
    expect(annotated.tenants[0].existingId).toBe(TENANT_ID);
    const tenantCalls = calls.filter((c) => c.table === 'tenants');
    expect(tenantCalls).toHaveLength(2);
  });
});
