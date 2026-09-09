/** Focused VA boundary for POST /api/action-proposals/[id]/reject. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/inbox/proposal-mutations', () => ({
  rejectProposal: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectProposal } from '@/lib/inbox/proposal-mutations';

import { POST } from '../[id]/reject/route';

const mockServer = vi.mocked(createServerClient);
const mockAdmin = vi.mocked(createAdminClient);
const mockReject = vi.mocked(rejectProposal);

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const PROPOSAL_ID = 'proposal-1';

function stubClients(role: string | null): void {
  mockServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);

  const single = vi.fn(async () => ({
    data: { organization_id: ORG_ID, role },
    error: null,
  }));
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  mockAdmin.mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
}

function post(): ReturnType<typeof POST> {
  return POST({} as NextRequest, {
    params: Promise.resolve({ id: PROPOSAL_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/action-proposals/[id]/reject', () => {
  it('should return Forbidden for a VA without rejecting the proposal', async () => {
    stubClients('va');

    const response = await post();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(mockReject).not.toHaveBeenCalled();
  });

  it('should preserve the existing owner rejection path', async () => {
    stubClients('owner');
    mockReject.mockResolvedValue({
      ok: true,
      data: { proposalId: PROPOSAL_ID },
    });

    const response = await post();

    expect(response.status).toBe(200);
    expect(mockReject).toHaveBeenCalledWith(
      expect.anything(),
      PROPOSAL_ID,
      USER_ID,
      ORG_ID,
    );
  });
});
