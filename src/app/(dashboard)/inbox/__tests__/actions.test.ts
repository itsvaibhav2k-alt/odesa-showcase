/**
 * Unit tests for `/inbox` server actions.
 *
 * The actions cross three boundaries:
 *
 *   1. Auth (Supabase SSR client) — `auth.getUser` + a `users` lookup.
 *   2. Admin (service-role) Supabase client — used for table writes.
 *   3. The messaging provider (`sendWithFailover`) — mocked to record
 *      outbound sends without hitting Sendblue.
 *
 * Mocks are thin: each test wires up only the chains its action
 * actually exercises.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/messaging/send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));

vi.mock('@/lib/inbox/draft-queries', () => ({
  getDraftDetail: vi.fn(),
}));

vi.mock('@/lib/inbox/conversation-queries', () => ({
  getConversation: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { sendWithFailover } from '@/lib/messaging/send-with-failover';
import { getDraftDetail } from '@/lib/inbox/draft-queries';
import { getConversation } from '@/lib/inbox/conversation-queries';

import {
  approveDraftAction,
  editDraftAction,
  loadConversationAction,
  loadDraftDetailAction,
  muteConversationAction,
  regenerateDraftAction,
  rejectDraftAction,
  sendOwnerMessageAction,
  snoozeConversationAction,
} from '../actions';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockSendWithFailover = vi.mocked(sendWithFailover);
const mockGetDraftDetail = vi.mocked(getDraftDetail);
const mockGetConversation = vi.mocked(getConversation);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';

// ---------------------------------------------------------------------------
// Server-client stub (auth gate + users lookup)
// ---------------------------------------------------------------------------

function stubServerClient(opts: { userId?: string | null } = {}): void {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: userId ? { id: userId, email: 'op@test.test' } : null,
        },
        error: null,
      })),
    },
    from: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

// ---------------------------------------------------------------------------
// Admin-client stub builder
// ---------------------------------------------------------------------------

interface AdminTables {
  users?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  conversations?: Array<Record<string, unknown>>;
  tenants?: Array<Record<string, unknown>>;
  organizations?: Array<Record<string, unknown>>;
  action_proposals?: Array<Record<string, unknown>>;
}

interface AdminStub {
  tables: AdminTables;
  client: ReturnType<typeof createAdminClient>;
  updateCalls: Array<{ table: string; patch: Record<string, unknown> }>;
  insertedRows: Array<{ table: string; row: Record<string, unknown> }>;
}

function buildAdminStub(
  initial: AdminTables,
  opts: { queryErrorTable?: keyof AdminTables } = {},
): AdminStub {
  const tables: AdminTables = {
    users: initial.users ? [...initial.users] : [],
    messages: initial.messages ? [...initial.messages] : [],
    conversations: initial.conversations ? [...initial.conversations] : [],
    tenants: initial.tenants ? [...initial.tenants] : [],
    organizations: initial.organizations ? [...initial.organizations] : [],
    action_proposals: initial.action_proposals
      ? [...initial.action_proposals]
      : [],
  };
  const updateCalls: AdminStub['updateCalls'] = [];
  const insertedRows: AdminStub['insertedRows'] = [];

  function makeQuery(tableName: keyof AdminTables) {
    const predicates: Array<{ col: string; value: unknown }> = [];
    const apply = () => {
      const rows = tables[tableName] ?? [];
      return rows.filter((r) =>
        predicates.every((p) => r[p.col] === p.value),
      );
    };

    const chain: Record<string, unknown> = {
      select(_cols?: string) {
        return chain;
      },
      eq(col: string, value: unknown) {
        predicates.push({ col, value });
        return chain;
      },
      maybeSingle() {
        if (opts.queryErrorTable === tableName) {
          return Promise.resolve({
            data: null,
            error: { message: 'lookup unavailable' },
          });
        }
        const result = apply()[0] ?? null;
        return Promise.resolve({ data: result, error: null });
      },
      single() {
        if (opts.queryErrorTable === tableName) {
          return Promise.resolve({
            data: null,
            error: { message: 'lookup unavailable' },
          });
        }
        const result = apply()[0] ?? null;
        return Promise.resolve({ data: result, error: null });
      },
    };
    return chain;
  }

  function makeUpdate(tableName: keyof AdminTables) {
    return (patch: Record<string, unknown>) => {
      const predicates: Array<{ col: string; value: unknown }> = [];
      const applyPatch = () => {
        const rows = tables[tableName] ?? [];
        const matched = rows.filter((r) =>
          predicates.every((p) => r[p.col] === p.value),
        );
        matched.forEach((r) => Object.assign(r, patch));
        updateCalls.push({ table: tableName as string, patch });
        return matched;
      };
      // Supports every update shape the actions use:
      //   await .update().eq()                       (plain promote)
      //   await .update().eq().eq()                  (conditional revert)
      //   .update().eq().eq().select().maybeSingle() (CAS claim — returns
      //                                               the matched row, or
      //                                               null on claim miss)
      const chain: Record<string, unknown> = {
        eq(col: string, value: unknown) {
          predicates.push({ col, value });
          return chain;
        },
        select() {
          return chain;
        },
        maybeSingle() {
          const matched = applyPatch();
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        single() {
          const matched = applyPatch();
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
        then(resolve: (value: { error: null }) => unknown) {
          applyPatch();
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return chain;
    };
  }

  function makeInsert(tableName: keyof AdminTables) {
    return (row: Record<string, unknown>) => {
      const id = (row.id as string | undefined) ?? `gen-${Date.now()}`;
      const persisted = { ...row, id };
      tables[tableName] = tables[tableName] ?? [];
      tables[tableName]!.push(persisted);
      insertedRows.push({ table: tableName as string, row: persisted });
      return {
        select() {
          return {
            single: async () => ({ data: { id }, error: null }),
          };
        },
      };
    };
  }

  const client = {
    from: (table: keyof AdminTables) => ({
      select: makeQuery(table).select,
      eq: (makeQuery(table) as unknown as { eq: unknown }).eq,
      // The actual API: from(table).select(cols) or from(table).update(patch)
      // We recreate per-call so predicates don't leak.
      ...buildFromMethods(table, makeUpdate, makeInsert, makeQuery),
    }),
  } as unknown as ReturnType<typeof createAdminClient>;

  // The above shape is finicky; build a cleaner factory:
  const cleanClient = {
    from: (table: keyof AdminTables) => {
      const queryChain = makeQuery(table);
      return {
        ...queryChain,
        update: makeUpdate(table),
        insert: makeInsert(table),
        select: (queryChain.select as () => unknown),
      };
    },
  } as unknown as ReturnType<typeof createAdminClient>;

  return {
    tables,
    client: cleanClient,
    updateCalls,
    insertedRows,
  };
}

function buildFromMethods(
  _table: string,
  _u: unknown,
  _i: unknown,
  _q: unknown,
): Record<string, unknown> {
  return {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('inbox/actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('approveDraftAction (message)', () => {
    it('should send the draft and mark it sent_by_human on success', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        messages: [
          {
            id: 'msg-1',
            organization_id: TEST_ORG_ID,
            conversation_id: 'conv-1',
            body: 'Hello',
            draft_status: 'pending_review',
          },
        ],
        conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
        tenants: [{ id: 'tenant-1', phone_e164: '+15550001111' }],
        organizations: [
          { id: TEST_ORG_ID, odesa_phone_number: '+15559990000' },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      mockSendWithFailover.mockResolvedValue({
        ok: true,
        provider: 'linq',
        providerMessageId: 'mock-id-1',
        attempted: ['linq'],
        failedOver: false,
      });

      const result = await approveDraftAction('message', 'msg-1');

      expect(result.ok).toBe(true);
      expect(mockSendWithFailover).toHaveBeenCalledOnce();
      const call = mockSendWithFailover.mock.calls[0];
      expect(call[1].toE164).toBe('+15550001111');
      expect(call[1].body).toBe('Hello');
      // Draft row should have been updated.
      const draft = admin.tables.messages!.find((m) => m.id === 'msg-1');
      expect(draft).toBeDefined();
      expect(draft!.draft_status).toBe('sent_by_human');
      expect(draft!.provider_message_id).toBe('mock-id-1');
    });

    it('should send exactly once when two approves race (CAS claim)', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        messages: [
          {
            id: 'msg-1',
            organization_id: TEST_ORG_ID,
            conversation_id: 'conv-1',
            body: 'Hello',
            draft_status: 'pending_review',
          },
        ],
        conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
        tenants: [{ id: 'tenant-1', phone_e164: '+15550001111' }],
        organizations: [
          { id: TEST_ORG_ID, odesa_phone_number: '+15559990000' },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      mockSendWithFailover.mockResolvedValue({
        ok: true,
        provider: 'linq',
        providerMessageId: 'mock-id-1',
        attempted: ['linq'],
        failedOver: false,
      });

      const [a, b] = await Promise.all([
        approveDraftAction('message', 'msg-1'),
        approveDraftAction('message', 'msg-1'),
      ]);

      // Exactly one winner, exactly one provider send.
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect(mockSendWithFailover).toHaveBeenCalledOnce();
      const draft = admin.tables.messages!.find((m) => m.id === 'msg-1');
      expect(draft!.draft_status).toBe('sent_by_human');
    });

    it('should return Unauthorized when no signed-in user', async () => {
      stubServerClient({ userId: null });
      const result = await approveDraftAction('message', 'msg-1');
      expect(result).toEqual({ ok: false, error: 'Unauthorized' });
    });

    it.each(['manager', 'va', null])(
      'should return Forbidden for role %s without sending or writing',
      async (role) => {
        stubServerClient();
        const admin = buildAdminStub({
          users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role }],
          messages: [
            {
              id: 'msg-1',
              organization_id: TEST_ORG_ID,
              conversation_id: 'conv-1',
              body: 'Hello',
              draft_status: 'pending_review',
            },
          ],
          conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
          tenants: [{ id: 'tenant-1', phone_e164: '+15550001111' }],
          organizations: [
            { id: TEST_ORG_ID, odesa_phone_number: '+15559990000' },
          ],
        });
        mockCreateAdminClient.mockReturnValue(admin.client);

        const result = await approveDraftAction('message', 'msg-1');

        expect(result).toEqual({ ok: false, error: 'Forbidden' });
        expect(mockSendWithFailover).not.toHaveBeenCalled();
        expect(admin.updateCalls).toHaveLength(0);
        const draft = admin.tables.messages!.find((m) => m.id === 'msg-1');
        expect(draft!.draft_status).toBe('pending_review');
      },
    );

    it('should return Forbidden for a manager approving a proposal draft', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [
          { id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'manager' },
        ],
        action_proposals: [
          {
            id: 'prop-1',
            organization_id: TEST_ORG_ID,
            action_type: 'draft_sms_reply',
            payload: { body: 'Hi tenant' },
            routing: { tenantId: 'tenant-2', conversationId: 'conv-2' },
            status: 'proposed',
            edit_diff: null,
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);

      const result = await approveDraftAction('proposal', 'prop-1');

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockSendWithFailover).not.toHaveBeenCalled();
      expect(admin.updateCalls).toHaveLength(0);
      const proposal = admin.tables.action_proposals!.find(
        (p) => p.id === 'prop-1',
      );
      expect(proposal!.status).toBe('proposed');
    });

    it('should reject cross-org draft access', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        messages: [
          {
            id: 'msg-other',
            organization_id: 'other-org',
            conversation_id: 'conv-other',
            body: 'x',
            draft_status: 'pending_review',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await approveDraftAction('message', 'msg-other');
      expect(result).toEqual({ ok: false, error: 'Forbidden' });
    });

    it('should error when tenant has no phone_e164', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        messages: [
          {
            id: 'msg-1',
            organization_id: TEST_ORG_ID,
            conversation_id: 'conv-1',
            body: 'Hello',
            draft_status: 'pending_review',
          },
        ],
        conversations: [{ id: 'conv-1', tenant_id: 'tenant-1' }],
        tenants: [{ id: 'tenant-1', phone_e164: null }],
        organizations: [
          { id: TEST_ORG_ID, odesa_phone_number: '+15559990000' },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await approveDraftAction('message', 'msg-1');
      expect(result).toEqual({
        ok: false,
        error: 'Tenant missing phone_e164',
      });
      expect(mockSendWithFailover).not.toHaveBeenCalled();
    });
  });

  describe('approveDraftAction (proposal)', () => {
    it('should commit a draft_sms_reply proposal end-to-end', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        action_proposals: [
          {
            id: 'prop-1',
            organization_id: TEST_ORG_ID,
            action_type: 'draft_sms_reply',
            payload: {
              body: 'Hi tenant',
              recipient_phone: '+15550002222',
            },
            routing: {
              tenantId: 'tenant-2',
              conversationId: 'conv-2',
            },
            status: 'proposed',
            edit_diff: null,
          },
        ],
        tenants: [{ id: 'tenant-2', phone_e164: '+15550002222' }],
        organizations: [
          {
            id: TEST_ORG_ID,
            odesa_phone_number: '+15559990000',
            messaging_primary: 'linq',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      mockSendWithFailover.mockResolvedValue({
        ok: true,
        provider: 'linq',
        providerMessageId: 'prop-handle-1',
        attempted: ['linq'],
        failedOver: false,
      });

      const result = await approveDraftAction('proposal', 'prop-1');

      expect(result.ok).toBe(true);
      expect(mockSendWithFailover).toHaveBeenCalledOnce();
      const proposal = admin.tables.action_proposals!.find(
        (p) => p.id === 'prop-1',
      );
      expect(proposal!.status).toBe('committed');
      // Verify a `messages` row was inserted.
      const inserted = admin.insertedRows.find((r) => r.table === 'messages');
      expect(inserted).toBeDefined();
    });

    it('should return error for unsupported action_type', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        action_proposals: [
          {
            id: 'prop-2',
            organization_id: TEST_ORG_ID,
            action_type: 'schedule_repair',
            payload: {},
            routing: {},
            status: 'proposed',
            edit_diff: null,
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await approveDraftAction('proposal', 'prop-2');
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toBe(
        'Unsupported proposal action_type: schedule_repair',
      );
      expect(mockSendWithFailover).not.toHaveBeenCalled();
    });
  });

  describe('rejectDraftAction', () => {
    it('should keep a VA from rejecting a draft before any status write', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [
          { id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'va' },
        ],
        messages: [
          {
            id: 'msg-va',
            organization_id: TEST_ORG_ID,
            draft_status: 'pending_review',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);

      const result = await rejectDraftAction('message', 'msg-va');

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(admin.updateCalls).toHaveLength(0);
      expect(admin.tables.messages?.[0]?.draft_status).toBe('pending_review');
    });

    it('should mark a message draft rejected', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        messages: [
          {
            id: 'msg-3',
            organization_id: TEST_ORG_ID,
            draft_status: 'pending_review',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await rejectDraftAction('message', 'msg-3');
      expect(result.ok).toBe(true);
      const row = admin.tables.messages!.find((m) => m.id === 'msg-3');
      expect(row!.draft_status).toBe('rejected');
    });

    it('should mark a proposal rejected', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        action_proposals: [
          {
            id: 'prop-3',
            organization_id: TEST_ORG_ID,
            action_type: 'draft_sms_reply',
            payload: {},
            routing: {},
            status: 'proposed',
            edit_diff: null,
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await rejectDraftAction('proposal', 'prop-3');
      expect(result.ok).toBe(true);
      const row = admin.tables.action_proposals!.find((p) => p.id === 'prop-3');
      expect(row!.status).toBe('rejected');
      expect(row!.rejected_at).toBeTypeOf('string');
    });
  });

  describe('editDraftAction', () => {
    it('blocks Operations Assistant edits and queue controls before validation or writes', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'va' }],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);

      await expect(editDraftAction('message', 'msg-1', '')).resolves.toEqual({
        ok: false,
        error: 'Forbidden',
      });
      await expect(
        regenerateDraftAction('msg-1', ''),
      ).resolves.toEqual({ ok: false, error: 'Forbidden' });
      await expect(
        snoozeConversationAction('conv-1', null),
      ).resolves.toEqual({ ok: false, error: 'Forbidden' });
      await expect(
        muteConversationAction('conv-1', true),
      ).resolves.toEqual({ ok: false, error: 'Forbidden' });

      expect(admin.updateCalls).toHaveLength(0);
      expect(mockCreateAdminClient).toHaveBeenCalledTimes(4);
    });

    it('should validate body length (too short)', async () => {
      stubServerClient();
      mockCreateAdminClient.mockReturnValue(
        buildAdminStub({
          users: [
            { id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' },
          ],
        }).client,
      );
      const result = await editDraftAction('message', 'msg-1', '');
      expect(result).toEqual({
        ok: false,
        error: 'Body must be 1-2000 characters',
      });
    });

    it('should validate body length (too long)', async () => {
      stubServerClient();
      mockCreateAdminClient.mockReturnValue(
        buildAdminStub({
          users: [
            { id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' },
          ],
        }).client,
      );
      const result = await editDraftAction(
        'message',
        'msg-1',
        'x'.repeat(2001),
      );
      expect(result).toEqual({
        ok: false,
        error: 'Body must be 1-2000 characters',
      });
    });

    it('should update message draft body', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        messages: [
          {
            id: 'msg-4',
            organization_id: TEST_ORG_ID,
            draft_status: 'pending_review',
            body: 'before',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await editDraftAction('message', 'msg-4', 'after edit');
      expect(result.ok).toBe(true);
      const row = admin.tables.messages!.find((m) => m.id === 'msg-4');
      expect(row!.body).toBe('after edit');
      expect(row!.draft_status).toBe('pending_review');
    });

    it('should let a manager edit a draft (draft prep stays open)', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [
          { id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'manager' },
        ],
        messages: [
          {
            id: 'msg-4',
            organization_id: TEST_ORG_ID,
            draft_status: 'pending_review',
            body: 'before',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await editDraftAction('message', 'msg-4', 'after edit');
      expect(result.ok).toBe(true);
      const row = admin.tables.messages!.find((m) => m.id === 'msg-4');
      expect(row!.body).toBe('after edit');
    });

    it('should write proposal edit_diff', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        action_proposals: [
          {
            id: 'prop-edit',
            organization_id: TEST_ORG_ID,
            action_type: 'draft_sms_reply',
            payload: { body: 'orig' },
            routing: {},
            status: 'proposed',
            edit_diff: null,
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await editDraftAction(
        'proposal',
        'prop-edit',
        'new body',
      );
      expect(result.ok).toBe(true);
      const row = admin.tables.action_proposals!.find(
        (p) => p.id === 'prop-edit',
      );
      const diff = row!.edit_diff as Record<string, unknown>;
      expect(diff.body_before).toBe('orig');
      expect(diff.body_after).toBe('new body');
      expect(diff.edited_at).toBeTypeOf('string');
      // Status remains 'proposed'.
      expect(row!.status).toBe('proposed');
    });
  });

  describe('canonical Owner Queue voice drafts', () => {
    it.each([
      ['approve', () => approveDraftAction('message', 'voice-message')],
      ['reject', () => rejectDraftAction('message', 'voice-message')],
      [
        'edit',
        () => editDraftAction('message', 'voice-message', 'edited evidence'),
      ],
      [
        'regenerate',
        () => regenerateDraftAction('voice-message', 'make it warmer'),
      ],
    ] as const)(
      'routes %s to Owner Queue without mutating the evidence row',
      async (_label, invoke) => {
        stubServerClient();
        const admin = buildAdminStub({
          users: [
            {
              id: TEST_USER_ID,
              organization_id: TEST_ORG_ID,
              role: 'owner',
            },
          ],
          messages: [
            {
              id: 'voice-message',
              organization_id: TEST_ORG_ID,
              conversation_id: 'conv-voice',
              body: 'Voice follow-up evidence',
              draft_status: 'pending_review',
              retell_artifact_key: 'retell:call-1:message',
            },
          ],
          action_proposals: [
            {
              id: 'voice-proposal',
              organization_id: TEST_ORG_ID,
              retell_artifact_key: 'retell:call-1:proposal',
              status: 'proposed',
            },
          ],
        });
        mockCreateAdminClient.mockReturnValue(admin.client);

        const result = await invoke();

        expect(result).toEqual({
          ok: false,
          error: 'This draft is reviewed in Owner Queue',
        });
        expect(admin.updateCalls).toHaveLength(0);
        expect(mockSendWithFailover).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['approve', () => approveDraftAction('message', 'voice-message')],
      ['reject', () => rejectDraftAction('message', 'voice-message')],
      [
        'edit',
        () => editDraftAction('message', 'voice-message', 'edited evidence'),
      ],
      [
        'regenerate',
        () => regenerateDraftAction('voice-message', 'make it warmer'),
      ],
    ] as const)(
      'fails closed when %s cannot verify the canonical ledger',
      async (_label, invoke) => {
        stubServerClient();
        const admin = buildAdminStub(
          {
            users: [
              {
                id: TEST_USER_ID,
                organization_id: TEST_ORG_ID,
                role: 'owner',
              },
            ],
            messages: [
              {
                id: 'voice-message',
                organization_id: TEST_ORG_ID,
                conversation_id: 'conv-voice',
                body: 'Voice follow-up evidence',
                draft_status: 'pending_review',
                retell_artifact_key: 'retell:call-1:message',
              },
            ],
          },
          { queryErrorTable: 'action_proposals' },
        );
        mockCreateAdminClient.mockReturnValue(admin.client);

        const result = await invoke();

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('could not be verified');
        expect(admin.updateCalls).toHaveLength(0);
        expect(mockSendWithFailover).not.toHaveBeenCalled();
      },
    );
  });

  describe('loadDraftDetailAction', () => {
    it('should return null when unauthenticated', async () => {
      stubServerClient({ userId: null });
      const result = await loadDraftDetailAction('message', 'msg-1');
      expect(result).toBeNull();
      expect(mockGetDraftDetail).not.toHaveBeenCalled();
    });

    it('should delegate to getDraftDetail when authenticated', async () => {
      stubServerClient();
      mockGetDraftDetail.mockResolvedValue(null);
      const result = await loadDraftDetailAction('message', 'msg-X');
      expect(result).toBeNull();
      expect(mockGetDraftDetail).toHaveBeenCalledOnce();
      expect(mockGetDraftDetail.mock.calls[0][1]).toBe('message');
      expect(mockGetDraftDetail.mock.calls[0][2]).toBe('msg-X');
    });
  });

  // -------------------------------------------------------------------------
  // Wave 4
  // -------------------------------------------------------------------------

  describe('loadConversationAction', () => {
    it('should return null when unauthenticated', async () => {
      stubServerClient({ userId: null });
      const result = await loadConversationAction('conv-1');
      expect(result).toBeNull();
      expect(mockGetConversation).not.toHaveBeenCalled();
    });

    it('should delegate to getConversation when authenticated', async () => {
      stubServerClient();
      mockGetConversation.mockResolvedValue(null);
      const result = await loadConversationAction('conv-X');
      expect(result).toBeNull();
      expect(mockGetConversation).toHaveBeenCalledOnce();
      expect(mockGetConversation.mock.calls[0][1]).toBe('conv-X');
    });
  });

  describe('sendOwnerMessageAction', () => {
    it('should reject empty body', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await sendOwnerMessageAction('conv-1', '   ');
      expect(result).toEqual({
        ok: false,
        error: 'Body must be 1-2000 characters',
      });
    });

    it('should reject overlong body', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await sendOwnerMessageAction(
        'conv-1',
        'x'.repeat(2001),
      );
      expect(result).toEqual({
        ok: false,
        error: 'Body must be 1-2000 characters',
      });
    });

    it.each(['manager', 'va', null])(
      'should return Forbidden for role %s without inserting or sending',
      async (role) => {
        stubServerClient();
        const admin = buildAdminStub({
          users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role }],
          conversations: [
            {
              id: 'conv-1',
              organization_id: TEST_ORG_ID,
              tenant_id: 'tenant-1',
            },
          ],
          tenants: [{ id: 'tenant-1', phone_e164: '+15550001111' }],
          organizations: [
            {
              id: TEST_ORG_ID,
              odesa_phone_number: '+15559990000',
              messaging_primary: 'linq',
            },
          ],
        });
        mockCreateAdminClient.mockReturnValue(admin.client);

        const result = await sendOwnerMessageAction('conv-1', 'Hi there');

        expect(result).toEqual({ ok: false, error: 'Forbidden' });
        expect(mockSendWithFailover).not.toHaveBeenCalled();
        expect(admin.insertedRows).toHaveLength(0);
        expect(admin.updateCalls).toHaveLength(0);
      },
    );

    it('should require authentication', async () => {
      stubServerClient({ userId: null });
      const result = await sendOwnerMessageAction('conv-1', 'Hi');
      expect(result).toEqual({ ok: false, error: 'Unauthorized' });
    });

    it('should reject cross-org conversation access', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        conversations: [
          {
            id: 'conv-other',
            organization_id: 'other-org',
            tenant_id: 'tenant-1',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await sendOwnerMessageAction('conv-other', 'Hi');
      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockSendWithFailover).not.toHaveBeenCalled();
    });

    it('should error when tenant lacks phone_e164', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        conversations: [
          {
            id: 'conv-1',
            organization_id: TEST_ORG_ID,
            tenant_id: 'tenant-1',
          },
        ],
        tenants: [{ id: 'tenant-1', phone_e164: null }],
        organizations: [
          {
            id: TEST_ORG_ID,
            odesa_phone_number: '+15559990000',
            messaging_primary: 'linq',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      const result = await sendOwnerMessageAction('conv-1', 'Hi');
      expect(result).toEqual({
        ok: false,
        error: 'Tenant missing phone_e164',
      });
      expect(mockSendWithFailover).not.toHaveBeenCalled();
    });

    it('should insert and send the outbound, then mark sent_by_human', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        conversations: [
          {
            id: 'conv-1',
            organization_id: TEST_ORG_ID,
            tenant_id: 'tenant-1',
          },
        ],
        tenants: [{ id: 'tenant-1', phone_e164: '+15550001111' }],
        organizations: [
          {
            id: TEST_ORG_ID,
            odesa_phone_number: '+15559990000',
            messaging_primary: 'linq',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      mockSendWithFailover.mockResolvedValue({
        ok: true,
        provider: 'linq',
        providerMessageId: 'mock-handle-X',
        attempted: ['linq'],
        failedOver: false,
      });

      const result = await sendOwnerMessageAction(
        'conv-1',
        'Quick check-in from owner.',
      );
      expect(result.ok).toBe(true);
      expect(mockSendWithFailover).toHaveBeenCalledOnce();
      expect(mockSendWithFailover.mock.calls[0][1]).toMatchObject({
        toE164: '+15550001111',
        fromE164: '+15559990000',
        body: 'Quick check-in from owner.',
      });

      const insertedMsg = admin.insertedRows.find(
        (r) => r.table === 'messages',
      );
      expect(insertedMsg).toBeDefined();
      expect(insertedMsg!.row.draft_status).toBe('sent_by_human');
      expect(insertedMsg!.row.sent_at).toBeTypeOf('string');
      expect(insertedMsg!.row.provider_message_id).toBe('mock-handle-X');
    });

    it('should preserve failed send evidence without re-arming the draft', async () => {
      stubServerClient();
      const admin = buildAdminStub({
        users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
        conversations: [
          {
            id: 'conv-1',
            organization_id: TEST_ORG_ID,
            tenant_id: 'tenant-1',
          },
        ],
        tenants: [{ id: 'tenant-1', phone_e164: '+15550001111' }],
        organizations: [
          {
            id: TEST_ORG_ID,
            odesa_phone_number: '+15559990000',
            messaging_primary: 'linq',
          },
        ],
      });
      mockCreateAdminClient.mockReturnValue(admin.client);
      mockSendWithFailover.mockResolvedValue({
        ok: false,
        attempted: ['linq', 'twilio'],
        errors: [
          { provider: 'linq', error: 'down' },
          { provider: 'twilio', error: 'rate limited' },
        ],
      });

      const result = await sendOwnerMessageAction('conv-1', 'Hello');
      expect(result).toEqual({ ok: false, error: 'All providers failed' });

      const insertedMsg = admin.insertedRows.find(
        (r) => r.table === 'messages',
      );
      expect(insertedMsg).toBeDefined();
      expect(insertedMsg!.row).toMatchObject({
        draft_status: 'rejected',
        delivery_status: 'failed',
        delivery_error: 'All providers rejected the send',
      });
    });
  });
});
