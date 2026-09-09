import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  requireAccessContext: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mocks.createServerClient,
}));
vi.mock('@/lib/authz/context', () => ({
  requireAccessContext: mocks.requireAccessContext,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { createInvitationAction } from '../actions';

describe('Team & Access invitation actions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('denies Accountant invitation creation before any database write', async () => {
    mocks.requireAccessContext.mockResolvedValue({
      ok: true,
      context: {
        userId: 'accountant-user',
        membershipId: 'accountant-membership',
        organizationId: 'organization-1',
        role: 'accountant',
        capabilities: new Set([
          'view_dashboard',
          'view_rent',
          'view_financials',
          'view_documents',
          'export_financials',
        ]),
        propertyScope: [],
      },
    });

    await expect(
      createInvitationAction({
        email: 'other@galaxy-accountant.test',
        role: 'accountant',
        propertyIds: [],
      }),
    ).resolves.toEqual({ success: false, error: 'Forbidden' });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});
