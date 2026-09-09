/**
 * Unit tests for `POST /api/chat/assistant`.
 *
 * The route auth-gates via Supabase SSR, validates the body, resolves
 * the iMessage chat row, and streams the operator dispatcher reply
 * back as `text/event-stream`. We mock at the module boundary:
 *
 *   - Supabase server + admin clients (auth + chat lookup).
 *   - `loadOrCreateChat` (chat row resolution).
 *   - `runOperatorDispatcher` (the dispatcher itself — programmable
 *     async iterable that yields a scripted DispatcherEvent sequence).
 *
 * Coverage targets the four contract points the route must hold:
 *
 *   1. 401 when no authenticated user.
 *   2. 400 when the body is malformed (missing message, empty string,
 *      unparsable JSON).
 *   3. 500 surface when `loadOrCreateChat` throws — we don't crash, we
 *      return a clean envelope.
 *   4. 200 + SSE happy path: dispatcher is called with the imessage
 *      shape (`channel: 'imessage'`, `propertyId` semantics, `chatId`
 *      from the resolved row), and the SSE frames the route emits
 *      match the dispatcher's events verbatim.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DispatcherEvent } from '@/lib/agent/operator/types';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/agent/operator/persist', () => ({
  loadOrCreateChat: vi.fn(),
}));

vi.mock('@/lib/agent/operator/dispatcher', () => ({
  runOperatorDispatcher: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import { runOperatorDispatcher } from '@/lib/agent/operator/dispatcher';

import { POST } from '../route';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockLoadOrCreateChat = vi.mocked(loadOrCreateChat);
const mockRunOperatorDispatcher = vi.mocked(runOperatorDispatcher);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
const TEST_CHAT_ID = 'chat-1';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface ServerStubOpts {
  userId?: string | null;
  /** Property row returned from a `properties.eq(...).maybeSingle()` lookup. */
  property?: { id: string; name: string } | null;
  /** Override the users-row lookup return value. */
  organizationId?: string | null;
  role?: string | null;
}

