/**
 * Unit tests for handleOperatorInbound. Mocks the dispatcher, persist
 * helpers, imessage helpers, and admin client so the wrapper's
 * pipeline (chat resolution → propertyHint resolution → event reduction
 * → single iMessage flush) is the only thing exercised.
 *
 * The disambiguateProperty function and markChatDisambiguated call have
 * been removed in Wave 2A. The dispatcher now handles property routing
 * entirely. These tests verify:
 *   - dispatcher is called without a disambiguation gate
 *   - when chat.property_id is null, propertyHint is omitted
 *   - when chat.property_id is stamped, propertyHint is passed
 *   - event reduction and iMessage flush still work correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  composeReply,
  handleOperatorInbound,
  OPERATOR_ERROR_SMS_LINE,
  reduceEvent,
  type OperatorIdentity,
} from '../handle-operator-inbound';
import type { DispatcherEvent } from '@/lib/agent/operator/types';
import type { ActionProposal } from '@/lib/agent/worker/types';
import type { InboundMessage } from '../types';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/agent/operator/persist', () => ({
  loadOrCreateChat: vi.fn(),
}));
vi.mock('@/lib/agent/operator/dispatcher', () => ({
  runOperatorDispatcher: vi.fn(),
}));
vi.mock('@/lib/agent/operator/imessage', () => ({
  sendImessageReply: vi.fn(),
  startTypingLoop: vi.fn(),
}));
// Durable path (flag on): the inngest client is mocked so the enqueue
// branch's `inngest.send` is observable; `createFunction` keeps the
// real run-operator-dispatcher module (imported for its event-name
// constant) loadable.
vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: vi.fn(async () => ({ ids: [] })),
    createFunction: vi.fn(() => ({})),
  },
}));
// The dev inline fallback dynamically imports the executor; mock it so
// the fallback test can assert the call without driving a real run.
vi.mock('@/lib/agent/operator/run-executor', () => ({
  executeAgentRun: vi.fn(async () => ({ kind: 'done' })),
}));
// `after()` outside a real request scope: invoke the work immediately.
vi.mock('next/server', () => ({
  after: vi.fn((fn: () => Promise<void>) => {
    void fn();
  }),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { inngest } from '@/lib/inngest/client';
import { executeAgentRun } from '@/lib/agent/operator/run-executor';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import { runOperatorDispatcher } from '@/lib/agent/operator/dispatcher';
import {
  sendImessageReply,
  startTypingLoop,
} from '@/lib/agent/operator/imessage';

const mockCreateAdmin = vi.mocked(createAdminClient);
const mockLoadOrCreateChat = vi.mocked(loadOrCreateChat);
const mockRunDispatcher = vi.mocked(runOperatorDispatcher);
const mockSendImessage = vi.mocked(sendImessageReply);
const mockStartTyping = vi.mocked(startTypingLoop);
const mockInngestSend = vi.mocked(inngest.send);
const mockExecuteAgentRun = vi.mocked(executeAgentRun);

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    fromE164: '+15555550100',
    toE164: '+15551234567',
    body: 'remind Jane she is two days late',
    provider: 'linq',
    receivedAt: '2026-05-02T00:00:00Z',
    providerMessageId: 'm1',
    ...overrides,
  };
}

const USER: OperatorIdentity = { id: 'user-1', organizationId: 'org-1' };

function chatRow(propertyId: string | null = null) {
  return {
    id: 'chat-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    property_id: propertyId,
    channel: 'imessage' as const,
    status: 'open' as const,
    last_message_at: null,
    created_at: '2026-05-02T00:00:00Z',
  };
}

/**
 * Build a stub admin client that handles the `inbound_webhook_dedup`
 * claim insert plus an optional properties lookup. The dedup claim is
 * `.from('inbound_webhook_dedup').insert({...})` (awaited directly);
 * the property lookup is
 * `.from('properties').select('name').eq('id', id).maybeSingle()`.
 *
 * `dedupInsertError` simulates the claim outcome: null = claim won,
 * `{ code: '23505', ... }` = another delivery already owns the id.
 */
