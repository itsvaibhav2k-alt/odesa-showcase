/**
 * Unit tests for src/lib/agent/operator/org-context.ts.
 *
 * `loadOrganizationContext` fires two Supabase queries in parallel:
 * one for the org row, one for the properties list. We mock both and
 * assert the returned `OrganizationContext` shape plus address assembly.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  loadOrganizationContext,
  type OrganizationContext,
  type PropertySummary,
} from '../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
}

interface PropertyRow {
  id: string;
  name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  timezone: string | null;
  autonomy_level: number;
  privacy_mode: string;
}

interface MockScript {
  org?: { data: OrgRow | null; error: { message: string } | null };
  properties?: { data: PropertyRow[] | null; error: { message: string } | null };
}

function makeMockAdmin(script: MockScript): SupabaseClient<Database> {
  const orgSingle = vi.fn(async () =>
    script.org ?? { data: null, error: { message: 'no org' } },
  );
  const propertiesOrderResult = vi.fn(async () =>
    script.properties ?? { data: [], error: null },
  );

  // Track which table was queried.
  const from = vi.fn((table: string) => {
    if (table === 'organizations') {
      const select = vi.fn(() => ({
        eq: vi.fn(() => ({ single: orgSingle })),
      }));
      return { select };
    }
    if (table === 'properties') {
      const orderFn = vi.fn(() => propertiesOrderResult());
      const eqFn = vi.fn(() => ({ order: orderFn }));
      const select = vi.fn(() => ({ eq: eqFn }));
      return { select };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-abc';
const ORG_NAME = 'Galaxy Estates';

function propertyRow(overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    id: 'prop-1',
    name: 'Oakwood Commons',
    address_street: '100 Oakwood Dr',
    address_city: 'Brooklyn',
    address_state: 'NY',
    timezone: 'America/New_York',
    autonomy_level: 0.6,
    privacy_mode: 'hosted',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadOrganizationContext', () => {
  it('should return the right OrganizationContext shape for a multi-property org', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: {
        data: [
          propertyRow({ id: 'prop-1', name: 'Oakwood Commons' }),
          propertyRow({ id: 'prop-2', name: 'Galaxy Lofts', address_city: 'Manhattan' }),
        ],
        error: null,
      },
    });

    const ctx = await loadOrganizationContext(admin, ORG_ID);

    expect(ctx.organization.id).toBe(ORG_ID);
    expect(ctx.organization.name).toBe(ORG_NAME);
    expect(ctx.properties).toHaveLength(2);
    expect(ctx.properties[0]!.id).toBe('prop-1');
    expect(ctx.properties[1]!.id).toBe('prop-2');
    expect(ctx.loadedAt).toBeTruthy();
  });

  it('should assemble address from street, city, state — all present', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: {
        data: [
          propertyRow({
            address_street: '100 Oakwood Dr',
            address_city: 'Brooklyn',
            address_state: 'NY',
          }),
        ],
        error: null,
      },
    });

    const ctx = await loadOrganizationContext(admin, ORG_ID);
    const prop = ctx.properties[0]!;
    expect(prop.address).toBe('100 Oakwood Dr, Brooklyn, NY');
  });

  it('should assemble address when some parts are null', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: {
        data: [
          propertyRow({
            address_street: null,
            address_city: 'Brooklyn',
            address_state: null,
          }),
        ],
        error: null,
      },
    });

    const ctx = await loadOrganizationContext(admin, ORG_ID);
    expect(ctx.properties[0]!.address).toBe('Brooklyn');
  });

  it('should return "n/a" address when all address parts are null', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: {
        data: [
          propertyRow({
            address_street: null,
            address_city: null,
            address_state: null,
          }),
        ],
        error: null,
      },
    });

    const ctx = await loadOrganizationContext(admin, ORG_ID);
    expect(ctx.properties[0]!.address).toBe('n/a');
  });

  it('should default timezone to UTC when null', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: {
        data: [propertyRow({ timezone: null })],
        error: null,
      },
    });

    const ctx = await loadOrganizationContext(admin, ORG_ID);
    expect(ctx.properties[0]!.timezone).toBe('UTC');
  });

  it('should map all PropertySummary fields correctly', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: {
        data: [
          propertyRow({
            id: 'prop-x',
            name: 'Test Prop',
            autonomy_level: 0.8,
            privacy_mode: 'anonymous',
          }),
        ],
        error: null,
      },
    });

    const ctx = await loadOrganizationContext(admin, ORG_ID);
    const p: PropertySummary = ctx.properties[0]!;
    expect(p.id).toBe('prop-x');
    expect(p.name).toBe('Test Prop');
    expect(p.autonomyLevel).toBe(0.8);
    expect(p.privacyMode).toBe('anonymous');
  });

  it('should return empty properties array for an org with no properties', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: { data: [], error: null },
    });

    const ctx: OrganizationContext = await loadOrganizationContext(admin, ORG_ID);
    expect(ctx.properties).toEqual([]);
  });

  it('should throw when the org query fails', async () => {
    const admin = makeMockAdmin({
      org: { data: null, error: { message: 'no such org' } },
      properties: { data: [], error: null },
    });

    await expect(loadOrganizationContext(admin, ORG_ID)).rejects.toThrow(
      /org query failed/,
    );
  });

  it('should throw when the properties query fails', async () => {
    const admin = makeMockAdmin({
      org: { data: { id: ORG_ID, name: ORG_NAME }, error: null },
      properties: { data: null, error: { message: 'rls denied' } },
    });

    await expect(loadOrganizationContext(admin, ORG_ID)).rejects.toThrow(
      /properties query failed/,
    );
  });
});
