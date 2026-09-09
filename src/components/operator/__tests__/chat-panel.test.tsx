/**
 * Unit tests for src/components/operator/chat-panel.tsx.
 *
 * Two surfaces under test:
 *
 *   1. SSE event reducer — verify a DispatcherEvent stream coming back
 *      from `apiEndpoint` mutates the message list correctly. The
 *      `proposed-action-card` server-action import is mocked away so
 *      the component renders cleanly in jsdom.
 *   2. Realtime ↔ SSE dedupe — when the dispatcher persists a
 *      `assistant_text` row server-side and the realtime publication
 *      broadcasts it back via Supabase, the panel must not render the
 *      same text twice. We exercise the full path: SSE streams the text
 *      → done event seeds the turn-id dedupe set → realtime broadcast
 *      arrives → `applyRealtimeTurn` skips it.
 *
 * Mocks:
 *   - `@/lib/supabase/client.createBrowserClient` returns a hand-rolled
 *     channel object that captures the registered `postgres_changes`
 *     callback so the test can fire it directly.
 *   - `global.fetch` is replaced per-test with a small SSE-stream
 *     factory.
 *   - The `proposed-action-card` module is mocked because its
 *     `revalidatePath` import path triggers `next/cache` resolution
 *     which jsdom can't satisfy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type {
  DispatcherEvent,
  OperatorChatTurnRow,
} from '@/lib/agent/operator/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Captured realtime callback. The test fires this with a
 * `{ new: OperatorChatTurnRow }` payload to simulate a Supabase
 * postgres_changes broadcast.
 */
type PostgresChangesCallback = (payload: {
  new: OperatorChatTurnRow;
  eventType: 'INSERT';
}) => void;

let realtimeCallback: PostgresChangesCallback | null = null;
/**
 * Callbacks keyed by the subscribed table. The durable-run path adds a
 * second subscription (`agent_runs` UPDATE) next to the historical
 * `operator_chat_turns` INSERT one; tests fire each independently.
 */
let realtimeCallbacksByTable: Record<
  string,
  (payload: { new: unknown; eventType: string }) => void
> = {};
// Use any-shape mocks here. Vitest's strict generic on `vi.fn` makes
// a typed signature awkward to thread through the channel object, and
// the tests only ever inspect `.mock.calls` shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockChannelOnSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockChannelSubscribeSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockRemoveChannelSpy: any;

vi.mock('@/lib/supabase/client', () => {
  return {
    createBrowserClient: () => {
      const channel = {
        on: (_evt: string, _filter: unknown, cb: PostgresChangesCallback) => {
          mockChannelOnSpy(_evt, _filter, cb);
          const table =
            (_filter as { table?: string } | null)?.table ?? 'unknown';
          realtimeCallbacksByTable[table] = cb as (payload: {
            new: unknown;
            eventType: string;
          }) => void;
          if (table === 'operator_chat_turns') {
            realtimeCallback = cb;
          }
          return channel;
        },
        subscribe: () => {
          mockChannelSubscribeSpy();
          return channel;
        },
      };
      return {
        channel: () => channel,
        removeChannel: (ch: unknown) => {
          mockRemoveChannelSpy(ch);
          return Promise.resolve('ok');
        },
      };
    },
  };
});

// ProposedActionCard imports server actions whose module graph reaches
// next/cache.revalidatePath — that fails to resolve in jsdom. The card
// itself is exercised in its own component test, so we stub it here.
vi.mock('../proposed-action-card', () => ({
  ProposedActionCard: ({ proposal }: { proposal: { id?: string } }) => (
    <div data-testid={`proposal-card-${proposal.id ?? 'new'}`}>card</div>
  ),
}));

// Import AFTER mocks register so the component's import resolution
// picks them up.
import { ChatPanel } from '../chat-panel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHAT_ID = '00000000-0000-0000-0000-0000000000c1';
const ORG_ID = '00000000-0000-0000-0000-0000000000a1';