function makePropertiesAdmin(
  properties: { id: string; name: string }[],
  dedupInsertError: { code: string; message: string } | null = null,
): SupabaseClient<Database> {
  const maybeSingle = vi.fn(async () => ({
    data: properties.length > 0 ? properties[0] : null,
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn(async () => ({ error: dedupInsertError }));
  const deleteFilters: Array<[string, unknown]> = [];
  const deleteChain: Record<string, unknown> = {};
  deleteChain.eq = vi.fn((column: string, value: unknown) => {
    deleteFilters.push([column, value]);
    return deleteChain;
  });
  deleteChain.then = (resolve: (value: unknown) => unknown) =>
    resolve({ error: null });
  const deleteClaim = vi.fn(() => deleteChain);
  const from = vi.fn((table: string) =>
    table === 'inbound_webhook_dedup'
      ? { insert, delete: deleteClaim }
      : { select },
  );
  return Object.assign(
    { from },
    { __deleteClaim: deleteClaim, __deleteFilters: deleteFilters },
  ) as unknown as SupabaseClient<Database>;
}

async function* genEvents(events: DispatcherEvent[]) {
  for (const e of events) yield e;
}

function proposal(actionType: ActionProposal['action_type']): ActionProposal {
  return {
    id: 'p1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    workerModel: 'haiku',
    action_type: actionType,
    payload: { body: 'hi', tone: 'firm' } as ActionProposal['payload'],
    routing: null,
    reasoning: 'r',
    confidence: 0.9,
    context_fact_ids: [],
    gate_decision: 'auto',
    status: 'committed',
    createdAt: '2026-05-02T00:00:00Z',
  };
}

beforeEach(() => {
  // Keep inline-path coverage deterministic even when the invoking shell
  // enables durable chat. Durable-path tests opt in explicitly below.
  vi.stubEnv('ODESA_DURABLE_CHAT', 'false');
  vi.stubEnv('NEXT_PUBLIC_DURABLE_CHAT', 'false');
  vi.clearAllMocks();
  mockStartTyping.mockReturnValue(() => undefined);
  mockSendImessage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// reduceEvent (pure)
// ---------------------------------------------------------------------------

describe('reduceEvent', () => {
  it('should append say.delta text to narrative', () => {
    let n = '';
    const actions: string[] = [];
    reduceEvent({ type: 'say.delta', text: 'hello ' }, (c) => {
      n += c;
    }, (l) => actions.push(l));
    reduceEvent({ type: 'say.delta', text: 'world' }, (c) => {
      n += c;
    }, (l) => actions.push(l));
    expect(n).toBe('hello world');
    expect(actions).toEqual([]);
  });

  it('should add ✓ line on proposal.committed', () => {
    const actions: string[] = [];
    reduceEvent(
      { type: 'proposal.committed', proposal: proposal('draft_sms_reply') },
      () => undefined,
      (l) => actions.push(l),
    );
    expect(actions[0]).toBe('✓ Drafted SMS reply (auto)');
  });

  it('should add a humane review line without exposing proposal ids', () => {
    const actions: string[] = [];
    reduceEvent(
      {
        type: 'proposal.review_required',
        proposal: proposal('dispatch_vendor'),
        reviewUrl: '/properties/prop-1/proposals/p1',
      },
      () => undefined,
      (l) => actions.push(l),
    );
    expect(actions[0]).toBe('⏳ Vendor dispatch — needs review: /owner-queue');
    expect(actions[0]).not.toContain('prop-1');
    expect(actions[0]).not.toContain('p1');
  });

  it('should render grounded rent review detail from the proposal payload', () => {
    const actions: string[] = [];
    reduceEvent(
      {
        type: 'proposal.review_required',
        proposal: {
          ...proposal('update_rent'),
          payload: {
            leaseRef: { tenantName: 'Dana Reed' },
            rentAmount: 1900,
          },
        },
        reviewUrl: '/owner-queue?proposal=secret-id',
      },
      () => undefined,
      (line) => actions.push(line),
    );

    expect(actions).toEqual([
      '⏳ Rent change for Dana Reed to $1,900/month — needs review: /owner-queue',
    ]);
    expect(actions[0]).not.toContain('secret-id');
  });

  it('should add a generic ⚠ line on tool.error without leaking internals', () => {
    const actions: string[] = [];
    reduceEvent(
      {
        type: 'tool.error',
        name: 'dispatcher',
        message:
          'Claude Code native binary not found at /app/node_modules/@anthropic-ai/...',
      },
      () => undefined,
      (l) => actions.push(l),
    );
    expect(actions).toEqual([OPERATOR_ERROR_SMS_LINE]);
    expect(actions[0]).not.toContain('dispatcher');
    expect(actions[0]).not.toContain('node_modules');
  });

  it('should log full tool.error detail server-side', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      reduceEvent(
        { type: 'tool.error', name: 'persist', message: 'pg deadlock detail' },
        () => undefined,
        () => undefined,
      );
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('persist: pg deadlock detail'),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('should ignore ack / tool.use / tool.result / proposal.recorded / done', () => {
    const actions: string[] = [];
    let narrative = '';
    const append = (l: string) => actions.push(l);
    const appendN = (c: string) => {
      narrative += c;
    };
    reduceEvent({ type: 'ack', text: 'on it' }, appendN, append);
    reduceEvent(
      { type: 'tool.use', name: 'recall_facts', input: {}, toolUseId: 'u1' },
      appendN,
      append,
    );
    reduceEvent(
      { type: 'tool.result', toolUseId: 'u1', result: {} },
      appendN,
      append,
    );
    reduceEvent(
      { type: 'proposal.recorded', proposal: proposal('draft_sms_reply') },
      appendN,
      append,
    );
    reduceEvent({ type: 'done', turnId: 't1' }, appendN, append);
    expect(narrative).toBe('');
    expect(actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// composeReply
// ---------------------------------------------------------------------------

describe('composeReply', () => {
  it('should combine narrative + actions with a blank line', () => {
    expect(composeReply('hello', ['✓ Sent'])).toBe('hello\n\n✓ Sent');
  });

  it('should drop empty narrative', () => {
    expect(composeReply('   ', ['✓ Sent'])).toBe('✓ Sent');
  });

  it('should drop empty actions', () => {
    expect(composeReply('hello', [])).toBe('hello');
  });

  it('should return empty when both are empty', () => {
    expect(composeReply('', [])).toBe('');
  });

  it('should collapse repeated generic error lines into one', () => {
    expect(
      composeReply('', [
        OPERATOR_ERROR_SMS_LINE,
        OPERATOR_ERROR_SMS_LINE,
        OPERATOR_ERROR_SMS_LINE,
      ]),
    ).toBe(OPERATOR_ERROR_SMS_LINE);
  });

  it('should keep non-error duplicate action lines intact', () => {
    expect(composeReply('', ['✓ Sent', '✓ Sent'])).toBe('✓ Sent\n✓ Sent');
  });
});

// ---------------------------------------------------------------------------
// handleOperatorInbound (integration of the pieces)
// ---------------------------------------------------------------------------

describe('handleOperatorInbound', () => {
  it('should call dispatcher without propertyHint when chat.property_id is null', async () => {
    mockCreateAdmin.mockReturnValue(makePropertiesAdmin([]));
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([{ type: 'done', turnId: 't1' }]) as ReturnType<
        typeof runOperatorDispatcher
      >,
    );

    await handleOperatorInbound(inbound(), USER);

    expect(mockRunDispatcher).toHaveBeenCalledOnce();
    const dispatcherArgs = mockRunDispatcher.mock.calls[0]![0];
    expect(dispatcherArgs.propertyHint).toBeUndefined();
  });

  it('should call dispatcher even when the chat is fresh (no disambiguation gate)', async () => {
    // Pre-Wave 2A: dispatcher was skipped when disambiguation was ambiguous.
    // Post-Wave 2A: dispatcher always runs.
    mockCreateAdmin.mockReturnValue(makePropertiesAdmin([]));
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([
        { type: 'say.delta', text: 'You manage 2 properties.' },
        { type: 'done', turnId: 't1' },
      ]) as ReturnType<typeof runOperatorDispatcher>,
    );

    const res = await handleOperatorInbound(
      inbound({ body: 'what properties do I have?' }),
      USER,
    );

    expect(mockRunDispatcher).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });

  it('should pass propertyHint when chat already has a stamped property_id', async () => {
    // Stub the admin to return property name for the propertyHint lookup.
    mockCreateAdmin.mockReturnValue(
      makePropertiesAdmin([{ id: 'prop-1', name: 'Oakwood Commons' }]),
    );
    mockLoadOrCreateChat.mockResolvedValue(chatRow('prop-1'));
    mockRunDispatcher.mockReturnValue(
      genEvents([{ type: 'done', turnId: 't1' }]) as ReturnType<
        typeof runOperatorDispatcher
      >,
    );

    await handleOperatorInbound(inbound(), USER);

    expect(mockRunDispatcher).toHaveBeenCalledOnce();
    const dispatcherArgs = mockRunDispatcher.mock.calls[0]![0];
    expect(dispatcherArgs.propertyHint).toEqual({
      id: 'prop-1',
      name: 'Oakwood Commons',
    });
  });

  it('should iMessage one combined body after dispatcher emits delta + committed + done', async () => {
    mockCreateAdmin.mockReturnValue(makePropertiesAdmin([]));
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([
        { type: 'say.delta', text: 'On it. ' },
        { type: 'say.delta', text: 'Reminded Jane.' },
        { type: 'proposal.committed', proposal: proposal('draft_sms_reply') },
        { type: 'done', turnId: 't1' },
      ]) as ReturnType<typeof runOperatorDispatcher>,
    );

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    expect(mockSendImessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendImessage.mock.calls[0]![0].text;
    expect(sentText).toContain('On it. Reminded Jane.');
    expect(sentText).toContain('✓ Drafted SMS reply (auto)');
  });

  it('should always stop the typing loop, even when dispatcher throws', async () => {
    mockCreateAdmin.mockReturnValue(makePropertiesAdmin([]));
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    const stopFn = vi.fn();
    mockStartTyping.mockReturnValue(stopFn);

    // Generator that throws mid-iteration.
    async function* angry(): AsyncGenerator<DispatcherEvent> {
      yield { type: 'say.delta', text: 'starting…' };
      throw new Error('dispatcher exploded');
    }
    mockRunDispatcher.mockReturnValue(
      angry() as ReturnType<typeof runOperatorDispatcher>,
    );

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    expect(stopFn).toHaveBeenCalled();
    const sentText = mockSendImessage.mock.calls[0]![0].text;
    expect(sentText).toContain('starting…');
    expect(sentText).toContain('⚠ Dispatcher crashed');
  });

  it('should return ok:false when loadOrCreateChat fails', async () => {
    const admin = makePropertiesAdmin([]);
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockRejectedValue(new Error('db down'));

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('loadOrCreateChat failed');
    const release = admin as unknown as {
      __deleteClaim: ReturnType<typeof vi.fn>;
      __deleteFilters: Array<[string, unknown]>;
    };
    expect(release.__deleteClaim).toHaveBeenCalledOnce();
    expect(release.__deleteFilters).toEqual([
      ['provider', 'linq'],
      ['provider_message_id', 'm1'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// handleOperatorInbound — webhook dedup claim (A1)
// ---------------------------------------------------------------------------

describe('handleOperatorInbound dedup claim', () => {
  it('should skip the dispatcher and return duplicate when the claim hits 23505', async () => {
    mockCreateAdmin.mockReturnValue(
      makePropertiesAdmin([], { code: '23505', message: 'duplicate key value' }),
    );

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res).toEqual({ ok: true, duplicate: true });
    expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
    expect(mockRunDispatcher).not.toHaveBeenCalled();
    expect(mockSendImessage).not.toHaveBeenCalled();
    expect(mockStartTyping).not.toHaveBeenCalled();
  });

  it('should claim the provider message id before loading the chat', async () => {
    const admin = makePropertiesAdmin([]);
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([{ type: 'done', turnId: 't1' }]) as ReturnType<
        typeof runOperatorDispatcher
      >,
    );

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    const fromMock = vi.mocked(admin.from);
    expect(fromMock).toHaveBeenCalledWith('inbound_webhook_dedup');
    const claimOrder = fromMock.mock.invocationCallOrder[0]!;
    const chatOrder = mockLoadOrCreateChat.mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(chatOrder);
    expect(mockRunDispatcher).toHaveBeenCalledOnce();
  });

  it('should skip the claim and process normally when providerMessageId is absent', async () => {
    const admin = makePropertiesAdmin([]);
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([{ type: 'done', turnId: 't1' }]) as ReturnType<
        typeof runOperatorDispatcher
      >,
    );

    const res = await handleOperatorInbound(
      inbound({ providerMessageId: undefined }),
      USER,
    );

    expect(res.ok).toBe(true);
    expect(vi.mocked(admin.from)).not.toHaveBeenCalledWith(
      'inbound_webhook_dedup',
    );
    expect(mockRunDispatcher).toHaveBeenCalledOnce();
  });

  it('should return ok:false (fail closed) when the claim errors for a non-duplicate reason', async () => {
    mockCreateAdmin.mockReturnValue(
      makePropertiesAdmin([], { code: '57014', message: 'statement timeout' }),
    );

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('dedup claim failed');
    expect(mockRunDispatcher).not.toHaveBeenCalled();
  });

  it('should release a failed claim so the same provider delivery can retry', async () => {
    let held = false;
    const filters: Array<[string, unknown]> = [];
    const deleteChain: Record<string, unknown> = {};
    deleteChain.eq = vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return deleteChain;
    });
    deleteChain.then = (resolve: (value: unknown) => unknown) => {
      held = false;
      return resolve({ error: null });
    };
    const insert = vi.fn(async () => {
      if (held) return { error: { code: '23505', message: 'duplicate' } };
      held = true;
      return { error: null };
    });
    const from = vi.fn((table: string) => {
      if (table === 'inbound_webhook_dedup') {
        return { insert, delete: vi.fn(() => deleteChain) };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    });
    mockCreateAdmin.mockReturnValue({ from } as never);
    mockLoadOrCreateChat
      .mockRejectedValueOnce(new Error('transient db failure'))
      .mockResolvedValueOnce(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([{ type: 'done', turnId: 't1' }]) as ReturnType<
        typeof runOperatorDispatcher
      >,
    );

    const first = await handleOperatorInbound(inbound(), USER);
    const retry = await handleOperatorInbound(inbound(), USER);

    expect(first.ok).toBe(false);
    expect(retry.ok).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(filters).toEqual([
      ['provider', 'linq'],
      ['provider_message_id', 'm1'],
    ]);
    expect(mockRunDispatcher).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// handleOperatorInbound — durable enqueue (Phase B, flag on)
// ---------------------------------------------------------------------------

/**
 * Admin stub for the durable path: dedup claim + properties lookup as
 * in `makePropertiesAdmin`, plus an `agent_runs` insert whose outcome
 * is configurable (null = enqueued; `{ code: '23505' }` = the
 * one-active-run-per-chat unique index fired).
 */
function makeDurableAdmin(
  properties: { id: string; name: string }[] = [],
  runInsertError: { code: string; message: string } | null = null,
) {
  const dedupInsert = vi.fn(async () => ({ error: null }));
  const runInsert = vi.fn(async () => ({ error: runInsertError }));
  const releaseFilters: Array<[string, unknown]> = [];
  const deleteChain: Record<string, unknown> = {};
  deleteChain.eq = vi.fn((column: string, value: unknown) => {
    releaseFilters.push([column, value]);
    return deleteChain;
  });
  deleteChain.then = (resolve: (value: unknown) => unknown) =>
    resolve({ error: null });
  const releaseDelete = vi.fn(() => deleteChain);
  const maybeSingle = vi.fn(async () => ({
    data: properties.length > 0 ? properties[0] : null,
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === 'inbound_webhook_dedup') {
      return { insert: dedupInsert, delete: releaseDelete };
    }
    if (table === 'agent_runs') return { insert: runInsert };
    return { select };
  });
  return {
    admin: { from } as unknown as SupabaseClient<Database>,
    runInsert,
    releaseDelete,
    releaseFilters,
  };
}

describe('handleOperatorInbound durable enqueue (flag on)', () => {
  beforeEach(() => {
    vi.stubEnv('ODESA_DURABLE_CHAT', 'true');
    mockInngestSend.mockResolvedValue({ ids: [] } as never);
  });

  it('should insert a queued agent_run + send the event WITHOUT invoking the dispatcher inline', async () => {
    const { admin, runInsert } = makeDurableAdmin();
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    if (!res.ok || res.duplicate || !('enqueued' in res)) {
      throw new Error('expected the enqueued variant');
    }
    expect(res.enqueued).toBe(true);
    expect(res.chatId).toBe('chat-1');
    expect(res.runId).toBeTruthy();
    expect(res.turnId).toBeTruthy();

    // Run row carries the durable intent snapshot.
    expect(runInsert).toHaveBeenCalledTimes(1);
    expect(runInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: res.runId,
        organization_id: 'org-1',
        user_id: 'user-1',
        chat_id: 'chat-1',
        turn_id: res.turnId,
        surface: 'imessage',
        channel: 'imessage',
        message: 'remind Jane she is two days late',
        reply_to_e164: '+15555550100',
        property_hint: null,
        status: 'queued',
      }),
    );

    // Event fired with the concurrency-key payload shape.
    expect(mockInngestSend).toHaveBeenCalledTimes(1);
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'odesa/operator-run.requested',
      data: { runId: res.runId, chatId: 'chat-1' },
    });

    // The dispatcher must NOT run inside the webhook; no reply is sent
    // here — the executor owns both. One typing burst is allowed.
    expect(mockRunDispatcher).not.toHaveBeenCalled();
    expect(mockSendImessage).not.toHaveBeenCalled();
    expect(mockExecuteAgentRun).not.toHaveBeenCalled();
    expect(mockStartTyping).toHaveBeenCalledTimes(1);
    expect(mockStartTyping).toHaveBeenCalledWith({
      organizationId: 'org-1',
      toE164: '+15555550100',
    });
  });

  it('should snapshot propertyHint into the run row when the chat has a stamped property', async () => {
    const { admin, runInsert } = makeDurableAdmin([
      { id: 'prop-1', name: 'Oakwood Commons' },
    ]);
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow('prop-1'));

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    expect(runInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        property_hint: { id: 'prop-1', name: 'Oakwood Commons' },
      }),
    );
  });

  it('should reply busy (and not enqueue an event) when a run is already active for the chat', async () => {
    const { admin } = makeDurableAdmin([], {
      code: '23505',
      message: 'duplicate key value violates "uq_agent_runs_active_chat"',
    });
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    if (!res.ok || res.duplicate) throw new Error('expected the busy reply');
    expect('enqueued' in res).toBe(false);
    expect(mockInngestSend).not.toHaveBeenCalled();
    expect(mockRunDispatcher).not.toHaveBeenCalled();
    expect(mockSendImessage).toHaveBeenCalledTimes(1);
    expect(mockSendImessage.mock.calls[0]![0].text).toContain('Still working');
  });

  it('should release the webhook claim when durable run persistence fails', async () => {
    const { admin, releaseDelete, releaseFilters } = makeDurableAdmin([], {
      code: '57014',
      message: 'statement timeout',
    });
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(false);
    expect(releaseDelete).toHaveBeenCalledOnce();
    expect(releaseFilters).toEqual([
      ['provider', 'linq'],
      ['provider_message_id', 'm1'],
    ]);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('should fall back to inline executeAgentRun when inngest.send fails outside production', async () => {
    const { admin } = makeDurableAdmin();
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockInngestSend.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:8288'));

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    if (!res.ok || res.duplicate || !('enqueued' in res)) {
      throw new Error('expected the enqueued variant');
    }
    // The fallback is fire-and-forget (the webhook must return <1s).
    await vi.waitFor(() => {
      expect(mockExecuteAgentRun).toHaveBeenCalledWith(res.runId);
    });
    expect(mockRunDispatcher).not.toHaveBeenCalled();
  });

  it('should keep the inline path byte-identical when the flag is off', async () => {
    vi.stubEnv('ODESA_DURABLE_CHAT', 'false');
    vi.stubEnv('NEXT_PUBLIC_DURABLE_CHAT', 'false');
    const admin = makePropertiesAdmin([]);
    mockCreateAdmin.mockReturnValue(admin);
    mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
    mockRunDispatcher.mockReturnValue(
      genEvents([{ type: 'done', turnId: 't1' }]) as ReturnType<
        typeof runOperatorDispatcher
      >,
    );

    const res = await handleOperatorInbound(inbound(), USER);

    expect(res.ok).toBe(true);
    expect(mockRunDispatcher).toHaveBeenCalledOnce();
    expect(mockInngestSend).not.toHaveBeenCalled();
    expect(vi.mocked(admin.from)).not.toHaveBeenCalledWith('agent_runs');
  });
});
