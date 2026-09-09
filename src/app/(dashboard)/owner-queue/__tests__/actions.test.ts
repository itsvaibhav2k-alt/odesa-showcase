/**
 * Unit tests for `/owner-queue` server actions (Pass 2 — real decision control).
 *
 * The actions cross four boundaries, all mocked here so no real send/commit
 * fires:
 *   1. Auth (Supabase SSR client) — `auth.getUser`.
 *   2. Admin (service-role) client — the `users` org lookup + the
 *      `action_proposals` / `properties` reads + the edit UPDATE.
 *   3. The proposal side-effect layer — `commitProposal` / `recordOutcome`.
 *   4. The rulebook write path — `updateRulebook`.
 *
 * The admin client is a thin fake (commit.test.ts style): each `from(table)`
 * returns a chainable stub whose terminal `maybeSingle`/`update` resolves to a
 * queued response. We assert the cross-org guard, fail-closed re-validation,
 * per-id batch results, and rulebook dedupe/cap — never that a real mutation ran.
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

vi.mock('@/lib/agent/proposals/commit', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/agent/proposals/commit')
  >('@/lib/agent/proposals/commit');
  return {
    ...actual,
    commitProposal: vi.fn(),
  };
});

vi.mock('@/lib/agent/proposals/outcome', () => ({
  recordOutcome: vi.fn(),
}));

vi.mock('@/app/(dashboard)/properties/[id]/actions', () => ({
  updateRulebook: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  commitProposal,
  ProposalBlockedError,
} from '@/lib/agent/proposals/commit';
import { recordOutcome } from '@/lib/agent/proposals/outcome';
import { updateRulebook } from '@/app/(dashboard)/properties/[id]/actions';

import {
  approveDecision,
  batchApprove,
  declineDecision,
  saveAndApproveDecision,
  saveDecisionAsOwnerRule,
  saveDecisionEdits,
} from '../actions';

const mockServer = vi.mocked(createServerClient);
const mockAdmin = vi.mocked(createAdminClient);
const mockCommit = vi.mocked(commitProposal);
const mockRecordOutcome = vi.mocked(recordOutcome);
const mockUpdateRulebook = vi.mocked(updateRulebook);

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const OTHER_ORG = 'org-2';
const PROPOSAL_ID = 'prop-1';
const PROPERTY_ID = 'property-1';

// ---------------------------------------------------------------------------
// SSR client stub — auth gate only.
// ---------------------------------------------------------------------------

function stubAuth(opts: { userId?: string | null } = {}): void {
  const userId = opts.userId === undefined ? USER_ID : opts.userId;
  mockServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

// ---------------------------------------------------------------------------
// Admin client fake — routes from(table) to queued responses.
// ---------------------------------------------------------------------------

interface AdminScript {
  /** Org returned by the `users` lookup (the auth context org). */
  userOrg?: string | null;
  /** Role returned by the `users` lookup; defaults to 'owner'. */
  userRole?: string | null;
  /** Rows keyed by table for `.eq().maybeSingle()` reads. */
  proposal?: Record<string, unknown> | null;
  property?: Record<string, unknown> | null;
  /** Error returned by the action_proposals UPDATE (default: none). */
  updateError?: { message: string } | null;
  /** Whether the status-conditioned edit UPDATE won its CAS (default: true). */
  updateMatched?: boolean;
}

