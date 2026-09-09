/**
 * Unit tests for src/lib/agent/operator/dispatcher.ts.
 *
 * The Claude Agent SDK is mocked at module boundary — `query()` is
 * replaced with a programmable async-iterable that yields a scripted
 * sequence of SDKMessages. This lets us drive the full dispatcher
 * loop deterministically and assert:
 *
 *   - Translation: SDK assistant text/tool_use blocks → say.delta /
 *     tool.use events; SDK user tool_result blocks → tool.result.
 *   - Persist side-effects: appendTurn called per audit-worthy event.
 *   - Ordering: user persist → translated events → final
 *     assistant_text persist → bumpChatLastMessageAt → done.
 *   - Error paths: SDK throws → tool.error + done; persist throws →
 *     tool.error + done. Dispatcher never re-throws to the caller.
 *   - Org-level routing: no propertyHint → org-wide system prompt;
 *     propertyHint present → hint line in prompt prologue.
 *   - Channel-aware ack routing happens in createAckMcp (covered in
 *     its own tests). Here we verify the dispatcher passes `sendInline`
 *     through to the ack MCP factory unchanged.
 *
 * The MCP factories themselves are mocked too — we only care that
 * the dispatcher constructs them with the right args and wires the
 * shared `emit` callback through. Per-tool behavior lives in the
 * mcps/__tests__/* suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type {
  ContextTenantSummary,
  ContextVendorSummary,
  PropertyContext,
} from '@/lib/agent/worker/types';
import type { DispatcherEvent } from '../types';
import type { OrganizationContext } from '../org-context';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));
vi.mock('@/lib/agent/worker/context-loader', () => ({
  loadPropertyContext: vi.fn(),
}));
vi.mock('../org-context', () => ({
  loadOrganizationContext: vi.fn(),
}));
vi.mock('../persist', () => ({
  appendTurn: vi.fn(async (_admin, args) => ({
    id: `row_${Math.random().toString(36).slice(2, 8)}`,
    chat_id: args.chatId,
    organization_id: args.organizationId,
    turn_id: args.turnId,
    role: args.role,
    body: args.body ?? null,
    tool_name: args.toolName ?? null,
    tool_input: args.toolInput ?? null,
    tool_use_id: args.toolUseId ?? null,
    tool_result: args.toolResult ?? null,
    proposal_id: args.proposalId ?? null,
    created_at: new Date().toISOString(),
  })),
  loadHistory: vi.fn(async () => []),
  bumpChatLastMessageAt: vi.fn(async () => undefined),
}));

// MCP factories return a tagged object the dispatcher passes verbatim
// to the SDK; we record the construction args so we can assert wiring.
const mockMcpCalls: {
  ack: Array<Record<string, unknown>>;
  context: Array<Record<string, unknown>>;
  spawn: Array<Record<string, unknown>>;
  proposals: Array<Record<string, unknown>>;
  memory: Array<Record<string, unknown>>;
  scheduling: Array<Record<string, unknown>>;
  calendar: Array<Record<string, unknown>>;
} = {
  ack: [],
  context: [],
  spawn: [],
  proposals: [],
  memory: [],
  scheduling: [],
  calendar: [],
};

vi.mock('../mcps/ack', () => ({
  createAckMcp: vi.fn((deps) => {
    mockMcpCalls.ack.push(deps);
    return { type: 'sdk', name: 'odesa-operator-ack' };
  }),
}));
vi.mock('../mcps/context', () => ({
  createContextMcp: vi.fn((deps) => {
    mockMcpCalls.context.push(deps);
    return { type: 'sdk', name: 'odesa-operator-context' };
  }),
}));
vi.mock('../mcps/spawn', () => ({
  createSpawnMcp: vi.fn((deps) => {
    mockMcpCalls.spawn.push(deps);
    return { type: 'sdk', name: 'odesa-operator-spawn' };
  }),
}));
vi.mock('../mcps/proposals', () => ({
  createProposalsMcp: vi.fn((deps) => {
    mockMcpCalls.proposals.push(deps);
    return { type: 'sdk', name: 'odesa-operator-proposals' };
  }),
}));
vi.mock('../mcps/memory', () => ({
  createMemoryMcp: vi.fn((deps) => {
    mockMcpCalls.memory.push(deps);
    return { type: 'sdk', name: 'odesa-operator-memory' };
  }),
}));
vi.mock('../mcps/scheduling', () => ({
  createSchedulingMcp: vi.fn((deps) => {
    mockMcpCalls.scheduling.push(deps);
    return { type: 'sdk', name: 'odesa-operator-scheduling' };
  }),
}));
vi.mock('../mcps/calendar', () => ({
  createCalendarMcp: vi.fn((deps) => {
    mockMcpCalls.calendar.push(deps);
    return { type: 'sdk', name: 'odesa-operator-calendar' };
  }),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { loadPropertyContext } from '@/lib/agent/worker/context-loader';
import { loadOrganizationContext } from '../org-context';
import {
  appendTurn,
  bumpChatLastMessageAt,
  loadHistory,
} from '../persist';
import { runOperatorDispatcher, buildSystemPrompt } from '../dispatcher';

const mockQuery = vi.mocked(query);
const mockLoadCtx = vi.mocked(loadPropertyContext);
const mockLoadOrgCtx = vi.mocked(loadOrganizationContext);
const mockAppendTurn = vi.mocked(appendTurn);
const mockBumpChat = vi.mocked(bumpChatLastMessageAt);
const mockLoadHistory = vi.mocked(loadHistory);

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const ORG = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000002';
const PROP = '00000000-0000-0000-0000-000000000003';
const CHAT = '00000000-0000-0000-0000-000000000004';
const PROP2 = '00000000-0000-0000-0000-000000000005';

function fakeAdmin(): SupabaseClient<Database> {
  return {} as unknown as SupabaseClient<Database>;
}

function fakeAdminWithRole(role: 'owner' | 'manager' | 'va') {
  const maybeSingle = vi.fn(async () => ({ data: { role }, error: null }));
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  const from = vi.fn(() => builder);
  return { from } as unknown as SupabaseClient<Database>;
}

function fakeOrgContext(
  propertyCount = 2,
  assistantName = 'Odesa',
): OrganizationContext {
  const properties = Array.from({ length: propertyCount }, (_, i) => ({
    id: i === 0 ? PROP : PROP2,
    name: i === 0 ? '412 Maple' : 'Oakwood Commons',
    address: i === 0 ? '412 Maple St' : '100 Oakwood Dr',
    timezone: 'America/New_York',
    autonomyLevel: 0.5,
    privacyMode: 'hosted',
  }));
  return {
    organization: { id: ORG, name: 'Galaxy Estates', assistantName },
    properties,
    loadedAt: '2026-05-04T00:00:00.000Z',
  };
}

function fakeContext(
  overrides: Partial<PropertyContext['property']> = {},
  tenants: ContextTenantSummary[] = [],
  vendors: ContextVendorSummary[] = [],
): PropertyContext {
  return {
    property: {
      id: PROP,
      organizationId: ORG,
      name: '412 Maple',
      addressLine: '412 Maple St',
      timezone: 'America/New_York',
      rulesText: 'No pets without deposit. Quiet hours 10pm-7am.',
      autonomyLevel: 0.5,
      privacyMode: 'hosted',
      ...overrides,
    },
    facts: [],
    recentTurns: [],
    vendors,
    tenants,
    loadedAt: '2026-05-02T12:00:00.000Z',
  };
}

/**
 * Builds an async-iterable from a static list of SDK messages so
 * `for await (const msg of query(...))` walks them in order. The
 * resolved value of each `next()` is awaited synchronously (no
 * artificial latency); the dispatcher's queue handles interleaving.
 */
