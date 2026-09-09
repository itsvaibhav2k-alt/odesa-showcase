import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

import {
  commitProposal,
  ProposalBlockedError,
  ProposalCommitError,
  ProposalForbiddenError,
  ProposalMalformedEditError,
  ProposalNotFoundError,
  ProposalReviewRequiredError,
} from '../commit';
import { requiresHumanReview } from '@/lib/agent/worker/commit-gate';
import { WORKER_ACTION_TYPES } from '@/lib/agent/worker/types';
import type { NotifyResult } from '@/lib/messaging/notify';

const ORG = '00000000-0000-0000-0000-000000000001';
const PROP = '00000000-0000-0000-0000-000000000002';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000003';
const TENANT = '00000000-0000-0000-0000-000000000004';

const SYSTEM = { kind: 'system' } as const;
const OWNER = { kind: 'user', role: 'owner' } as const;

// ---------------------------------------------------------------------------
// Mock builder for the action_proposals load + claim + commit flow
// ---------------------------------------------------------------------------
//
// commit.ts calls:
//   1. db.from('action_proposals').select().eq('id', x).maybeSingle()      (load; also claim-miss reload)
//   2. db.from('action_proposals').update({status:'committing'})
//        .eq('id', x).eq('status', 'proposed').select().maybeSingle()      (CAS claim)
//   3. (action-specific dispatch — sometimes db.from('weekly_reports') ...)
//   4. db.from('action_proposals').update({status:'committed', ...})
//        .eq('id', x).eq('status', 'committing').select().single()         (finalize)
//
// Responses are FIFO queues per operation kind. Updates are routed by
// the status value they write, which keeps the mock stable under the
// interleavings of the concurrent-commit test.

type Row = Database['public']['Tables']['action_proposals']['Row'];

interface Resp {
  data: Row | null;
  error: null | { message: string };
}

interface DbScript {
  /** select().eq().maybeSingle() loads (initial load + claim-miss reload). */
  loads: Resp[];
  /** update({status:'committing'}) CAS claims. */
  claims: Resp[];
  /** update({status:'committed'}) finalizes. */
  commits: Resp[];
  /** Optional briefing update → select('id') resolves to data array */
  briefing?: { error: null | { message: string }; count: number };
}

function buildDb(script: DbScript) {
  const briefingUpdate = vi.fn();
  const claimCalls: Array<Record<string, unknown>> = [];
  const commitCalls: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table === 'action_proposals') {
      const maybeSingleLoad = vi.fn(
        async () => script.loads.shift() ?? { data: null, error: null },
      );
      const select = vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: maybeSingleLoad })),
      }));
      const update = vi.fn((values: Record<string, unknown>) => {
        const isClaim = values.status === 'committing';
        (isClaim ? claimCalls : commitCalls).push(values);
        const respond = async (): Promise<Resp> =>
          (isClaim ? script.claims : script.commits).shift() ?? {
            data: null,
            error: null,
          };
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(respond),
                single: vi.fn(respond),
              })),
            })),
          })),
        };
      });
      return { select, update };
    }
    if (table === 'weekly_reports') {
      // briefing update path: .update().eq().eq().select('id')
      // commit.ts measures rowsAffected from the data array length, so
      // the mock returns N empty rows where N = script.briefing.count.
      briefingUpdate.mockImplementation((value) => value);
      const stubRows: Array<{ id: string }> = Array.from(
        { length: script.briefing?.count ?? 0 },
        (_, i) => ({ id: `wr-${i}` }),
      );
      const finalSelect = vi.fn(async () => ({
        data: stubRows,
        error: script.briefing?.error ?? null,
      }));
      const eq2 = vi.fn(() => ({ select: finalSelect }));
      const eq1 = vi.fn(() => ({ eq: eq2 }));
      const update = vi.fn((v: unknown) => {
        briefingUpdate(v);
        return { eq: eq1 };
      });
      return { update };
    }
    throw new Error(`unexpected from(${table})`);
  });

  const db = { from } as unknown as SupabaseClient<Database>;
  return { db, from, briefingUpdate, claimCalls, commitCalls };
}

