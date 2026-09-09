/**
 * Unit tests for the proposals MCP. Mocks the wrapped commit/outcome
 * helpers and the admin client's chainable surface. Focus is on the
 * MCP wrapper boundaries:
 *   - propertyName-based property resolution (via orgContext)
 *   - org-wide listing when propertyName is omitted
 *   - ownership assertion (org scope)
 *   - happy paths for list/commit/reject
 *   - error pass-through for the helpers
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProposalsMcp,
  type CreateProposalsMcpDeps,
} from '../../mcps/proposals';
import type { OrganizationContext } from '../../org-context';
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/agent/proposals/commit', () => ({
  commitProposal: vi.fn(),
}));

vi.mock('@/lib/agent/proposals/outcome', () => ({
  recordOutcome: vi.fn(),
}));

import { commitProposal } from '@/lib/agent/proposals/commit';
import { recordOutcome } from '@/lib/agent/proposals/outcome';

const mockCommitProposal = vi.mocked(commitProposal);
const mockRecordOutcome = vi.mocked(recordOutcome);

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
    organization: { id: 'org-1', name: 'Galaxy Estates', assistantName: 'Odesa' },
    properties: [
      {
        id: 'prop-1',
        name: 'Oakwood Commons',
        address: '100 Oak St',
        timezone: 'America/New_York',
        autonomyLevel: 0.5,
        privacyMode: 'hosted',
      },
      {
        id: 'prop-2',
        name: 'Galaxy Lofts',
        address: '200 Loft Ave',
        timezone: 'America/New_York',
        autonomyLevel: 0.4,
        privacyMode: 'anonymous',
      },
    ],
    loadedAt: '2026-05-04T00:00:00Z',
  };
}

interface AdminScript {
  /** Rows returned from list_proposals lookup. */
  list?: { data: unknown[] | null; error: { message: string } | null };
  /** Row returned from ownership check (.maybeSingle()). */
  lookup?: {
    data: { id: string; organization_id: string } | null;
    error: { message: string } | null;
  };
}

function makeAdmin(script: AdminScript): SupabaseClient<Database> {
  const limit = vi.fn(async () => script.list ?? { data: [], error: null });
  const order = vi.fn(() => ({ limit }));
  const maybeSingle = vi.fn(async () =>
    script.lookup ?? { data: null, error: null },
  );
  // Ownership: from(...).select(...).eq(id).maybeSingle()
  // List:      from(...).select(...).eq(org).[eq(prop)].eq(status).order().limit()
  const eq = vi.fn(function chain(this: unknown) {
    return { eq, order, maybeSingle };
  }) as ReturnType<typeof vi.fn>;
  const select = vi.fn(() => ({ eq, maybeSingle }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as SupabaseClient<Database>;
}

function deps(
  overrides: Partial<CreateProposalsMcpDeps> = {},
): CreateProposalsMcpDeps {
  return {
    admin: makeAdmin({}),
    organizationId: 'org-1',
    orgContext: makeOrgContext(),
    userId: 'user-1',
    commitActor: { kind: 'user', role: 'owner' },
    decisionAuthority: 'confirmed_human',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list_proposals', () => {
  it('should list proposals for a resolved propertyName', async () => {
    const admin = makeAdmin({
      list: {
        data: [
          {
            id: 'p1',
            action_type: 'draft_sms_reply',
            gate_decision: 'review',
            confidence: 0.7,
            reasoning: 'late on rent',
            payload: { body: 'hi', tone: 'firm' },
            property_id: 'prop-1',
            status: 'proposed',
            created_at: '2026-05-01T00:00:00Z',
          },
        ],
        error: null,
      },
    });
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'list_proposals');
    const res = await handler({ propertyName: 'Oakwood' }, {});
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<
      Record<string, unknown>
    >;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      action: 'Tenant reply draft',
      property: 'Oakwood Commons',
      status: 'Awaiting Owner Queue review',
      createdAt: '2026-05-01T00:00:00Z',
    });
    expect(res.content[0]?.text).not.toContain('p1');
    expect(res.content[0]?.text).not.toContain('draft_sms_reply');
  });

  it('should list proposals without propertyName (org-wide, capped at 50)', async () => {
    const admin = makeAdmin({
      list: {
        data: [
          { id: 'p1', action_type: 'draft_sms_reply', property_id: 'prop-1', status: 'proposed', created_at: '2026-05-01T00:00:00Z' },
          { id: 'p2', action_type: 'dispatch_vendor', property_id: 'prop-2', status: 'proposed', created_at: '2026-05-02T00:00:00Z' },
        ],
        error: null,
      },
    });
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'list_proposals');
    // No propertyName → org-wide path.
    const res = await handler({}, {});
    const parsed = JSON.parse(res.content[0]?.text ?? '[]') as Array<{
      action: string;
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.action)).toEqual([
      'Tenant reply draft',
      'Vendor dispatch',
    ]);
    expect(res.content[0]?.text).not.toMatch(/\bp[12]\b/);
  });

  it('should return clarification string when propertyName matches none', async () => {
    const server = createProposalsMcp(deps());
    const handler = getHandler(server, 'list_proposals');
    const res = await handler({ propertyName: 'unknown place' }, {});
    expect(res.content[0]?.text).toMatch(/No property/i);
  });

  it('should return clarification string when propertyName matches multiple', async () => {
    const server = createProposalsMcp(deps());
    const handler = getHandler(server, 'list_proposals');
    // 'a' matches both 'Oakwood Commons' and 'Galaxy Lofts'
    const res = await handler({ propertyName: 'a' }, {});
    expect(res.content[0]?.text).toMatch(/Multiple properties/i);
  });

  it('should surface DB errors as a list_proposals-failed message', async () => {
    const admin = makeAdmin({
      list: { data: null, error: { message: 'boom' } },
    });
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'list_proposals');
    const res = await handler({ status: 'committed', propertyName: 'Oakwood' }, {});
    expect(res.content[0]?.text).toContain('list_proposals failed');
  });
});