function turnRow(overrides: Partial<OperatorChatTurnRow>): OperatorChatTurnRow {
  return {
    id: '00000000-0000-0000-0000-0000000000ff',
    chat_id: CHAT_ID,
    organization_id: ORG_ID,
    turn_id: 'turn-default',
    role: 'user',
    body: '',
    tool_name: null,
    tool_input: null,
    tool_use_id: null,
    tool_result: null,
    proposal_id: null,
    created_at: '2026-05-06T12:00:00Z',
    ...overrides,
  };
}

/**
 * Build a ReadableStream that emits a fixed sequence of DispatcherEvent
 * frames. The panel decodes them via the same SSE wire format the
 * dispatcher emits.
 */
function buildSseStream(events: DispatcherEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = events.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('');
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames));
      controller.close();
    },
  });
}

function mockFetchOnceWithEvents(events: DispatcherEvent[]): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(buildSseStream(events), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  );
}

function mockFetchFailureOnce(status = 500, body = 'boom'): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(body, { status }),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  realtimeCallback = null;
  realtimeCallbacksByTable = {};
  mockChannelOnSpy = vi.fn();
  mockChannelSubscribeSpy = vi.fn();
  mockRemoveChannelSpy = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering / hydration
// ---------------------------------------------------------------------------