function scriptedQuery(messages: unknown[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= messages.length) {
            return { value: undefined, done: true };
          }
          return { value: messages[i++], done: false };
        },
      };
    },
  };
}

// SDK assistant message factory.
function asst(blocks: unknown[]) {
  return {
    type: 'assistant',
    message: { content: blocks },
    parent_tool_use_id: null,
    uuid: 'uuid-asst',
    session_id: 'sess',
  };
}

// SDK tool-result-bearing user message factory.
function userToolResult(toolUseId: string, result: unknown) {
  return {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: result },
      ],
    },
    parent_tool_use_id: null,
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
  mockMcpCalls.ack.length = 0;
  mockMcpCalls.context.length = 0;
  mockMcpCalls.spawn.length = 0;
  mockMcpCalls.proposals.length = 0;
  mockMcpCalls.memory.length = 0;
  mockMcpCalls.scheduling.length = 0;
  mockMcpCalls.calendar.length = 0;
  mockLoadCtx.mockResolvedValue(fakeContext());
  mockLoadOrgCtx.mockResolvedValue(fakeOrgContext());
  mockLoadHistory.mockResolvedValue([]);
  mockAppendTurn.mockClear();
  mockBumpChat.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------
// Happy path
// -----------------------------------------------------------------------

describe('runOperatorDispatcher', () => {
  it('threads the authenticated database role into the spawn commit actor', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([{ type: 'result', subtype: 'success' }]) as unknown as ReturnType<
        typeof query
      >,
    );

    await collect(
      runOperatorDispatcher({
        admin: fakeAdminWithRole('va'),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'prepare a handoff',
        channel: 'web',
      }),
    );

    expect(mockMcpCalls.spawn[0]!.commitActor).toEqual({
      kind: 'user',
      role: 'va',
    });
  });

  it('should yield user persist → say.delta → done for a simple text-only turn', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([{ type: 'text', text: 'Hi! All quiet at 412 Maple.' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'whats up at maple',
        channel: 'imessage',
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['say.delta', 'done']);
    const say = events[0] as Extract<DispatcherEvent, { type: 'say.delta' }>;
    expect(say.text).toBe('Hi! All quiet at 412 Maple.');

    // Persist roles in order: user → assistant_text. ack/tool_use/tool_result
    // didn't happen this turn.
    const roles = mockAppendTurn.mock.calls.map((c) => (c[1] as { role: string }).role);
    expect(roles).toEqual(['user', 'assistant_text']);
    expect(mockBumpChat).toHaveBeenCalledOnce();
  });

  it('should interleave tool.use, tool.result, and say.delta events in arrival order', async () => {
    const toolUseId = 'tool_use_001';
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([
          { type: 'text', text: 'Looking…' },
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'mcp__odesa-operator-context__list_tenants',
            input: {},
          },
        ]),
        userToolResult(toolUseId, { content: [{ type: 'text', text: '[]' }] }),
        asst([{ type: 'text', text: 'No active tenants.' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'who lives there',
        channel: 'web',
      }),
    );

    expect(events.map((e) => e.type)).toEqual([
      'say.delta',
      'tool.use',
      'tool.result',
      'say.delta',
      'done',
    ]);
    const tu = events[1] as Extract<DispatcherEvent, { type: 'tool.use' }>;
    expect(tu.toolUseId).toBe(toolUseId);
    expect(tu.name).toBe('mcp__odesa-operator-context__list_tenants');
    const tr = events[2] as Extract<DispatcherEvent, { type: 'tool.result' }>;
    expect(tr.toolUseId).toBe(toolUseId);

    // Persist roles include tool_use + tool_result + final assistant_text.
    const roles = mockAppendTurn.mock.calls.map((c) => (c[1] as { role: string }).role);
    expect(roles).toEqual([
      'user',
      'tool_use',
      'tool_result',
      'assistant_text',
    ]);
  });

  it('should pass through ack events emitted by the spawn MCP via the shared emit callback', async () => {
    // Simulate the ack MCP firing emit() during a tool execution. We
    // do this by capturing the `emit` callback the dispatcher passes
    // into createAckMcp / createSpawnMcp, then invoking it from the
    // scripted query loop's tool_use side via a synchronous push.
    let capturedEmit: ((e: DispatcherEvent) => void) | undefined;

    // The spawn MCP is the one we'll fire through. (ack also receives
    // emit, but the dispatcher records both in mockMcpCalls — either
    // works.) We re-mock createAckMcp to capture and immediately fire
    // a synthetic ack when query() begins streaming.
    mockQuery.mockImplementation(((opts: unknown) => {
      // Pull the emit out of the spawn MCP factory call we already
      // recorded. The dispatcher constructs MCPs synchronously before
      // calling query(), so `mockMcpCalls.spawn[0]` is populated.
      capturedEmit = (
        mockMcpCalls.spawn[0] as { emit: (e: DispatcherEvent) => void }
      ).emit;
      // Fire a synthetic ack BEFORE the SDK yields anything.
      capturedEmit({ type: 'ack', text: 'On it.' });

      // Then yield a single text result + done.
      return scriptedQuery([
        asst([{ type: 'text', text: 'All set.' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>;
      void opts;
    }) as unknown as typeof query);

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'go',
        channel: 'imessage',
      }),
    );

    // Ack lands first (it was pushed before any SDK msg arrived).
    expect(events.map((e) => e.type)).toEqual(['ack', 'say.delta', 'done']);
    const ack = events[0] as Extract<DispatcherEvent, { type: 'ack' }>;
    expect(ack.text).toBe('On it.');

    // Persist roles include assistant_ack.
    const roles = mockAppendTurn.mock.calls.map((c) => (c[1] as { role: string }).role);
    expect(roles).toContain('assistant_ack');
  });

  it('should wire sendInline through to createAckMcp on imessage channel', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([{ type: 'text', text: 'ok' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    const sendInline = vi.fn(async () => undefined);
    await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'hi',
        channel: 'imessage',
        sendInline,
      }),
    );

    expect(mockMcpCalls.ack[0]!.channel).toBe('imessage');
    expect(mockMcpCalls.ack[0]!.sendInline).toBe(sendInline);
    // sendInline isn't actually invoked by the dispatcher — only by
    // the ack MCP handler (mocked here). Just confirm the wiring.
    expect(sendInline).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Producer-owned persistence (audit-first)
// -----------------------------------------------------------------------

describe('runOperatorDispatcher / producer-owned persistence', () => {
  function scriptedToolRun(toolUseId: string): unknown[] {
    return [
      asst([
        { type: 'text', text: 'Checking… ' },
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'mcp__odesa-operator-context__list_tenants',
          input: { propertyName: '412 Maple' },
        },
      ]),
      userToolResult(toolUseId, { content: [{ type: 'text', text: '[]' }] }),
      asst([{ type: 'text', text: 'No active tenants.' }]),
      { type: 'result', subtype: 'success' },
    ];
  }

  it('should persist tool audit rows and final assistant_text when the consumer breaks after the first event', async () => {
    const toolUseId = 'tool_use_disc';
    mockQuery.mockReturnValue(
      scriptedQuery(
        scriptedToolRun(toolUseId),
      ) as unknown as ReturnType<typeof query>,
    );

    const gen = runOperatorDispatcher({
      admin: fakeAdmin(),
      organizationId: ORG,
      userId: USER,
      chatId: CHAT,
      message: 'who lives there',
      channel: 'web',
    });

    // Consume exactly one event, then abandon the generator the way an
    // SSE disconnect does — breaking out of for-await calls the
    // generator's return(), which runs its finally block.
    const seen: DispatcherEvent[] = [];
    for await (const ev of gen) {
      seen.push(ev);
      break;
    }
    expect(seen.map((e) => e.type)).toEqual(['say.delta']);

    // The finally awaited the pump, so by the time return() resolved
    // every audit write already happened: tool_use + tool_result from
    // the pump, then the full final reply.
    const roles = mockAppendTurn.mock.calls.map(
      (c) => (c[1] as { role: string }).role,
    );
    expect(roles).toEqual(['user', 'tool_use', 'tool_result', 'assistant_text']);

    const finalCalls = mockAppendTurn.mock.calls.filter(
      (c) => (c[1] as { role: string }).role === 'assistant_text',
    );
    expect(finalCalls).toHaveLength(1);
    // Reply buffer accumulated in the pump — includes text produced
    // AFTER the consumer disconnected.
    expect((finalCalls[0]![1] as { body: string }).body).toBe(
      'Checking… No active tenants.',
    );
    expect(mockBumpChat).toHaveBeenCalledOnce();
  });

  it('should persist final assistant_text exactly once when the consumer drains to completion', async () => {
    const toolUseId = 'tool_use_full';
    mockQuery.mockReturnValue(
      scriptedQuery(
        scriptedToolRun(toolUseId),
      ) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'who lives there',
        channel: 'web',
      }),
    );

    // Event contract unchanged on the normal path.
    expect(events.map((e) => e.type)).toEqual([
      'say.delta',
      'tool.use',
      'tool.result',
      'say.delta',
      'done',
    ]);

    // The normal completion path and the generator finally must not
    // double-write the final reply (or double-bump the chat).
    const finalCalls = mockAppendTurn.mock.calls.filter(
      (c) => (c[1] as { role: string }).role === 'assistant_text',
    );
    expect(finalCalls).toHaveLength(1);
    expect((finalCalls[0]![1] as { body: string }).body).toBe(
      'Checking… No active tenants.',
    );
    expect(mockBumpChat).toHaveBeenCalledOnce();
  });

  it('should persist the tool_use audit row before its event is observable to the consumer', async () => {
    const toolUseId = 'tool_use_order';
    mockQuery.mockReturnValue(
      scriptedQuery(
        scriptedToolRun(toolUseId),
      ) as unknown as ReturnType<typeof query>,
    );

    const gen = runOperatorDispatcher({
      admin: fakeAdmin(),
      organizationId: ORG,
      userId: USER,
      chatId: CHAT,
      message: 'who lives there',
      channel: 'web',
    });

    for await (const ev of gen) {
      if (ev.type === 'tool.use') {
        // Producer awaited the persist before enqueueing — the audit
        // row write was already issued when the consumer sees the event.
        const roles = mockAppendTurn.mock.calls.map(
          (c) => (c[1] as { role: string }).role,
        );
        expect(roles).toContain('tool_use');
        break;
      }
    }
  });
});

