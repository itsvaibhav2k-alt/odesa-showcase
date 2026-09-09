/**
 * Release proof for the real durable Ask Odesa loop.
 *
 * Only the external model transport and provider-facing iMessage helpers are
 * mocked. The route, durable executor, dispatcher, context MCP, spawn MCP,
 * proposal recorder/gate, and operator-turn persistence all run unchanged
 * against one stateful in-memory Supabase boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<
    typeof import('@anthropic-ai/claude-agent-sdk')
  >('@anthropic-ai/claude-agent-sdk');
  return { ...actual, query: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({
  startSpan: vi.fn(
    async (_options: unknown, callback: () => Promise<unknown>) => callback(),
  ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(() => ({})),
  },
}));

vi.mock('@/lib/agent/operator/imessage', () => ({
  sendImessageReply: vi.fn(async () => {
    throw new Error('provider send must not run in a web release test');
  }),
  startTypingLoop: vi.fn(() => () => undefined),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { after } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

import { GET, POST } from '../route';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '44444444-4444-4444-8444-444444444444';
const LEASE_ID = '55555555-5555-4555-8555-555555555555';
const CHAT_ID = '66666666-6666-4666-8666-666666666666';
const RUN_ID = '77777777-7777-4777-8777-777777777777';
const PROPOSAL_ID = '88888888-8888-4888-8888-888888888888';
const SUBMISSION_ID = 'assistant-release-submission-1';
const NOW = '2026-08-07T12:00:00.000Z';

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type QueryResult = { data: unknown; error: null };

interface Mutation {
  table: string;
  kind: 'insert' | 'update';
  values: Row;
}

class MemorySupabase {
  readonly tables: Record<string, Row[]>;
  readonly mutations: Mutation[] = [];

  constructor(seed: Record<string, Row[]>) {
    this.tables = Object.fromEntries(
      Object.entries(seed).map(([table, rows]) => [
        table,
        rows.map((row) => ({ ...row })),
      ]),
    );
  }

  from(table: string): MemoryQuery {
    this.tables[table] ??= [];
    return new MemoryQuery(this, table);
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  materialize(table: string, input: Row): Row {
    const count = this.rows(table).length + 1;
    const defaults: Row = { created_at: NOW };

    if (table === 'operator_chats') {
      Object.assign(defaults, {
        id: CHAT_ID,
        property_id: null,
        status: 'open',
        last_message_at: null,
        updated_at: NOW,
      });
    } else if (table === 'agent_runs') {
      Object.assign(defaults, {
        id: RUN_ID,
        error: null,
        error_notified_at: null,
        finished_at: null,
        heartbeat_at: null,
        reply_text: null,
        reply_to_e164: null,
        started_at: null,
      });
    } else if (table === 'operator_chat_turns') {
      Object.assign(defaults, {
        id: `turn-row-${count}`,
        body: null,
        proposal_id: null,
        tool_input: null,
        tool_name: null,
        tool_result: null,
        tool_use_id: null,
      });
    } else if (table === 'action_proposals') {
      Object.assign(defaults, {
        id: PROPOSAL_ID,
        committed_at: null,
        context_fact_ids: null,
        edit_diff: null,
        execution_evidence: null,
        last_attempted_at: null,
        outcome: null,
        rejected_at: null,
        retryable: null,
        routing: null,
      });
    }

    return { ...defaults, ...input };
  }
}

class MemoryQuery {
  private readonly filters: Filter[] = [];
  private readonly orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private operation: 'select' | 'insert' | 'update' = 'select';
  private values: Row | Row[] | null = null;
  private selected = false;
  private result: Row[] | null = null;

  constructor(
    private readonly db: MemorySupabase,
    private readonly table: string,
  ) {}

  select(_columns = '*'): this {
    this.selected = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.operation = 'insert';
    this.values = values;
    return this;
  }

  update(values: Row): this {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => readPath(row, column) === value);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push((row) => readPath(row, column) === value);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.filters.push((row) => values.includes(readPath(row, column)));
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push(
      (row) => String(readPath(row, column) ?? '') >= String(value ?? ''),
    );
    return this;
  }

  order(
    column: string,
    options: { ascending?: boolean } = {},
  ): this {
    this.orders.push({
      column,
      ascending: options.ascending !== false,
    });
    return this;
  }

  limit(value: number): this {
    this.limitCount = value;
    return this;
  }

  async single(): Promise<QueryResult> {
    const rows = this.execute();
    return { data: rows[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<QueryResult> {
    const rows = this.execute();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.execute();
    const data = this.selected ? rows : null;
    return Promise.resolve({ data, error: null } as QueryResult).then(
      onfulfilled,
      onrejected,
    );
  }

  private execute(): Row[] {
    if (this.result !== null) return this.result;

    if (this.operation === 'insert') {
      const inputs = Array.isArray(this.values) ? this.values : [this.values];
      const inserted = inputs
        .filter((value): value is Row => value !== null)
        .map((value) => this.db.materialize(this.table, value));
      this.db.rows(this.table).push(...inserted);
      for (const value of inserted) {
        this.db.mutations.push({
          table: this.table,
          kind: 'insert',
          values: { ...value },
        });
      }
      this.result = inserted;
      return inserted;
    }

    const matched = this.db
      .rows(this.table)
      .filter((row) => this.filters.every((filter) => filter(row)));

    if (this.operation === 'update') {
      const patch = (this.values ?? {}) as Row;
      for (const row of matched) Object.assign(row, patch);
      if (matched.length > 0) {
        this.db.mutations.push({
          table: this.table,
          kind: 'update',
          values: { ...patch },
        });
      }
      this.result = matched.map((row) => ({ ...row }));
      return this.result;
    }

    const rows = matched.map((row) => ({ ...row }));
    rows.sort((left, right) => {
      for (const order of this.orders) {
        const a = readPath(left, order.column);
        const b = readPath(right, order.column);
        const comparison = String(a ?? '').localeCompare(String(b ?? ''));
        if (comparison !== 0) return order.ascending ? comparison : -comparison;
      }
      return 0;
    });
    this.result =
      this.limitCount === null ? rows : rows.slice(0, this.limitCount);
    return this.result;
  }
}

function readPath(row: Row, path: string): unknown {
  let value: unknown = row;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Row)[segment];
  }
  return value;
}

interface ToolDefinition {
  handler: (input: Row, extra?: unknown) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
  }>;
}

interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefinition> };
}

function toolHandler(
  mcpServers: Record<string, unknown>,
  serverName: string,
  toolName: string,
): ToolDefinition['handler'] {
  const server = mcpServers[serverName] as McpServerShape | undefined;
  const handler = server?.instance?._registeredTools?.[toolName]?.handler;
  if (!handler) throw new Error(`${serverName}.${toolName} is not registered`);
  return handler;
}

function scriptedProvider() {
  return (queryArgs: { options?: { mcpServers?: unknown } }) => {
    const servers = queryArgs.options?.mcpServers as
      | Record<string, unknown>
      | undefined;
    if (!servers) throw new Error('dispatcher did not configure MCP servers');

    const listTenants = toolHandler(
      servers,
      'odesa-operator-context',
      'list_tenants',
    );
    const spawn = toolHandler(
      servers,
      'odesa-operator-spawn',
      'spawn_property_worker',
    );

    let step = 0;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<{ value: unknown; done: boolean }> {
            step += 1;
            if (step === 1) {
              return sdkMessage(
                assistantToolUse(
                  'context-tool-1',
                  'mcp__odesa-operator-context__list_tenants',
                  { propertyName: 'Galaxy A' },
                ),
              );
            }
            if (step === 2) {
              const result = await listTenants({ propertyName: 'Galaxy A' });
              expect(JSON.stringify(result.content)).toContain('Dana Reed');
              return sdkMessage(userToolResult('context-tool-1', result.content));
            }
            if (step === 3) {
              return sdkMessage(
                assistantToolUse(
                  'spawn-tool-1',
                  'mcp__odesa-operator-spawn__spawn_property_worker',
                  {
                    propertyName: 'Galaxy A',
                    action_type: 'update_rent',
                    prompt: 'Prepare Dana Reed rent at $1,900.',
                    payload: {
                      leaseRef: { tenantName: 'Dana Reed' },
                      rentAmount: 1900,
                    },
                  },
                ),
              );
            }
            if (step === 4) {
              const result = await spawn({
                propertyName: 'Galaxy A',
                action_type: 'update_rent',
                prompt: 'Prepare Dana Reed rent at $1,900.',
                payload: {
                  leaseRef: { tenantName: 'Dana Reed' },
                  rentAmount: 1900,
                },
              });
              expect(JSON.stringify(result.content)).toContain('Owner Queue');
              return sdkMessage(userToolResult('spawn-tool-1', result.content));
            }
            if (step === 5) {
              return sdkMessage({
                type: 'assistant',
                message: {
                  content: [
                    {
                      type: 'text',
                      text: 'Dana Reed is active at Galaxy A. I prepared the $1,900 rent change for Owner Queue review.',
                    },
                  ],
                },
                parent_tool_use_id: null,
                uuid: 'assistant-final',
                session_id: 'release-test',
              });
            }
            if (step === 6) {
              return sdkMessage({ type: 'result', subtype: 'success' });
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  };
}

function assistantToolUse(
  id: string,
  name: string,
  input: Row,
): Row {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
    parent_tool_use_id: null,
    uuid: `assistant-${id}`,
    session_id: 'release-test',
  };
}

function userToolResult(toolUseId: string, content: unknown): Row {
  return {
    type: 'user',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content }],
    },
    parent_tool_use_id: null,
  };
}

function sdkMessage(value: unknown): { value: unknown; done: false } {
  return { value, done: false };
}

function buildPost(body: unknown): Request {
  return new Request('http://localhost/api/chat/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function asNextRequest(request: Request): never {
  const wrapped = request as Request & { nextUrl: URL };
  wrapped.nextUrl = new URL(request.url);
  return wrapped as never;
}

function seedDatabase(): MemorySupabase {
  return new MemorySupabase({
    organizations: [
      {
        id: ORG_ID,
        name: 'Galaxy Estates',
        assistant_name: 'Odesa',
        created_at: NOW,
      },
    ],
    users: [
      {
        id: USER_ID,
        organization_id: ORG_ID,
        role: 'owner',
        created_at: NOW,
      },
    ],
    properties: [
      {
        id: PROPERTY_ID,
        organization_id: ORG_ID,
        name: 'Galaxy A',
        address_street: '1 Main St',
        address_city: 'Aldie',
        address_state: 'VA',
        address_zip: '20105',
        timezone: 'America/New_York',
        rules_text: 'Rent changes require owner review.',
        autonomy_level: 0,
        privacy_mode: 'hosted',
        created_at: NOW,
      },
    ],
    leases: [
      {
        id: LEASE_ID,
        status: 'active',
        tenant_id: TENANT_ID,
        rent_amount: 1750,
        units: { property_id: PROPERTY_ID, label: '2A' },
        tenants: { id: TENANT_ID, full_name: 'Dana Reed' },
        created_at: NOW,
      },
    ],
    rent_events: [
      {
        lease_id: LEASE_ID,
        status: 'current',
        cycle_month: '2026-08-01',
      },
    ],
    memory_facts: [],
    messages: [],
    vendors: [],
    operator_chats: [],
    operator_chat_turns: [],
    agent_runs: [],
    action_proposals: [],
  });
}

describe('Ask Odesa durable release loop', () => {
  let db: MemorySupabase;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('INNGEST_EVENT_KEY', '');
    vi.stubEnv('DURABLE_CHAT_REQUIRE_INNGEST', '');
    db = seedDatabase();

    const admin = {
      from: (table: string) => db.from(table),
    } as unknown as SupabaseClient<Database>;
    const server = {
      ...admin,
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: USER_ID, email: 'owner@example.test' } },
          error: null,
        })),
      },
      from: (table: string) => db.from(table),
    };

    vi.mocked(createAdminClient).mockReturnValue(admin);
    vi.mocked(createServerClient).mockResolvedValue(
      server as unknown as Awaited<ReturnType<typeof createServerClient>>,
    );
    vi.mocked(query).mockImplementation(
      scriptedProvider() as unknown as typeof query,
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('grounds a consequential request, records review evidence, and renders the durable completion', async () => {
    const response = await POST(
      buildPost({
        message: 'Change Dana Reed rent at Galaxy A to $1,900.',
        submissionId: SUBMISSION_ID,
      }) as never,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      data: { runId: RUN_ID, chatId: CHAT_ID, turnId: SUBMISSION_ID },
    });
    expect(inngest.send).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);

    const deferred = vi.mocked(after).mock.calls[0]![0] as () => Promise<void>;
    await deferred();

    const lifecycle = db.mutations
      .filter((mutation) => mutation.table === 'agent_runs')
      .map((mutation) => mutation.values['status'])
      .filter((status) => typeof status === 'string');
    expect(lifecycle).toEqual(['queued', 'running', 'done']);

    const proposals = db.rows('action_proposals');
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      organization_id: ORG_ID,
      property_id: PROPERTY_ID,
      action_type: 'update_rent',
      gate_decision: 'review',
      status: 'proposed',
      payload: {
        leaseRef: { tenantName: 'Dana Reed' },
        rentAmount: 1900,
      },
    });

    const leaseWrites = db.mutations.filter(
      (mutation) => mutation.table === 'leases',
    );
    expect(leaseWrites).toEqual([]);

    const turns = db.rows('operator_chat_turns');
    expect(turns.map((turn) => turn['role'])).toEqual([
      'user',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'assistant_text',
    ]);
    expect(
      turns
        .filter((turn) => turn['role'] === 'tool_result')
        .map((turn) => JSON.stringify(turn['tool_result']))
        .join('\n'),
    ).toContain('Dana Reed');

    const finalRun = db.rows('agent_runs')[0]!;
    const assistantTurn = turns.find(
      (turn) => turn['role'] === 'assistant_text',
    );
    expect(finalRun['status']).toBe('done');
    expect(finalRun['error']).toBeNull();
    expect(assistantTurn?.['body']).toBe(finalRun['reply_text']);
    expect(finalRun['reply_text']).toContain(
      'No consequential action was completed.',
    );
    expect(finalRun['reply_text']).toContain(
      '⏳ Rent change for Dana Reed to $1,900/month — needs review: /owner-queue',
    );
    expect(finalRun['reply_text']).not.toMatch(
      /update_rent|spawn_property_worker|mcp__|88888888-/,
    );

    const getResponse = await GET(
      asNextRequest(
        new Request(`http://localhost/api/chat/runs?runId=${RUN_ID}`),
      ),
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      success: true,
      data: {
        runId: RUN_ID,
        status: 'done',
        replyText: finalRun['reply_text'],
        error: null,
      },
    });
  });
});
