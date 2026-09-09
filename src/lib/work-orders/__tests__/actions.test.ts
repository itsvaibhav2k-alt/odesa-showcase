import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));

import { createServerClient } from '@/lib/supabase/server';
import {
  updateWorkOrderFieldsAction,
  transitionWorkOrderLifecycleAction,
} from '../actions';

const mockServer = vi.mocked(createServerClient);
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const WO_ID = '22222222-2222-4222-8222-222222222222';
const VENDOR_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

function stub(opts: {
  role?: string | null;
  userId?: string | null;
  membershipError?: { message: string } | null;
  rpcError?: { code: string; message: string } | null;
  rpcData?: Record<string, unknown>;
} = {}) {
  const userId = opts.userId === undefined ? 'user-1' : opts.userId;
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null }, error: null })) },
    from: vi.fn((table: string) => {
      if (table !== 'users') throw new Error(`unexpected table ${table}`);
      return { select: () => ({ eq: () => ({ single: async () => ({
        data: opts.membershipError ? null : {
          organization_id: ORG_ID,
          role: opts.role === undefined ? 'owner' : opts.role,
        },
        error: opts.membershipError ?? null,
      }) }) }) };
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: opts.rpcData ?? { changed: true, unitId: null }, error: null };
    }),
  };
  mockServer.mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createServerClient>>);
  return { rpcCalls };
}

beforeEach(() => vi.clearAllMocks());

describe('updateWorkOrderFieldsAction is urgency-only', () => {
  it('rejects an empty/invalid patch before any auth or RPC work', async () => {
    const state = stub();
    // status/vendor are no longer part of the schema — an object without a
    // valid urgency is invalid.
    await expect(
      updateWorkOrderFieldsAction(WO_ID, {} as never),
    ).resolves.toEqual({ ok: false, error: 'Invalid update' });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('denies an unauthenticated caller with zero RPC calls', async () => {
    const state = stub({ userId: null });
    await expect(updateWorkOrderFieldsAction(WO_ID, { urgency: 'urgent' }))
      .resolves.toEqual({ ok: false, error: 'Unauthorized', status: 401 });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it.each(['manager', 'va', 'member', null])(
    'denies role %s before calling the mutation RPC',
    async (role) => {
      const state = stub({ role });
      await expect(updateWorkOrderFieldsAction(WO_ID, { urgency: 'urgent' }))
        .resolves.toEqual({ ok: false, error: 'Forbidden', status: 403 });
      expect(state.rpcCalls).toHaveLength(0);
    },
  );

  it('sends ONLY urgency through the audited Wave 2 RPC (no status/vendor)', async () => {
    const state = stub();
    await expect(
      updateWorkOrderFieldsAction(WO_ID, { urgency: 'urgent' }),
    ).resolves.toEqual({ ok: true });
    expect(state.rpcCalls).toEqual([{
      name: 'mutate_work_order_audited',
      args: {
        p_work_order_id: WO_ID,
        p_urgency: 'urgent',
        p_status: null,
        p_vendor_id: null,
        p_set_vendor: false,
      },
    }]);
  });

  it('maps a database authorization rejection to status 403', async () => {
    stub({ rpcError: { code: '42501', message: 'Forbidden' } });
    await expect(updateWorkOrderFieldsAction(WO_ID, { urgency: 'routine' }))
      .resolves.toEqual({ ok: false, error: 'Forbidden', status: 403 });
  });
});

describe('transitionWorkOrderLifecycleAction', () => {
  const validInput = {
    action: 'assign_vendor' as const,
    expectedVersion: 0,
    requestId: REQUEST_ID,
    vendorId: VENDOR_ID,
  };

  it('rejects a malformed request before any auth or RPC work', async () => {
    const state = stub();
    await expect(
      transitionWorkOrderLifecycleAction(WO_ID, { ...validInput, requestId: 'not-a-uuid' }),
    ).resolves.toEqual({ ok: false, error: 'Invalid request', code: 'invalid' });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('denies an unauthenticated caller with zero RPC calls', async () => {
    const state = stub({ userId: null });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput))
      .resolves.toEqual({ ok: false, error: 'Unauthorized', status: 401 });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it.each(['manager', 'va', 'member', null])(
    'denies role %s before calling the lifecycle RPC',
    async (role) => {
      const state = stub({ role });
      await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput))
        .resolves.toEqual({ ok: false, error: 'Forbidden', code: 'forbidden', status: 403 });
      expect(state.rpcCalls).toHaveLength(0);
    },
  );

  it('relays the verb + version + request id to mutate_work_order_lifecycle', async () => {
    const state = stub({
      rpcData: {
        changed: true,
        unitId: null,
        vendorId: null,
        lifecycleVersion: 1,
        vendorAssignedAt: '2026-07-11T12:00:00.000Z',
        vendorRespondedAt: null,
      },
    });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput))
      .resolves.toEqual({
        ok: true,
        changed: true,
        lifecycleVersion: 1,
        vendorAssignedAt: '2026-07-11T12:00:00.000Z',
        vendorRespondedAt: null,
      });
    expect(state.rpcCalls).toEqual([{
      name: 'mutate_work_order_lifecycle',
      args: {
        p_work_order_id: WO_ID,
        p_action: 'assign_vendor',
        p_expected_version: 0,
        p_request_id: REQUEST_ID,
        p_vendor_id: VENDOR_ID,
        p_vendor_response: null,
      },
    }]);
  });

  it('returns changed=false and stable vendor timestamps for a truthful no-op', async () => {
    stub({
      rpcData: {
        changed: false,
        lifecycleVersion: 3,
        vendorAssignedAt: '2026-07-11T10:00:00.000Z',
        vendorRespondedAt: '2026-07-11T10:05:00.000Z',
      },
    });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput)).resolves.toEqual({
      ok: true,
      changed: false,
      lifecycleVersion: 3,
      vendorAssignedAt: '2026-07-11T10:00:00.000Z',
      vendorRespondedAt: '2026-07-11T10:05:00.000Z',
    });
  });

  it('maps 55000 to a stale error with the honest refresh copy', async () => {
    stub({ rpcError: { code: '55000', message: 'stale_write' } });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput)).resolves.toEqual({
      ok: false,
      code: 'stale',
      error: 'This work order changed since you loaded it — refresh to see the latest.',
    });
  });

  it('maps 22000 invalid_transition to a cleaned invalid error', async () => {
    stub({ rpcError: { code: '22000', message: 'invalid_transition: cannot start_work from status open' } });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput)).resolves.toEqual({
      ok: false,
      code: 'invalid',
      error: 'Cannot start_work from status open',
    });
  });

  it('maps 22000 idempotency_conflict to a conflict error', async () => {
    stub({ rpcError: { code: '22000', message: 'idempotency_conflict: request already used with a different payload' } });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput)).resolves.toEqual({
      ok: false,
      code: 'conflict',
      error: 'This action was already submitted with different values.',
    });
  });

  it('maps a database authorization rejection to forbidden 403', async () => {
    stub({ rpcError: { code: '42501', message: 'Forbidden' } });
    await expect(transitionWorkOrderLifecycleAction(WO_ID, validInput))
      .resolves.toEqual({ ok: false, error: 'Forbidden', code: 'forbidden', status: 403 });
  });
});
