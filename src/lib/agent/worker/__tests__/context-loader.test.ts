/**
 * Unit tests for context-loader.ts.
 *
 * The Supabase client is mocked via a hand-rolled object that
 * satisfies the SupabaseLike interface. Each call to `from(table)`
 * returns a builder that records its filters and resolves with a
 * preset row set. This lets us verify both the shape of queries
 * (e.g. memory_facts must filter `superseded_at IS NULL`) and the
 * mapping from row → ContextFact.
 */

import { describe, expect, it } from 'vitest';

import {
  loadPropertyContext,
  type SupabaseLike,
} from '../context-loader';
import { PropertyContextNotFoundError } from '../types';

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: string;
  selects: string[];
  eqs: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
  ins: Array<[string, ReadonlyArray<unknown>]>;
  orders: Array<[string, boolean]>;
  limits: number[];
  terminal: 'maybeSingle' | 'single' | 'list';
}

function makeMock(
  tableHandlers: Record<
    string,
    (q: RecordedQuery) =>
      | { data: unknown; error: null }
      | { data: null; error: { message: string } }
  >,
): { client: SupabaseLike; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];

  function makeBuilder(table: string): unknown {
    const q: RecordedQuery = {
      table,
      selects: [],
      eqs: [],
      iss: [],
      ins: [],
      orders: [],
      limits: [],
      terminal: 'list',
    };

    const builder: Record<string, unknown> = {
      select(cols: string) {
        q.selects.push(cols);
        return builder;
      },
      eq(col: string, val: unknown) {
        q.eqs.push([col, val]);
        return builder;
      },
      is(col: string, val: unknown) {
        q.iss.push([col, val]);
        return builder;
      },
      in(col: string, vals: ReadonlyArray<unknown>) {
        q.ins.push([col, [...vals]]);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        q.orders.push([col, opts?.ascending !== false]);
        return builder;
      },
      limit(n: number) {
        q.limits.push(n);
        return builder;
      },
      maybeSingle: async () => {
        q.terminal = 'maybeSingle';
        queries.push(q);
        return tableHandlers[table](q);
      },
      single: async () => {
        q.terminal = 'single';
        queries.push(q);
        return tableHandlers[table](q);
      },
      then: <TResult1, TResult2 = never>(
        onfulfilled?:
          | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
          | null
          | undefined,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
          | undefined,
      ) => {
        q.terminal = 'list';
        queries.push(q);
        try {
          const result = tableHandlers[table](q);
          return Promise.resolve(result).then(
            onfulfilled ?? ((v) => v as unknown as TResult1),
            onrejected,
          );
        } catch (e) {
          if (onrejected) return Promise.resolve(onrejected(e));
          return Promise.reject(e);
        }
      },
    };
    return builder;
  }

  const client: SupabaseLike = {
    from(table: string) {
      return makeBuilder(table);
    },
  };

  return { client, queries };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROPERTY_ROW = {
  id: 'prop-1',
  organization_id: 'org-1',
  name: '123 Main St',
  address_street: '123 Main St',
  address_city: 'San Francisco',
  address_state: 'CA',
  address_zip: '94110',
  timezone: 'America/Los_Angeles',
  rules_text: 'Be direct. Never waive late fees without owner approval.',
  autonomy_level: 0.45,
  privacy_mode: 'hosted',
};

// 3 facts: 2 active, 1 superseded
const FACT_ROWS_ACTIVE = [
  {
    id: 'fact-active-1',
    fact_type: 'vendor_relationship',
    subject_id: 'vendor-pete',
    content: { acceptanceTrend: 'rising', last30dJobs: 4 },
    confidence: 0.85,
    source: 'observed',
    created_at: '2026-04-20T10:00:00Z',
  },
  {
    id: 'fact-active-2',
    fact_type: 'tenant_pattern',
    subject_id: 'tenant-marcus',
    content: { paysOnDay: 5 },
    confidence: 0.7,
    source: 'observed',
    created_at: '2026-04-22T10:00:00Z',
  },
];

const MESSAGE_ROWS_DESC = [
  {
    id: 'msg-3',
    conversation_id: 'conv-1',
    direction: 'inbound',
    body: 'My sink is leaking',
    created_at: '2026-04-25T09:00:00Z',
    conversations: { channel: 'sms', property_id: 'prop-1' },
  },
  {
    id: 'msg-2',
    conversation_id: 'conv-1',
    direction: 'outbound',
    body: 'When did it start?',
    created_at: '2026-04-25T08:00:00Z',
    conversations: { channel: 'sms', property_id: 'prop-1' },
  },
  {
    id: 'msg-1',
    conversation_id: 'conv-1',
    direction: 'inbound',
    body: 'Hi — I have an issue with my unit',
    created_at: '2026-04-25T07:00:00Z',
    conversations: { channel: 'sms', property_id: 'prop-1' },
  },
];

