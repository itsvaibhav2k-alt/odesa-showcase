/**
 * Unit tests for the compose-to-tenant server action.
 *
 * `composeToTenantAction` crosses the same three boundaries as the
 * sibling `actions.ts` suite (SSR auth client, admin client, provider
 * send) plus the find-or-create conversation resolver in
 * `lib/inbox/compose.ts`, which runs UNMOCKED against the admin stub so
 * the reuse-vs-create branch is exercised for real.
 *
 * Stub idiom mirrors `actions.test.ts`; the query chain additionally
 * supports `.order().limit()` (no-ops over the in-memory rows) because
 * the open-conversation lookup uses them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { composeToTenantAction } from '../compose-actions';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockSendWithFailover = vi.mocked(sendWithFailover);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
const TEST_TENANT_ID = 'tenant-1';

// ---------------------------------------------------------------------------
// Server-client stub (auth gate)
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
// Admin-client stub (in-memory tables)
// ---------------------------------------------------------------------------

interface AdminTables {
  users?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  conversations?: Array<Record<string, unknown>>;
  tenants?: Array<Record<string, unknown>>;
  organizations?: Array<Record<string, unknown>>;
}

interface AdminStub {
  tables: AdminTables;
  client: ReturnType<typeof createAdminClient>;
  insertedRows: Array<{ table: string; row: Record<string, unknown> }>;
}

let idSeq = 0;

function buildAdminStub(initial: AdminTables): AdminStub {
  const tables: AdminTables = {
    users: initial.users ? [...initial.users] : [],
    messages: initial.messages ? [...initial.messages] : [],
    conversations: initial.conversations ? [...initial.conversations] : [],
    tenants: initial.tenants ? [...initial.tenants] : [],
    organizations: initial.organizations ? [...initial.organizations] : [],
  };
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
      // No-ops over the in-memory rows: the open-conversation lookup
      // orders by last_message_at and limits to 1; filtering above plus
      // first-row selection below is behaviour-equivalent for tests.
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        const result = apply()[0] ?? null;
        return Promise.resolve({ data: result, error: null });
      },
      single() {
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
        return matched;
      };
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
      const id = (row.id as string | undefined) ?? `gen-${++idSeq}`;
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
    from: (table: keyof AdminTables) => {
      const queryChain = makeQuery(table);
      return {
        ...queryChain,
        update: makeUpdate(table),
        insert: makeInsert(table),
        select: queryChain.select as () => unknown,
      };
    },
  } as unknown as ReturnType<typeof createAdminClient>;

  return { tables, client, insertedRows };
}

/** Baseline org + tenant + caller rows shared by the happy paths. */
function baselineTables(): AdminTables {
  return {
    users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
    tenants: [
      {
        id: TEST_TENANT_ID,
        organization_id: TEST_ORG_ID,
        phone_e164: '+15550001111',
      },
    ],
    organizations: [
      {
        id: TEST_ORG_ID,
        odesa_phone_number: '+15559990000',
        messaging_primary: 'linq',
      },
    ],
  };
}

