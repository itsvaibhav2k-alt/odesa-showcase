/**
 * Unit tests for the operator-chat `commitProposalAction` role gate.
 *
 * The action threads a `{ kind: 'user', role }` actor into the shared
 * `commitProposal` primitive, which fails closed BEFORE the CAS claim:
 * manager/va (and unknown roles) get Forbidden with zero side effects;
 * owners commit as before. The real primitive runs against a scripted
 * admin client — only the module boundaries (supabase clients, tenant
 * notify, next/cache) are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/messaging/notify', () => ({
  notifyTenant: vi.fn(),
}));

vi.mock('@/lib/agent/proposals/outcome', () => ({
  recordOutcome: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyTenant } from '@/lib/messaging/notify';
import { recordOutcome } from '@/lib/agent/proposals/outcome';

import { commitProposalAction, rejectProposalAction } from '../actions';

const mockServer = vi.mocked(createServerClient);
const mockAdmin = vi.mocked(createAdminClient);
const mockNotify = vi.mocked(notifyTenant);
const mockRecordOutcome = vi.mocked(recordOutcome);

const USER_ID = 'user-1';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const TENANT_ID = '44444444-4444-4444-8444-444444444444';

function proposalRow(status: string): Record<string, unknown> {
  return {
    id: PROPOSAL_ID,
    organization_id: ORG_ID,
    property_id: PROPERTY_ID,
    worker_model: 'haiku-4-5',
    action_type: 'draft_sms_reply',
    payload: { body: 'hello there', tone: 'warm' },
    reasoning: 'tenant asked rent total',
    confidence: 0.9,
    context_fact_ids: [],
    gate_decision: 'review',
    status,
    created_at: '2026-07-01T12:00:00.000Z',
    committed_at: null,
    rejected_at: null,
    edit_diff: null,
    outcome: null,
    routing: { tenantId: TENANT_ID, conversationId: 'conv-1' },
  };
}

/** SSR client: auth + users role lookup + assertProposalInOrg read. */
function stubServerClient(role: string | null): void {
  mockServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { organization_id: ORG_ID, role },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'action_proposals') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: PROPOSAL_ID,
                  organization_id: ORG_ID,
                  property_id: PROPERTY_ID,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected server from(${table})`);
    }),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

/** Admin client driving the real commitProposal: load + CAS claim + finalize. */
function stubAdminClient() {
  const claimCalls: Array<Record<string, unknown>> = [];

  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'action_proposals') {
        throw new Error(`unexpected admin from(${table})`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: proposalRow('proposed'),
              error: null,
            }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          const isClaim = values.status === 'committing';
          if (isClaim) claimCalls.push(values);
          const respond = async () => ({
            data: proposalRow(isClaim ? 'committing' : 'committed'),
            error: null,
          });
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({ maybeSingle: respond, single: respond }),
              }),
            }),
          };
        },
      };
    }),
  } as unknown as ReturnType<typeof createAdminClient>;

  return { client, claimCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNotify.mockResolvedValue({
    ok: true,
    conversationId: 'conv-1',
    messageId: 'm1',
    provider: 'linq',
    failedOver: false,
    error: null,
  });
});

describe('commitProposalAction', () => {
  it.each(['manager', 'va', null])(
    'should return Forbidden for role %s with zero side effects',
    async (role) => {
      stubServerClient(role);
      const { client, claimCalls } = stubAdminClient();
      mockAdmin.mockReturnValue(client);

      const result = await commitProposalAction({ proposalId: PROPOSAL_ID });

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      // No CAS claim, no status write, no tenant send.
      expect(claimCalls).toHaveLength(0);
      expect(mockNotify).not.toHaveBeenCalled();
    },
  );

  it('should commit and send for role owner', async () => {
    stubServerClient('owner');
    const { client, claimCalls } = stubAdminClient();
    mockAdmin.mockReturnValue(client);

    const result = await commitProposalAction({ proposalId: PROPOSAL_ID });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('committed');
    }
    expect(claimCalls).toEqual([{ status: 'committing' }]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});

describe('rejectProposalAction', () => {
  it('should return Forbidden for a VA before any proposal write', async () => {
      stubServerClient('va');

      const result = await rejectProposalAction({
        proposalId: PROPOSAL_ID,
        reason: 'owner should decide',
      });

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(mockAdmin).not.toHaveBeenCalled();
      expect(mockRecordOutcome).not.toHaveBeenCalled();
  });

  it('should let an owner record the rejection after the ownership check', async () => {
    stubServerClient('owner');
    const { client } = stubAdminClient();
    mockAdmin.mockReturnValue(client);
    mockRecordOutcome.mockResolvedValue({} as never);

    const result = await rejectProposalAction({
      proposalId: PROPOSAL_ID,
      reason: 'wrong tone',
    });

    expect(result).toEqual({
      success: true,
      data: { proposalId: PROPOSAL_ID },
    });
    expect(mockRecordOutcome).toHaveBeenCalledWith(client, {
      proposalId: PROPOSAL_ID,
      outcome: { kind: 'rejected', reason: 'wrong tone' },
      outcomeMeta: {
        rejected_by: USER_ID,
        channel: 'operator_chat_web',
      },
    });
  });
});