// -----------------------------------------------------------------------
// Org-level routing
// -----------------------------------------------------------------------

describe('runOperatorDispatcher / org-level routing', () => {
  it('should run the dispatcher without a propertyHint (fresh org-level chat)', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([{ type: 'text', text: 'You manage 2 properties.' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'what properties do I have?',
        channel: 'imessage',
      }),
    );

    // Dispatcher proceeds — no short-circuit, no tool.error for missing hint.
    expect(events.map((e) => e.type)).toEqual(['say.delta', 'done']);
    // loadOrganizationContext was called.
    expect(mockLoadOrgCtx).toHaveBeenCalledWith(expect.anything(), ORG);
    // query() was called (no early-exit).
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('should include the hint line in the user-prompt prologue when propertyHint is provided', async () => {
    let capturedPrompt: string | undefined;
    mockQuery.mockImplementation(((opts: { prompt?: string }) => {
      capturedPrompt = opts.prompt;
      return scriptedQuery([
        asst([{ type: 'text', text: 'ok' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>;
    }) as unknown as typeof query);

    await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        propertyHint: { id: PROP, name: '412 Maple' },
        message: 'what happened recently?',
        channel: 'imessage',
      }),
    );

    expect(capturedPrompt).toBeDefined();
    expect(capturedPrompt).toContain('[The current conversation is about: 412 Maple.');
  });

  it('should not include a hint line in the prompt when propertyHint is omitted', async () => {
    let capturedPrompt: string | undefined;
    mockQuery.mockImplementation(((opts: { prompt?: string }) => {
      capturedPrompt = opts.prompt;
      return scriptedQuery([
        asst([{ type: 'text', text: 'ok' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>;
    }) as unknown as typeof query);

    await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'what properties do I have?',
        channel: 'imessage',
      }),
    );

    expect(capturedPrompt).toBeDefined();
    expect(capturedPrompt).not.toContain('[The current conversation is about:');
  });
});

// -----------------------------------------------------------------------
// Error paths
// -----------------------------------------------------------------------

describe('runOperatorDispatcher / errors', () => {
  it('fails closed when provider text ends without a terminal result', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([{ type: 'text', text: 'I changed the rent.' }]),
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'change the rent',
        channel: 'web',
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'say.delta',
      'tool.error',
      'done',
    ]);
    expect(events[1]).toMatchObject({
      type: 'tool.error',
      name: 'provider',
      message: expect.stringContaining('terminal result'),
    });
  });

  it('turns a malformed model tool request into failure evidence', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([
          { type: 'tool_use', input: { propertyName: 'Galaxy A' } },
        ]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'check Galaxy A',
        channel: 'web',
      }),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool.error',
        name: 'model-output',
      }),
    );
  });

  it('should emit tool.error + done when query() throws', async () => {
    mockQuery.mockImplementation((() => {
      throw new Error('claude api went sideways');
    }) as unknown as typeof query);

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'whats up',
        channel: 'web',
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['tool.error', 'done']);
    const err = events[0] as Extract<DispatcherEvent, { type: 'tool.error' }>;
    expect(err.name).toBe('dispatcher');
    expect(err.message).toMatch(/sideways/);
  });

  it('turns a provider error result into tool.error + done', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
        },
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'check the rent ledger',
        channel: 'web',
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'tool.error',
      'done',
    ]);
    expect(events[0]).toMatchObject({
      type: 'tool.error',
      name: 'provider',
    });
  });

  it('turns an SDK tool_result marked is_error into durable failure evidence', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool-1',
                content: 'internal provider detail',
                is_error: true,
              },
            ],
          },
        },
      ]) as unknown as ReturnType<typeof query>,
    );

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'check the rent ledger',
        channel: 'web',
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      'tool.result',
      'tool.error',
      'done',
    ]);
    expect(events[1]).toMatchObject({
      type: 'tool.error',
      name: 'tool-result',
    });
  });

  it('should emit tool.error + done when the user-message persist throws', async () => {
    // First appendTurn call (the user-row persist) throws; subsequent
    // calls (none should happen) would also be safe.
    mockAppendTurn.mockImplementationOnce(async () => {
      throw new Error('rls denied');
    });

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'hi',
        channel: 'imessage',
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['tool.error', 'done']);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should emit tool.error + done when loadOrganizationContext throws', async () => {
    mockLoadOrgCtx.mockRejectedValueOnce(new Error('org not found'));

    const events = await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'hi',
        channel: 'imessage',
      }),
    );

    expect(events.map((e) => e.type)).toEqual(['tool.error', 'done']);
    const err = events[0] as Extract<DispatcherEvent, { type: 'tool.error' }>;
    expect(err.name).toBe('context-load');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should never throw — caller can always for-await without try/catch', async () => {
    mockQuery.mockImplementation((() => {
      throw new Error('boom');
    }) as unknown as typeof query);

    let threw = false;
    try {
      await collect(
        runOperatorDispatcher({
          admin: fakeAdmin(),
          organizationId: ORG,
          userId: USER,
          chatId: CHAT,
          message: 'hi',
          channel: 'web',
        }),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// -----------------------------------------------------------------------
// MCP wiring
// -----------------------------------------------------------------------

describe('runOperatorDispatcher / MCP wiring', () => {
  it('should construct all 5 MCPs with organizationId + orgContext (+ propertyContextCache for context/spawn)', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([{ type: 'text', text: 'ok' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    const orgCtx = fakeOrgContext();
    mockLoadOrgCtx.mockResolvedValueOnce(orgCtx);

    await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'hi',
        channel: 'web',
      }),
    );

    // Each factory invoked exactly once.
    expect(mockMcpCalls.ack.length).toBe(1);
    expect(mockMcpCalls.context.length).toBe(1);
    expect(mockMcpCalls.spawn.length).toBe(1);
    expect(mockMcpCalls.proposals.length).toBe(1);
    expect(mockMcpCalls.memory.length).toBe(1);

    // organizationId threaded to all MCP factories.
    expect(mockMcpCalls.context[0]!.organizationId).toBe(ORG);
    expect(mockMcpCalls.spawn[0]!.organizationId).toBe(ORG);
    expect(mockMcpCalls.proposals[0]!.organizationId).toBe(ORG);
    expect(mockMcpCalls.memory[0]!.organizationId).toBe(ORG);

    // orgContext threaded to all MCP factories.
    expect(mockMcpCalls.context[0]!.orgContext).toBe(orgCtx);
    expect(mockMcpCalls.spawn[0]!.orgContext).toBe(orgCtx);
    expect(mockMcpCalls.proposals[0]!.orgContext).toBe(orgCtx);
    expect(mockMcpCalls.memory[0]!.orgContext).toBe(orgCtx);

    // propertyContextCache (a Map) passed to context and spawn.
    expect(mockMcpCalls.context[0]!.propertyContextCache).toBeInstanceOf(Map);
    expect(mockMcpCalls.spawn[0]!.propertyContextCache).toBeInstanceOf(Map);
    // Context and spawn share the SAME cache instance for deduplication.
    expect(mockMcpCalls.context[0]!.propertyContextCache).toBe(
      mockMcpCalls.spawn[0]!.propertyContextCache,
    );

    // userId only on proposals.
    expect(mockMcpCalls.proposals[0]!.userId).toBe(USER);
  });

  it('should create a fresh propertyContextCache on each dispatcher call (no cross-call cache)', async () => {
    mockQuery.mockReturnValue(
      scriptedQuery([
        asst([{ type: 'text', text: 'ok' }]),
        { type: 'result', subtype: 'success' },
      ]) as unknown as ReturnType<typeof query>,
    );

    await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'one',
        channel: 'web',
      }),
    );
    await collect(
      runOperatorDispatcher({
        admin: fakeAdmin(),
        organizationId: ORG,
        userId: USER,
        chatId: CHAT,
        message: 'two',
        channel: 'web',
      }),
    );

    // A new Map was created per call — not the same reference.
    expect(mockMcpCalls.context[0]!.propertyContextCache).not.toBe(
      mockMcpCalls.context[1]!.propertyContextCache,
    );
  });
});