function stubProviderOk(): void {
  mockSendWithFailover.mockResolvedValue({
    ok: true,
    provider: 'linq',
    providerMessageId: 'mock-handle-1',
    attempted: ['linq'],
    failedOver: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('composeToTenantAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['manager', 'va', null])(
    'should return Forbidden for role %s before creating any conversation',
    async (role) => {
      stubServerClient();
      const tables = baselineTables();
      tables.users = [
        { id: TEST_USER_ID, organization_id: TEST_ORG_ID, role },
      ];
      const admin = buildAdminStub(tables);
      mockCreateAdminClient.mockReturnValue(admin.client);

      const result = await composeToTenantAction(TEST_TENANT_ID, 'Hi Maya.');

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockSendWithFailover).not.toHaveBeenCalled();
      expect(admin.insertedRows).toHaveLength(0);
    },
  );

  it('should create a new open conversation and send when tenant has none', async () => {
    stubServerClient();
    const admin = buildAdminStub(baselineTables());
    mockCreateAdminClient.mockReturnValue(admin.client);
    stubProviderOk();

    const result = await composeToTenantAction(TEST_TENANT_ID, 'Hi Maya — quick heads up.');

    expect(result.ok).toBe(true);

    // A conversation row was created with the inbound pipeline's shape.
    const conv = admin.insertedRows.find((r) => r.table === 'conversations');
    expect(conv).toBeDefined();
    expect(conv!.row).toMatchObject({
      organization_id: TEST_ORG_ID,
      tenant_id: TEST_TENANT_ID,
      channel: 'sms',
      status: 'open',
    });

    // The message landed in that conversation and was promoted.
    const msg = admin.insertedRows.find((r) => r.table === 'messages');
    expect(msg).toBeDefined();
    expect(msg!.row.conversation_id).toBe(conv!.row.id);
    expect(msg!.row.draft_status).toBe('sent_by_human');
    expect(msg!.row.provider_message_id).toBe('mock-handle-1');

    expect(mockSendWithFailover).toHaveBeenCalledOnce();
    expect(mockSendWithFailover.mock.calls[0][1]).toMatchObject({
      toE164: '+15550001111',
      fromE164: '+15559990000',
      body: 'Hi Maya — quick heads up.',
    });

    if (result.ok) {
      expect(result.data?.conversationId).toBe(conv!.row.id);
      expect(result.data?.messageId).toBe(msg!.row.id);
    }
  });

  it('should reuse the existing open conversation instead of creating one', async () => {
    stubServerClient();
    const admin = buildAdminStub({
      ...baselineTables(),
      conversations: [
        {
          id: 'conv-open',
          organization_id: TEST_ORG_ID,
          tenant_id: TEST_TENANT_ID,
          channel: 'sms',
          status: 'open',
          last_message_at: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
    mockCreateAdminClient.mockReturnValue(admin.client);
    stubProviderOk();

    const result = await composeToTenantAction(TEST_TENANT_ID, 'Following up.');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.conversationId).toBe('conv-open');
    }

    // No second conversation row.
    const convInserts = admin.insertedRows.filter(
      (r) => r.table === 'conversations',
    );
    expect(convInserts).toHaveLength(0);

    const msg = admin.insertedRows.find((r) => r.table === 'messages');
    expect(msg).toBeDefined();
    expect(msg!.row.conversation_id).toBe('conv-open');
    expect(msg!.row.draft_status).toBe('sent_by_human');
  });

  it('should not reuse a closed conversation', async () => {
    stubServerClient();
    const admin = buildAdminStub({
      ...baselineTables(),
      conversations: [
        {
          id: 'conv-closed',
          organization_id: TEST_ORG_ID,
          tenant_id: TEST_TENANT_ID,
          channel: 'sms',
          status: 'closed',
          last_message_at: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
    mockCreateAdminClient.mockReturnValue(admin.client);
    stubProviderOk();

    const result = await composeToTenantAction(TEST_TENANT_ID, 'New thread please.');

    expect(result.ok).toBe(true);
    const convInsert = admin.insertedRows.find(
      (r) => r.table === 'conversations',
    );
    expect(convInsert).toBeDefined();
    if (result.ok) {
      expect(result.data?.conversationId).toBe(convInsert!.row.id);
      expect(result.data?.conversationId).not.toBe('conv-closed');
    }
  });

  it('should persist failed evidence without re-arming the outbound intent', async () => {
    stubServerClient();
    const admin = buildAdminStub(baselineTables());
    mockCreateAdminClient.mockReturnValue(admin.client);
    mockSendWithFailover.mockResolvedValue({
      ok: false,
      attempted: ['linq', 'twilio'],
      errors: [
        { provider: 'linq', error: 'down' },
        { provider: 'twilio', error: 'rate limited' },
      ],
    });

    const result = await composeToTenantAction(TEST_TENANT_ID, 'Hello');

    expect(result).toEqual({ ok: false, error: 'All providers failed' });
    expect(mockSendWithFailover).toHaveBeenCalledOnce();

    // The failed attempt remains durable evidence, but is not presented as
    // approved or blindly re-armed for another send.
    const msg = admin.insertedRows.find((r) => r.table === 'messages');
    expect(msg).toBeDefined();
    expect(msg!.row).toMatchObject({
      draft_status: 'rejected',
      delivery_status: 'failed',
      delivery_error: 'All providers rejected the send',
      sent_at: null,
    });
    expect(msg!.row.draft_status).not.toBe('sent_by_human');
    expect(msg!.row.provider_message_id).toBeUndefined();
    const conv = admin.insertedRows.find((r) => r.table === 'conversations');
    expect(conv).toBeDefined();
    expect(msg!.row.conversation_id).toBe(conv!.row.id);
  });

  it('should require authentication', async () => {
    stubServerClient({ userId: null });
    const result = await composeToTenantAction(TEST_TENANT_ID, 'Hi');
    expect(result).toEqual({ ok: false, error: 'Unauthorized' });
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('should reject an empty body without writing rows', async () => {
    stubServerClient();
    const admin = buildAdminStub(baselineTables());
    mockCreateAdminClient.mockReturnValue(admin.client);

    const result = await composeToTenantAction(TEST_TENANT_ID, '   ');

    expect(result).toEqual({
      ok: false,
      error: 'Body must be 1-2000 characters',
    });
    expect(admin.insertedRows).toHaveLength(0);
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('should reject an overlong body', async () => {
    stubServerClient();
    const admin = buildAdminStub(baselineTables());
    mockCreateAdminClient.mockReturnValue(admin.client);

    const result = await composeToTenantAction(TEST_TENANT_ID, 'x'.repeat(2001));

    expect(result).toEqual({
      ok: false,
      error: 'Body must be 1-2000 characters',
    });
    expect(admin.insertedRows).toHaveLength(0);
  });

  it('should return error for an unknown tenant', async () => {
    stubServerClient();
    const admin = buildAdminStub({
      users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
    });
    mockCreateAdminClient.mockReturnValue(admin.client);

    const result = await composeToTenantAction('tenant-missing', 'Hi');

    expect(result).toEqual({ ok: false, error: 'Tenant not found' });
    expect(admin.insertedRows).toHaveLength(0);
  });

  it('should reject a cross-org tenant', async () => {
    stubServerClient();
    const admin = buildAdminStub({
      users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
      tenants: [
        {
          id: 'tenant-other',
          organization_id: 'other-org',
          phone_e164: '+15550002222',
        },
      ],
    });
    mockCreateAdminClient.mockReturnValue(admin.client);

    const result = await composeToTenantAction('tenant-other', 'Hi');

    expect(result).toEqual({ ok: false, error: 'Forbidden' });
    expect(admin.insertedRows).toHaveLength(0);
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('should error before creating a conversation when tenant has no phone', async () => {
    stubServerClient();
    const admin = buildAdminStub({
      users: [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID, role: 'owner' }],
      tenants: [
        {
          id: TEST_TENANT_ID,
          organization_id: TEST_ORG_ID,
          phone_e164: null,
        },
      ],
    });
    mockCreateAdminClient.mockReturnValue(admin.client);

    const result = await composeToTenantAction(TEST_TENANT_ID, 'Hi');

    expect(result).toEqual({ ok: false, error: 'Tenant missing phone_e164' });
    // No orphan conversation for an unreachable tenant.
    expect(admin.insertedRows).toHaveLength(0);
  });
});
