import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getUser: vi.fn(),
  requireAccessContext: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));
vi.mock('@/lib/authz/context', () => ({
  requireAccessContext: mocks.requireAccessContext,
}));
vi.mock('@/components/marketing/night-garden/night-garden-page', () => ({
  default: () => null,
}));

import Home from '../page';

describe('authenticated root landing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('lands a dashboard-denied Accountant on the first readable surface', async () => {
    mocks.requireAccessContext.mockResolvedValue({
      ok: true,
      context: {
        userId: 'user-1',
        membershipId: 'membership-1',
        organizationId: 'organization-1',
        role: 'accountant',
        capabilities: new Set(['view_financials', 'view_documents']),
        propertyScope: [],
      },
    });

    await Home();

    expect(mocks.redirect).toHaveBeenCalledWith('/financials');
  });

  it('preserves the shipped Owner landing', async () => {
    mocks.requireAccessContext.mockResolvedValue({
      ok: true,
      context: {
        userId: 'user-1',
        membershipId: 'membership-1',
        organizationId: 'organization-1',
        role: 'owner',
        capabilities: new Set(),
        propertyScope: 'all',
      },
    });

    await Home();

    expect(mocks.redirect).toHaveBeenCalledWith('/today');
  });
});