// -----------------------------------------------------------------------
// System prompt
// -----------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('should list all org properties in the preamble when no propertyHint', () => {
    const orgCtx = fakeOrgContext(2);
    const prompt = buildSystemPrompt({ channel: 'imessage', orgContext: orgCtx });
    expect(prompt).toContain('412 Maple');
    expect(prompt).toContain('Oakwood Commons');
    expect(prompt).toContain('run 2 properties');
  });

  it('should include the [Last turn was about: ...] line when propertyHint is provided', () => {
    const orgCtx = fakeOrgContext(2);
    const prompt = buildSystemPrompt({
      channel: 'imessage',
      orgContext: orgCtx,
      propertyHint: { id: PROP, name: '412 Maple' },
    });
    expect(prompt).toContain('[Last turn was about: 412 Maple.');
  });

  it('should NOT include a hint line when propertyHint is omitted', () => {
    const orgCtx = fakeOrgContext(2);
    const prompt = buildSystemPrompt({ channel: 'web', orgContext: orgCtx });
    expect(prompt).not.toContain('[Last turn was about:');
  });

  it('should pick the structured tone block on the web channel', () => {
    const prompt = buildSystemPrompt({
      channel: 'web',
      orgContext: fakeOrgContext(),
    });
    expect(prompt).toMatch(/short paragraphs/i);
    expect(prompt).not.toMatch(/under ~400 chars/i);
  });

  it('should pick the terse tone block on imessage and mcp channels', () => {
    const im = buildSystemPrompt({
      channel: 'imessage',
      orgContext: fakeOrgContext(),
    });
    const mcp = buildSystemPrompt({
      channel: 'mcp',
      orgContext: fakeOrgContext(),
    });
    expect(im).toMatch(/under ~400 chars/i);
    expect(mcp).toMatch(/under ~400 chars/i);
  });

  it('should include the acknowledgment rule (ported from Boop)', () => {
    const prompt = buildSystemPrompt({
      channel: 'imessage',
      orgContext: fakeOrgContext(),
    });
    expect(prompt).toMatch(/acknowledgment rule/i);
    expect(prompt).toMatch(/send_ack/);
    expect(prompt).toMatch(/spawn_property_worker/);
  });

  it('should include the grounding rule (no-knowledge guard)', () => {
    const prompt = buildSystemPrompt({
      channel: 'web',
      orgContext: fakeOrgContext(),
    });
    // The grounding rule explicitly disqualifies training data and
    // commits to a "say so" disposition rather than fabrication.
    expect(prompt).toMatch(/training data does NOT count/);
    expect(prompt).toMatch(/grounding rule/i);
    expect(prompt).toMatch(/say so/i);
  });

  it('should include the source-bounded asking rule', () => {
    const prompt = buildSystemPrompt({
      channel: 'imessage',
      orgContext: fakeOrgContext(),
    });
    expect(prompt).toMatch(/source-bounded asking/i);
    expect(prompt).toMatch(/ask the operator a direct one-line question/i);
    expect(prompt).toMatch(/don't guess/i);
  });

  it('should brand the system prompt with the org assistant name', () => {
    const prompt = buildSystemPrompt({
      channel: 'imessage',
      orgContext: fakeOrgContext(2, 'Concierge'),
    });
    expect(prompt).toMatch(/^You are Concierge,/);
    expect(prompt).toContain('Galaxy Estates');
  });

  it('should default to "Odesa" when assistant name is the schema default', () => {
    const prompt = buildSystemPrompt({
      channel: 'imessage',
      orgContext: fakeOrgContext(2, 'Odesa'),
    });
    expect(prompt).toMatch(/^You are Odesa,/);
  });

  it('should instruct the assistant to ask when the query references a property not in the org', () => {
    // The org owns 412 Maple + Oakwood Commons. If the operator asks
    // about, e.g., "the Sunset house" — a name not in the list — the
    // dispatcher's source-bounded asking rule should kick in: ask
    // rather than guess. This test pins the language at the prompt
    // level (the LLM behavior is end-to-end-tested separately).
    const orgCtx = fakeOrgContext(2);
    const prompt = buildSystemPrompt({
      channel: 'imessage',
      orgContext: orgCtx,
    });
    // Property list is what's loaded; the model should treat anything
    // beyond it as un-grounded.
    expect(prompt).toContain('412 Maple');
    expect(prompt).toContain('Oakwood Commons');
    // Prompt explicitly handles the "unknown property name" case.
    expect(prompt).toMatch(
      /property name that isn't in the list above, ask which property they mean/,
    );
    expect(prompt).toMatch(/don't invent details/i);
  });
});