function stubServerClient(opts: ServerStubOpts = {}): void {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  const orgId =
    opts.organizationId === undefined ? TEST_ORG_ID : opts.organizationId;
  const role = opts.role === undefined ? 'owner' : opts.role;
  const property = opts.property ?? null;

  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: userId ? { id: userId, email: 'op@test.test' } : null,
        },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: orgId ? { organization_id: orgId, role } : null,
                error: orgId ? null : { message: 'not found' },
              }),
            }),
          }),
        };
      }
      if (table === 'properties') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: property, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table lookup: ${table}`);
    }),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

function stubAdminClient(): void {
  // The route uses the admin client only as an opaque handle that gets
  // passed straight through to `loadOrCreateChat` and `runOperatorDispatcher`,
  // both of which we mock. Returning a tagged sentinel is fine.
  mockCreateAdminClient.mockReturnValue(
    { __admin: true } as unknown as ReturnType<typeof createAdminClient>,
  );
}

function chatRow(propertyId: string | null = null) {
  return {
    id: TEST_CHAT_ID,
    organization_id: TEST_ORG_ID,
    user_id: TEST_USER_ID,
    property_id: propertyId,
    channel: 'imessage' as const,
    status: 'open' as const,
    last_message_at: null,
    created_at: '2026-05-07T00:00:00Z',
    updated_at: '2026-05-07T00:00:00Z',
  };
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/chat/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readSseFrames(stream: ReadableStream<Uint8Array>): Promise<DispatcherEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: DispatcherEvent[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      if (dataLines.length > 0) {
        events.push(JSON.parse(dataLines.join('\n')) as DispatcherEvent);
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  return events;
}

async function* scriptedDispatcher(
  events: DispatcherEvent[],
): AsyncGenerator<DispatcherEvent> {
  for (const ev of events) {
    yield ev;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat/assistant', () => {
  beforeEach(() => {
    stubAdminClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('auth gate', () => {
    it('returns 401 when no authenticated user', async () => {
      stubServerClient({ userId: null });

      const res = await POST(buildRequest({ message: 'hi' }) as never);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'Not authenticated' });
      expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
      expect(mockRunOperatorDispatcher).not.toHaveBeenCalled();
    });

    it('returns 401 when the user has no organization profile', async () => {
      stubServerClient({ organizationId: null });

      const res = await POST(buildRequest({ message: 'hi' }) as never);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: 'User profile not found',
      });
    });

    it('returns 403 before resolving a chat for a non-owner', async () => {
      stubServerClient({ role: 'manager' });

      const res = await POST(buildRequest({ message: 'hi' }) as never);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        success: false,
        error: 'Owner access required',
      });
      expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
      expect(mockRunOperatorDispatcher).not.toHaveBeenCalled();
    });
  });

  describe('body validation', () => {
    it('returns 400 when the body is missing the message field', async () => {
      stubServerClient();

      const res = await POST(buildRequest({}) as never);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
      expect(mockRunOperatorDispatcher).not.toHaveBeenCalled();
    });

    it('returns 400 when message is an empty string', async () => {
      stubServerClient();

      const res = await POST(buildRequest({ message: '   ' }) as never);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('returns 400 when the body is not valid JSON', async () => {
      stubServerClient();

      const res = await POST(buildRequest('not json') as never);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'Invalid JSON body' });
    });
  });

  describe('chat resolution', () => {
    it('returns 500 when loadOrCreateChat throws', async () => {
      stubServerClient();
      mockLoadOrCreateChat.mockRejectedValue(new Error('db is down'));

      const res = await POST(buildRequest({ message: 'hi' }) as never);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'db is down' });
      expect(mockRunOperatorDispatcher).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('streams dispatcher events as SSE frames', async () => {
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const events: DispatcherEvent[] = [
        { type: 'say.delta', text: 'on it — ' },
        { type: 'say.delta', text: 'looking now.' },
        { type: 'done', turnId: 'turn-1' },
      ];
      mockRunOperatorDispatcher.mockReturnValue(scriptedDispatcher(events));

      const res = await POST(
        buildRequest({ message: 'what needs my attention?' }) as never,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe(
        'text/event-stream; charset=utf-8',
      );
      expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');
      expect(res.body).not.toBeNull();

      const decoded = await readSseFrames(res.body as ReadableStream<Uint8Array>);
      expect(decoded).toEqual(events);
    });

    it('invokes the dispatcher with channel=imessage and the resolved chatId', async () => {
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
      mockRunOperatorDispatcher.mockReturnValue(
        scriptedDispatcher([{ type: 'done', turnId: 't' }]),
      );

      const res = await POST(buildRequest({ message: 'hello' }) as never);
      // Drain the body so the start callback runs to completion.
      await readSseFrames(res.body as ReadableStream<Uint8Array>);

      expect(mockLoadOrCreateChat).toHaveBeenCalledTimes(1);
      const [, loadArgs] = mockLoadOrCreateChat.mock.calls[0]!;
      expect(loadArgs).toEqual({
        organizationId: TEST_ORG_ID,
        userId: TEST_USER_ID,
        propertyId: null,
        channel: 'imessage',
      });

      expect(mockRunOperatorDispatcher).toHaveBeenCalledTimes(1);
      const dispatchArgs = mockRunOperatorDispatcher.mock.calls[0]![0];
      expect(dispatchArgs.organizationId).toBe(TEST_ORG_ID);
      expect(dispatchArgs.userId).toBe(TEST_USER_ID);
      expect(dispatchArgs.chatId).toBe(TEST_CHAT_ID);
      expect(dispatchArgs.channel).toBe('imessage');
      expect(dispatchArgs.message).toBe('hello');
      // No prior property stamped on the chat → no propertyHint forwarded.
      expect(dispatchArgs.propertyHint).toBeUndefined();
    });

    it('forwards a propertyHint when the chat row carries a stamped property_id', async () => {
      stubServerClient({ property: { id: 'prop-9', name: 'Maple St' } });
      mockLoadOrCreateChat.mockResolvedValue(chatRow('prop-9'));
      mockRunOperatorDispatcher.mockReturnValue(
        scriptedDispatcher([{ type: 'done', turnId: 't' }]),
      );

      const res = await POST(buildRequest({ message: 'follow up?' }) as never);
      await readSseFrames(res.body as ReadableStream<Uint8Array>);

      const dispatchArgs = mockRunOperatorDispatcher.mock.calls[0]![0];
      expect(dispatchArgs.propertyHint).toEqual({
        id: 'prop-9',
        name: 'Maple St',
      });
    });

    it('emits a fallback tool.error + done if the dispatcher itself throws', async () => {
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      // Dispatcher contract says it never throws, but if it does we
      // surface a synthetic terminal frame so the client clears its
      // streaming state instead of hanging forever.
      async function* throwingGenerator(): AsyncGenerator<DispatcherEvent> {
        throw new Error('boom');
      }
      mockRunOperatorDispatcher.mockReturnValue(throwingGenerator());

      const res = await POST(buildRequest({ message: 'hi' }) as never);
      const decoded = await readSseFrames(res.body as ReadableStream<Uint8Array>);

      expect(decoded).toHaveLength(2);
      expect(decoded[0]).toMatchObject({
        type: 'tool.error',
        name: 'sse-route',
        message: 'boom',
      });
      expect(decoded[1]).toMatchObject({ type: 'done' });
    });
  });
});