const VENDOR_ROWS = [
  {
    id: 'vendor-pete',
    name: "Pete's Plumbing",
    category: 'plumbing',
    acceptance_rate: 0.92,
  },
  {
    id: 'vendor-rita',
    name: "Rita's Repairs",
    category: 'general',
    acceptance_rate: 0.7,
  },
];

const LEASE_ROWS = [
  {
    id: 'lease-1',
    status: 'active',
    tenant_id: 'tenant-marcus',
    rent_amount: 1200,
    units: { property_id: 'prop-1', label: '2A' },
    tenants: { id: 'tenant-marcus', full_name: 'Marcus Lee' },
  },
];

const RENT_EVENT_ROWS = [
  { lease_id: 'lease-1', status: 'paid', cycle_month: '2026-04-01' },
  { lease_id: 'lease-1', status: 'late_3', cycle_month: '2026-03-01' },
];

// Convenience: handlers that return empty for every table we don't care
// about in a particular test. Spread it and override only what matters.
const EMPTY_HANDLERS = {
  properties: () => ({ data: PROPERTY_ROW, error: null }),
  memory_facts: () => ({ data: [], error: null }),
  messages: () => ({ data: [], error: null }),
  vendors: () => ({ data: [], error: null }),
  leases: () => ({ data: [], error: null }),
  rent_events: () => ({ data: [], error: null }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadPropertyContext', () => {
  it('returns a fully populated PropertyContext for a valid id', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      memory_facts: () => ({ data: FACT_ROWS_ACTIVE, error: null }),
      messages: () => ({ data: MESSAGE_ROWS_DESC, error: null }),
      vendors: () => ({ data: VENDOR_ROWS, error: null }),
      leases: () => ({ data: LEASE_ROWS, error: null }),
      rent_events: () => ({ data: RENT_EVENT_ROWS, error: null }),
    });

    const ctx = await loadPropertyContext(client, 'prop-1', {
      now: () => new Date('2026-04-27T00:00:00Z'),
    });

    expect(ctx.property.id).toBe('prop-1');
    expect(ctx.property.organizationId).toBe('org-1');
    expect(ctx.property.rulesText).toContain('Never waive late fees');
    expect(ctx.property.autonomyLevel).toBeCloseTo(0.45, 2);
    expect(ctx.property.privacyMode).toBe('hosted');
    expect(ctx.property.addressLine).toBe(
      '123 Main St, San Francisco, CA, 94110',
    );

    expect(ctx.facts).toHaveLength(2);
    expect(ctx.facts[0].id).toBe('fact-active-1');
    expect(ctx.facts[0].factType).toBe('vendor_relationship');
    expect(ctx.facts[0].confidence).toBeCloseTo(0.85, 2);
    expect(ctx.facts[0].source).toBe('observed');

    // Recent turns reversed to chronological (oldest-first)
    expect(ctx.recentTurns).toHaveLength(3);
    expect(ctx.recentTurns[0].body).toBe('Hi — I have an issue with my unit');
    expect(ctx.recentTurns[2].body).toBe('My sink is leaking');
    expect(ctx.recentTurns[0].direction).toBe('inbound');
    expect(ctx.recentTurns[0].channel).toBe('sms');

    expect(ctx.vendors).toHaveLength(2);
    expect(ctx.vendors[0].id).toBe('vendor-pete');
    expect(ctx.vendors[0].acceptanceRate).toBe(0.92);

    expect(ctx.tenants).toHaveLength(1);
    expect(ctx.tenants[0].id).toBe('tenant-marcus');
    expect(ctx.tenants[0].fullName).toBe('Marcus Lee');
    expect(ctx.tenants[0].unitLabel).toBe('2A');
    // Latest rent_event for lease-1 is the 2026-04 cycle (status=paid)
    expect(ctx.tenants[0].rentStatus).toBe('paid');
    expect(ctx.tenants[0].rentAmount).toBe(1200);

    expect(ctx.loadedAt).toBe('2026-04-27T00:00:00.000Z');
  });

  it('filters memory_facts to non-superseded only', async () => {
    const { client, queries } = makeMock({
      ...EMPTY_HANDLERS,
      memory_facts: () => ({ data: FACT_ROWS_ACTIVE, error: null }),
    });

    await loadPropertyContext(client, 'prop-1');

    const factsQuery = queries.find((q) => q.table === 'memory_facts');
    expect(factsQuery).toBeDefined();
    expect(factsQuery!.iss).toContainEqual(['superseded_at', null]);
    expect(factsQuery!.eqs).toContainEqual(['property_id', 'prop-1']);
    // Confidence ordered desc, then created_at desc
    expect(factsQuery!.orders).toEqual([
      ['confidence', false],
      ['created_at', false],
    ]);
  });

  it('throws PropertyContextNotFoundError when property row is missing', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      properties: () => ({ data: null, error: null }),
    });

    await expect(loadPropertyContext(client, 'missing')).rejects.toBeInstanceOf(
      PropertyContextNotFoundError,
    );
  });

  it('throws when properties query errors', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      properties: () => ({
        data: null,
        error: { message: 'connection refused' },
      }),
    });

    await expect(loadPropertyContext(client, 'prop-1')).rejects.toThrow(
      /connection refused/,
    );
  });

  it('throws when leases query errors out (no silent swallow)', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      memory_facts: () => ({ data: FACT_ROWS_ACTIVE, error: null }),
      messages: () => ({ data: MESSAGE_ROWS_DESC, error: null }),
      vendors: () => ({ data: VENDOR_ROWS, error: null }),
      leases: () => ({
        data: null,
        error: { message: 'permission denied for table leases' },
      }),
    });

    await expect(loadPropertyContext(client, 'prop-1')).rejects.toThrow(
      /tenants load failed.*permission denied/,
    );
  });

  it('tolerates a rent_events error and returns tenants without rentStatus', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      memory_facts: () => ({ data: FACT_ROWS_ACTIVE, error: null }),
      messages: () => ({ data: MESSAGE_ROWS_DESC, error: null }),
      vendors: () => ({ data: VENDOR_ROWS, error: null }),
      leases: () => ({ data: LEASE_ROWS, error: null }),
      rent_events: () => ({
        data: null,
        error: { message: 'rent_events index missing' },
      }),
    });

    const ctx = await loadPropertyContext(client, 'prop-1');
    expect(ctx.tenants).toHaveLength(1);
    expect(ctx.tenants[0].fullName).toBe('Marcus Lee');
    expect(ctx.tenants[0].rentStatus).toBeNull();
  });

  it('filters leases to active/pending and joins them to property units', async () => {
    const { client, queries } = makeMock({
      ...EMPTY_HANDLERS,
      leases: () => ({ data: LEASE_ROWS, error: null }),
      rent_events: () => ({ data: RENT_EVENT_ROWS, error: null }),
    });

    await loadPropertyContext(client, 'prop-1');

    const leaseQuery = queries.find((q) => q.table === 'leases');
    expect(leaseQuery).toBeDefined();
    expect(leaseQuery!.eqs).toContainEqual(['units.property_id', 'prop-1']);
    expect(leaseQuery!.ins).toContainEqual([
      'status',
      ['active', 'pending'],
    ]);
    expect(leaseQuery!.selects[0]).toContain('units!inner');
    expect(leaseQuery!.selects[0]).toContain('tenants');
    expect(leaseQuery!.selects[0]).toContain('rent_amount');

    // rent_events queried by lease IN list, ordered cycle_month desc
    const rentEventsQuery = queries.find((q) => q.table === 'rent_events');
    expect(rentEventsQuery).toBeDefined();
    expect(rentEventsQuery!.ins[0][0]).toBe('lease_id');
    expect(rentEventsQuery!.ins[0][1]).toEqual(['lease-1']);
    expect(rentEventsQuery!.orders).toEqual([['cycle_month', false]]);
  });

  it('respects custom limits', async () => {
    const { client, queries } = makeMock(EMPTY_HANDLERS);

    await loadPropertyContext(client, 'prop-1', {
      factsLimit: 5,
      recentTurnsLimit: 2,
      vendorsLimit: 3,
      tenantsLimit: 1,
    });

    const factsQuery = queries.find((q) => q.table === 'memory_facts');
    const messagesQuery = queries.find((q) => q.table === 'messages');
    const vendorsQuery = queries.find((q) => q.table === 'vendors');
    const leasesQuery = queries.find((q) => q.table === 'leases');

    expect(factsQuery!.limits[0]).toBe(5);
    expect(messagesQuery!.limits[0]).toBe(2);
    expect(vendorsQuery!.limits[0]).toBe(3);
    expect(leasesQuery!.limits[0]).toBe(1);
  });

  it('handles empty address gracefully', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      properties: () => ({
        data: {
          ...PROPERTY_ROW,
          address_street: null,
          address_city: null,
          address_state: null,
          address_zip: null,
        },
        error: null,
      }),
    });

    const ctx = await loadPropertyContext(client, 'prop-1');
    expect(ctx.property.addressLine).toBeNull();
  });

  it('throws when memory_facts errors out', async () => {
    const { client } = makeMock({
      ...EMPTY_HANDLERS,
      memory_facts: () => ({
        data: null,
        error: { message: 'permission denied' },
      }),
    });

    await expect(loadPropertyContext(client, 'prop-1')).rejects.toThrow(
      /permission denied/,
    );
  });
});
