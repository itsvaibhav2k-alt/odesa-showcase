/**
 * Unit tests for `POST /api/action-proposals/[id]/commit` — the role gate.
 *
 * The route resolves the caller's role from `public.users` and passes a
 * `{ kind: 'user', role }` actor into the inbox `commitProposal`
 * primitive, which fails closed BEFORE the CAS claim / message insert /
 * provider send. manager/va get a 403 with zero side effects; owners
 * send as before. The real primitive runs against an in-memory admin
 * stub — only the module boundaries are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/messaging/send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWithFailover } from '@/lib/messaging/send-with-failover';

import { POST } from '../[id]/commit/route';

const mockServer = vi.mocked(createServerClient);
const mockAdmin = vi.mocked(createAdminClient);
const mockSend = vi.mocked(sendWithFailover);

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const PROPOSAL_ID = 'prop-1';

function stubServerClient(): void {
  mockServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

interface Tables {
  users: Array<Record<string, unknown>>;
  action_proposals: Array<Record<string, unknown>>;
  tenants: Array<Record<string, unknown>>;
  organizations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
}

/**
 * Minimal in-memory admin stub covering the chains the route + the inbox
 * commitProposal use (reads, CAS claim, plain updates, message insert).
 */
function stubAdminClient(role: string | null) {
  const tables: Tables = {
    users: [{ id: USER_ID, organization_id: ORG_ID, role }],
    action_proposals: [
      {
        id: PROPOSAL_ID,
        organization_id: ORG_ID,
        action_type: 'draft_sms_reply',
        payload: { body: 'Hi tenant', recipient_phone: '+15550002222' },
        routing: { tenantId: 'tenant-1', conversationId: 'conv-1' },
        status: 'proposed',
        edit_diff: null,
      },
    ],
    tenants: [{ id: 'tenant-1', phone_e164: '+15550002222' }],
    organizations: [
      {
        id: ORG_ID,
        odesa_phone_number: '+15559990000',
        messaging_primary: 'linq',
      },
    ],
    messages: [],
  };
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  let seq = 0;

  const client = {
    from: (tableName: keyof Tables) => {
      const predicates: Array<{ col: string; value: unknown }> = [];
      const rows = () =>
        (tables[tableName] ?? []).filter((r) =>
          predicates.every((p) => r[p.col] === p.value),
        );
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          predicates.push({ col, value });
          return chain;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        update: (patch: Record<string, unknown>) => {
          const applyPatch = () => {
            const matched = rows();
            matched.forEach((r) => Object.assign(r, patch));
            return matched;
          };
          const updateChain: Record<string, unknown> = {
            eq: (col: string, value: unknown) => {
              predicates.push({ col, value });
              return updateChain;
            },
            select: () => updateChain,
            maybeSingle: async () => ({
              data: applyPatch()[0] ?? null,
              error: null,
            }),
            single: async () => ({
              data: applyPatch()[0] ?? null,
              error: null,
            }),
            then(resolve: (value: { error: null }) => unknown) {
              applyPatch();
              return Promise.resolve(resolve({ error: null }));
            },
          };
          return updateChain;
        },
        insert: (row: Record<string, unknown>) => {
          seq += 1;
          const persisted = { id: `gen-${seq}`, ...row };
          tables[tableName].push(persisted);
          inserted.push({ table: tableName, row: persisted });
          return {
            select: () => ({
              single: async () => ({ data: { id: persisted.id }, error: null }),
            }),
          };
        },
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createAdminClient>;

  return { client, tables, inserted };
}

function post(): ReturnType<typeof POST> {
  return POST({} as NextRequest, {
    params: Promise.resolve({ id: PROPOSAL_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSend.mockResolvedValue({
    ok: true,
    provider: 'linq',
    providerMessageId: 'mock-1',
    attempted: ['linq'],
    failedOver: false,
  });
});

describe('POST /api/action-proposals/[id]/commit', () => {
  it.each(['manager', 'va', null])(
    'should return 403 Forbidden for role %s with zero side effects',
    async (role) => {
      stubServerClient();
      const { client, tables, inserted } = stubAdminClient(role);
      mockAdmin.mockReturnValue(client);

      const res = await post();
      const body = (await res.json()) as { success: boolean; error?: string };

      expect(res.status).toBe(403);
      expect(body).toEqual({ success: false, error: 'Forbidden' });
      // Zero side effects: no claim, no message row, no provider send.
      expect(tables.action_proposals[0].status).toBe('proposed');
      expect(inserted.filter((r) => r.table === 'messages')).toHaveLength(0);
      expect(mockSend).not.toHaveBeenCalled();
    },
  );

  it('should commit and send for role owner', async () => {
    stubServerClient();
    const { client, tables } = stubAdminClient('owner');
    mockAdmin.mockReturnValue(client);

    const res = await post();
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(tables.action_proposals[0].status).toBe('committed');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
