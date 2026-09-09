/**
 * Unit tests for the proposals MCP `commit_proposal` role gate.
 *
 * The dispatcher resolves the requesting user's role once and threads a
 * human commit actor into this tool. Non-owners fail closed before any
 * proposal lookup or CAS claim; a missing role is never a system bypass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/messaging/notify', () => ({
  notifyTenant: vi.fn(),
}));

import { notifyTenant } from '@/lib/messaging/notify';

import { createProposalsMcp } from '../proposals';
import type { OrganizationContext } from '../../org-context';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const mockNotify = vi.mocked(notifyTenant);

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const PROPOSAL_ID = 'prop-1';

// ---------------------------------------------------------------------------
// MCP harness — mirrors the pattern in `scheduling.test.ts`.
// ---------------------------------------------------------------------------

interface ToolDefShape {
  name?: string;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;
}
interface McpServerShape {
  instance?: { _registeredTools?: Record<string, ToolDefShape> };
  tools?: ToolDefShape[];
}

function getHandler(server: unknown, name: string): ToolDefShape['handler'] {
  const s = server as McpServerShape;
  return (
    s.instance?._registeredTools?.[name]?.handler ??
    s.tools?.find((t) => t.name === name)?.handler ??
    (() => {
      throw new Error(`${name} handler not found`);
    })()
  );
}

function makeOrgContext(): OrganizationContext {
  return {
    organization: { id: ORG_ID, name: 'Galaxy Estates', assistantName: 'Odesa' },
    properties: [],
    loadedAt: '2026-07-09T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Admin stub: assertOwnership read + users role read + real commitProposal
// (action_proposals load / CAS claim / finalize).
// ---------------------------------------------------------------------------

function proposalRow(status: string): Record<string, unknown> {
  return {
    id: PROPOSAL_ID,
    organization_id: ORG_ID,
    property_id: 'property-1',
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
    routing: { tenantId: 'tenant-1', conversationId: 'conv-1' },
  };
}

function buildAdmin(opts: { userRow: { role: string | null } | null }) {
  const claimCalls: Array<Record<string, unknown>> = [];

  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.userRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'action_proposals') {
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
      }
      throw new Error(`unexpected from(${table})`);
    }),
  } as unknown as SupabaseClient<Database>;

  return { admin, claimCalls };
}

function makeCommitHandler(opts: { userRow: { role: string | null } | null }) {
  const { admin, claimCalls } = buildAdmin(opts);
  const rawRole = opts.userRow?.role;
  const role =
    rawRole === 'owner' || rawRole === 'manager' || rawRole === 'va'
      ? rawRole
      : null;
  const server = createProposalsMcp({
    admin,
    organizationId: ORG_ID,
    orgContext: makeOrgContext(),
    userId: USER_ID,
    commitActor: { kind: 'user', role },
    decisionAuthority: 'confirmed_human',
  });
  return {
    admin,
    commit: getHandler(server, 'commit_proposal'),
    reject: getHandler(server, 'reject_proposal'),
    claimCalls,
  };
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

describe('proposals MCP commit_proposal', () => {
  it.each(['manager', 'va', null])(
    'should route role %s to owner approval with zero side effects',
    async (role) => {
      const { admin, commit, claimCalls } = makeCommitHandler({
        userRow: { role },
      });

      const result = await commit({ proposalId: PROPOSAL_ID }, {});

      expect(result.content[0]?.text).toMatch(/Owner approval is required/i);
      expect(result.content[0]?.text).not.toContain('Committed');
      expect(admin.from).not.toHaveBeenCalled();
      expect(claimCalls).toHaveLength(0);
      expect(mockNotify).not.toHaveBeenCalled();
    },
  );

  it('should treat a missing users row as owner-gated (never system)', async () => {
    const { admin, commit, claimCalls } = makeCommitHandler({ userRow: null });

    const result = await commit({ proposalId: PROPOSAL_ID }, {});

    expect(result.content[0]?.text).toMatch(/Owner approval is required/i);
    expect(admin.from).not.toHaveBeenCalled();
    expect(claimCalls).toHaveLength(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('should prevent a VA from rejecting a proposal without a DB lookup', async () => {
    const { admin, reject, claimCalls } = makeCommitHandler({
      userRow: { role: 'va' },
    });

    const result = await reject(
      { proposalId: PROPOSAL_ID, reason: 'not mine to decide' },
      {},
    );

    expect(result.content[0]?.text).toMatch(/Owner approval is required/i);
    expect(result.content[0]?.text).not.toContain('Rejected proposal');
    expect(admin.from).not.toHaveBeenCalled();
    expect(claimCalls).toHaveLength(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('should commit and send for role owner', async () => {
    const { commit, claimCalls } = makeCommitHandler({
      userRow: { role: 'owner' },
    });

    const result = await commit({ proposalId: PROPOSAL_ID }, {});

    expect(result.content[0]?.text).toBe('The reviewed decision is committed.');
    expect(result.content[0]?.text).not.toContain(PROPOSAL_ID);
    expect(claimCalls).toEqual([{ status: 'committing' }]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});
