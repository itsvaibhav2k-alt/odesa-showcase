/**
 * Wave 6 Stream E.1 — dispatcher → spawn → handler → proposal → commit
 * integration spec for portfolio-write action_types.
 *
 * Coverage target: prove that a dispatcher tool_use for
 * `spawn_property_worker` with one of the new write action_types
 * (`create_property`, `update_rent`) flows end-to-end through:
 *
 *   1. spawn MCP's `handleWriteAction` (validates payload via zod,
 *      attaches an in-memory ActionProposal to the org's anchor
 *      property).
 *   2. `recordProposal` stamps the explicit safety disposition. Safe internal
 *      capture (create_property) may be automatic; a consequential lease/rent
 *      mutation (update_rent) must remain review-only regardless of confidence.
 *   3. Only the safe automatic path reaches `commitProposal` and its real
 *      handler INSERT/UPDATE. The review path performs no domain mutation.
 *   4. Events and narrated results stay aligned with the durable proposal
 *      state.
 *
 * Mocking strategy
 * ----------------
 * The Claude Agent SDK `query()` is mocked at module boundary. The
 * mock pulls the spawn MCP out of the `options.mcpServers` map the
 * dispatcher constructed, fishes the registered tool handler out of
 * the underlying McpServer (`instance._registeredTools`), invokes it
 * synchronously with the test-supplied args, then yields a scripted
 * SDK message sequence:
 *   assistant tool_use → user tool_result → assistant final text.
 *
 * This is the same access pattern used by `mcps/__tests__/spawn.test.ts`
 * (it bypasses the SDK's wire transport but exercises the real spawn
 * handler, recordProposal, commitProposal, and downstream WORKER_HANDLERS
 * code paths). recordProposal + commitProposal are NOT mocked — they
 * run against the chainable Supabase mock from the wave-6 handler test
 * helpers, with row queues seeded per (table, op).
 *
 * Two scenarios are exercised here. Two more pinning tests cover
 * payload validation + gate routing edge cases. Other action_types
 * are covered by the per-handler unit specs and the spawn MCP unit
 * spec; the goal here is just to prove the pipeline composes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type { DispatcherEvent } from '../types';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

// Claude SDK is mocked module-wide; we drive it per-test via a
// programmable factory that picks the spawn MCP off the options.
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<
    typeof import('@anthropic-ai/claude-agent-sdk')
  >('@anthropic-ai/claude-agent-sdk');
  return {
    ...actual,
    query: vi.fn(),
  };
});

// org-context is mocked so we don't need a real `organizations` SELECT
// during the test bootstrap. The org context's `properties[0]` is the
// anchor handleWriteAction attaches the action_proposals row to.
vi.mock('../org-context', () => ({
  loadOrganizationContext: vi.fn(),
}));

// persist is mocked so appendTurn / loadHistory / bumpChatLastMessageAt
// are no-ops. The integration we're testing is dispatcher → spawn →
// handler, not the audit log writer (covered by dispatcher.test.ts).
vi.mock('../persist', () => ({
  appendTurn: vi.fn(async () => ({})),
  loadHistory: vi.fn(async () => []),
  bumpChatLastMessageAt: vi.fn(async () => undefined),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadOrganizationContext } from '../org-context';
import { runOperatorDispatcher } from '../dispatcher';
import { ORG_ID, PROPERTY_ID, makeAdmin } from
  '@/lib/agent/worker/handlers/__tests__/__helpers';
import type { OrganizationContext } from '../org-context';

const mockQuery = vi.mocked(query);
const mockLoadOrgCtx = vi.mocked(loadOrganizationContext);

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEW_PROP_ID = '77777777-7777-4777-8777-777777777777';
const TENANT_ID = '55555555-5555-4555-8555-555555555555';
const LEASE_ID = '66666666-6666-4666-8666-666666666666';
const PROPOSAL_ID = '99999999-9999-4999-8999-999999999999';

function fakeOrgContext(): OrganizationContext {
  return {
    organization: {
      id: ORG_ID,
      name: 'Galaxy Estates',
      assistantName: 'Odesa',
    },
    properties: [
      {
        id: PROPERTY_ID,
        name: 'Galaxy A',
        address: '1 Main St, Aldie VA 20105',
        timezone: 'America/New_York',
        autonomyLevel: 0.5,
        privacyMode: 'hosted',
      },
    ],
    loadedAt: '2026-05-07T00:00:00.000Z',
  };
}

interface ToolDefShape {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: Record<string, unknown>, extra?: unknown) => Promise<any>;
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
}

/**
 * Reach into the MCP server the dispatcher built and pull the
 * registered tool handler. Mirrors the access pattern used in
 * `mcps/__tests__/spawn.test.ts`.
 */
