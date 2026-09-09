/**
 * Unit tests for the `/review` server actions' role gate.
 *
 * Tenant-facing sends are owner-only (approve_tenant_message):
 * `sendRentReminderAction` gates locally before any read/delegation;
 * `sendConversationReplyAction` delegates wholesale to
 * `sendOwnerMessageAction`, which carries the same gate (covered in the
 * inbox suite). Operations Assistants can inspect review context but cannot
 * invoke hidden owner-review mutations directly. Work-order status transitions
 * use the owner-only shared mutation policy as a second line of defense.
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

vi.mock('@/app/(dashboard)/inbox/actions', () => ({
  sendOwnerMessageAction: vi.fn(),
}));

vi.mock('@/lib/work-orders/actions', () => ({
  transitionWorkOrderLifecycleAction: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOwnerMessageAction } from '@/app/(dashboard)/inbox/actions';
import { transitionWorkOrderLifecycleAction } from '@/lib/work-orders/actions';

import {
  decideConversationReviewAction,
  decideRentReviewAction,
  decideWorkOrderReviewAction,
  sendRentReminderAction,
} from '../actions';

const mockServer = vi.mocked(createServerClient);
const mockAdmin = vi.mocked(createAdminClient);
const mockSendOwnerMessage = vi.mocked(sendOwnerMessageAction);
const mockTransitionWorkOrder = vi.mocked(transitionWorkOrderLifecycleAction);

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const RENT_EVENT_ID = 'rent-1';

function stubAuth(userId: string | null = USER_ID): void {
  mockServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

interface AdminScript {
  userRole?: string | null;
  rentEvent?: Record<string, unknown> | null;
  lease?: Record<string, unknown> | null;
  conversation?: Record<string, unknown> | null;
  workOrder?: Record<string, unknown> | null;
}

function buildAdmin(script: AdminScript) {
  const updateCalls: Array<Record<string, unknown>> = [];

  const from = vi.fn((table: string) => {
    if (table === 'users') {
      const single = vi.fn(async () => ({
        data: {
          organization_id: ORG_ID,
          role: script.userRole === undefined ? 'owner' : script.userRole,
        },
        error: null,
      }));
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single })) })) };
    }
    if (table === 'leases') {
      const maybeSingle = vi.fn(async () => ({
        data: script.lease ?? null,
        error: null,
      }));
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      };
    }
    if (table === 'conversations') {
      const maybeSingle = vi.fn(async () => ({
        data: script.conversation ?? null,
        error: null,
      }));
      const limit = vi.fn(() => ({ maybeSingle }));
      const order = vi.fn(() => ({ limit }));
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ order })) })),
      };
    }
    if (table === 'rent_events') {
      const maybeSingle = vi.fn(async () => ({
        data: script.rentEvent ?? null,
        error: null,
      }));
      const select = vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }));
      const eqUpdate = vi.fn(async () => ({ error: null }));
      const update = vi.fn((patch: Record<string, unknown>) => {
        updateCalls.push(patch);
        return { eq: eqUpdate };
      });
      return { select, update };
    }
    if (table === 'work_orders') {
      // Product reads: .select('id, lifecycle_version').eq('id').eq('organization_id').maybeSingle()
      const maybeSingle = vi.fn(async () => ({
        data: script.workOrder ?? null,
        error: null,
      }));
      const eqOrg = vi.fn(() => ({ maybeSingle }));
      const eqId = vi.fn(() => ({ eq: eqOrg }));
      return { select: vi.fn(() => ({ eq: eqId })) };
    }
    throw new Error(`unexpected from(${table})`);
  });

  const client = { from } as unknown as ReturnType<typeof createAdminClient>;
  return { client, updateCalls, from };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('review actions role gate', () => {
  it('blocks Operations Assistant review decisions before record reads or writes', async () => {
    stubAuth();
    const { client, updateCalls, from } = buildAdmin({ userRole: 'va' });
    mockAdmin.mockReturnValue(client);

    await expect(
      decideRentReviewAction(RENT_EVENT_ID, 'escalate'),
    ).resolves.toEqual({ ok: false, error: 'Forbidden' });
    await expect(
      decideConversationReviewAction('conversation-1', 'resolve'),
    ).resolves.toEqual({ ok: false, error: 'Forbidden' });
    await expect(
      decideWorkOrderReviewAction('work-order-1', 'start'),
    ).resolves.toEqual({ ok: false, error: 'Forbidden' });

    expect(updateCalls).toHaveLength(0);
    expect(mockTransitionWorkOrder).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledTimes(3);
    expect(from).toHaveBeenCalledWith('users');
  });

  it.each(['manager', 'va', null])(
    'sendRentReminderAction returns Forbidden for role %s without delegating',
    async (userRole) => {
      stubAuth();
      const { client, updateCalls } = buildAdmin({
        userRole,
        rentEvent: {
          id: RENT_EVENT_ID,
          organization_id: ORG_ID,
          lease_id: 'lease-1',
        },
      });
      mockAdmin.mockReturnValue(client);

      const result = await sendRentReminderAction(RENT_EVENT_ID, 'Rent is due');

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(mockSendOwnerMessage).not.toHaveBeenCalled();
      expect(updateCalls).toHaveLength(0);
    },
  );

  it('sendRentReminderAction reaches the delegated send for role owner', async () => {
    stubAuth();
    const { client } = buildAdmin({
      userRole: 'owner',
      rentEvent: {
        id: RENT_EVENT_ID,
        organization_id: ORG_ID,
        lease_id: 'lease-1',
      },
      lease: { tenant_id: 'tenant-1' },
      conversation: { id: 'conv-1' },
    });
    mockAdmin.mockReturnValue(client);
    mockSendOwnerMessage.mockResolvedValue({
      ok: true,
      data: { messageId: 'm1' },
    } as unknown as Awaited<ReturnType<typeof sendOwnerMessageAction>>);

    const result = await sendRentReminderAction(RENT_EVENT_ID, 'Rent is due');

    // Owner is NOT forbidden — the action crosses the delegation boundary.
    expect(mockSendOwnerMessage).toHaveBeenCalledWith('conv-1', 'Rent is due');
    expect(result.ok).toBe(true);
  });

  it('decideRentReviewAction stays member-accessible (internal record)', async () => {
    stubAuth();
    const { client, updateCalls } = buildAdmin({
      userRole: 'manager',
      rentEvent: { id: RENT_EVENT_ID, organization_id: ORG_ID },
    });
    mockAdmin.mockReturnValue(client);

    const result = await decideRentReviewAction(RENT_EVENT_ID, 'escalate');

    expect(result.ok).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].status).toBe('escalated');
  });

  it.each(['manager', 'va', null])(
    'decideRentReviewAction blocks arrange_plan for role %s before row reads or writes',
    async (userRole) => {
      stubAuth();
      const { client, updateCalls, from } = buildAdmin({
        userRole,
        rentEvent: { id: RENT_EVENT_ID, organization_id: ORG_ID },
      });
      mockAdmin.mockReturnValue(client);

      const result = await decideRentReviewAction(
        RENT_EVENT_ID,
        'arrange_plan',
      );

      expect(result).toEqual({ ok: false, error: 'Forbidden' });
      expect(updateCalls).toHaveLength(0);
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).toHaveBeenCalledWith('users');
    },
  );

  it('decideRentReviewAction lets an owner arrange a plan', async () => {
    stubAuth();
    const { client, updateCalls } = buildAdmin({
      userRole: 'owner',
      rentEvent: { id: RENT_EVENT_ID, organization_id: ORG_ID },
    });
    mockAdmin.mockReturnValue(client);

    const result = await decideRentReviewAction(RENT_EVENT_ID, 'arrange_plan');

    expect(result.ok).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].status).toBe('plan_agreed');
  });

  it('decideWorkOrderReviewAction reads lifecycle_version and drives start_work via the owner-only transition', async () => {
    stubAuth();
    const { client } = buildAdmin({
      userRole: 'owner',
      workOrder: { id: 'work-order-1', lifecycle_version: 3 },
    });
    mockAdmin.mockReturnValue(client);
    mockTransitionWorkOrder.mockResolvedValue({
      ok: true,
      changed: true,
      lifecycleVersion: 4,
      vendorAssignedAt: null,
      vendorRespondedAt: null,
    });

    const result = await decideWorkOrderReviewAction('work-order-1', 'start');

    // The org-scoped read version is handed to the optimistically-locked RPC as
    // expectedVersion, with a fresh requestId, under the 'start_work' verb.
    expect(mockTransitionWorkOrder).toHaveBeenCalledWith(
      'work-order-1',
      expect.objectContaining({
        action: 'start_work',
        expectedVersion: 3,
        requestId: expect.any(String),
      }),
    );
    expect(result).toEqual({ ok: true, data: { status: 'in_progress' } });
  });

  it('decideWorkOrderReviewAction surfaces Forbidden from the centralized owner-only mutation', async () => {
    stubAuth();
    const { client } = buildAdmin({
      workOrder: { id: 'work-order-1', lifecycle_version: 0 },
    });
    mockAdmin.mockReturnValue(client);
    // The owner gate lives in the delegated mutation; the review action must
    // faithfully surface its denial, never fake success.
    mockTransitionWorkOrder.mockResolvedValue({
      ok: false,
      error: 'Forbidden',
      code: 'forbidden',
      status: 403,
    });

    const result = await decideWorkOrderReviewAction('work-order-1', 'start');

    expect(mockTransitionWorkOrder).toHaveBeenCalledWith(
      'work-order-1',
      expect.objectContaining({ action: 'start_work' }),
    );
    expect(result).toMatchObject({ ok: false, error: 'Forbidden' });
  });
});
