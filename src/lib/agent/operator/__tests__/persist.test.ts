/**
 * Unit tests for src/lib/agent/operator/persist.ts.
 *
 * The Supabase admin client is mocked via a hand-rolled chainable
 * builder. Each `from(table)` returns a recorder that captures the
 * filter/order/limit/terminal calls and resolves with a preset row
 * set. Tests assert both that the right query shape was emitted
 * (e.g. `is('property_id', null)` not `eq('property_id', null)` for
 * pre-disambiguation lookups) AND that the right row(s) were returned
 * to the caller.
 *
 * Naming follows the project's convention from
 * src/lib/agent/proposals/__tests__/record.test.ts and
 * src/lib/agent/worker/__tests__/context-loader.test.ts.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  appendTurn,
  bumpChatLastMessageAt,
  loadHistory,
  loadOrCreateChat,
  OperatorPersistError,
} from '../persist';
import type {
  OperatorChatRow,
  OperatorChatTurnRow,
} from '../types';

// ---------------------------------------------------------------------------
// Constants — readable test fixtures
// ---------------------------------------------------------------------------

const ORG = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000002';
const PROP = '00000000-0000-0000-0000-000000000003';
const CHAT = '00000000-0000-0000-0000-000000000004';
const TURN = '00000000-0000-0000-0000-000000000005';
const PROPOSAL = '00000000-0000-0000-0000-000000000006';

const NOW = '2026-05-02T12:00:00.000Z';

function baseChat(overrides: Partial<OperatorChatRow> = {}): OperatorChatRow {
  return {
    id: CHAT,
    organization_id: ORG,
    user_id: USER,
    property_id: null,
    channel: 'imessage',
    status: 'open',
    last_message_at: null,
    created_at: NOW,
    ...overrides,
  };
}

function baseTurn(
  overrides: Partial<OperatorChatTurnRow> = {},
): OperatorChatTurnRow {
  return {
    id: TURN,
    chat_id: CHAT,
    organization_id: ORG,
    turn_id: 't-1',
    role: 'user',
    body: 'hi',
    tool_name: null,
    tool_input: null,
    tool_use_id: null,
    tool_result: null,
    proposal_id: null,
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------
//
// Records every chainable call so assertions can verify the exact
// query shape (eq vs is, order direction, limit, terminal). Each
// terminal (`single`, `limit`) resolves with a `result` you supply.

interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  selects: string[];
  inserts: unknown[];
  updates: unknown[];
  eqs: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean; nullsFirst?: boolean }]>;
  limits: number[];
  terminal: 'single' | 'limit' | 'await';
}

type Result<T> = { data: T | null; error: null | { message: string } };

interface MockBuilderOptions {
  /**
   * Per-table handler. Receives the recorded call and returns the
   * Supabase-shaped `{data, error}` response. If the test only needs
   * one table, this is the simplest path; for multi-table tests
   * (loadOrCreateChat: select THEN insert) provide a function that
   * branches on `call.op`.
   */
  handler: (call: RecordedCall) => Result<unknown>;
}