function findSpawnHandler(
  mcpServers: Record<string, unknown> | undefined,
): ToolDefShape['handler'] {
  if (!mcpServers) throw new Error('no mcpServers in query options');
  const spawn = mcpServers['odesa-operator-spawn'] as McpServerShape;
  const tool = spawn.instance?._registeredTools?.['spawn_property_worker'];
  if (!tool) throw new Error('spawn_property_worker not registered');
  return tool.handler;
}

/**
 * Build a stub SDK async-iterable that:
 *   1. Synchronously kicks off the real spawn MCP
 *      `spawn_property_worker` handler with the test-supplied args
 *      (this is where the proposal record + commit actually happen —
 *      emit fires from inside the handler).
 *   2. Yields a scripted SDK message sequence so the dispatcher
 *      translates them into say.delta + tool.use + tool.result events.
 *      The user `tool_result` message is awaited against the handler
 *      promise so we don't yield a stale result.
 *
 * The `finalText` arg is what the assistant says back to the operator
 * AFTER the tool returned. The dispatcher emits this verbatim as
 * `say.delta`; tests assert against it.
 *
 * Returned shape mirrors `Query` (AsyncGenerator-like) — the SDK's real
 * `query()` returns a sync object with `[Symbol.asyncIterator]`, NOT a
 * Promise. Returning a Promise here breaks the dispatcher's
 * `for await (const sdkMsg of query(...))` since it would iterate a
 * Promise (no asyncIterator).
 */