function buildAdmin(script: AdminScript) {
  const updateCalls: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table === 'users') {
      const single = vi.fn(async () => ({
        data:
          script.userOrg === null
            ? null
            : {
                organization_id: script.userOrg ?? ORG_ID,
                role: script.userRole === undefined ? 'owner' : script.userRole,
              },
        error: null,
      }));
      const eq = vi.fn(() => ({ single }));
      const select = vi.fn(() => ({ eq }));
      return { select };
    }
    if (table === 'action_proposals') {
      const maybeSingle = vi.fn(async () => ({
        data: script.proposal ?? null,
        error: null,
      }));
      const eqRead = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq: eqRead }));
      const updateBuilder: Record<string, unknown> = {};
      updateBuilder.eq = vi.fn(() => updateBuilder);
      updateBuilder.select = vi.fn(() => updateBuilder);
      updateBuilder.maybeSingle = vi.fn(async () => ({
        data: script.updateMatched === false ? null : { id: PROPOSAL_ID },
        error: script.updateError ?? null,
      }));
      const update = vi.fn((patch: Record<string, unknown>) => {
        updateCalls.push(patch);
        return updateBuilder;
      });
      return { select, update };
    }
    if (table === 'properties') {
      const maybeSingle = vi.fn(async () => ({
        data: script.property ?? null,
        error: null,
      }));
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));
      return { select };
    }
    throw new Error(`unexpected from(${table})`);
  });

  const client = { from } as unknown as ReturnType<typeof createAdminClient>;
  return { client, from, updateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================

describe('owner-queue actions', () => {
  describe('auth gate', () => {
    it('rejects an unauthenticated approveDecision', async () => {
      stubAuth({ userId: null });
      mockAdmin.mockReturnValue(buildAdmin({}).client);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Unauthorized');
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('rejects an unauthenticated declineDecision', async () => {
      stubAuth({ userId: null });
      mockAdmin.mockReturnValue(buildAdmin({}).client);

      const result = await declineDecision(PROPOSAL_ID, 'no thanks');

      expect(result.ok).toBe(false);
      expect(mockRecordOutcome).not.toHaveBeenCalled();
    });
  });

  describe('cross-org guard', () => {
    it('refuses to commit a proposal owned by another org', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: OTHER_ORG,
          action_type: 'dispatch_vendor',
          payload: { candidateIndex: 0, smsBody: 'hi' },
          status: 'proposed',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Decision not found');
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('refuses to decline a proposal owned by another org', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: OTHER_ORG,
          action_type: 'send_tenant_message',
          payload: { tenantRef: { tenantName: 'A' }, body: 'hi' },
          status: 'proposed',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await declineDecision(PROPOSAL_ID);

      expect(result.ok).toBe(false);
      expect(mockRecordOutcome).not.toHaveBeenCalled();
    });

    it('treats a missing proposal the same as a cross-org one', async () => {
      stubAuth();
      const { client } = buildAdmin({ userOrg: ORG_ID, proposal: null });
      mockAdmin.mockReturnValue(client);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Decision not found');
    });
  });

  describe('approveDecision (owned)', () => {
    it('commits via commitProposal with the admin client', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'dispatch_vendor',
          payload: { candidateIndex: 0, smsBody: 'hi' },
          status: 'proposed',
        },
      });
      mockAdmin.mockReturnValue(client);
      mockCommit.mockResolvedValue({
        proposal: { status: 'committed' },
        dispatch: { kind: 'noop' },
        changed: true,
      } as unknown as Awaited<ReturnType<typeof commitProposal>>);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data?.status).toBe('committed');
      expect(mockCommit).toHaveBeenCalledWith(client, PROPOSAL_ID, {
        kind: 'user',
        role: 'owner',
      });
    });

    it('maps ProposalBlockedError to a not-recommended error', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'dispatch_vendor',
          payload: { candidateIndex: 0, smsBody: 'hi' },
          status: 'proposed',
        },
      });
      mockAdmin.mockReturnValue(client);
      mockCommit.mockRejectedValue(new ProposalBlockedError(PROPOSAL_ID));

      const result = await approveDecision(PROPOSAL_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/not recommended/i);
    });

    it('never reports success when the canonical commit did not reach committed', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'log_maintenance_ticket',
          payload: {
            unitRef: { unitLabel: '2B' },
            summary: 'Leaking faucet',
            severity: 'low',
          },
          status: 'proposed',
          gate_decision: 'auto',
        },
      });
      mockAdmin.mockReturnValue(client);
      mockCommit.mockResolvedValue({
        proposal: { status: 'failed' },
        dispatch: { kind: 'noop' },
        changed: false,
      } as unknown as Awaited<ReturnType<typeof commitProposal>>);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result).toEqual({
        ok: false,
        error: 'The decision was not completed and needs reconciliation',
      });
    });
  });

  describe('role gate (owner-only sensitive commits)', () => {
    const sensitiveProposal = (actionType: string, payload: Record<string, unknown>) => ({
      id: PROPOSAL_ID,
      organization_id: ORG_ID,
      action_type: actionType,
      payload,
      status: 'proposed',
      gate_decision: 'auto',
    });

    it.each(['manager', 'va', null])(
      'should refuse approveDecision of a vendor dispatch for role %s',
      async (userRole) => {
        stubAuth();
        const { client } = buildAdmin({
          userOrg: ORG_ID,
          userRole,
          proposal: sensitiveProposal('dispatch_vendor', {
            candidateIndex: 0,
            smsBody: 'hi',
          }),
        });
        mockAdmin.mockReturnValue(client);

        const result = await approveDecision(PROPOSAL_ID);

        expect(result).toEqual({ ok: false, error: 'Forbidden' });
        expect(mockCommit).not.toHaveBeenCalled();
      },
    );

    it('should refuse approveDecision of a tenant-facing send for a manager', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
        proposal: sensitiveProposal('send_tenant_message', {
          tenantRef: { tenantName: 'Dana' },
          body: 'hi',
        }),
      });
      mockAdmin.mockReturnValue(client);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('should refuse saveAndApproveDecision for a manager BEFORE any write', async () => {
      stubAuth();
      const { client, updateCalls } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
        proposal: sensitiveProposal('send_tenant_message', {
          tenantRef: { tenantName: 'Dana' },
          body: 'old body',
        }),
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveAndApproveDecision(PROPOSAL_ID, {
        body: 'new body',
      });

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(updateCalls).toHaveLength(0);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('should require the owner to acknowledge a review-only health flag', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'health_flag',
          payload: {},
          status: 'proposed',
          gate_decision: 'review',
        },
      });
      mockAdmin.mockReturnValue(client);
      const result = await approveDecision(PROPOSAL_ID);

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('keeps owner decisions owner-only, including decline', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
        proposal: sensitiveProposal('send_tenant_message', {
          tenantRef: { tenantName: 'Dana' },
          body: 'hi',
        }),
      });
      mockAdmin.mockReturnValue(client);
      mockRecordOutcome.mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof recordOutcome>>,
      );

      const result = await declineDecision(PROPOSAL_ID, 'not now');

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockRecordOutcome).not.toHaveBeenCalled();
    });

    it('should keep a VA from declining before the proposal is loaded', async () => {
      stubAuth();
      const { client, from } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'va',
        proposal: sensitiveProposal('send_tenant_message', {
          tenantRef: { tenantName: 'Dana' },
          body: 'hi',
        }),
      });
      mockAdmin.mockReturnValue(client);

      const result = await declineDecision(PROPOSAL_ID, 'not mine to decide');

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith('users');
      expect(mockRecordOutcome).not.toHaveBeenCalled();
    });

    it('should keep a VA from approving an internal-record proposal', async () => {
      stubAuth();
      const { client, from } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'va',
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'health_flag',
          payload: {},
          status: 'proposed',
          gate_decision: 'review',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await approveDecision(PROPOSAL_ID);

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith('users');
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('should let a manager save edits without committing (save stays open)', async () => {
      stubAuth();
      const { client, updateCalls } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
        proposal: sensitiveProposal('send_tenant_message', {
          tenantRef: { tenantName: 'Dana' },
          body: 'old body',
        }),
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionEdits(PROPOSAL_ID, { body: 'new body' });

      expect(result.ok).toBe(true);
      expect(updateCalls).toHaveLength(1);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('should refuse a batchApprove item per-id for a manager (no bulk bypass)', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
        proposal: sensitiveProposal('dispatch_vendor', {
          candidateIndex: 0,
          smsBody: 'hi',
        }),
      });
      mockAdmin.mockReturnValue(client);

      const { ok, results } = await batchApprove([PROPOSAL_ID]);

      expect(ok).toBe(false);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: PROPOSAL_ID,
        ok: false,
        error: 'Forbidden',
      });
      expect(mockCommit).not.toHaveBeenCalled();
    });
  });

  describe('saveDecisionEdits', () => {
    it('re-validates a good patch and persists payload + edit_diff (no commit)', async () => {
      stubAuth();
      const { client, updateCalls } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'send_tenant_message',
          payload: { tenantRef: { tenantName: 'Dana' }, body: 'old body' },
          status: 'proposed',
        },
      });
      mockAdmin.mockReturnValue(client);

      const patch = { body: 'updated body' };
      const result = await saveDecisionEdits(PROPOSAL_ID, patch);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data?.status).toBe('edited');
      // No commit ever fires from a save.
      expect(mockCommit).not.toHaveBeenCalled();
      // Persisted the merged + validated payload AND the raw patch as edit_diff.
      expect(updateCalls).toHaveLength(1);
      const written = updateCalls[0];
      expect((written.payload as Record<string, unknown>).body).toBe(
        'updated body',
      );
      expect(written.edit_diff).toEqual(patch);
    });

    it('keeps draft model output immutable and persists body_after as the reviewed text', async () => {
      stubAuth();
      const originalPayload = { body: 'model draft', tone: 'neutral' };
      const { client, updateCalls } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'draft_sms_reply',
          payload: originalPayload,
          edit_diff: null,
          status: 'proposed',
          gate_decision: 'review',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionEdits(PROPOSAL_ID, {
        body: 'owner reviewed draft',
      });

      expect(result.ok).toBe(true);
      expect(updateCalls).toHaveLength(1);
      const written = updateCalls[0];
      expect(written).not.toHaveProperty('payload');
      expect(written.edit_diff).toMatchObject({
        patch: { body: 'owner reviewed draft' },
        body_before: 'model draft',
        body_after: 'owner reviewed draft',
        edited_by: USER_ID,
      });
      expect(originalPayload.body).toBe('model draft');
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('FAILS CLOSED on a schema-invalid patch (no write, zod message)', async () => {
      stubAuth();
      const { client, updateCalls } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'send_tenant_message',
          payload: { tenantRef: { tenantName: 'Dana' }, body: 'old body' },
          status: 'proposed',
        },
      });
      mockAdmin.mockReturnValue(client);

      // Empty body violates sendTenantMessagePayloadSchema (min length 1).
      const result = await saveDecisionEdits(PROPOSAL_ID, { body: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
      // Nothing was written — fail closed.
      expect(updateCalls).toHaveLength(0);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('fails closed when commit claims the proposal before the edit update', async () => {
      stubAuth();
      const { client, updateCalls } = buildAdmin({
        userOrg: ORG_ID,
        updateMatched: false,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'draft_sms_reply',
          payload: { body: 'model draft', tone: 'neutral' },
          edit_diff: null,
          status: 'proposed',
          gate_decision: 'review',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionEdits(PROPOSAL_ID, {
        body: 'owner reviewed draft',
      });

      expect(result).toEqual({
        ok: false,
        error: 'This decision is no longer editable because its status changed',
      });
      expect(updateCalls).toHaveLength(1);
      expect(mockCommit).not.toHaveBeenCalled();
    });
  });

  describe('batchApprove', () => {
    it('returns per-id results with partial success', async () => {
      stubAuth();
      // Two ids: the first is owned + commits, the second is foreign (guarded).
      // A shared counter routes successive action_proposals reads (a fresh
      // `from()` is created per id, so the index can't live on the inner fn).
      let proposalReadIdx = 0;
      const from = vi.fn((table: string) => {
        if (table === 'users') {
          const single = vi.fn(async () => ({
            data: { organization_id: ORG_ID, role: 'owner' },
            error: null,
          }));
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) };
        }
        if (table === 'action_proposals') {
          const maybeSingle = vi.fn(async () => {
            const idx = proposalReadIdx++;
            return idx === 0
              ? {
                  data: {
                    id: 'ok-id',
                    organization_id: ORG_ID,
                    action_type: 'log_maintenance_ticket',
                    payload: {
                      unitRef: { unitLabel: '2B' },
                      summary: 'Leaking faucet',
                      severity: 'low',
                    },
                    status: 'proposed',
                    gate_decision: 'auto',
                  },
                  error: null,
                }
              : {
                  data: {
                    id: 'bad-id',
                    organization_id: OTHER_ORG,
                    action_type: 'dispatch_vendor',
                    payload: {},
                    status: 'proposed',
                    gate_decision: 'auto',
                  },
                  error: null,
                };
          });
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
          };
        }
        throw new Error(`unexpected from(${table})`);
      });
      const client = { from } as unknown as ReturnType<typeof createAdminClient>;
      mockAdmin.mockReturnValue(client);
      mockCommit.mockResolvedValue({
        proposal: { status: 'committed' },
        dispatch: { kind: 'noop' },
        changed: true,
      } as unknown as Awaited<ReturnType<typeof commitProposal>>);

      const { ok, results } = await batchApprove(['ok-id', 'bad-id']);

      expect(ok).toBe(false);
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'ok-id', ok: true });
      expect(results[1].ok).toBe(false);
      expect(results[1].error).toBe('Decision not found');
      // Only the owned id reached commit.
      expect(mockCommit).toHaveBeenCalledTimes(1);
    });

    it('marks every id failed when unauthenticated', async () => {
      stubAuth({ userId: null });
      mockAdmin.mockReturnValue(buildAdmin({}).client);

      const { ok, results } = await batchApprove(['a', 'b']);

      expect(ok).toBe(false);
      expect(results.every((r) => !r.ok)).toBe(true);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('no-ops safely on an empty id list (no auth, no commit)', async () => {
      stubAuth({ userId: null });
      mockAdmin.mockReturnValue(buildAdmin({}).client);

      const { ok, results } = await batchApprove([]);

      expect(ok).toBe(true);
      expect(results).toEqual([]);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('refuses a review-gated proposal server-side (bulk is auto-only)', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'send_tenant_message',
          payload: { tenantRef: { tenantName: 'Dana' }, body: 'hi' },
          status: 'proposed',
          gate_decision: 'review',
        },
      });
      mockAdmin.mockReturnValue(client);

      const { ok, results } = await batchApprove([PROPOSAL_ID]);

      expect(ok).toBe(false);
      expect(results).toHaveLength(1);
      expect(results[0].ok).toBe(false);
      expect(results[0].error).toMatch(/routine/i);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('refuses a stale consequential auto row under current safety policy', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'send_tenant_message',
          payload: { tenantRef: { tenantName: 'Dana' }, body: 'hi' },
          status: 'proposed',
          gate_decision: 'auto',
        },
      });
      mockAdmin.mockReturnValue(client);

      const { ok, results } = await batchApprove([PROPOSAL_ID]);

      expect(ok).toBe(false);
      expect(results[0]).toMatchObject({ ok: false });
      expect(results[0].error).toMatch(/routine/i);
      expect(mockCommit).not.toHaveBeenCalled();
    });

    it('refuses a non-commit-capable (legacy) action_type server-side', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        proposal: {
          id: PROPOSAL_ID,
          organization_id: ORG_ID,
          action_type: 'offer_payment_plan',
          payload: { rentAmount: 1850 },
          status: 'proposed',
          gate_decision: 'auto',
        },
      });
      mockAdmin.mockReturnValue(client);

      const { ok, results } = await batchApprove([PROPOSAL_ID]);

      expect(ok).toBe(false);
      expect(results[0].ok).toBe(false);
      expect(results[0].error).toMatch(/routine/i);
      expect(mockCommit).not.toHaveBeenCalled();
    });
  });

  describe('saveDecisionAsOwnerRule', () => {
    it('keeps owner guidance writes owner-only', async () => {
      stubAuth();
      const { client, from } = buildAdmin({
        userOrg: ORG_ID,
        userRole: 'manager',
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionAsOwnerRule(
        PROPERTY_ID,
        'Always ask the owner.',
      );

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith('users');
      expect(mockUpdateRulebook).not.toHaveBeenCalled();
    });

    it('appends new guidance via the updateRulebook path', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        property: {
          id: PROPERTY_ID,
          organization_id: ORG_ID,
          rules_text: 'Existing line.',
        },
      });
      mockAdmin.mockReturnValue(client);
      mockUpdateRulebook.mockResolvedValue({
        success: true,
        data: { propertyId: PROPERTY_ID, rulesText: 'x' },
      });

      const result = await saveDecisionAsOwnerRule(
        PROPERTY_ID,
        'Always confirm with the owner before lease changes.',
      );

      expect(result.ok).toBe(true);
      expect(mockUpdateRulebook).toHaveBeenCalledTimes(1);
      const arg = mockUpdateRulebook.mock.calls[0][0];
      expect(arg.rulesText).toBe(
        'Existing line.\nAlways confirm with the owner before lease changes.',
      );
    });

    it('dedupes — a guidance line already present is skipped (no write)', async () => {
      stubAuth();
      const existing = 'Always confirm with the owner before lease changes.';
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        property: {
          id: PROPERTY_ID,
          organization_id: ORG_ID,
          rules_text: existing,
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionAsOwnerRule(PROPERTY_ID, existing);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data?.status).toBe('duplicate');
      expect(mockUpdateRulebook).not.toHaveBeenCalled();
    });

    it('refuses to append past the 4000-character cap', async () => {
      stubAuth();
      // 3990 chars of existing + a newline + a 20-char line > 4000.
      const existing = 'x'.repeat(3990);
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        property: {
          id: PROPERTY_ID,
          organization_id: ORG_ID,
          rules_text: existing,
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionAsOwnerRule(
        PROPERTY_ID,
        'this line is twenty+',
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/4000/);
      expect(mockUpdateRulebook).not.toHaveBeenCalled();
    });

    it('refuses guidance for a property owned by another org', async () => {
      stubAuth();
      const { client } = buildAdmin({
        userOrg: ORG_ID,
        property: {
          id: PROPERTY_ID,
          organization_id: OTHER_ORG,
          rules_text: '',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await saveDecisionAsOwnerRule(PROPERTY_ID, 'New guidance.');

      expect(result.ok).toBe(false);
      expect(mockUpdateRulebook).not.toHaveBeenCalled();
    });
  });
});
