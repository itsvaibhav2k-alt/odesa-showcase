/**
 * Unit tests for `/api/chat/runs` (durable web-chat enqueue, Phase B).
 *
 * POST contract points:
 *   1. 401 when no authenticated user; 400 on malformed body.
 *   2. Property surface: ownership re-check (404 cross-org), chat keyed
 *      (propertyId, channel 'web'), property_hint snapshot.
 *   3. Assistant surface: chat keyed (propertyId null, channel
 *      'imessage') — the same row as the operator's iMessage thread.
 *   4. Enqueue inserts an agent_runs(queued) row and sends the
 *      `odesa/operator-run.requested` event with {runId, chatId};
 *      returns 202 {runId, chatId, turnId}.
 *   5. LOCAL FALLBACK: with no INNGEST_EVENT_KEY (and not required),
 *      the run executes via `after()` → executeAgentRun(runId);
 *      inngest.send is never called.
 *   6. DURABLE_CHAT_REQUIRE_INNGEST='true' forbids the fallback.
 *   7. 409 when the partial unique index rejects a second active run.
 *
 * GET contract points: org-scoped status read; 404 on miss.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn() };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/agent/operator/persist', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/agent/operator/persist')
  >();
  return { ...actual, loadOrCreateChat: vi.fn() };
});

vi.mock('@/lib/agent/operator/run-executor', () => ({
  executeAgentRun: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: vi.fn(),
    createFunction: vi.fn(() => ({})),
  },
}));

import { after } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import { executeAgentRun } from '@/lib/agent/operator/run-executor';
import { inngest } from '@/lib/inngest/client';

import { GET, POST } from '../route';

const mockAfter = vi.mocked(after);
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockLoadOrCreateChat = vi.mocked(loadOrCreateChat);
const mockExecuteAgentRun = vi.mocked(executeAgentRun);
const mockInngestSend = vi.mocked(inngest.send);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
const TEST_CHAT_ID = 'chat-1';
const TEST_RUN_ID = 'run-1';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

interface ServerStubOpts {
  userId?: string | null;
  organizationId?: string | null;
  role?: string | null;
  /** Row returned from the `properties` ownership re-check. */
  property?: { id: string; name: string } | null;
  /** Row returned from the GET agent_runs status lookup. */
  run?: {
    id: string;
    status: string;
    reply_text: string | null;
    error: string | null;
  } | null;
}

/** Captures the org filter applied on the GET agent_runs lookup. */
let capturedRunFilters: Record<string, unknown> = {};

function stubServerClient(opts: ServerStubOpts = {}): void {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  const orgId =
    opts.organizationId === undefined ? TEST_ORG_ID : opts.organizationId;
  const role = opts.role === undefined ? 'owner' : opts.role;
  const property = opts.property ?? null;
  const run = opts.run ?? null;

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
      if (table === 'agent_runs') {
        return {
          select: () => ({
            eq: (col1: string, val1: unknown) => {
              capturedRunFilters[col1] = val1;
              return {
                eq: (col2: string, val2: unknown) => {
                  capturedRunFilters[col2] = val2;
                  return {
                    maybeSingle: async () => ({ data: run, error: null }),
                  };
                },
              };
            },
          }),
        };
      }
      throw new Error(`Unexpected table lookup: ${table}`);
    }),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

interface AdminStubOpts {
  /** Error returned by the agent_runs insert (e.g. 23505). */
  insertError?: { code?: string; message: string } | null;
  /** Existing row resolved for an exact (chat_id, turn_id) replay. */
  existingRun?: {
    id: string;
    chat_id: string;
    turn_id: string;
    message: string;
  } | null;
  /** Failure from persisting the queued user turn. */
  turnInsertError?: { message: string } | null;
  /** Failure from recording a terminal run update. */
  updateError?: { message: string } | null;
  /** Whether the conditional run update won its status fence. */
  updateMatched?: boolean;
}

interface AdminStub {
  insertSpy: ReturnType<typeof vi.fn>;
  updateSpy: ReturnType<typeof vi.fn>;
  turnInsertSpy: ReturnType<typeof vi.fn>;
}