function scriptSpawnInvocation(opts: {
  toolInput: Record<string, unknown>;
  finalText: string;
}) {
  const toolUseId = 'tool_use_test';

  return (queryArgs: { options?: { mcpServers?: unknown } }) => {
    const handler = findSpawnHandler(
      queryArgs.options?.mcpServers as Record<string, unknown>,
    );
    // Fire the real handler synchronously — it returns a promise that
    // resolves once recordProposal + commitProposal have run. emit
    // fires from inside before this resolves; the iterator below
    // awaits the promise before yielding the tool_result message.
    const handlerPromise = handler(opts.toolInput);

    return {
      [Symbol.asyncIterator]() {
        let step = 0;
        return {
          async next() {
            if (step === 0) {
              step = 1;
              return {
                value: {
                  type: 'assistant',
                  message: {
                    content: [
                      {
                        type: 'tool_use',
                        id: toolUseId,
                        name: 'mcp__odesa-operator-spawn__spawn_property_worker',
                        input: opts.toolInput,
                      },
                    ],
                  },
                  parent_tool_use_id: null,
                  uuid: 'uuid-asst-1',
                  session_id: 'sess',
                },
                done: false,
              };
            }
            if (step === 1) {
              step = 2;
              const toolResult = await handlerPromise;
              return {
                value: {
                  type: 'user',
                  message: {
                    content: [
                      {
                        type: 'tool_result',
                        tool_use_id: toolUseId,
                        content: toolResult.content,
                      },
                    ],
                  },
                  parent_tool_use_id: null,
                },
                done: false,
              };
            }
            if (step === 2) {
              step = 3;
              return {
                value: {
                  type: 'assistant',
                  message: {
                    content: [{ type: 'text', text: opts.finalText }],
                  },
                  parent_tool_use_id: null,
                  uuid: 'uuid-asst-2',
                  session_id: 'sess',
                },
                done: false,
              };
            }
            if (step === 3) {
              step = 4;
              return {
                value: { type: 'result', subtype: 'success' },
                done: false,
              };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  };
}

async function collect(
  gen: AsyncGenerator<DispatcherEvent>,
): Promise<DispatcherEvent[]> {
  const out: DispatcherEvent[] = [];
  for await (const ev of gen) {
    out.push(ev);
  }
  return out;
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadOrgCtx.mockResolvedValue(fakeOrgContext());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------
// Scenario A — create_property end-to-end
// -----------------------------------------------------------------------

describe('dispatcher write tools / create_property', () => {
  it('records, gates auto, commits, and inserts a properties row', async () => {
    // Queue Supabase responses in the order each table is queried.
    //
    // 1. action_proposals INSERT (recordProposal)         → row with id
    // 2. properties SELECT      (handleCreateProperty idempotency lookup)
    //                                                       → no existing
    // 3. properties INSERT      (handleCreateProperty insert)
    //                                                       → created row
    // 4. action_proposals SELECT (commitProposal load)    → proposed row
    // 5. action_proposals UPDATE (commitProposal mark)    → committed row
    const proposedRow = {
      id: PROPOSAL_ID,
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      worker_model: 'dispatcher-direct',
      action_type: 'create_property',
      payload: {
        name: 'Vaba House',
        addressStreet: '25911 Sycamore Grove Pl',
        addressCity: 'Aldie',
        addressState: 'VA',
        addressZip: '20105',
      },
      reasoning: 'Dispatcher-supplied create_property',
      confidence: 0.9,
      context_fact_ids: null,
      gate_decision: 'auto',
      status: 'proposed',
      committed_at: null,
      routing: null,
      created_at: '2026-05-07T00:00:00.000Z',
    };

    const { admin, calls } = makeAdmin({
      users: [{ data: { role: 'owner' }, error: null }],
      action_proposals: [
        { data: proposedRow, error: null }, // recordProposal INSERT
        { data: proposedRow, error: null }, // commitProposal load
        {
          data: { ...proposedRow, status: 'committing' },
          error: null,
        }, // commitProposal CAS claim
        {
          data: { ...proposedRow, status: 'committed' },
          error: null,
        }, // commitProposal mark
      ],
      properties: [
        { data: null, error: null }, // idempotency lookup → no existing
        {
          data: {
            id: NEW_PROP_ID,
            name: 'Vaba House',
            address_street: '25911 Sycamore Grove Pl',
            address_city: 'Aldie',
            address_state: 'VA',
            address_zip: '20105',
            timezone: 'America/New_York',
          },
          error: null,
        }, // insert
      ],
    });

    mockQuery.mockImplementation(
      scriptSpawnInvocation({
        toolInput: {
          action_type: 'create_property',
          payload: {
            name: 'Vaba House',
            addressStreet: '25911 Sycamore Grove Pl',
            addressCity: 'Aldie',
            addressState: 'VA',
            addressZip: '20105',
          },
        },
        finalText: 'Created Vaba House at 25911 Sycamore Grove Pl, Aldie VA 20105.',
      }) as unknown as typeof query,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: admin as unknown as SupabaseClient<Database>,
        organizationId: ORG_ID,
        userId: USER_ID,
        chatId: CHAT_ID,
        message: 'add a property called Vaba House at 25911 Sycamore Grove Pl Aldie VA 20105',
        channel: 'web',
      }),
    );

    // The dispatcher emitted (in order): proposal.recorded,
    // proposal.committed, tool.use, tool.result, say.delta, done. The
    // proposal events come from the spawn MCP's emit path (synchronous
    // inside the handler); the tool.use/result/say.delta come from
    // translating the scripted SDK messages.
    const types = events.map((e) => e.type);
    expect(types).toContain('proposal.recorded');
    expect(types).toContain('proposal.committed');
    expect(types).toContain('say.delta');
    expect(types[types.length - 1]).toBe('done');

    // action_proposals INSERT happened with the right shape.
    const proposalsInsert = calls.find(
      (c) => c.table === 'action_proposals' && c.op === 'insert',
    );
    expect(proposalsInsert).toBeTruthy();
    expect(proposalsInsert!.insertValues!['action_type']).toBe('create_property');
    expect(proposalsInsert!.insertValues!['gate_decision']).toBe('auto');
    expect(proposalsInsert!.insertValues!['status']).toBe('proposed');
    expect(proposalsInsert!.insertValues!['organization_id']).toBe(ORG_ID);

    // action_proposals UPDATEs: CAS claim ('committing') first, then
    // the finalize ('committed').
    const proposalUpdates = calls.filter(
      (c) => c.table === 'action_proposals' && c.op === 'update',
    );
    expect(
      proposalUpdates.map((c) => c.updateValues!['status']),
    ).toEqual(['committing', 'committed']);

    // properties INSERT happened with the right shape, scoped to the org.
    const propertiesInsert = calls.find(
      (c) => c.table === 'properties' && c.op === 'insert',
    );
    expect(propertiesInsert).toBeTruthy();
    expect(propertiesInsert!.insertValues!['name']).toBe('Vaba House');
    expect(propertiesInsert!.insertValues!['address_street']).toBe(
      '25911 Sycamore Grove Pl',
    );
    expect(propertiesInsert!.insertValues!['organization_id']).toBe(ORG_ID);

    // The dispatcher's final reply text contains "Created" and the name.
    const sayEvents = events.filter(
      (e): e is Extract<DispatcherEvent, { type: 'say.delta' }> =>
        e.type === 'say.delta',
    );
    const reply = sayEvents.map((e) => e.text).join('');
    expect(reply).toContain('Created');
    expect(reply).toContain('Vaba House');
  });

  it('emits proposal.committed carrying the committed proposal payload', async () => {
    // Same scaffold, narrower assertion: the proposal.committed event's
    // payload is the dispatcher-supplied create_property payload (not
    // a transformed shape) so the iMessage transport's
    // `formatProposalSummary` can render it correctly.
    const proposedRow = {
      id: PROPOSAL_ID,
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      worker_model: 'dispatcher-direct',
      action_type: 'create_property',
      payload: {
        name: 'Vaba House',
        addressStreet: '25911 Sycamore Grove Pl',
        addressCity: 'Aldie',
        addressState: 'VA',
        addressZip: '20105',
      },
      reasoning: 'Dispatcher-supplied create_property',
      confidence: 0.9,
      context_fact_ids: null,
      gate_decision: 'auto',
      status: 'proposed',
      committed_at: null,
      routing: null,
      created_at: '2026-05-07T00:00:00.000Z',
    };
    const { admin } = makeAdmin({
      users: [{ data: { role: 'owner' }, error: null }],
      action_proposals: [
        { data: proposedRow, error: null },
        { data: proposedRow, error: null },
        {
          data: { ...proposedRow, status: 'committing' },
          error: null,
        }, // commitProposal CAS claim
        {
          data: { ...proposedRow, status: 'committed' },
          error: null,
        },
      ],
      properties: [
        { data: null, error: null },
        {
          data: {
            id: NEW_PROP_ID,
            name: 'Vaba House',
            address_street: '25911 Sycamore Grove Pl',
            address_city: 'Aldie',
            address_state: 'VA',
            address_zip: '20105',
            timezone: 'America/New_York',
          },
          error: null,
        },
      ],
    });
    mockQuery.mockImplementation(
      scriptSpawnInvocation({
        toolInput: {
          action_type: 'create_property',
          payload: {
            name: 'Vaba House',
            addressStreet: '25911 Sycamore Grove Pl',
            addressCity: 'Aldie',
            addressState: 'VA',
            addressZip: '20105',
          },
        },
        finalText: 'Done.',
      }) as unknown as typeof query,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: admin as unknown as SupabaseClient<Database>,
        organizationId: ORG_ID,
        userId: USER_ID,
        chatId: CHAT_ID,
        message: 'add Vaba House',
        channel: 'web',
      }),
    );

    const committed = events.find(
      (e): e is Extract<DispatcherEvent, { type: 'proposal.committed' }> =>
        e.type === 'proposal.committed',
    );
    expect(committed).toBeTruthy();
    expect(committed!.proposal.action_type).toBe('create_property');
    const payload = committed!.proposal.payload as Record<string, unknown>;
    expect(payload['name']).toBe('Vaba House');
    expect(payload['addressStreet']).toBe('25911 Sycamore Grove Pl');
  });
});

// -----------------------------------------------------------------------
// Scenario B — update_rent end-to-end
// -----------------------------------------------------------------------

describe('dispatcher write tools / update_rent', () => {
  it('records an Owner Queue review item without mutating a lease', async () => {
    const proposedRow = {
      id: PROPOSAL_ID,
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      worker_model: 'dispatcher-direct',
      action_type: 'update_rent',
      payload: {
        leaseRef: { tenantName: 'babab' },
        rentAmount: 1900,
      },
      reasoning: 'Dispatcher-supplied update_rent',
      confidence: 0.9,
      context_fact_ids: null,
      gate_decision: 'auto',
      status: 'proposed',
      committed_at: null,
      routing: null,
      created_at: '2026-05-07T00:00:00.000Z',
    };
    const { admin, calls } = makeAdmin({
      users: [{ data: { role: 'owner' }, error: null }],
      action_proposals: [
        { data: proposedRow, error: null }, // recordProposal INSERT
        { data: proposedRow, error: null }, // commitProposal load
        {
          data: { ...proposedRow, status: 'committing' },
          error: null,
        }, // commitProposal CAS claim
        {
          data: { ...proposedRow, status: 'committed' },
          error: null,
        }, // commitProposal mark
      ],
      tenants: [
        { data: [{ id: TENANT_ID }], error: null }, // resolveTenant
      ],
      leases: [
        { data: [{ id: LEASE_ID }], error: null }, // resolveLease active-lease lookup
        {
          data: { id: LEASE_ID, rent_amount: 1500 },
          error: null,
        }, // current rent read
        {
          data: {
            id: LEASE_ID,
            rent_amount: 1900,
            tenant_id: TENANT_ID,
            unit_id: '44444444-4444-4444-8444-444444444444',
          },
          error: null,
        }, // UPDATE
      ],
    });
    mockQuery.mockImplementation(
      scriptSpawnInvocation({
        toolInput: {
          action_type: 'update_rent',
          payload: {
            leaseRef: { tenantName: 'babab' },
            rentAmount: 1900,
          },
        },
        finalText: "Prepared babab's $1,900 rent change for Owner Queue review.",
      }) as unknown as typeof query,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: admin as unknown as SupabaseClient<Database>,
        organizationId: ORG_ID,
        userId: USER_ID,
        chatId: CHAT_ID,
        message: "update babab's rent to $1900",
        channel: 'web',
      }),
    );

    expect(events.some((e) => e.type === 'proposal.committed')).toBe(false);
    expect(events.some((e) => e.type === 'proposal.review_required')).toBe(true);

    // Review-first means the lease resolver and mutator never run.
    const leasesUpdate = calls.find(
      (c) => c.table === 'leases' && c.op === 'update',
    );
    expect(leasesUpdate).toBeUndefined();
    expect(
      calls.some((c) => c.table === 'tenants' && c.op === 'select'),
    ).toBe(false);
    const proposalInsert = calls.find(
      (c) => c.table === 'action_proposals' && c.op === 'insert',
    );
    expect(proposalInsert?.insertValues?.['gate_decision']).toBe('review');

    // Final reply text from the scripted assistant message.
    const reply = events
      .filter(
        (e): e is Extract<DispatcherEvent, { type: 'say.delta' }> =>
          e.type === 'say.delta',
      )
      .map((e) => e.text)
      .join('');
    expect(reply).toBe(
      "Prepared babab's $1,900 rent change for Owner Queue review.",
    );
  });
});

