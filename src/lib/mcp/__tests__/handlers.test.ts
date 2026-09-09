/**
 * Unit tests for src/lib/mcp/handlers.ts.
 *
 * Each handler test mocks the supabase admin client with a per-table
 * dispatcher so we can reproduce realistic multi-table flows
 * (list_properties does properties→units; get_property does properties→
 * units→leases→work_orders→action_proposals).
 *
 * The mock builder is a slimmed-down variant of the one in
 * src/lib/agent/operator/__tests__/persist.test.ts, extended with
 * `.in(...)` and `.gte(...)` and the head-count `select(cols, {
 * count: 'exact', head: true })` shape.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { AccessContext } from '@/lib/authz/context';

import {
  __testing,
  askProperty,
  getProperty,
  listProperties,
  type AdminClient,
  type GetPropertySnapshot,
  type ListPropertiesItem,
} from '../handlers';

// ---------------------------------------------------------------------------
// Hoisted module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/agent/worker/context-loader', () => ({
  loadPropertyContext: vi.fn(),
}));

vi.mock('@/lib/agent/operator/dispatcher', () => ({
  runOperatorDispatcher: vi.fn(),
}));

vi.mock('@/lib/agent/operator/persist', () => ({
  loadOrCreateChat: vi.fn(),
}));

import { loadPropertyContext } from '@/lib/agent/worker/context-loader';
import { runOperatorDispatcher } from '@/lib/agent/operator/dispatcher';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import type { DispatcherEvent } from '@/lib/agent/operator/types';
import type { ActionProposal } from '@/lib/agent/worker/types';

const mockedLoadPropertyContext = vi.mocked(loadPropertyContext);
const mockedRunOperatorDispatcher = vi.mocked(runOperatorDispatcher);
const mockedLoadOrCreateChat = vi.mocked(loadOrCreateChat);

function makeProposal(
  overrides: Partial<ActionProposal> = {},
): ActionProposal {
  return {
    id: 'p-1',
    organizationId: ORG,
    propertyId: PROP_A,
    workerModel: 'claude-haiku-4-5',
    action_type: 'draft_sms_reply',
    payload: {
      action_type: 'draft_sms_reply',
      tenant_id: 't-1',
      conversation_id: 'c-1',
      body: 'hi',
    },
    routing: null,
    reasoning: '',
    confidence: 0.9,
    context_fact_ids: [],
    gate_decision: 'auto',
    status: 'committed',
    createdAt: NOW,
    ...overrides,
  } as ActionProposal;
}

async function* asyncIter(events: DispatcherEvent[]): AsyncGenerator<DispatcherEvent> {
  for (const e of events) yield e;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-0000-0000-0000000000a1';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000a2';
const USER = '00000000-0000-0000-0000-0000000000b1';

const PROP_A = '00000000-0000-0000-0000-0000000000c1';
const PROP_B = '00000000-0000-0000-0000-0000000000c2';

const UNIT_A1 = '00000000-0000-0000-0000-0000000000d1';
const UNIT_A2 = '00000000-0000-0000-0000-0000000000d2';
const UNIT_B1 = '00000000-0000-0000-0000-0000000000d3';

const TENANT_1 = '00000000-0000-0000-0000-0000000000e1';
const TENANT_2 = '00000000-0000-0000-0000-0000000000e2';

const NOW = '2026-05-02T12:00:00.000Z';

function deps(
  admin: AdminClient,
  overrides: Partial<AccessContext> = {},
): { admin: AdminClient; access: AccessContext } {
  return {
    admin,
    access: {
      userId: USER,
      membershipId: 'membership-1',
      organizationId: ORG,
      role: 'owner' as const,
      capabilities: new Set(['view_properties', 'view_assistant'] as const),
      propertyScope: 'all' as const,
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock supabase admin client
// ---------------------------------------------------------------------------

interface RecordedCall {
  table: string;
  op: 'select';
  selects: Array<{ cols: string; opts?: { count?: string; head?: boolean } }>;
  eqs: Array<[string, unknown]>;
  ins: Array<[string, unknown[]]>;
  gtes: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean }]>;
}

type Result =
  | { data: unknown; error: null | { message: string } }
  | { count: number; data: unknown; error: null | { message: string } };

interface TableHandler {
  (call: RecordedCall): Result;
}

type TableHandlers = Record<string, TableHandler | TableHandler[]>;

function makeMock(handlers: TableHandlers): {
  db: AdminClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const callIndices: Record<string, number> = {};

  function dispatch(call: RecordedCall): Result {
    const h = handlers[call.table];
    if (!h && call.table === 'properties') {
      return { data: { id: PROP_A, name: 'Maple' }, error: null };
    }
    if (!h) throw new Error(`unhandled table: ${call.table}`);
    if (Array.isArray(h)) {
      const idx = callIndices[call.table] ?? 0;
      callIndices[call.table] = idx + 1;
      const fn = h[idx];
      if (!fn) throw new Error(`no handler for ${call.table}[${idx}]`);
      return fn(call);
    }
    return h(call);
  }

  function newCall(table: string): RecordedCall {
    return {
      table,
      op: 'select',
      selects: [],
      eqs: [],
      ins: [],
      gtes: [],
      orders: [],
    };
  }

  function makeBuilder(call: RecordedCall): Record<string, unknown> {
    const builder: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        call.eqs.push([col, val]);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        call.ins.push([col, vals]);
        return builder;
      },
      gte(col: string, val: unknown) {
        call.gtes.push([col, val]);
        return builder;
      },
      order(col: string, o?: { ascending?: boolean }) {
        call.orders.push([col, { ascending: o?.ascending !== false }]);
        return builder;
      },
      maybeSingle: async () => dispatch(call),
      then: <T1, T2 = never>(
        onfulfilled?: ((v: Result) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
      ): PromiseLike<T1 | T2> => {
        try {
          const r = dispatch(call);
          return Promise.resolve(
            onfulfilled ? onfulfilled(r) : (r as never),
          );
        } catch (err) {
          return onrejected
            ? Promise.resolve(onrejected(err))
            : Promise.reject(err);
        }
      },
    };
    return builder;
  }

  const from = vi.fn((table: string) => ({
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      const call = newCall(table);
      call.selects.push({ cols: cols ?? '*', opts });
      calls.push(call);
      return makeBuilder(call);
    },
  }));

  const db = { from } as unknown as SupabaseClient<Database>;
  return { db, calls };
}

// ===========================================================================
// listProperties
// ===========================================================================

describe('listProperties', () => {
  it('should return scoped property rows with correct unit counts', async () => {
    const { db, calls } = makeMock({
      properties: () => ({
        data: [
          {
            id: PROP_A,
            name: 'Maple',
            address_street: '412 Maple',
            address_city: 'Cleveland',
            address_state: 'OH',
            address_zip: '44102',
          },
          {
            id: PROP_B,
            name: 'Oak',
            address_street: null,
            address_city: null,
            address_state: null,
            address_zip: null,
          },
        ],
        error: null,
      }),
      units: () => ({
        data: [
          { id: UNIT_A1, property_id: PROP_A },
          { id: UNIT_A2, property_id: PROP_A },
          { id: UNIT_B1, property_id: PROP_B },
        ],
        error: null,
      }),
    });

    const out = await listProperties(deps(db));

    const items = JSON.parse(out.content[0]!.text) as ListPropertiesItem[];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: PROP_A,
      name: 'Maple',
      addressLine: '412 Maple, Cleveland, OH, 44102',
      unitCount: 2,
    });
    expect(items[1]).toEqual({
      id: PROP_B,
      name: 'Oak',
      addressLine: null,
      unitCount: 1,
    });

    // Verify org scoping on the properties query.
    const propCall = calls.find((c) => c.table === 'properties');
    expect(propCall!.eqs).toContainEqual(['organization_id', ORG]);

    // Verify the units query uses .in() with both property ids.
    const unitCall = calls.find((c) => c.table === 'units');
    expect(unitCall!.ins).toContainEqual(['property_id', [PROP_A, PROP_B]]);
  });

  it('should return an empty array when the org has no properties', async () => {
    const { db, calls } = makeMock({
      properties: () => ({ data: [], error: null }),
    });

    const out = await listProperties(deps(db));

    expect(JSON.parse(out.content[0]!.text)).toEqual([]);
    // Should NOT have queried units when there are no properties.
    expect(calls.find((c) => c.table === 'units')).toBeUndefined();
  });

  it('should throw a generic error if the properties query fails', async () => {
    const { db } = makeMock({
      properties: () => ({ data: null, error: { message: 'db down' } }),
    });

    await expect(
      listProperties(deps(db)),
    ).rejects.toThrow(/Failed to list properties/);
  });

  it('should apply explicit property grants to the service-role query', async () => {
    const { db, calls } = makeMock({
      properties: () => ({
        data: [{
          id: PROP_A,
          name: 'Maple',
          address_street: null,
          address_city: null,
          address_state: null,
          address_zip: null,
        }],
        error: null,
      }),
      units: () => ({ data: [], error: null }),
    });

    await listProperties(deps(db, { propertyScope: [PROP_A] }));

    expect(calls.find((call) => call.table === 'properties')?.ins).toContainEqual([
      'id',
      [PROP_A],
    ]);
  });

  it('should deny missing capability and empty scope before any service-role read', async () => {
    const denied = makeMock({});
    await expect(
      listProperties(deps(denied.db, { capabilities: new Set() })),
    ).rejects.toThrow('Forbidden');
    expect(denied.calls).toEqual([]);

    const empty = makeMock({});
    const out = await listProperties(deps(empty.db, { propertyScope: [] }));
    expect(JSON.parse(out.content[0]!.text)).toEqual([]);
    expect(empty.calls).toEqual([]);
  });
});

// ===========================================================================
// getProperty
// ===========================================================================

describe('getProperty', () => {
  it('should return a snapshot with kpis and recent activity count', async () => {
    mockedLoadPropertyContext.mockResolvedValue({
      property: {
        id: PROP_A,
        organizationId: ORG,
        name: 'Maple',
        addressLine: '412 Maple, Cleveland, OH, 44102',
        timezone: 'America/New_York',
        rulesText: '',
        autonomyLevel: 0.6,
        privacyMode: 'hosted',
      },
      facts: [],
      recentTurns: [],
      vendors: [],
      tenants: [],
      loadedAt: NOW,
    });

    const { db } = makeMock({
      // units → returns 2 units
      // leases → returns 2 active leases for distinct tenants + 1 expired
      // work_orders → head-count: 3 open
      // action_proposals → head-count: 5 in last 7d
      units: [
        () => ({
          data: [
            { id: UNIT_A1, property_id: PROP_A },
            { id: UNIT_A2, property_id: PROP_A },
          ],
          error: null,
        }),
        // countOpenWorkOrders calls units again
        () => ({
          data: [
            { id: UNIT_A1, property_id: PROP_A },
            { id: UNIT_A2, property_id: PROP_A },
          ],
          error: null,
        }),
      ],
      leases: () => ({
        data: [
          { id: 'l1', status: 'active', tenant_id: TENANT_1 },
          { id: 'l2', status: 'active', tenant_id: TENANT_2 },
          { id: 'l3', status: 'expired', tenant_id: TENANT_1 },
        ],
        error: null,
      }),
      work_orders: () => ({ count: 3, data: null, error: null }),
      action_proposals: () => ({ count: 5, data: null, error: null }),
    });

    const out = await getProperty(
      deps(db),
      { propertyId: PROP_A },
    );

    const snap = JSON.parse(out.content[0]!.text) as GetPropertySnapshot;
    expect(snap).toEqual({
      id: PROP_A,
      name: 'Maple',
      addressLine: '412 Maple, Cleveland, OH, 44102',
      autonomyLevel: 0.6,
      privacyMode: 'hosted',
      kpis: {
        tenantCount: 2,
        activeLeaseCount: 2,
        openWorkOrderCount: 3,
      },
      recentActivityCount: 5,
    });
  });

  it('should refuse to leak across organizations even if RLS were bypassed', async () => {
    mockedLoadPropertyContext.mockResolvedValue({
      property: {
        id: PROP_A,
        organizationId: OTHER_ORG,
        name: 'Cross-org property',
        addressLine: null,
        timezone: null,
        rulesText: '',
        autonomyLevel: 0,
        privacyMode: 'hosted',
      },
      facts: [],
      recentTurns: [],
      vendors: [],
      tenants: [],
      loadedAt: NOW,
    });

    const { db } = makeMock({});

    await expect(
      getProperty(
        deps(db),
        { propertyId: PROP_A },
      ),
    ).rejects.toThrow('Property not found');
  });

  it('should reject an out-of-scope property before loading its context', async () => {
    const { db } = makeMock({});
    mockedLoadPropertyContext.mockClear();

    await expect(
      getProperty(deps(db, { propertyScope: [PROP_B] }), { propertyId: PROP_A }),
    ).rejects.toThrow('Property not found');
    expect(mockedLoadPropertyContext).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// askProperty
// ===========================================================================

describe('askProperty', () => {
  const CHAT_ID = '00000000-0000-0000-0000-0000000000f1';

  beforeEach(() => {
    mockedLoadOrCreateChat.mockReset();
    mockedRunOperatorDispatcher.mockReset();
    mockedLoadOrCreateChat.mockResolvedValue({
      id: CHAT_ID,
      organization_id: ORG,
      user_id: USER,
      property_id: PROP_A,
      channel: 'mcp',
      status: 'open',
      last_message_at: null,
      created_at: NOW,
    });
  });

  it('should deny assistant capability or property scope before chat creation', async () => {
    const { db } = makeMock({});

    await expect(
      askProperty(
        deps(db, { capabilities: new Set(['view_properties']) }),
        { propertyId: PROP_A, message: 'status' },
      ),
    ).rejects.toThrow('Property not found');
    await expect(
      askProperty(
        deps(db, { propertyScope: [PROP_B] }),
        { propertyId: PROP_A, message: 'status' },
      ),
    ).rejects.toThrow('Property not found');
    expect(mockedLoadOrCreateChat).not.toHaveBeenCalled();
    expect(mockedRunOperatorDispatcher).not.toHaveBeenCalled();
  });

  it('should accumulate say.delta text and return it as the joined response', async () => {
    mockedRunOperatorDispatcher.mockReturnValue(
      asyncIter([
        { type: 'say.delta', text: 'Two open work orders ' },
        { type: 'say.delta', text: 'and one late tenant.' },
        { type: 'done', turnId: 't-1' },
      ]),
    );

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: 'whats pending here?' },
    );

    expect(out.content[0]!.text).toBe(
      'Two open work orders and one late tenant.',
    );

    // Verify the dispatcher was invoked with channel='mcp' and the
    // chat id from loadOrCreateChat.
    expect(mockedLoadOrCreateChat).toHaveBeenCalledWith(db, {
      organizationId: ORG,
      userId: USER,
      propertyId: PROP_A,
      channel: 'mcp',
    });
    expect(mockedRunOperatorDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID,
        channel: 'mcp',
        message: 'whats pending here?',
      }),
    );
  });

  it('should append a ✓ summary line per proposal.committed event using formatActionSummary', async () => {
    mockedRunOperatorDispatcher.mockReturnValue(
      asyncIter([
        { type: 'say.delta', text: 'Texted Jane.' },
        {
          type: 'proposal.committed',
          proposal: makeProposal({
            action_type: 'draft_sms_reply',
            payload: {
              body: 'Got it — see you Tuesday.',
              tone: 'warm',
            },
          }),
        },
        { type: 'done', turnId: 't-1' },
      ]),
    );

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: 'text Jane' },
    );

    expect(out.content[0]!.text).toBe(
      'Texted Jane.\n\n✓ Texted tenant (warm)',
    );
  });

  it('should append a ⏳ line with the review URL for proposal.review_required', async () => {
    mockedRunOperatorDispatcher.mockReturnValue(
      asyncIter([
        { type: 'say.delta', text: 'Drafted SMS — needs your eyes.' },
        {
          type: 'proposal.review_required',
          proposal: makeProposal({
            action_type: 'dispatch_vendor',
            payload: { candidateIndex: 2, smsBody: 'Plumber tomorrow at 9?' },
          }),
          reviewUrl: 'https://app.odesa.com/inbox/p-1',
        },
        { type: 'done', turnId: 't-1' },
      ]),
    );

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: 'send out the plumber' },
    );

    expect(out.content[0]!.text).toBe(
      'Drafted SMS — needs your eyes.\n\n' +
        '⏳ Dispatch approval recorded (candidate #2) — needs review: https://app.odesa.com/inbox/p-1',
    );
  });

  it('should drop ack/tool.use/tool.result/proposal.recorded events', async () => {
    mockedRunOperatorDispatcher.mockReturnValue(
      asyncIter([
        { type: 'ack', text: 'Looking…' },
        { type: 'tool.use', name: 'get_property', input: {}, toolUseId: 'u-1' },
        { type: 'tool.result', toolUseId: 'u-1', result: { ok: true } },
        { type: 'proposal.recorded', proposal: makeProposal() },
        { type: 'say.delta', text: 'Two open.' },
        { type: 'done', turnId: 't-1' },
      ]),
    );

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: 'status' },
    );

    expect(out.content[0]!.text).toBe('Two open.');
  });

  it('should append a ⚠ line for tool.error events so Poke sees what failed', async () => {
    mockedRunOperatorDispatcher.mockReturnValue(
      asyncIter([
        { type: 'tool.error', name: 'spawn', message: 'Tenant not found' },
        { type: 'done', turnId: 't-1' },
      ]),
    );

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: 'text Jane' },
    );

    expect(out.content[0]!.text).toBe('⚠ spawn: Tenant not found');
  });

  it('should return the fallback message when the dispatcher emits nothing user-visible', async () => {
    mockedRunOperatorDispatcher.mockReturnValue(
      asyncIter([{ type: 'done', turnId: 't-1' }]),
    );

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: '?' },
    );

    expect(out.content[0]!.text).toBe(
      __testing.DISPATCHER_FALLBACK_MESSAGE,
    );
  });

  it('should return a clear MCP-level error message when the dispatcher throws', async () => {
    // Defense-in-depth: the dispatcher should surface failures as
    // tool.error events, but if it throws synchronously (e.g. the loop
    // wedges before the first yield) we must NOT bubble the raw stack
    // into the Poke response.
    async function* failingIter(): AsyncGenerator<DispatcherEvent> {
      throw new Error('boom: ANTHROPIC_API_KEY missing');
      yield { type: 'done', turnId: 't-1' };
    }
    mockedRunOperatorDispatcher.mockReturnValue(failingIter());

    const { db } = makeMock({});
    const out = await askProperty(
      deps(db),
      { propertyId: PROP_A, message: 'whats pending' },
    );

    expect(out.content[0]!.text).toBe(__testing.DISPATCHER_THROW_MESSAGE);
    // Critically: must NOT contain raw error text or stack info.
    expect(out.content[0]!.text).not.toContain('boom');
    expect(out.content[0]!.text).not.toContain('ANTHROPIC_API_KEY');
  });

  it('should expose formatActionSummary for each WorkerActionType branch', () => {
    const cases: Array<{ proposal: ActionProposal; expected: string }> = [
      {
        proposal: makeProposal({
          action_type: 'draft_sms_reply',
          payload: { body: 'hi', tone: 'firm' },
        }),
        expected: 'Texted tenant (firm)',
      },
      {
        proposal: makeProposal({
          action_type: 'dispatch_vendor',
          payload: { candidateIndex: 0, smsBody: 'on the way' },
        }),
        expected: 'Dispatch approval recorded (candidate #0)',
      },
      {
        proposal: makeProposal({
          action_type: 'classify_intent',
          payload: { intent: 'rent_question', reasoning: '' },
        }),
        expected: 'Classified intent',
      },
      {
        proposal: makeProposal({
          action_type: 'confirm_emergency',
          payload: {
            isEmergency: true,
            category: 'water',
            recommendedAction: 'escalate_now',
          },
        }),
        expected: 'Confirmed emergency status',
      },
      {
        proposal: makeProposal({
          action_type: 'polish_briefing',
          payload: { prose: 'All quiet.' },
        }),
        expected: 'Polished briefing',
      },
      {
        proposal: makeProposal({
          action_type: 'update_rulebook',
          payload: { newRulebook: '...', diffSummary: '+1 line' },
        }),
        expected: 'Updated rulebook',
      },
    ];

    for (const c of cases) {
      expect(__testing.formatActionSummary(c.proposal)).toBe(c.expected);
    }
  });

  it('summarizes dispatch_vendor as an approval RECORD, never a past-tense contact', () => {
    // Vendor Dispatch Truth: committing a dispatch_vendor proposal is a no-op
    // (src/lib/agent/proposals/commit.ts) — nobody is contacted. The MCP
    // summary must say the approval was recorded, and must NEVER imply the
    // vendor was actually reached.
    const summary = __testing.formatActionSummary(
      makeProposal({
        action_type: 'dispatch_vendor',
        payload: { candidateIndex: 3, smsBody: 'plumber?' },
      }),
    );
    expect(summary).toBe('Dispatch approval recorded (candidate #3)');
    expect(summary).not.toMatch(/dispatched vendor/i);
    expect(summary).not.toMatch(/vendor (contacted|notified|sent|texted)/i);
  });
});