function stubAdminClient(opts: AdminStubOpts = {}): AdminStub {
  const insertSpy = vi.fn();
  const updateSpy = vi.fn();
  const turnInsertSpy = vi.fn();

  mockCreateAdminClient.mockReturnValue({
    from: (table: string) => {
      if (table === 'operator_chat_turns') {
        let insertRow: Record<string, unknown> | null = null;
        const chain: Record<string, unknown> = {};
        chain.insert = (row: Record<string, unknown>) => {
          insertRow = row;
          turnInsertSpy(row);
          return chain;
        };
        chain.update = () => chain;
        chain.eq = () => chain;
        chain.select = () => chain;
        chain.single = async () =>
          opts.turnInsertError
            ? { data: null, error: opts.turnInsertError }
            : { data: { ...insertRow, id: 'turn-row-1' }, error: null };
        chain.maybeSingle = async () => ({ data: null, error: null });
        chain.then = (
          fulfilled?: (value: {
            data: null;
            error: { message: string } | null;
          }) => unknown,
        ) => {
          const result = {
            data: null,
            error: opts.turnInsertError ?? null,
          };
          return Promise.resolve(fulfilled ? fulfilled(result) : result);
        };
        return chain;
      }
      if (table !== 'agent_runs') {
        throw new Error(`Unexpected admin table: ${table}`);
      }
      return {
        select: () => {
          const chain: Record<string, unknown> = {};
          chain.eq = vi.fn(() => chain);
          chain.maybeSingle = vi.fn(async () => ({
            data: opts.existingRun ?? null,
            error: null,
          }));
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          insertSpy(row);
          return {
            select: () => ({
              single: async () =>
                opts.insertError
                  ? { data: null, error: opts.insertError }
                  : {
                      data: { ...row, id: TEST_RUN_ID },
                      error: null,
                    },
            }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          updateSpy(patch);
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.select = () => chain;
          chain.maybeSingle = async () => ({
            data:
              opts.updateMatched === false
                ? null
                : {
                    id: TEST_RUN_ID,
                    organization_id: TEST_ORG_ID,
                    chat_id: TEST_CHAT_ID,
                    turn_id: 'submission-1',
                  },
            error: opts.updateError ?? null,
          });
          return chain;
        },
      };
    },
  } as unknown as ReturnType<typeof createAdminClient>);

  return { insertSpy, updateSpy, turnInsertSpy };
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
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  };
}

function buildPost(body: unknown): Request {
  return new Request('http://localhost/api/chat/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function buildGet(runId: string | null): Request {
  const url = runId
    ? `http://localhost/api/chat/runs?runId=${runId}`
    : 'http://localhost/api/chat/runs';
  return new Request(url, { method: 'GET' });
}

// Next's NextRequest exposes `nextUrl`; the route reads
// `req.nextUrl.searchParams`. Wrap a plain Request to provide it.
function asNextRequest(req: Request): never {
  const wrapped = req as Request & { nextUrl: URL };
  wrapped.nextUrl = new URL(req.url);
  return wrapped as never;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat/runs', () => {
  beforeEach(() => {
    capturedRunFilters = {};
    // Default: Inngest configured → the send path is exercised unless a
    // test explicitly clears the key.
    vi.stubEnv('INNGEST_EVENT_KEY', 'test-event-key');
    vi.stubEnv('DURABLE_CHAT_REQUIRE_INNGEST', '');
    mockInngestSend.mockResolvedValue({ ids: ['ev-1'] } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('auth + validation', () => {
    it('should return 401 when no authenticated user', async () => {
      stubAdminClient();
      stubServerClient({ userId: null });

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(401);
      expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
      expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it('should return 400 when message is missing or empty', async () => {
      stubAdminClient();
      stubServerClient();

      const missing = await POST(buildPost({}) as never);
      expect(missing.status).toBe(400);

      const empty = await POST(buildPost({ message: '   ' }) as never);
      expect(empty.status).toBe(400);
      expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it('should return 403 before creating a run for a non-owner', async () => {
      stubAdminClient();
      stubServerClient({ role: 'manager' });

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        success: false,
        error: 'Owner access required',
      });
      expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
      expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it('should return 404 when propertyId fails the ownership re-check', async () => {
      stubAdminClient();
      stubServerClient({ property: null });

      const res = await POST(
        buildPost({ message: 'hi', propertyId: 'prop-other-org' }) as never,
      );

      expect(res.status).toBe(404);
      expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
      expect(mockInngestSend).not.toHaveBeenCalled();
    });
  });

  describe('enqueue (Inngest configured)', () => {
    it('should insert a queued web run and send the event for the assistant surface', async () => {
      const { insertSpy, turnInsertSpy } = stubAdminClient();
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const res = await POST(buildPost({ message: 'what needs me?' }) as never);

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.runId).toBe(TEST_RUN_ID);
      expect(body.data.chatId).toBe(TEST_CHAT_ID);
      expect(typeof body.data.turnId).toBe('string');
      expect(body.data.turnId.length).toBeGreaterThan(0);

      // Assistant surface keying: same row as the iMessage thread.
      const [, loadArgs] = mockLoadOrCreateChat.mock.calls[0]!;
      expect(loadArgs).toEqual({
        organizationId: TEST_ORG_ID,
        userId: TEST_USER_ID,
        propertyId: null,
        channel: 'imessage',
      });

      expect(insertSpy).toHaveBeenCalledTimes(1);
      expect(insertSpy.mock.calls[0]![0]).toMatchObject({
        organization_id: TEST_ORG_ID,
        user_id: TEST_USER_ID,
        chat_id: TEST_CHAT_ID,
        surface: 'web',
        channel: 'imessage',
        message: 'what needs me?',
        status: 'queued',
        property_hint: null,
      });
      expect(insertSpy.mock.calls[0]![0].turn_id).toBe(body.data.turnId);
      expect(turnInsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: TEST_CHAT_ID,
          organization_id: TEST_ORG_ID,
          turn_id: body.data.turnId,
          role: 'user',
          body: 'what needs me?',
        }),
      );

      expect(mockInngestSend).toHaveBeenCalledTimes(1);
      expect(mockInngestSend.mock.calls[0]![0]).toEqual({
        name: 'odesa/operator-run.requested',
        data: { runId: TEST_RUN_ID, chatId: TEST_CHAT_ID },
      });
      expect(mockAfter).not.toHaveBeenCalled();
      expect(mockExecuteAgentRun).not.toHaveBeenCalled();
    });

    it('should key the property surface on (propertyId, channel web) with a hint snapshot', async () => {
      const { insertSpy } = stubAdminClient();
      stubServerClient({ property: { id: 'prop-9', name: 'Maple St' } });
      mockLoadOrCreateChat.mockResolvedValue({
        ...chatRow('prop-9'),
        channel: 'web' as never,
      });

      const res = await POST(
        buildPost({ message: 'lease status?', propertyId: 'prop-9' }) as never,
      );

      expect(res.status).toBe(202);
      const [, loadArgs] = mockLoadOrCreateChat.mock.calls[0]!;
      expect(loadArgs).toEqual({
        organizationId: TEST_ORG_ID,
        userId: TEST_USER_ID,
        propertyId: 'prop-9',
        channel: 'web',
      });
      expect(insertSpy.mock.calls[0]![0]).toMatchObject({
        surface: 'web',
        channel: 'web',
        property_hint: { id: 'prop-9', name: 'Maple St' },
      });
    });

    it('should return 409 when a run is already active for the chat (23505)', async () => {
      stubAdminClient({
        insertError: { code: '23505', message: 'duplicate key value' },
      });
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(409);
      expect(mockInngestSend).not.toHaveBeenCalled();
    });

    it('returns the original run and never re-enqueues an exact submission replay', async () => {
      const submissionId = 'submission-stable-1';
      stubAdminClient({
        insertError: { code: '23505', message: 'duplicate key value' },
        existingRun: {
          id: TEST_RUN_ID,
          chat_id: TEST_CHAT_ID,
          turn_id: submissionId,
          message: 'what needs me?',
        },
      });
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const res = await POST(
        buildPost({ message: 'what needs me?', submissionId }) as never,
      );

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({
        success: true,
        data: {
          runId: TEST_RUN_ID,
          chatId: TEST_CHAT_ID,
          turnId: submissionId,
          duplicate: true,
        },
      });
      expect(mockInngestSend).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('rejects reuse of a submission identifier for different text', async () => {
      const submissionId = 'submission-stable-1';
      stubAdminClient({
        insertError: { code: '23505', message: 'duplicate key value' },
        existingRun: {
          id: TEST_RUN_ID,
          chat_id: TEST_CHAT_ID,
          turn_id: submissionId,
          message: 'what needs me?',
        },
      });
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const res = await POST(
        buildPost({ message: 'change the rent', submissionId }) as never,
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        success: false,
        error:
          'This submission identifier was already used for a different message',
      });
      expect(mockInngestSend).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it('should fail the queued row and return 500 when inngest.send throws', async () => {
      const { updateSpy } = stubAdminClient();
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
      mockInngestSend.mockRejectedValue(new Error('event key rejected'));

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        success: false,
        error: 'Odesa could not start this request. It is recorded as failed.',
      });
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.calls[0]![0]).toMatchObject({
        status: 'failed',
        error: 'enqueue failed: event key rejected',
        reply_text: expect.stringContaining("couldn't finish this request"),
      });
    });

    it('does not claim an enqueue failure was durable when the failed-row write errors', async () => {
      stubAdminClient({ updateError: { message: 'database unavailable' } });
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
      mockInngestSend.mockRejectedValue(new Error('event key rejected'));

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        success: false,
        error: 'Odesa could not start this request. Refresh before trying again.',
      });
    });

    it('fails closed when the queued user turn cannot be persisted', async () => {
      const { updateSpy } = stubAdminClient({
        turnInsertError: { message: 'turn insert failed' },
      });
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        success: false,
        error:
          'Odesa could not safely record this request. Refresh before trying again.',
      });
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('user turn persistence failed'),
        }),
      );
      expect(mockInngestSend).not.toHaveBeenCalled();
    });
  });

  describe('local fallback (no Inngest event key)', () => {
    it('should execute the run via after() instead of inngest.send', async () => {
      vi.stubEnv('INNGEST_EVENT_KEY', '');
      stubAdminClient();
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));
      mockExecuteAgentRun.mockResolvedValue({
        kind: 'done',
        runId: TEST_RUN_ID,
        replyText: 'ok',
      });

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(202);
      expect(mockInngestSend).not.toHaveBeenCalled();
      expect(mockAfter).toHaveBeenCalledTimes(1);

      // Drive the deferred callback: it must run the executor with the
      // queued run's id (same DB lifecycle, agent_runs never bypassed).
      const deferred = mockAfter.mock.calls[0]![0] as () => Promise<void>;
      await deferred();
      expect(mockExecuteAgentRun).toHaveBeenCalledTimes(1);
      expect(mockExecuteAgentRun).toHaveBeenCalledWith(TEST_RUN_ID);
    });

    it('should NOT fall back when DURABLE_CHAT_REQUIRE_INNGEST is true', async () => {
      vi.stubEnv('INNGEST_EVENT_KEY', '');
      vi.stubEnv('DURABLE_CHAT_REQUIRE_INNGEST', 'true');
      stubAdminClient();
      stubServerClient();
      mockLoadOrCreateChat.mockResolvedValue(chatRow(null));

      const res = await POST(buildPost({ message: 'hi' }) as never);

      expect(res.status).toBe(202);
      expect(mockAfter).not.toHaveBeenCalled();
      expect(mockExecuteAgentRun).not.toHaveBeenCalled();
      expect(mockInngestSend).toHaveBeenCalledTimes(1);
    });
  });
});