// -----------------------------------------------------------------------
// Pinning tests — payload validation + ambiguous-ref edge cases.
// -----------------------------------------------------------------------

describe('dispatcher write tools / edge cases', () => {
  it('returns a tool error message when the payload fails zod validation', async () => {
    // No Supabase queues seeded — the spawn handler should reject the
    // payload before any DB call. action_proposals must NOT be inserted.
    const { admin, calls } = makeAdmin({});
    mockQuery.mockImplementation(
      scriptSpawnInvocation({
        toolInput: {
          action_type: 'create_property',
          // Missing addressStreet/addressCity/addressState/addressZip.
          payload: { name: 'Incomplete' },
        },
        finalText: "I couldn't add that — the address is incomplete.",
      }) as unknown as typeof query,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: admin as unknown as SupabaseClient<Database>,
        organizationId: ORG_ID,
        userId: USER_ID,
        chatId: CHAT_ID,
        message: 'add a property',
        channel: 'web',
      }),
    );

    // No INSERT into action_proposals or properties.
    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(0);

    // The dispatcher terminates, but malformed model output is explicit
    // failure evidence for the durable executor rather than false success.
    expect(events[events.length - 1]!.type).toBe('done');
    expect(events.some((event) => event.type === 'tool.error')).toBe(true);

    // The tool result text surfaced into the SDK loop carries the
    // validation summary. We don't assert against the exact string
    // (zod's error formatting can drift); we assert the dispatcher
    // didn't crash and that no proposal.committed fired.
    expect(events.some((e) => e.type === 'proposal.committed')).toBe(false);
  });

  it('does not commit when resolveLease fails (tenant not found)', async () => {
    // recordProposal succeeds (the payload validates), but commit fires
    // the handler which returns ok:false — handleUpdateRent returns
    // error 'lease_not_found'. commit.ts proceeds to mark the
    // proposal committed regardless (the action_proposals row is the
    // audit trail; handler-level failures are recorded on the
    // returned dispatch result, not by reverting status). We assert
    // no leases UPDATE happened — the handler bailed before mutating.
    const proposedRow = {
      id: PROPOSAL_ID,
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      worker_model: 'dispatcher-direct',
      action_type: 'update_rent',
      payload: {
        leaseRef: { tenantName: 'ghost' },
        rentAmount: 2000,
      },
      reasoning: 'Dispatcher-supplied update_rent',
      confidence: 0.9,
      context_fact_ids: null,
      gate_decision: 'auto',
      status: 'proposed',
      committed_at: null,
      routing: null,
      created_at: '2026-05-07T00:00:00.000Z',
    };
    const { admin, calls } = makeAdmin({
      users: [{ data: { role: 'owner' }, error: null }],
      action_proposals: [
        { data: proposedRow, error: null }, // recordProposal INSERT
        { data: proposedRow, error: null }, // commitProposal load
        {
          data: { ...proposedRow, status: 'committing' },
          error: null,
        }, // commitProposal CAS claim
        {
          data: { ...proposedRow, status: 'committed' },
          error: null,
        }, // commitProposal mark
      ],
      tenants: [
        { data: [], error: null }, // resolveTenant → no match
      ],
    });
    mockQuery.mockImplementation(
      scriptSpawnInvocation({
        toolInput: {
          action_type: 'update_rent',
          payload: {
            leaseRef: { tenantName: 'ghost' },
            rentAmount: 2000,
          },
        },
        finalText: "I couldn't find that tenant.",
      }) as unknown as typeof query,
    );

    await collect(
      runOperatorDispatcher({
        admin: admin as unknown as SupabaseClient<Database>,
        organizationId: ORG_ID,
        userId: USER_ID,
        chatId: CHAT_ID,
        message: "update ghost's rent",
        channel: 'web',
      }),
    );

    // No leases UPDATE — handler bailed at lease resolution.
    const leasesUpdate = calls.find(
      (c) => c.table === 'leases' && c.op === 'update',
    );
    expect(leasesUpdate).toBeUndefined();
  });
});