function makeMock(opts: MockBuilderOptions): {
  db: SupabaseClient<Database>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];

  function newCall(table: string): RecordedCall {
    return {
      table,
      op: 'select',
      selects: [],
      inserts: [],
      updates: [],
      eqs: [],
      iss: [],
      orders: [],
      limits: [],
      terminal: 'await',
    };
  }

  function makeBuilder(call: RecordedCall): Record<string, unknown> {
    const builder: Record<string, unknown> = {
      select(cols?: string) {
        call.selects.push(cols ?? '*');
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqs.push([col, val]);
        return builder;
      },
      is(col: string, val: unknown) {
        call.iss.push([col, val]);
        return builder;
      },
      order(
        col: string,
        o?: { ascending?: boolean; nullsFirst?: boolean },
      ) {
        call.orders.push([
          col,
          {
            ascending: o?.ascending !== false,
            nullsFirst: o?.nullsFirst,
          },
        ]);
        return builder;
      },
      // .limit(n) is a terminal in Supabase's "list result" shape (it
      // returns a thenable resolving to {data: T[], error}). Hand-mock
      // by giving it a `then` so `await query.limit(1)` resolves.
      limit(n: number) {
        call.limits.push(n);
        call.terminal = 'limit';
        const result = opts.handler(call);
        const thenable: PromiseLike<Result<unknown>> = {
          then: (onfulfilled, onrejected) => {
            try {
              return Promise.resolve(
                onfulfilled ? onfulfilled(result) : (result as never),
              );
            } catch (err) {
              return onrejected
                ? Promise.resolve(onrejected(err))
                : Promise.reject(err);
            }
          },
        };
        return thenable;
      },
      single: async () => {
        call.terminal = 'single';
        return opts.handler(call);
      },
      // For .update().eq().is() and .update().eq() chains, the chain is
      // itself awaitable. The terminal is the last filter call returning
      // a thenable. To keep the mock simple, treat the builder itself
      // as a thenable that resolves on await.
      then: <T1, T2 = never>(
        onfulfilled?:
          | ((v: Result<unknown>) => T1 | PromiseLike<T1>)
          | null,
        onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
      ): PromiseLike<T1 | T2> => {
        call.terminal = 'await';
        try {
          const r = opts.handler(call);
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

  const from = vi.fn((table: string) => {
    return {
      select(cols?: string) {
        const call = newCall(table);
        call.op = 'select';
        calls.push(call);
        const b = makeBuilder(call);
        (b.select as (c?: string) => unknown)(cols);
        return b;
      },
      insert(row: unknown) {
        const call = newCall(table);
        call.op = 'insert';
        call.inserts.push(row);
        calls.push(call);
        return makeBuilder(call);
      },
      update(row: unknown) {
        const call = newCall(table);
        call.op = 'update';
        call.updates.push(row);
        calls.push(call);
        return makeBuilder(call);
      },
    };
  });

  const db = { from } as unknown as SupabaseClient<Database>;
  return { db, calls };
}

// ===========================================================================
// loadOrCreateChat
// ===========================================================================

describe('loadOrCreateChat', () => {
  it('should return existing open chat when one matches the (org, user, channel, propertyId) tuple', async () => {
    const { db, calls } = makeMock({
      handler: (call) => {
        if (call.op === 'select') {
          return { data: [baseChat({ property_id: PROP })], error: null };
        }
        throw new Error(`unexpected op: ${call.op}`);
      },
    });

    const out = await loadOrCreateChat(db, {
      organizationId: ORG,
      userId: USER,
      propertyId: PROP,
      channel: 'web',
    });

    expect(out.id).toBe(CHAT);
    expect(out.property_id).toBe(PROP);
    // Only the SELECT happened — no insert.
    expect(calls.length).toBe(1);
    expect(calls[0]!.op).toBe('select');
    expect(calls[0]!.eqs).toEqual(
      expect.arrayContaining([
        ['organization_id', ORG],
        ['user_id', USER],
        ['channel', 'web'],
        ['status', 'open'],
        ['property_id', PROP],
      ]),
    );
    // Ordered by last_message_at desc with nulls last.
    expect(calls[0]!.orders).toEqual([
      ['last_message_at', { ascending: false, nullsFirst: false }],
    ]);
    expect(calls[0]!.limits).toEqual([1]);
  });

  it('should use is() not eq() when matching null property_id on web/mcp (pre-disambiguation)', async () => {
    // Returning a non-null property row would be a bug — the dispatcher
    // would attach turns to the wrong chat. The mock returns empty so
    // we trigger the insert path; the assertion is on the SELECT query
    // shape itself. iMessage is exempt (see next test) — this scenario
    // applies to web/mcp where a null propertyId can briefly occur.
    const { db, calls } = makeMock({
      handler: (call) => {
        if (call.op === 'select') return { data: [], error: null };
        if (call.op === 'insert') return { data: baseChat(), error: null };
        throw new Error(`unexpected op: ${call.op}`);
      },
    });

    await loadOrCreateChat(db, {
      organizationId: ORG,
      userId: USER,
      propertyId: null,
      channel: 'web',
    });

    // .is('property_id', null) — NOT .eq('property_id', null).
    expect(calls[0]!.iss).toEqual([['property_id', null]]);
    // property_id must NOT appear in the eq list (else PostgREST emits
    // `eq.null` which never matches).
    expect(calls[0]!.eqs.find(([col]) => col === 'property_id')).toBeUndefined();
  });

  it('org-level web chat: propertyId null returns single rolling thread', async () => {
    // The `/inbox` surface lives on (org, user, channel='web', property_id IS NULL).
    // Subsequent inbound turns arriving with propertyId=null must resolve to the
    // SAME existing row even after the dispatcher stamps `chat.property_id` for
    // a propertyHint mid-conversation — the chat row is matched via `.is(...)`,
    // not by the URL-bound propertyId. We assert two things:
    //   1. The select shape is `.is('property_id', null)` (not `.eq`), so a
    //      pre-existing org-level chat is reachable.
    //   2. When the select returns a hit, that row is returned and no insert
    //      fires (single rolling thread is preserved across calls).
    const orgLevelChat = baseChat({
      id: 'org-level-chat-id',
      property_id: null,
      channel: 'web',
      last_message_at: '2026-05-06T09:00:00.000Z',
    });
    const { db, calls } = makeMock({
      handler: (call) => {
        if (call.op === 'select')
          return { data: [orgLevelChat], error: null };
        throw new Error(`unexpected op: ${call.op} — null propertyId on web should reuse row`);
      },
    });

    const out = await loadOrCreateChat(db, {
      organizationId: ORG,
      userId: USER,
      propertyId: null,
      channel: 'web',
    });

    expect(out.id).toBe('org-level-chat-id');
    expect(out.property_id).toBeNull();
    expect(out.channel).toBe('web');
    // Exactly one op — the SELECT — and it filtered with .is(), not .eq().
    expect(calls.length).toBe(1);
    expect(calls[0]!.op).toBe('select');
    expect(calls[0]!.iss).toEqual([['property_id', null]]);
    expect(calls[0]!.eqs.find(([col]) => col === 'property_id')).toBeUndefined();
  });

  it('should ignore property_id entirely for imessage so the rolling thread persists across property switches', async () => {
    // Direct iMessage is one rolling thread per (org, user). After a
    // property_id hint is stamped on the chat, the next inbound still
    // arrives with propertyId=null — without this exemption every turn
    // would spawn a fresh chat and the dispatcher would lose history.
    const { db, calls } = makeMock({
      handler: (call) => {
        if (call.op === 'select') return { data: [], error: null };
        if (call.op === 'insert') return { data: baseChat(), error: null };
        throw new Error(`unexpected op: ${call.op}`);
      },
    });

    await loadOrCreateChat(db, {
      organizationId: ORG,
      userId: USER,
      propertyId: null,
      channel: 'imessage',
    });

    // No property_id filtering of any kind — neither `.eq` nor `.is`.
    expect(calls[0]!.eqs.find(([col]) => col === 'property_id')).toBeUndefined();
    expect(calls[0]!.iss.find(([col]) => col === 'property_id')).toBeUndefined();
  });

  it('should insert a fresh open chat when no existing chat is found', async () => {
    const insertedRow = baseChat({ id: 'new-chat-id', channel: 'mcp' });
    const { db, calls } = makeMock({
      handler: (call) => {
        if (call.op === 'select') return { data: [], error: null };
        if (call.op === 'insert')
          return { data: insertedRow, error: null };
        throw new Error(`unexpected op: ${call.op}`);
      },
    });

    const out = await loadOrCreateChat(db, {
      organizationId: ORG,
      userId: USER,
      propertyId: PROP,
      channel: 'mcp',
    });

    expect(out.id).toBe('new-chat-id');
    expect(out.channel).toBe('mcp');
    // Two ops: select (miss) then insert.
    expect(calls.length).toBe(2);
    expect(calls[1]!.op).toBe('insert');
    expect(calls[1]!.inserts[0]).toMatchObject({
      organization_id: ORG,
      user_id: USER,
      property_id: PROP,
      channel: 'mcp',
      status: 'open',
    });
  });

  it('should throw OperatorPersistError when the lookup fails', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: { message: 'db down' } }),
    });

    await expect(
      loadOrCreateChat(db, {
        organizationId: ORG,
        userId: USER,
        propertyId: null,
        channel: 'imessage',
      }),
    ).rejects.toBeInstanceOf(OperatorPersistError);
  });

  it('should throw OperatorPersistError when the insert returns no row', async () => {
    const { db } = makeMock({
      handler: (call) => {
        if (call.op === 'select') return { data: [], error: null };
        // Insert succeeds (no error) but returns no row — guard rail
        // for a misconfigured RLS policy / schema mismatch.
        return { data: null, error: null };
      },
    });

    await expect(
      loadOrCreateChat(db, {
        organizationId: ORG,
        userId: USER,
        propertyId: PROP,
        channel: 'web',
      }),
    ).rejects.toBeInstanceOf(OperatorPersistError);
  });
});