describe('GET /api/chat/runs', () => {
  beforeEach(() => {
    capturedRunFilters = {};
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('should return 401 when no authenticated user', async () => {
    stubServerClient({ userId: null });

    const res = await GET(asNextRequest(buildGet(TEST_RUN_ID)));

    expect(res.status).toBe(401);
  });

  it('should return 400 when runId is missing', async () => {
    stubServerClient();

    const res = await GET(asNextRequest(buildGet(null)));

    expect(res.status).toBe(400);
  });

  it('should return 403 before reading run state for a non-owner', async () => {
    stubServerClient({ role: 'va' });

    const res = await GET(asNextRequest(buildGet(TEST_RUN_ID)));

    expect(res.status).toBe(403);
    expect(capturedRunFilters).toEqual({});
  });

  it('should return the org-scoped run status and reply text', async () => {
    stubServerClient({
      run: {
        id: TEST_RUN_ID,
        status: 'done',
        reply_text: 'All set — rent is current.',
        error: null,
      },
    });

    const res = await GET(asNextRequest(buildGet(TEST_RUN_ID)));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        runId: TEST_RUN_ID,
        status: 'done',
        replyText: 'All set — rent is current.',
        error: null,
      },
    });
    // Org scoping applied on the lookup itself, not just RLS.
    expect(capturedRunFilters['id']).toBe(TEST_RUN_ID);
    expect(capturedRunFilters['organization_id']).toBe(TEST_ORG_ID);
  });

  it('should return 404 when the run is not visible to this org', async () => {
    stubServerClient({ run: null });

    const res = await GET(asNextRequest(buildGet('run-other-org')));

    expect(res.status).toBe(404);
  });
});
