/**
 * Unit tests for the action-proposal mutation core — focused on the
 * CAS claim semantics of `commitProposal` (the /api/action-proposals
 * /[id]/commit route path).
 *
 * The invariant under test: the conditional UPDATE 'proposed' →
 * 'committing' happens BEFORE any side effect, so a claim miss (or
 * the loser of a concurrent race) inserts no `messages` row and
 * triggers no provider send.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/messaging/send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));

import { sendWithFailover } from '@/lib/messaging/send-with-failover';
import { createAdminClient } from '@/lib/supabase/admin';

import {
  commitProposal,
  editProposal,
  rejectProposal,
} from '../proposal-mutations';

const mockSendWithFailover = vi.mocked(sendWithFailover);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';

// Existing CAS-semantics tests run as an owner (user actor) — they double
// as the owner-positive role cell; the denial cells live in the role-gate
// describe block below.
const OWNER = { kind: 'user', role: 'owner' } as const;

// ---------------------------------------------------------------------------
// Minimal in-memory admin-client stub
//
// Mirrors the chains commitProposal uses:
//   .from(t).select(cols).eq(...).maybeSingle()/.single()       (reads)
//   .from(t).update(patch).eq(...).eq(...).select().maybeSingle() (CAS claim)
//   .from(t).update(patch).eq(...)[.eq(...)]                     (plain update)
//   .from(t).insert(row).select('id').single()                   (insert)
//
// `opts.proposalClaimMiss` simulates a concurrent committer winning
// the claim between the load and the conditional update: the claim
// UPDATE matches zero rows and returns null.
// ---------------------------------------------------------------------------

interface Tables {
  action_proposals?: Array<Record<string, unknown>>;
  tenants?: Array<Record<string, unknown>>;
  organizations?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
}

interface AdminStub {
  tables: Tables;
  client: ReturnType<typeof createAdminClient>;
  insertedRows: Array<{ table: string; row: Record<string, unknown> }>;
}

function buildAdminStub(
  initial: Tables,
  opts: {
    proposalClaimMiss?: boolean;
    proposalEditMiss?: boolean;
    proposalRejectMiss?: boolean;
    unsupportedPersistMiss?: boolean;
    unsupportedPersistError?: boolean;
  } = {},
): AdminStub {
  const tables: Tables = {
    action_proposals: initial.action_proposals
      ? [...initial.action_proposals]
      : [],
    tenants: initial.tenants ? [...initial.tenants] : [],
    organizations: initial.organizations ? [...initial.organizations] : [],
    messages: initial.messages ? [...initial.messages] : [],
  };
  const insertedRows: AdminStub['insertedRows'] = [];
  let insertSeq = 0;

  function makeQuery(tableName: keyof Tables) {
    const predicates: Array<{ col: string; value: unknown }> = [];
    const apply = () => {
      const rows = tables[tableName] ?? [];
      return rows.filter((r) => predicates.every((p) => r[p.col] === p.value));
    };
    const chain: Record<string, unknown> = {
      select() {
        return chain;
      },
      eq(col: string, value: unknown) {
        predicates.push({ col, value });
        return chain;
      },
      maybeSingle() {
        return Promise.resolve({ data: apply()[0] ?? null, error: null });
      },
      single() {
        return Promise.resolve({ data: apply()[0] ?? null, error: null });
      },
    };
    return chain;
  }

  function makeUpdate(tableName: keyof Tables) {
    return (patch: Record<string, unknown>) => {
      const predicates: Array<{ col: string; value: unknown }> = [];
      const isClaim =
        tableName === 'action_proposals' && patch.status === 'committing';
      const isUnsupported = tableName === 'action_proposals' && patch.status === 'unsupported';
      const isReject =
        tableName === 'action_proposals' && patch.status === 'rejected';
      const isEdit =
        tableName === 'action_proposals' && 'edit_diff' in patch;
      const applyPatch = () => {
        if (isClaim && opts.proposalClaimMiss) return [];
        if (isEdit && opts.proposalEditMiss) return [];
        if (isReject && opts.proposalRejectMiss) return [];
        if (isUnsupported && opts.unsupportedPersistMiss) return [];
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
          if (isUnsupported && opts.unsupportedPersistError) {
            return Promise.resolve({ data: null, error: { message: 'database unavailable' } });
          }
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

  function makeInsert(tableName: keyof Tables) {
    return (row: Record<string, unknown>) => {
      insertSeq += 1;
      const id = (row.id as string | undefined) ?? `gen-${insertSeq}`;
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
    from: (table: keyof Tables) => {
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

function proposedSmsProposal(): Record<string, unknown> {
  return {
    id: 'prop-1',
    organization_id: TEST_ORG_ID,
    action_type: 'draft_sms_reply',
    payload: { body: 'Hi tenant', recipient_phone: '+15550002222' },
    routing: { tenantId: 'tenant-1', conversationId: 'conv-1' },
    status: 'proposed',
    edit_diff: null,
  };
}

function baseTables(): Tables {
  return {
    action_proposals: [proposedSmsProposal()],
    tenants: [{ id: 'tenant-1', phone_e164: '+15550002222' }],
    organizations: [
      {
        id: TEST_ORG_ID,
        odesa_phone_number: '+15559990000',
        messaging_primary: 'linq',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proposal-mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendWithFailover.mockResolvedValue({
      ok: true,
      provider: 'linq',
      providerMessageId: 'mock-handle-1',
      attempted: ['linq'],
      failedOver: false,
    });
  });

  describe('commitProposal', () => {
    it('sends and records the authoritative human-edited body without mutating model output', async () => {
      const admin = buildAdminStub(baseTables());

      const edited = await editProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        '  Human-edited reply  ',
      );
      expect(edited).toMatchObject({
        ok: true,
        data: { bodyAfter: 'Human-edited reply' },
      });

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        OWNER,
      );

      expect(result.ok).toBe(true);
      expect(mockSendWithFailover).toHaveBeenCalledWith(
        TEST_ORG_ID,
        expect.objectContaining({ body: 'Human-edited reply' }),
      );
      expect(
        admin.insertedRows.find((row) => row.table === 'messages')?.row.body,
      ).toBe('Human-edited reply');
      expect(
        (admin.tables.action_proposals![0].payload as Record<string, unknown>)
          .body,
      ).toBe('Hi tenant');
    });

    it('falls back to immutable payload text when no human edit exists', async () => {
      const admin = buildAdminStub(baseTables());

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        OWNER,
      );

      expect(result.ok).toBe(true);
      expect(mockSendWithFailover).toHaveBeenCalledWith(
        TEST_ORG_ID,
        expect.objectContaining({ body: 'Hi tenant' }),
      );
      expect(
        admin.insertedRows.find((row) => row.table === 'messages')?.row.body,
      ).toBe('Hi tenant');
    });

    it('fails an edit CAS loser without changing model or edit evidence', async () => {
      const admin = buildAdminStub(baseTables(), { proposalEditMiss: true });

      const result = await editProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        'Owner edit that lost the race',
      );

      expect(result).toEqual({
        ok: false,
        error: 'Proposal changed before the edit could be saved',
      });
      expect(admin.tables.action_proposals![0]).toMatchObject({
        status: 'proposed',
        edit_diff: null,
        payload: { body: 'Hi tenant' },
      });
      expect(mockSendWithFailover).not.toHaveBeenCalled();
    });

    it.each([
      ['missing body_after', { edited_at: '2026-08-07T12:00:00.000Z' }],
      ['non-string body_after', { body_after: 42 }],
      ['blank body_after', { body_after: '   ' }],
      ['oversized body_after', { body_after: 'x'.repeat(2001) }],
    ])('fails closed on malformed edited text: %s', async (_label, editDiff) => {
      const tables = baseTables();
      tables.action_proposals![0].edit_diff = editDiff;
      const admin = buildAdminStub(tables);

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        OWNER,
      );

      expect(result).toEqual({
        ok: false,
        error:
          'Proposal edit_diff.body_after must be a non-empty string of at most 2000 characters',
      });
      expect(admin.tables.action_proposals![0].status).toBe('proposed');
      expect(mockSendWithFailover).not.toHaveBeenCalled();
      expect(
        admin.insertedRows.filter((row) => row.table === 'messages'),
      ).toHaveLength(0);
    });

    it('should commit and send when the claim wins', async () => {
      const admin = buildAdminStub(baseTables());

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        OWNER,
      );

      expect(result.ok).toBe(true);
      expect(mockSendWithFailover).toHaveBeenCalledOnce();
      const row = admin.tables.action_proposals![0];
      expect(row.status).toBe('committed');
      expect(row.committed_at).toBeTypeOf('string');
      expect(
        admin.insertedRows.filter((r) => r.table === 'messages'),
      ).toHaveLength(1);
    });

    it('should not insert a message or send on claim miss', async () => {
      const admin = buildAdminStub(baseTables(), { proposalClaimMiss: true });

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        OWNER,
      );

      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toBe(
        'Proposal is already being committed',
      );
      // No side effects: no provider send, no outbound message row.
      expect(mockSendWithFailover).not.toHaveBeenCalled();
      expect(
        admin.insertedRows.filter((r) => r.table === 'messages'),
      ).toHaveLength(0);
    });

    it('should send exactly once when two commits race (CAS claim)', async () => {
      const admin = buildAdminStub(baseTables());

      const [a, b] = await Promise.all([
        commitProposal(admin.client, 'prop-1', TEST_USER_ID, TEST_ORG_ID, OWNER),
        commitProposal(admin.client, 'prop-1', TEST_USER_ID, TEST_ORG_ID, OWNER),
      ]);

      // Exactly one winner, one provider send, one outbound message row.
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect(mockSendWithFailover).toHaveBeenCalledOnce();
      expect(
        admin.insertedRows.filter((r) => r.table === 'messages'),
      ).toHaveLength(1);
      expect(admin.tables.action_proposals![0].status).toBe('committed');
    });

    it.each(['manager', 'va', null])(
      'should return Forbidden for user role %s with zero side effects',
      async (role) => {
        const admin = buildAdminStub(baseTables());

        const result = await commitProposal(
          admin.client,
          'prop-1',
          TEST_USER_ID,
          TEST_ORG_ID,
          { kind: 'user', role },
        );

        expect(result).toEqual({ ok: false, error: 'Forbidden' });
        // Zero side effects: no claim, no message row, no provider send.
        expect(admin.tables.action_proposals![0].status).toBe('proposed');
        expect(mockSendWithFailover).not.toHaveBeenCalled();
        expect(
          admin.insertedRows.filter((r) => r.table === 'messages'),
        ).toHaveLength(0);
      },
    );

    it('refuses a system actor before claim because tenant-facing sends require owner review', async () => {
      const admin = buildAdminStub(baseTables());

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        { kind: 'system' },
      );

      expect(result).toEqual({
        ok: false,
        error: 'Proposal requires owner review',
      });
      expect(admin.tables.action_proposals![0].status).toBe('proposed');
      expect(mockSendWithFailover).not.toHaveBeenCalled();
      expect(
        admin.insertedRows.filter((row) => row.table === 'messages'),
      ).toHaveLength(0);
    });

    it('should persist provider failure evidence without marking the proposal committed', async () => {
      const admin = buildAdminStub(baseTables());
      mockSendWithFailover.mockResolvedValue({
        ok: false,
        attempted: ['linq', 'twilio'],
        errors: [
          { provider: 'linq', error: 'down' },
          { provider: 'twilio', error: 'rate limited' },
        ],
      });

      const result = await commitProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
        OWNER,
      );

      expect(result).toEqual({ ok: false, error: 'All providers failed' });
      const proposal = admin.tables.action_proposals![0];
      expect(proposal.status).toBe('failed');
      expect(proposal.committed_at).toBeNull();
      expect(proposal.retryable).toBe(false);
      expect(proposal.execution_evidence).toMatchObject({
        outcome: 'failed',
        attempted: ['linq', 'twilio'],
      });
      expect(
        admin.insertedRows.find((row) => row.table === 'messages')?.row,
      ).toMatchObject({
        draft_status: 'rejected',
        delivery_status: 'failed',
      });
    });

    it.each([
      ['database failure', { unsupportedPersistError: true }, 'Failed to persist unsupported proposal: database unavailable'],
      ['CAS miss', { unsupportedPersistMiss: true }, 'Proposal claim missed while persisting unsupported state'],
    ] as const)('distinguishes unsupported persistence %s', async (_label, opts, expected) => {
      const tables = baseTables();
      tables.action_proposals![0].action_type = 'unsupported_action';
      const admin = buildAdminStub(tables, opts);
      const result = await commitProposal(admin.client, 'prop-1', TEST_USER_ID, TEST_ORG_ID, OWNER);
      expect(result).toEqual({ ok: false, error: expected });
      expect(admin.tables.action_proposals![0].status).toBe('proposed');
      expect(mockSendWithFailover).not.toHaveBeenCalled();
    });
  });

  describe('rejectProposal', () => {
    it('CAS-rejects only a still-proposed row', async () => {
      const admin = buildAdminStub(baseTables());

      const result = await rejectProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
      );

      expect(result).toEqual({
        ok: true,
        data: { proposalId: 'prop-1' },
      });
      expect(admin.tables.action_proposals![0].status).toBe('rejected');
    });

    it('fails closed when an approval claim wins the reject race', async () => {
      const admin = buildAdminStub(baseTables(), { proposalRejectMiss: true });

      const result = await rejectProposal(
        admin.client,
        'prop-1',
        TEST_USER_ID,
        TEST_ORG_ID,
      );

      expect(result).toEqual({
        ok: false,
        error: 'Proposal is already being decided',
      });
      expect(admin.tables.action_proposals![0].status).toBe('proposed');
    });
  });
});