// ===========================================================================
// loadHistory
// ===========================================================================

describe('loadHistory', () => {
  it('should return turns in chronological order (oldest first)', async () => {
    // DB returns DESC; loadHistory must reverse to ASC.
    const turnNew = baseTurn({ id: 'new', body: 'newer', created_at: '2026-05-02T13:00:00Z' });
    const turnOld = baseTurn({ id: 'old', body: 'older', created_at: '2026-05-02T11:00:00Z' });
    const { db, calls } = makeMock({
      handler: () => ({ data: [turnNew, turnOld], error: null }),
    });

    const result = await loadHistory(db, CHAT);

    expect(result.map((r) => r.id)).toEqual(['old', 'new']);
    expect(calls[0]!.eqs).toEqual([['chat_id', CHAT]]);
    // DESC scan + limit on the way in.
    expect(calls[0]!.orders).toEqual([
      ['created_at', { ascending: false, nullsFirst: undefined }],
    ]);
    expect(calls[0]!.limits).toEqual([20]); // default
  });

  it('should respect a custom limit', async () => {
    const { db, calls } = makeMock({
      handler: () => ({ data: [], error: null }),
    });

    await loadHistory(db, CHAT, 5);

    expect(calls[0]!.limits).toEqual([5]);
  });

  it('should return an empty array when no turns exist', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: null }),
    });

    const result = await loadHistory(db, CHAT);
    expect(result).toEqual([]);
  });

  it('should throw OperatorPersistError on query error', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: { message: 'rls denied' } }),
    });

    await expect(loadHistory(db, CHAT)).rejects.toBeInstanceOf(
      OperatorPersistError,
    );
  });
});