describe('commit_proposal', () => {
  it('should call commitProposal on org-ownership-valid input', async () => {
    const admin = makeAdmin({
      lookup: {
        data: { id: 'p1', organization_id: 'org-1' },
        error: null,
      },
    });
    mockCommitProposal.mockResolvedValue({
      proposal: { id: 'p1', status: 'committed' } as never,
      dispatch: { kind: 'sms' } as never,
      changed: true,
    });
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'commit_proposal');
    const res = await handler({ proposalId: 'p1' }, {});
    expect(mockCommitProposal).toHaveBeenCalledWith(admin, 'p1', {
      kind: 'user',
      role: 'owner',
    });
    expect(res.content[0]?.text).toBe('The reviewed decision is committed.');
    expect(res.content[0]?.text).not.toContain('p1');
    expect(res.content[0]?.text).not.toContain('sms');
  });

  it('should reject cross-org proposalId', async () => {
    const admin = makeAdmin({
      lookup: {
        data: { id: 'p1', organization_id: 'OTHER-org' },
        error: null,
      },
    });
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'commit_proposal');
    const res = await handler({ proposalId: 'p1' }, {});
    expect(mockCommitProposal).not.toHaveBeenCalled();
    expect(res.content[0]?.text).toBe('That proposal was not found.');
  });

  it('should return not-found message when proposal lookup is empty', async () => {
    const admin = makeAdmin({ lookup: { data: null, error: null } });
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'commit_proposal');
    const res = await handler({ proposalId: 'missing' }, {});
    expect(res.content[0]?.text).toContain('not found');
  });

  it('should surface commitProposal errors', async () => {
    const admin = makeAdmin({
      lookup: {
        data: { id: 'p1', organization_id: 'org-1' },
        error: null,
      },
    });
    mockCommitProposal.mockRejectedValue(new Error('blocked'));
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'commit_proposal');
    const res = await handler({ proposalId: 'p1' }, {});
    expect(res.content[0]?.text).toContain('could not be completed');
    expect(res.content[0]?.text).not.toContain('blocked');
  });
});

describe('reject_proposal', () => {
  it('should call recordOutcome with rejected kind + reason metadata', async () => {
    const admin = makeAdmin({
      lookup: {
        data: { id: 'p1', organization_id: 'org-1' },
        error: null,
      },
    });
    mockRecordOutcome.mockResolvedValue({} as never);
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'reject_proposal');
    const res = await handler(
      { proposalId: 'p1', reason: 'wrong tone' },
      {},
    );
    expect(mockRecordOutcome).toHaveBeenCalledWith(admin, {
      proposalId: 'p1',
      outcome: { kind: 'rejected', reason: 'wrong tone' },
      outcomeMeta: { rejected_by: 'user-1', channel: 'operator_chat' },
    });
    expect(res.content[0]?.text).toBe('The reviewed decision was declined.');
    expect(res.content[0]?.text).not.toContain('p1');
  });

  it('should surface recordOutcome failures', async () => {
    const admin = makeAdmin({
      lookup: {
        data: { id: 'p1', organization_id: 'org-1' },
        error: null,
      },
    });
    mockRecordOutcome.mockRejectedValue(new Error('outcome write failed'));
    const server = createProposalsMcp(deps({ admin }));
    const handler = getHandler(server, 'reject_proposal');
    const res = await handler({ proposalId: 'p1' }, {});
    expect(res.content[0]?.text).toContain('could not be declined');
  });

  it('keeps rejection owner-only', async () => {
    const admin = makeAdmin({
      lookup: {
        data: { id: 'p1', organization_id: 'org-1' },
        error: null,
      },
    });
    mockRecordOutcome.mockResolvedValue({} as never);
    const server = createProposalsMcp(
      deps({
        admin,
        commitActor: { kind: 'user', role: 'manager' },
      }),
    );
    const handler = getHandler(server, 'reject_proposal');

    const res = await handler(
      { proposalId: 'p1', reason: 'manager review' },
      {},
    );

    expect(mockRecordOutcome).not.toHaveBeenCalled();
    expect(res.content[0]?.text).toContain('Owner approval is required');
  });

  it.each(['commit_proposal', 'reject_proposal'] as const)(
    'keeps dispatcher authority inspection-only for %s even when the actor is owner',
    async (toolName) => {
      const admin = makeAdmin({});
      const server = createProposalsMcp(
        deps({ admin, decisionAuthority: 'inspection_only' }),
      );
      const handler = getHandler(server, toolName);

      const res = await handler({ proposalId: 'private-id' }, {});

      expect(admin.from).not.toHaveBeenCalled();
      expect(mockCommitProposal).not.toHaveBeenCalled();
      expect(mockRecordOutcome).not.toHaveBeenCalled();
      expect(res.content[0]?.text).toContain('Owner Queue');
      expect(res.content[0]?.text).not.toContain('private-id');
    },
  );
});