describe('ChatPanel — hydration', () => {
  it('renders the empty state when no history is provided', () => {
    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    expect(screen.getByTestId('chat-panel-empty')).toBeInTheDocument();
  });

  it('keeps the owner empty-state copy and prompts unchanged by default', () => {
    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    expect(screen.getByTestId('chat-panel-empty')).toHaveTextContent(
      'Ask anything across your portfolio',
    );
    expect(
      screen.getByRole('button', { name: 'Show pending decisions' }),
    ).toBeInTheDocument();
  });

  it('renders a compact work-first starter whose prompts only prefill', () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/assistant"
        initialHistory={[]}
        emptyStateContent={{
          eyebrow: 'Shift support',
          description:
            'Prepare context and drafts for owner review. Nothing sends on your behalf.',
          prompts: ['Draft an owner handoff'],
          compact: true,
        }}
      />,
    );

    expect(screen.getByTestId('chat-panel')).toHaveStyle({
      height: 'min(54vh, 520px)',
    });
    expect(screen.getByTestId('chat-panel-empty-eyebrow')).toHaveTextContent(
      'Shift support',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Draft an owner handoff' }),
    );
    expect(screen.getByTestId('chat-panel-input')).toHaveValue(
      'Draft an owner handoff',
    );
    expect(screen.getByTestId('chat-panel-input')).toHaveFocus();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hydrates user / assistant_text / assistant_ack rows from initialHistory', () => {
    const history: OperatorChatTurnRow[] = [
      turnRow({ id: 'r1', role: 'user', body: 'hi from operator' }),
      turnRow({ id: 'r2', role: 'assistant_ack', body: 'looking…' }),
      turnRow({
        id: 'r3',
        role: 'assistant_text',
        body: 'here is the summary',
      }),
    ];

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={history}
      />,
    );

    expect(screen.getByText('hi from operator')).toBeInTheDocument();
    expect(screen.getByText('looking…')).toBeInTheDocument();
    expect(screen.getByText('here is the summary')).toBeInTheDocument();
  });

  it('subscribes to the chat-scoped realtime channel on mount', () => {
    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    expect(mockChannelOnSpy).toHaveBeenCalledTimes(1);
    expect(mockChannelOnSpy.mock.calls[0]![0]).toBe('postgres_changes');
    expect(mockChannelOnSpy.mock.calls[0]![1]).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'operator_chat_turns',
      filter: `chat_id=eq.${CHAT_ID}`,
    });
    expect(mockChannelSubscribeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// SSE event reducer — happy path
// ---------------------------------------------------------------------------

describe('ChatPanel — SSE reducer', () => {
  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('appends a streamed assistant message from say.delta + done frames', async () => {
    mockFetchOnceWithEvents([
      { type: 'say.delta', text: 'rent is ' },
      { type: 'say.delta', text: 'paid through May' },
      { type: 'done', turnId: 'turn-1' },
    ]);

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    const input = screen.getByTestId('chat-panel-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'what is rent status?' } });

    await act(async () => {
      fireEvent.submit(screen.getByTestId('chat-panel-form'));
    });
    await flushMicrotasks();

    // User bubble inserted locally on submit.
    expect(screen.getByText('what is rent status?')).toBeInTheDocument();
    // Assistant text accumulated from both say.delta frames.
    const assistant = screen.getByTestId('chat-message-assistant');
    expect(assistant).toHaveTextContent('rent is paid through May');
    // `done` flips streaming off.
    expect(assistant.getAttribute('data-streaming')).toBe('false');
  });

  it('renders an ack line when the dispatcher emits an ack frame', async () => {
    mockFetchOnceWithEvents([
      { type: 'ack', text: 'looking up the lease…' },
      { type: 'say.delta', text: 'lease ends June 30' },
      { type: 'done', turnId: 'turn-2' },
    ]);

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    fireEvent.change(screen.getByTestId('chat-panel-input'), {
      target: { value: 'when does the lease end?' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('chat-panel-form'));
    });
    await flushMicrotasks();

    expect(screen.getByTestId('chat-message-ack')).toHaveTextContent(
      'looking up the lease',
    );
    expect(screen.getByTestId('chat-message-assistant')).toHaveTextContent(
      'lease ends June 30',
    );
  });

  it('surfaces a transport error banner when the SSE response is non-2xx', async () => {
    mockFetchFailureOnce(500, 'kaboom');

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    fireEvent.change(screen.getByTestId('chat-panel-input'), {
      target: { value: 'fail please' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('chat-panel-form'));
    });
    await flushMicrotasks();

    expect(screen.getByTestId('chat-panel-transport-error')).toHaveTextContent(
      '500',
    );
  });
});

// ---------------------------------------------------------------------------
// Realtime ↔ SSE dedupe
// ---------------------------------------------------------------------------

describe('ChatPanel — realtime dedupe', () => {
  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('does not double-render an assistant_text turn that already streamed via SSE', async () => {
    const TURN_ID = 'turn-dedupe-1';
    mockFetchOnceWithEvents([
      { type: 'say.delta', text: 'rent is current' },
      { type: 'done', turnId: TURN_ID },
    ]);

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    fireEvent.change(screen.getByTestId('chat-panel-input'), {
      target: { value: 'rent status?' },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('chat-panel-form'));
    });
    await flushMicrotasks();

    // Sanity: SSE applied exactly one assistant bubble.
    expect(screen.getAllByTestId('chat-message-assistant')).toHaveLength(1);

    // The dispatcher persisted the same text server-side under TURN_ID;
    // the realtime publication fans the row out a moment later.
    expect(realtimeCallback).not.toBeNull();
    await act(async () => {
      realtimeCallback!({
        eventType: 'INSERT',
        new: turnRow({
          id: 'realtime-row-1',
          turn_id: TURN_ID,
          role: 'assistant_text',
          body: 'rent is current',
        }),
      });
    });

    // Still exactly one — the turn-id dedupe rejected the broadcast.
    expect(screen.getAllByTestId('chat-message-assistant')).toHaveLength(1);
  });

  it('renders an inbound iMessage broadcast that has no SSE counterpart', async () => {
    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    expect(realtimeCallback).not.toBeNull();
    // Simulate an inbound iMessage row arriving via realtime — the SSE
    // path is idle, so the panel surfaces it directly.
    await act(async () => {
      realtimeCallback!({
        eventType: 'INSERT',
        new: turnRow({
          id: 'inbound-imsg-1',
          turn_id: 'turn-from-imessage',
          role: 'user',
          body: 'hey from my phone',
        }),
      });
    });

    const list = screen.getByTestId('chat-panel-list');
    expect(within(list).getByText('hey from my phone')).toBeInTheDocument();
  });

  it('ignores a realtime broadcast for a row already in initialHistory (server hydration overlap)', async () => {
    const HISTORY_ROW_ID = 'r-history-1';
    const history: OperatorChatTurnRow[] = [
      turnRow({
        id: HISTORY_ROW_ID,
        turn_id: 'turn-history',
        role: 'assistant_text',
        body: 'cached on first paint',
      }),
    ];

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={history}
      />,
    );

    expect(realtimeCallback).not.toBeNull();
    await act(async () => {
      realtimeCallback!({
        eventType: 'INSERT',
        new: turnRow({
          id: HISTORY_ROW_ID,
          turn_id: 'turn-history',
          role: 'assistant_text',
          body: 'cached on first paint',
        }),
      });
    });

    // Exactly the one assistant bubble from history — no duplicate.
    expect(screen.getAllByTestId('chat-message-assistant')).toHaveLength(1);
  });

  it('drops tool_use realtime broadcasts (dispatcher bookkeeping is SSE-only)', async () => {
    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    expect(realtimeCallback).not.toBeNull();
    await act(async () => {
      realtimeCallback!({
        eventType: 'INSERT',
        new: turnRow({
          id: 'realtime-tool-use',
          turn_id: 'turn-x',
          role: 'tool_use',
          tool_name: 'spawn_property_worker',
        }),
      });
    });

    // Empty state still showing — tool_use rows do not surface in the UI.
    expect(screen.getByTestId('chat-panel-empty')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Durable runs (NEXT_PUBLIC_DURABLE_CHAT)
// ---------------------------------------------------------------------------
//
// Flag on: submit enqueues via POST /api/chat/runs; delivery is the
// realtime subscriptions (operator_chat_turns INSERT for content,
// agent_runs UPDATE for the run lifecycle). Dedupe is BY ID ONLY — the
// pre-minted turnId from the 202 routes the pending turn's rows.

describe('ChatPanel — durable runs (NEXT_PUBLIC_DURABLE_CHAT)', () => {
  const RUN_ID = 'run-d1';
  const TURN_ID = 'turn-d1';

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_DURABLE_CHAT', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function mockEnqueueOnce(): void {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { runId: RUN_ID, chatId: CHAT_ID, turnId: TURN_ID },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  async function submitMessage(text: string): Promise<void> {
    fireEvent.change(screen.getByTestId('chat-panel-input'), {
      target: { value: text },
    });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('chat-panel-form'));
    });
    await flushMicrotasks();
  }

  function fireTurn(row: OperatorChatTurnRow): Promise<void> {
    return act(async () => {
      realtimeCallbacksByTable['operator_chat_turns']!({
        eventType: 'INSERT',
        new: row,
      });
    });
  }

  function fireRunUpdate(run: {
    id: string;
    status: string;
    reply_text: string | null;
    error: string | null;
  }): Promise<void> {
    return act(async () => {
      realtimeCallbacksByTable['agent_runs']!({
        eventType: 'UPDATE',
        new: run,
      });
    });
  }

  it('POSTs to /api/chat/runs and subscribes to agent_runs updates', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    // Both realtime subscriptions registered.
    expect(realtimeCallbacksByTable['operator_chat_turns']).toBeDefined();
    expect(realtimeCallbacksByTable['agent_runs']).toBeDefined();

    await submitMessage('check rent');

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/chat/runs');
    const init = fetchMock.mock.calls[0]![1]!;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ message: 'check rent' });
    expect(body.submissionId).toEqual(expect.any(String));

    // Optimistic user bubble + working assistant placeholder.
    expect(screen.getAllByTestId('chat-message-user')).toHaveLength(1);
    expect(
      screen
        .getByTestId('chat-message-assistant')
        .getAttribute('data-streaming'),
    ).toBe('true');
  });

  it('forwards propertyId on the enqueue POST for per-property surfaces', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/property/prop-9"
        propertyId="prop-9"
        propertyName="Maple St"
        initialHistory={[]}
      />,
    );

    await submitMessage('lease status?');

    const init = vi.mocked(globalThis.fetch).mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      message: 'lease status?',
      propertyId: 'prop-9',
    });
  });

  it('dedupes the pending turn by id: skips the echoed user row, streams acks, fills the placeholder', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    await submitMessage('rent status?');

    // Echoed user row for the pending turn — already optimistic, skipped.
    await fireTurn(
      turnRow({
        id: 'rt-user-1',
        turn_id: TURN_ID,
        role: 'user',
        body: 'rent status?',
      }),
    );
    expect(screen.getAllByTestId('chat-message-user')).toHaveLength(1);

    // assistant_ack rows append live.
    await fireTurn(
      turnRow({
        id: 'rt-ack-1',
        turn_id: TURN_ID,
        role: 'assistant_ack',
        body: 'checking the ledger…',
      }),
    );
    expect(screen.getByTestId('chat-message-ack')).toHaveTextContent(
      'checking the ledger',
    );

    // assistant_text writes INTO the placeholder (still one bubble).
    await fireTurn(
      turnRow({
        id: 'rt-text-1',
        turn_id: TURN_ID,
        role: 'assistant_text',
        body: 'rent is current',
      }),
    );
    const assistants = screen.getAllByTestId('chat-message-assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toHaveTextContent('rent is current');
    expect(assistants[0]!.getAttribute('data-streaming')).toBe('true');

    // done UPDATE clears the working state.
    await fireRunUpdate({
      id: RUN_ID,
      status: 'done',
      reply_text: 'rent is current',
      error: null,
    });
    expect(
      screen
        .getByTestId('chat-message-assistant')
        .getAttribute('data-streaming'),
    ).toBe('false');
    expect(screen.getByTestId('chat-panel-input')).not.toBeDisabled();
  });

  it('fills the placeholder from reply_text when done outruns the turn broadcast', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    await submitMessage('anything urgent?');
    await fireRunUpdate({
      id: RUN_ID,
      status: 'done',
      reply_text: 'nothing urgent today',
      error: null,
    });

    const assistant = screen.getByTestId('chat-message-assistant');
    expect(assistant).toHaveTextContent('nothing urgent today');
    expect(assistant.getAttribute('data-streaming')).toBe('false');
  });

  it('uses canonical terminal reply_text instead of a stale model fragment', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    await submitMessage('change Dana rent to 1900');
    await fireTurn(
      turnRow({
        id: 'rt-text-model-fragment',
        turn_id: TURN_ID,
        role: 'assistant_text',
        body: 'I changed the rent.',
      }),
    );
    await fireRunUpdate({
      id: RUN_ID,
      status: 'done',
      reply_text:
        'I prepared the rent change.\n\n⏳ Rent change — needs review: /owner-queue',
      error: null,
    });

    const assistant = screen.getByTestId('chat-message-assistant');
    expect(assistant).toHaveTextContent('needs review');
    expect(assistant).toHaveTextContent('/owner-queue');
    expect(assistant).not.toHaveTextContent('I changed the rent.');
  });

  it('surfaces a failed run through the transport-error path', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    await submitMessage('boom please');
    await fireRunUpdate({
      id: RUN_ID,
      status: 'failed',
      reply_text: null,
      error: 'run timed out after 240000ms',
    });

    expect(screen.getByTestId('chat-panel-transport-error')).toHaveTextContent(
      "couldn't finish this request",
    );
    expect(screen.getByTestId('chat-panel-transport-error')).not.toHaveTextContent(
      '240000',
    );
    expect(
      screen
        .getByTestId('chat-message-assistant')
        .getAttribute('data-streaming'),
    ).toBe('false');
  });

  it('replaces an untrusted provider fragment when the durable run fails', async () => {
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    await submitMessage('change Dana rent to 1900');
    await fireTurn(
      turnRow({
        id: 'rt-text-before-failure',
        turn_id: TURN_ID,
        role: 'assistant_text',
        body: 'I changed the rent.',
      }),
    );
    await fireRunUpdate({
      id: RUN_ID,
      status: 'failed',
      reply_text: 'I changed the rent.',
      error: 'provider stream ended without terminal result',
    });

    const assistant = screen.getByTestId('chat-message-assistant');
    expect(assistant).toHaveTextContent("couldn't finish this request");
    expect(assistant).not.toHaveTextContent('I changed the rent.');
  });

  it('re-enables the composer when an enqueued run never settles (watchdog)', async () => {
    // The enqueue succeeds (202) but no terminal agent_runs UPDATE ever
    // arrives — Inngest down / worker crashed. Without the watchdog the
    // composer would stay disabled on "Sending" forever.
    vi.useFakeTimers();
    try {
      mockEnqueueOnce();

      render(
        <ChatPanel
          chatId={CHAT_ID}
          apiEndpoint="/api/chat/inbox"
          initialHistory={[]}
        />,
      );

      fireEvent.change(screen.getByTestId('chat-panel-input'), {
        target: { value: 'are you there?' },
      });
      await act(async () => {
        fireEvent.submit(screen.getByTestId('chat-panel-form'));
        // Resolve the enqueue POST microtasks under fake timers.
        await Promise.resolve();
        await Promise.resolve();
      });

      // Mid-flight: composer is locked while we wait for the run.
      expect(screen.getByTestId('chat-panel-input')).toBeDisabled();

      await fireTurn(
        turnRow({
          id: 'rt-text-before-watchdog',
          turn_id: TURN_ID,
          role: 'assistant_text',
          body: 'I changed the rent.',
        }),
      );

      // Advance past the 60s watchdog with no terminal status delivered.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });

      // Watchdog rescued the UI: composer re-enabled, clear error shown,
      // caret stopped.
      expect(screen.getByTestId('chat-panel-input')).not.toBeDisabled();
      expect(
        screen.getByTestId('chat-panel-transport-error'),
      ).toHaveTextContent("didn't finish in time");
      expect(
        screen
          .getByTestId('chat-message-assistant')
          .getAttribute('data-streaming'),
      ).toBe('false');
      expect(screen.getByTestId('chat-message-assistant')).not.toHaveTextContent(
        'I changed the rent.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces the enqueue failure when the POST is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'A run is already in progress for this chat',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    await submitMessage('hello?');

    expect(screen.getByTestId('chat-panel-transport-error')).toHaveTextContent(
      'already working on this thread',
    );
    expect(screen.getByTestId('chat-panel-input')).not.toBeDisabled();
  });

  it('forces the canonical assistant onto durable runs even when the rollout flag is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_DURABLE_CHAT', 'false');
    mockEnqueueOnce();

    render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/assistant"
        initialHistory={[]}
        forceDurable
      />,
    );

    await submitMessage('what needs me?');

    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
      '/api/chat/runs',
    );
    expect(realtimeCallbacksByTable['agent_runs']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('ChatPanel — unmount', () => {
  it('removes the realtime channel on unmount', () => {
    const { unmount } = render(
      <ChatPanel
        chatId={CHAT_ID}
        apiEndpoint="/api/chat/inbox"
        initialHistory={[]}
      />,
    );

    unmount();

    expect(mockRemoveChannelSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Wrapper utility — silence unused import warning if ReactNode is not
// referenced. Defensive only.
// ---------------------------------------------------------------------------

void (null as unknown as ReactNode);