// ===========================================================================
// appendTurn
// ===========================================================================

describe('appendTurn', () => {
  it('should insert a user turn with body and null tool fields', async () => {
    const { db, calls } = makeMock({
      handler: () => ({
        data: baseTurn({ role: 'user', body: 'hello' }),
        error: null,
      }),
    });

    const out = await appendTurn(db, {
      chatId: CHAT,
      organizationId: ORG,
      turnId: 't-1',
      role: 'user',
      body: 'hello',
    });

    expect(out.role).toBe('user');
    const row = calls[0]!.inserts[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      chat_id: CHAT,
      organization_id: ORG,
      turn_id: 't-1',
      role: 'user',
      body: 'hello',
      tool_name: null,
      tool_input: null,
      tool_use_id: null,
      tool_result: null,
      proposal_id: null,
    });
  });

  it('should insert a tool_use turn with toolName + toolInput + toolUseId', async () => {
    const toolInput = { propertyId: PROP, action_type: 'draft_sms_reply' };
    const { db, calls } = makeMock({
      handler: () => ({
        data: baseTurn({ role: 'tool_use' }),
        error: null,
      }),
    });

    await appendTurn(db, {
      chatId: CHAT,
      organizationId: ORG,
      turnId: 't-2',
      role: 'tool_use',
      toolName: 'spawn_property_worker',
      toolInput,
      toolUseId: 'use_abc',
    });

    const row = calls[0]!.inserts[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      role: 'tool_use',
      tool_name: 'spawn_property_worker',
      tool_input: toolInput,
      tool_use_id: 'use_abc',
      body: null,
    });
  });

  it('should insert a tool_result turn carrying proposalId when set', async () => {
    const toolResult = { ok: true, proposalId: PROPOSAL };
    const { db, calls } = makeMock({
      handler: () => ({
        data: baseTurn({ role: 'tool_result', proposal_id: PROPOSAL }),
        error: null,
      }),
    });

    await appendTurn(db, {
      chatId: CHAT,
      organizationId: ORG,
      turnId: 't-3',
      role: 'tool_result',
      toolUseId: 'use_abc',
      toolResult,
      proposalId: PROPOSAL,
    });

    const row = calls[0]!.inserts[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      role: 'tool_result',
      tool_result: toolResult,
      tool_use_id: 'use_abc',
      proposal_id: PROPOSAL,
    });
  });

  it('should distinguish undefined from explicit null on optional fields', async () => {
    // Both should serialize as null on the row — undefined is forbidden
    // by Supabase Insert types.
    const { db, calls } = makeMock({
      handler: () => ({ data: baseTurn(), error: null }),
    });

    await appendTurn(db, {
      chatId: CHAT,
      organizationId: ORG,
      turnId: 't-4',
      role: 'assistant_ack',
      body: 'looking',
    });

    const row = calls[0]!.inserts[0] as Record<string, unknown>;
    expect(row.tool_input).toBeNull();
    expect(row.tool_result).toBeNull();
    expect(row.proposal_id).toBeNull();
  });

  it('should throw OperatorPersistError on insert failure', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: { message: 'check failed' } }),
    });

    await expect(
      appendTurn(db, {
        chatId: CHAT,
        organizationId: ORG,
        turnId: 't-5',
        role: 'user',
        body: 'x',
      }),
    ).rejects.toBeInstanceOf(OperatorPersistError);
  });
});

// ===========================================================================
// bumpChatLastMessageAt
// ===========================================================================

describe('bumpChatLastMessageAt', () => {
  it('should update last_message_at to the supplied timestamp', async () => {
    const { db, calls } = makeMock({
      handler: () => ({ data: null, error: null }),
    });

    await bumpChatLastMessageAt(db, CHAT, NOW);

    expect(calls[0]!.op).toBe('update');
    expect(calls[0]!.updates[0]).toEqual({ last_message_at: NOW });
    expect(calls[0]!.eqs).toEqual([['id', CHAT]]);
  });

  it('should throw OperatorPersistError on update failure', async () => {
    const { db } = makeMock({
      handler: () => ({ data: null, error: { message: 'no row' } }),
    });

    await expect(
      bumpChatLastMessageAt(db, CHAT, NOW),
    ).rejects.toBeInstanceOf(OperatorPersistError);
  });
});
