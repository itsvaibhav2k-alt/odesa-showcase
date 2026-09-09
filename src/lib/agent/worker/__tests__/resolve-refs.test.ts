/**
 * Unit tests for resolve-refs.ts.
 *
 * Mocks the Supabase chainable query builder. Each resolver issues a
 * single query (`from(table).select('id').eq(...).ilike(...).limit(2)`)
 * and the mock returns whatever rows the test sets up.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  resolveAppliance,
  resolveLease,
  resolveProperty,
  resolveTenant,
  resolveUnit,
  resolveVendor,
} from '../resolve-refs';

const ORG = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Tiny chainable mock: every method returns `this` until `.limit(n)`
// resolves to the queued response. For multi-query helpers (resolveLease
// and resolveUnit-with-property) the test queues responses in order.
// ---------------------------------------------------------------------------

interface QueryResponse {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
}

function makeAdmin(responsesByTable: Record<string, QueryResponse[]>) {
  const calls: Array<{ table: string; eqs: Array<[string, unknown]>; ilikes: Array<[string, string]> }> = [];

  const from = vi.fn((table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ilikes: Array<[string, string]> = [];
    const queue = responsesByTable[table] ?? [];

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        eqs.push([column, value]);
        return builder;
      }),
      ilike: vi.fn((column: string, pattern: string) => {
        ilikes.push([column, pattern]);
        return builder;
      }),
      limit: vi.fn(async () => {
        const next = queue.shift();
        calls.push({ table, eqs: [...eqs], ilikes: [...ilikes] });
        return next ?? { data: [], error: null };
      }),
    };

    return builder;
  });

  return {
    admin: { from } as unknown as SupabaseClient<Database>,
    calls,
  };
}

// ---------------------------------------------------------------------------
// resolveProperty
// ---------------------------------------------------------------------------

describe('resolveProperty', () => {
  it('returns ok+id when exactly one property matches', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: [{ id: 'prop-1' }], error: null }],
    });
    const result = await resolveProperty(admin, ORG, 'Vaba');
    expect(result).toEqual({ ok: true, id: 'prop-1' });
    expect(calls[0].eqs).toEqual([['organization_id', ORG]]);
    expect(calls[0].ilikes).toEqual([['name', '%Vaba%']]);
  });

  it('returns ambiguous when 2+ properties match', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: 'p1' }, { id: 'p2' }], error: null }],
    });
    const result = await resolveProperty(admin, ORG, 'house');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('returns not_found when no property matches', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [], error: null }],
    });
    const result = await resolveProperty(admin, ORG, 'NonExistent');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found on supabase error', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: null, error: { message: 'boom' } }],
    });
    const result = await resolveProperty(admin, ORG, 'Vaba');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found for empty / whitespace-only input', async () => {
    const { admin } = makeAdmin({ properties: [] });
    const result = await resolveProperty(admin, ORG, '   ');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// resolveTenant
// ---------------------------------------------------------------------------

describe('resolveTenant', () => {
  it('returns ok+id when one tenant matches', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [{ data: [{ id: 't-1' }], error: null }],
    });
    const result = await resolveTenant(admin, ORG, 'jessica');
    expect(result).toEqual({ ok: true, id: 't-1' });
    expect(calls[0].ilikes).toEqual([['full_name', '%jessica%']]);
  });

  it('returns ambiguous when multiple tenants match', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: 't-1' }, { id: 't-2' }], error: null }],
    });
    const result = await resolveTenant(admin, ORG, 'jessica');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('returns not_found when no tenant matches', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [], error: null }],
    });
    const result = await resolveTenant(admin, ORG, 'ghost');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// resolveUnit
// ---------------------------------------------------------------------------

describe('resolveUnit', () => {
  it('returns ok+id when one unit matches (no property filter)', async () => {
    const { admin, calls } = makeAdmin({
      units: [{ data: [{ id: 'u-1' }], error: null }],
    });
    const result = await resolveUnit(admin, ORG, 'A');
    expect(result).toEqual({ ok: true, id: 'u-1' });
    expect(calls[0].table).toBe('units');
    expect(calls[0].ilikes).toEqual([['label', '%A%']]);
  });

  it('returns ambiguous when label matches in two units', async () => {
    const { admin } = makeAdmin({
      units: [{ data: [{ id: 'u-1' }, { id: 'u-2' }], error: null }],
    });
    const result = await resolveUnit(admin, ORG, 'A');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('returns not_found when no unit matches', async () => {
    const { admin } = makeAdmin({
      units: [{ data: [], error: null }],
    });
    const result = await resolveUnit(admin, ORG, 'Z');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('narrows by property name when supplied', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: [{ id: 'prop-1' }], error: null }],
      units: [{ data: [{ id: 'u-1' }], error: null }],
    });
    const result = await resolveUnit(admin, ORG, 'A', 'Vaba');
    expect(result).toEqual({ ok: true, id: 'u-1' });
    // Properties query first, units second.
    expect(calls[0].table).toBe('properties');
    expect(calls[1].table).toBe('units');
    // Units query gets the property filter via eq.
    const unitEqs = calls[1].eqs.map(([k]) => k);
    expect(unitEqs).toContain('property_id');
  });

  it('inherits ambiguous reason when property lookup is ambiguous', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: 'p1' }, { id: 'p2' }], error: null }],
      // Should never query units.
      units: [],
    });
    const result = await resolveUnit(admin, ORG, 'A', 'house');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });
});

// ---------------------------------------------------------------------------
// resolveLease
// ---------------------------------------------------------------------------

describe('resolveLease', () => {
  it('returns ok+id for an active lease via tenant name', async () => {
    const { admin, calls } = makeAdmin({
      tenants: [{ data: [{ id: 't-1' }], error: null }],
      leases: [{ data: [{ id: 'l-1' }], error: null }],
    });
    const result = await resolveLease(admin, ORG, 'jessica');
    expect(result).toEqual({ ok: true, id: 'l-1' });
    expect(calls[1].table).toBe('leases');
    const leaseEqs = calls[1].eqs;
    expect(leaseEqs).toContainEqual(['tenant_id', 't-1']);
    expect(leaseEqs).toContainEqual(['status', 'active']);
  });

  it('returns ambiguous when tenant has 2+ active leases', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: 't-1' }], error: null }],
      leases: [{ data: [{ id: 'l-1' }, { id: 'l-2' }], error: null }],
    });
    const result = await resolveLease(admin, ORG, 'jessica');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('returns not_found when tenant has no active lease', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: 't-1' }], error: null }],
      leases: [{ data: [], error: null }],
    });
    const result = await resolveLease(admin, ORG, 'jessica');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('propagates not_found when tenant lookup fails', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [], error: null }],
      // leases query should not run.
      leases: [],
    });
    const result = await resolveLease(admin, ORG, 'ghost');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('propagates ambiguous when tenant lookup is ambiguous', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: [{ id: 't-1' }, { id: 't-2' }], error: null }],
      leases: [],
    });
    const result = await resolveLease(admin, ORG, 'jessica');
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });
});

// ---------------------------------------------------------------------------
// resolveAppliance (wave 7)
// ---------------------------------------------------------------------------

describe('resolveAppliance', () => {
  it('short-circuits via UUID when applianceId is supplied', async () => {
    const { admin, calls } = makeAdmin({
      appliances: [{ data: [{ id: 'app-1' }], error: null }],
    });
    const result = await resolveAppliance(admin, ORG, {
      applianceId: '00000000-0000-0000-0000-000000000099',
    });
    expect(result).toEqual({ ok: true, id: 'app-1' });
    expect(calls[0].table).toBe('appliances');
    const eqs = calls[0].eqs.map(([k]) => k);
    expect(eqs).toContain('id');
    expect(eqs).toContain('organization_id');
  });

  it('returns not_found when applianceId UUID lookup is empty', async () => {
    const { admin } = makeAdmin({
      appliances: [{ data: [], error: null }],
    });
    const result = await resolveAppliance(admin, ORG, {
      applianceId: '00000000-0000-0000-0000-000000000099',
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('resolves via (propertyName, type) — single match', async () => {
    const { admin, calls } = makeAdmin({
      properties: [{ data: [{ id: 'prop-1' }], error: null }],
      appliances: [{ data: [{ id: 'app-1' }], error: null }],
    });
    const result = await resolveAppliance(admin, ORG, {
      propertyName: 'Vaba',
      type: 'fridge',
    });
    expect(result).toEqual({ ok: true, id: 'app-1' });
    expect(calls[0].table).toBe('properties');
    expect(calls[1].table).toBe('appliances');
    const applianceEqs = calls[1].eqs.map(([k]) => k);
    expect(applianceEqs).toContain('property_id');
    expect(applianceEqs).toContain('type');
  });

  it('resolves via (propertyName, unitLabel, type) — narrows by unit', async () => {
    const { admin, calls } = makeAdmin({
      // resolveProperty inside resolveAppliance, then again inside
      // resolveUnit (for the unitLabel branch). Two property lookups.
      properties: [
        { data: [{ id: 'prop-1' }], error: null },
        { data: [{ id: 'prop-1' }], error: null },
      ],
      units: [{ data: [{ id: 'u-1' }], error: null }],
      appliances: [{ data: [{ id: 'app-1' }], error: null }],
    });
    const result = await resolveAppliance(admin, ORG, {
      propertyName: 'Vaba',
      unitLabel: '1',
      type: 'fridge',
    });
    expect(result).toEqual({ ok: true, id: 'app-1' });
    const applianceCall = calls.find((c) => c.table === 'appliances');
    expect(applianceCall).toBeDefined();
    const eqs = applianceCall!.eqs.map(([k]) => k);
    expect(eqs).toContain('unit_id');
  });

  it('returns ambiguous when 2+ appliances match (propertyName, type)', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: 'prop-1' }], error: null }],
      appliances: [{ data: [{ id: 'a-1' }, { id: 'a-2' }], error: null }],
    });
    const result = await resolveAppliance(admin, ORG, {
      propertyName: 'Vaba',
      type: 'fridge',
    });
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('returns not_found when no appliance matches', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: 'prop-1' }], error: null }],
      appliances: [{ data: [], error: null }],
    });
    const result = await resolveAppliance(admin, ORG, {
      propertyName: 'Vaba',
      type: 'fridge',
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('inherits property ambiguity', async () => {
    const { admin } = makeAdmin({
      properties: [{ data: [{ id: 'p1' }, { id: 'p2' }], error: null }],
      appliances: [],
    });
    const result = await resolveAppliance(admin, ORG, {
      propertyName: 'house',
      type: 'fridge',
    });
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });
});

// ---------------------------------------------------------------------------
// resolveVendor (wave 7)
// ---------------------------------------------------------------------------

describe('resolveVendor', () => {
  it('short-circuits via UUID when vendorId is supplied', async () => {
    const { admin, calls } = makeAdmin({
      vendors: [{ data: [{ id: 'v-1' }], error: null }],
    });
    const result = await resolveVendor(admin, ORG, {
      vendorId: '00000000-0000-0000-0000-000000000077',
    });
    expect(result).toEqual({ ok: true, id: 'v-1' });
    const eqs = calls[0].eqs.map(([k]) => k);
    expect(eqs).toContain('id');
    expect(eqs).toContain('organization_id');
  });

  it('returns not_found when vendorId UUID lookup is empty', async () => {
    const { admin } = makeAdmin({
      vendors: [{ data: [], error: null }],
    });
    const result = await resolveVendor(admin, ORG, {
      vendorId: '00000000-0000-0000-0000-000000000077',
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('resolves via vendorName — single match', async () => {
    const { admin, calls } = makeAdmin({
      vendors: [{ data: [{ id: 'v-1' }], error: null }],
    });
    const result = await resolveVendor(admin, ORG, { vendorName: 'Joe Plumbing' });
    expect(result).toEqual({ ok: true, id: 'v-1' });
    expect(calls[0].ilikes).toEqual([['name', '%Joe Plumbing%']]);
  });

  it('returns ambiguous when 2+ vendors match the name', async () => {
    const { admin } = makeAdmin({
      vendors: [{ data: [{ id: 'v-1' }, { id: 'v-2' }], error: null }],
    });
    const result = await resolveVendor(admin, ORG, { vendorName: 'plumb' });
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('returns not_found when no vendor matches', async () => {
    const { admin } = makeAdmin({
      vendors: [{ data: [], error: null }],
    });
    const result = await resolveVendor(admin, ORG, { vendorName: 'nobody' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns not_found for empty vendorName', async () => {
    const { admin } = makeAdmin({ vendors: [] });
    const result = await resolveVendor(admin, ORG, { vendorName: '   ' });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});