// `routing` lives outside the regenerated `Row` shape until task #12
// (migrations-eng's column add) propagates through the regen. Test
// fixtures attach it as an extra field via an `unknown` cast so
// `rowToActionProposal()` can read it the same way it does in prod.
type RowWithRouting = Row & { routing?: unknown };

const baseRow = (overrides: Partial<RowWithRouting> = {}): Row => {
  const row: RowWithRouting = {
    id: PROPOSAL_ID,
    organization_id: ORG,
    property_id: PROP,
    worker_model: 'haiku-4-5',
    action_type: 'draft_sms_reply',
    // Payload is audit-pure model output: body+tone only. tenantId
    // moves to `routing` (privacy boundary).
    payload: { body: 'hello there', tone: 'warm' } as unknown as Row['payload'],
    reasoning: 'tenant asked rent total',
    confidence: 0.9,
    context_fact_ids: [],
    gate_decision: 'auto',
    status: 'proposed',
    created_at: '2026-04-28T12:00:00.000Z',
    committed_at: null,
    rejected_at: null,
    edit_diff: null,
    execution_evidence: null,
    outcome: null,
    routing: { tenantId: TENANT, conversationId: 'c-fixture' },
    retell_artifact_key: null,
    retryable: false,
    last_attempted_at: null,
    ...overrides,
  };
  return row as Row;
};

// ---------------------------------------------------------------------------

describe('commitProposal', () => {
  it('dispatches draft_sms_reply via notifyTenant', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const committing = baseRow({ status: 'committing' });
    const committed = baseRow({ status: 'committed', committed_at: '2026-04-28T12:01:00Z' });

    const { db, claimCalls } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [{ data: committing, error: null }],
      commits: [{ data: committed, error: null }],
    });

    const notifyResult: NotifyResult = {
      ok: true,
      conversationId: 'c1',
      messageId: 'm1',
      provider: 'linq',
      failedOver: false,
      error: null,
    };
    const notifyTenantImpl = vi.fn(async () => notifyResult);

    const result = await commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl });

    expect(notifyTenantImpl).toHaveBeenCalledTimes(1);
    expect(notifyTenantImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        tenantId: TENANT,
        body: 'hello there',
      }),
    );
    expect(result.changed).toBe(true);
    expect(result.proposal.status).toBe('committed');
    expect(result.dispatch.kind).toBe('sms');
    if (result.dispatch.kind === 'sms') {
      expect(result.dispatch.result.ok).toBe(true);
    }
    // The CAS claim ran exactly once before the side effect.
    expect(claimCalls).toEqual([{ status: 'committing' }]);
  });

  it('dispatches authoritative human-edited SMS text and preserves model output', async () => {
    const editDiff = {
      body_before: 'hello there',
      body_after: 'Human-edited tenant reply',
    } as Row['edit_diff'];
    const proposed = baseRow({ status: 'proposed', edit_diff: editDiff });
    const committing = baseRow({ status: 'committing', edit_diff: editDiff });
    const committed = baseRow({ status: 'committed', edit_diff: editDiff });
    const { db } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [{ data: committing, error: null }],
      commits: [{ data: committed, error: null }],
    });
    const notifyTenantImpl = vi.fn(async (): Promise<NotifyResult> => ({
      ok: true,
      conversationId: 'c1',
      messageId: 'm1',
      provider: 'linq',
      failedOver: false,
      error: null,
    }));

    await commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl });

    expect(notifyTenantImpl).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Human-edited tenant reply' }),
    );
    expect((proposed.payload as { body: string }).body).toBe('hello there');
  });

  it.each([
    ['missing body_after', { edited_at: '2026-08-07T12:00:00Z' }],
    ['non-string body_after', { body_after: 42 }],
    ['blank body_after', { body_after: '   ' }],
    ['oversized body_after', { body_after: 'x'.repeat(2001) }],
    ['empty edit object', {}],
    ['invalid legacy tone edit', { tone: 42 }],
  ])('fails closed before claim on malformed edited SMS text: %s', async (_label, editDiff) => {
    const notifyTenantImpl = vi.fn();
    const { db, claimCalls } = buildDb({
      loads: [
        {
          data: baseRow({ edit_diff: editDiff as Row['edit_diff'] }),
          error: null,
        },
      ],
      claims: [],
      commits: [],
    });

    await expect(
      commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl }),
    ).rejects.toBeInstanceOf(ProposalMalformedEditError);
    expect(claimCalls).toHaveLength(0);
    expect(notifyTenantImpl).not.toHaveBeenCalled();
  });

  it('persists non-retryable ambiguous send failure evidence and never commits', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const committing = baseRow({ status: 'committing' });
    const failed = baseRow({ status: 'failed' as Row['status'], committed_at: null });

    const { db, commitCalls } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [{ data: committing, error: null }],
      commits: [{ data: failed, error: null }],
    });
    const notifyTenantImpl = vi.fn(async (): Promise<NotifyResult> => ({
      ok: false,
      conversationId: 'c1',
      messageId: 'm1',
      provider: null,
      failedOver: false,
      error: 'provider_unavailable',
    }));

    const result = await commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl });

    expect(result.proposal.status).toBe('failed');
    expect(result.changed).toBe(false);
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]).toMatchObject({
      status: 'failed',
      retryable: false,
      committed_at: null,
    });
    expect(commitCalls[0]).toHaveProperty('execution_evidence');
    expect(commitCalls[0]?.status).not.toBe('committed');
  });

  it('persists handler failure evidence and never marks the proposal committed', async () => {
    const payload = {
      name: 'Test Property', addressStreet: '1 Main St', addressCity: 'Arlington',
      addressState: 'VA', addressZip: '22201',
    };
    const proposed = baseRow({ action_type: 'create_property', payload: payload as Row['payload'] });
    const committing = baseRow({ action_type: 'create_property', payload: payload as Row['payload'], status: 'committing' });
    const failed = baseRow({ action_type: 'create_property', payload: payload as Row['payload'], status: 'failed', committed_at: null });
    const { db, commitCalls } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [{ data: committing, error: null }],
      commits: [{ data: failed, error: null }],
    });
    const handlerImpl = vi.fn(async () => ({
      ok: false as const, error: 'database_write_failed', confidence: 0,
    }));

    const result = await commitProposal(db, PROPOSAL_ID, SYSTEM, { handlerImpl });

    expect(handlerImpl).toHaveBeenCalledOnce();
    expect(result.changed).toBe(false);
    expect(result.proposal.status).toBe('failed');
    expect(commitCalls[0]).toMatchObject({ status: 'failed', committed_at: null, retryable: false });
    expect(commitCalls[0]?.status).not.toBe('committed');
  });

  it('dispatches polish_briefing by writing weekly_reports.briefing_text', async () => {
    const proposed = baseRow({
      action_type: 'polish_briefing',
      payload: { prose: 'Here is the week.' } as unknown as Row['payload'],
    });
    const committed = baseRow({
      action_type: 'polish_briefing',
      status: 'committed',
      committed_at: '2026-04-28T12:01:00Z',
      payload: { prose: 'Here is the week.' } as unknown as Row['payload'],
    });

    const { db, briefingUpdate } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [
        {
          data: baseRow({
            action_type: 'polish_briefing',
            status: 'committing',
            payload: { prose: 'Here is the week.' } as unknown as Row['payload'],
          }),
          error: null,
        },
      ],
      commits: [{ data: committed, error: null }],
      briefing: { error: null, count: 1 },
    });

    const result = await commitProposal(db, PROPOSAL_ID, OWNER, {
      briefingWeekStartDate: '2026-04-27',
    });

    expect(briefingUpdate).toHaveBeenCalledWith({ briefing_text: 'Here is the week.' });
    expect(result.dispatch.kind).toBe('briefing');
    if (result.dispatch.kind === 'briefing') {
      expect(result.dispatch.weekStartDate).toBe('2026-04-27');
      expect(result.dispatch.rowsAffected).toBe(1);
    }
  });

  it('classify_intent commits as a no-op (no side effect dispatched)', async () => {
    const proposed = baseRow({
      action_type: 'classify_intent',
      payload: { intent: 'rent_balance', reasoning: 'r' } as unknown as Row['payload'],
    });
    const committed = baseRow({ action_type: 'classify_intent', status: 'committed' });

    const notifyTenantImpl = vi.fn();

    const { db } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [
        {
          data: baseRow({ action_type: 'classify_intent', status: 'committing' }),
          error: null,
        },
      ],
      commits: [{ data: committed, error: null }],
    });

    const result = await commitProposal(db, PROPOSAL_ID, SYSTEM, { notifyTenantImpl });
    expect(notifyTenantImpl).not.toHaveBeenCalled();
    expect(result.dispatch.kind).toBe('noop');
    if (result.dispatch.kind === 'noop') {
      expect(result.dispatch.action_type).toBe('classify_intent');
    }
  });

  it('dispatch_vendor commits as a no-op with NO provider send (approval only, vendor never contacted)', async () => {
    const proposed = baseRow({
      action_type: 'dispatch_vendor',
      payload: { vendorId: 'v1', smsBody: 'hi' } as unknown as Row['payload'],
    });
    const committed = baseRow({ action_type: 'dispatch_vendor', status: 'committed' });

    const { db } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [
        {
          data: baseRow({ action_type: 'dispatch_vendor', status: 'committing' }),
          error: null,
        },
      ],
      commits: [{ data: committed, error: null }],
    });

    // Vendor Dispatch Truth: committing this proposal must record the owner's
    // approval WITHOUT firing any provider send. There is no vendor-dispatch
    // pipeline — a notifyTenant call here would be a silent contact the UI
    // never claims. Assert the send path is never touched.
    const notifyTenantImpl = vi.fn();
    const result = await commitProposal(db, PROPOSAL_ID, OWNER, {
      notifyTenantImpl,
    });
    expect(result.dispatch.kind).toBe('noop');
    expect(notifyTenantImpl).not.toHaveBeenCalled();
  });

  it('confirm_emergency and update_rulebook commit as no-ops', async () => {
    for (const action of ['confirm_emergency', 'update_rulebook'] as const) {
      const proposed = baseRow({
        action_type: action,
        payload: {} as unknown as Row['payload'],
      });
      const committed = baseRow({ action_type: action, status: 'committed' });
      const { db } = buildDb({
        loads: [{ data: proposed, error: null }],
        claims: [
          { data: baseRow({ action_type: action, status: 'committing' }), error: null },
        ],
        commits: [{ data: committed, error: null }],
      });
      const result = await commitProposal(
        db,
        PROPOSAL_ID,
        action === 'confirm_emergency' ? SYSTEM : OWNER,
      );
      expect(result.dispatch.kind).toBe('noop');
    }
  });

  it('is idempotent: a proposal already committed returns changed=false and noop', async () => {
    const alreadyCommitted = baseRow({
      status: 'committed',
      committed_at: '2026-04-28T12:01:00Z',
    });

    const notifyTenantImpl = vi.fn();
    const { db, claimCalls } = buildDb({
      loads: [{ data: alreadyCommitted, error: null }],
      claims: [],
      commits: [],
    });

    const result = await commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl });
    expect(result.changed).toBe(false);
    expect(result.dispatch.kind).toBe('noop');
    expect(notifyTenantImpl).not.toHaveBeenCalled();
    expect(claimCalls).toHaveLength(0);
  });

  it('returns an idempotent noop on claim miss (row taken between load and claim)', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const takenByOther = baseRow({
      status: 'committed',
      committed_at: '2026-04-28T12:01:00Z',
    });

    const notifyTenantImpl = vi.fn();
    const { db, commitCalls } = buildDb({
      loads: [
        { data: proposed, error: null },
        // Reload after the missed claim sees the other committer's result.
        { data: takenByOther, error: null },
      ],
      claims: [{ data: null, error: null }],
      commits: [],
    });

    const result = await commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl });
    expect(result.changed).toBe(false);
    expect(result.dispatch.kind).toBe('noop');
    expect(result.proposal.status).toBe('committed');
    expect(notifyTenantImpl).not.toHaveBeenCalled();
    expect(commitCalls).toHaveLength(0);
  });

  it('throws ProposalNotFoundError when the row vanishes after a claim miss', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const { db } = buildDb({
      loads: [
        { data: proposed, error: null },
        { data: null, error: null },
      ],
      claims: [{ data: null, error: null }],
      commits: [],
    });
    await expect(commitProposal(db, PROPOSAL_ID, OWNER)).rejects.toBeInstanceOf(
      ProposalNotFoundError,
    );
  });

  it('leaves the row at committing when dispatch throws (fail closed)', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const committing = baseRow({ status: 'committing' });

    const notifyTenantImpl = vi.fn(async (): Promise<NotifyResult> => {
      throw new Error('provider exploded mid-flight');
    });
    const { db, claimCalls, commitCalls } = buildDb({
      loads: [{ data: proposed, error: null }],
      claims: [{ data: committing, error: null }],
      commits: [],
    });

    await expect(
      commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl }),
    ).rejects.toThrow('provider exploded mid-flight');

    // Claimed once, then NO further status writes: no markCommitted and
    // crucially no revert to 'proposed' — we can't know if the send fired.
    expect(claimCalls).toEqual([{ status: 'committing' }]);
    expect(commitCalls).toHaveLength(0);
  });

  it('concurrent commits: only the claim winner dispatches the send', async () => {
    const proposed = baseRow({ status: 'proposed' });
    const committing = baseRow({ status: 'committing' });
    const committed = baseRow({
      status: 'committed',
      committed_at: '2026-04-28T12:01:00Z',
    });

    const { db, claimCalls } = buildDb({
      // Both callers load 'proposed'; the claim loser then reloads.
      loads: [
        { data: proposed, error: null },
        { data: proposed, error: null },
        { data: committed, error: null },
      ],
      // First CAS claim wins the row; the second gets no row back.
      claims: [
        { data: committing, error: null },
        { data: null, error: null },
      ],
      commits: [{ data: committed, error: null }],
    });

    const notifyResult: NotifyResult = {
      ok: true,
      conversationId: 'c1',
      messageId: 'm1',
      provider: 'linq',
      failedOver: false,
      error: null,
    };
    const notifyTenantImpl = vi.fn(async () => notifyResult);

    const [a, b] = await Promise.all([
      commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl }),
      commitProposal(db, PROPOSAL_ID, OWNER, { notifyTenantImpl }),
    ]);

    // Exactly one send across both callers.
    expect(notifyTenantImpl).toHaveBeenCalledTimes(1);
    expect(claimCalls).toHaveLength(2);
    const changedFlags = [a.changed, b.changed].sort();
    expect(changedFlags).toEqual([false, true]);
  });

  it.each([
    'draft_sms_reply',
    'dispatch_vendor',
    'update_rulebook',
    'add_tenant',
    'set_lease_terms',
    'update_rent',
    'waive_rent',
    'send_tenant_message',
    'update_property_rules',
    'archive_lease',
    'set_property_vendor',
    'update_tenant_preference',
    'request_rent_payment',
    'schedule_calendar_event',
    'cancel_calendar_event',
    'health_flag',
    'voice_call_review',
  ] as const)(
    'refuses a system commit for consequential %s even on a stale auto row',
    async (actionType) => {
      const notifyTenantImpl = vi.fn();
      const { db, claimCalls, commitCalls } = buildDb({
        loads: [
          {
            data: baseRow({
              action_type: actionType,
              gate_decision: 'auto',
              status: 'proposed',
            }),
            error: null,
          },
        ],
        claims: [],
        commits: [],
      });

      await expect(
        commitProposal(db, PROPOSAL_ID, SYSTEM, { notifyTenantImpl }),
      ).rejects.toBeInstanceOf(ProposalReviewRequiredError);
      expect(claimCalls).toHaveLength(0);
      expect(commitCalls).toHaveLength(0);
      expect(notifyTenantImpl).not.toHaveBeenCalled();
    },
  );

  it('refuses a system commit whenever the persisted gate says review', async () => {
    const { db, claimCalls } = buildDb({
      loads: [
        {
          data: baseRow({
            action_type: 'log_maintenance_ticket',
            gate_decision: 'review',
          }),
          error: null,
        },
      ],
      claims: [],
      commits: [],
    });

    await expect(
      commitProposal(db, PROPOSAL_ID, SYSTEM),
    ).rejects.toBeInstanceOf(ProposalReviewRequiredError);
    expect(claimCalls).toHaveLength(0);
  });

  it('refuses to commit blocked proposals', async () => {
    const blocked = baseRow({ gate_decision: 'block' });
    const { db, claimCalls } = buildDb({
      loads: [{ data: blocked, error: null }],
      claims: [],
      commits: [],
    });
    await expect(commitProposal(db, PROPOSAL_ID, SYSTEM)).rejects.toBeInstanceOf(ProposalBlockedError);
    // Blocked proposals are refused BEFORE the claim — never 'committing'.
    expect(claimCalls).toHaveLength(0);
  });

  it('throws ProposalNotFoundError when proposal id is missing', async () => {
    const { db } = buildDb({
      loads: [{ data: null, error: null }],
      claims: [],
      commits: [],
    });
    await expect(commitProposal(db, PROPOSAL_ID, SYSTEM)).rejects.toBeInstanceOf(ProposalNotFoundError);
  });

  describe('actor role gate', () => {
    const okNotify: NotifyResult = {
      ok: true,
      conversationId: 'c1',
      messageId: 'm1',
      provider: 'linq',
      failedOver: false,
      error: null,
    };

    it.each(['manager', 'va', null])(
      'user role %s is Forbidden on draft_sms_reply with zero side effects',
      async (role) => {
        const notifyTenantImpl = vi.fn(async () => okNotify);
        const { db, claimCalls, commitCalls } = buildDb({
          loads: [{ data: baseRow({ status: 'proposed' }), error: null }],
          claims: [],
          commits: [],
        });

        await expect(
          commitProposal(db, PROPOSAL_ID, { kind: 'user', role }, { notifyTenantImpl }),
        ).rejects.toThrowError(new ProposalForbiddenError());

        // Refused BEFORE the claim — no status write, no send.
        expect(claimCalls).toHaveLength(0);
        expect(commitCalls).toHaveLength(0);
        expect(notifyTenantImpl).not.toHaveBeenCalled();
      },
    );

    it('user role owner commits draft_sms_reply as before', async () => {
      const notifyTenantImpl = vi.fn(async () => okNotify);
      const { db } = buildDb({
        loads: [{ data: baseRow({ status: 'proposed' }), error: null }],
        claims: [{ data: baseRow({ status: 'committing' }), error: null }],
        commits: [
          {
            data: baseRow({ status: 'committed', committed_at: '2026-04-28T12:01:00Z' }),
            error: null,
          },
        ],
      });

      const result = await commitProposal(
        db,
        PROPOSAL_ID,
        { kind: 'user', role: 'owner' },
        { notifyTenantImpl },
      );

      expect(result.changed).toBe(true);
      expect(notifyTenantImpl).toHaveBeenCalledTimes(1);
    });

    it.each(WORKER_ACTION_TYPES.filter(requiresHumanReview))(
      'requires an owner for review disposition %s before any claim',
      async (actionType) => {
        const { db, claimCalls, commitCalls } = buildDb({
          loads: [
            {
              data: baseRow({ action_type: actionType, status: 'proposed' }),
              error: null,
            },
          ],
          claims: [],
          commits: [],
        });

        await expect(
          commitProposal(db, PROPOSAL_ID, {
            kind: 'user',
            role: 'manager',
          }),
        ).rejects.toBeInstanceOf(ProposalForbiddenError);
        expect(claimCalls).toHaveLength(0);
        expect(commitCalls).toHaveLength(0);
      },
    );
  });

  it('rejects SMS commit when routing.tenantId is missing', async () => {
    // Privacy invariant: tenantId must come from `routing`, not payload.
    // If routing is null (or missing tenantId), the dispatcher should
    // throw rather than silently dropping or peeking at payload.
    const noRouting = baseRow({ routing: null });
    const { db } = buildDb({
      loads: [{ data: noRouting, error: null }],
      claims: [{ data: baseRow({ routing: null, status: 'committing' }), error: null }],
      commits: [],
    });
    await expect(commitProposal(db, PROPOSAL_ID, OWNER)).rejects.toBeInstanceOf(ProposalCommitError);
  });
});
