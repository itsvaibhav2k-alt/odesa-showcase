/** Focused VA denial for POST /api/messaging/drafts/[id]/reject. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

import { POST } from '../[id]/reject/route';

const mockServer = vi.mocked(createServerClient);
const mockAdmin = vi.mocked(createAdminClient);

const DRAFT_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/messaging/drafts/[id]/reject', () => {
  it('should reject a VA before loading or updating a draft', async () => {
    mockServer.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    } as unknown as Awaited<ReturnType<typeof createServerClient>>);

    const single = vi.fn(async () => ({
      data: { organization_id: 'org-1', role: 'va' },
      error: null,
    }));
    const eq = vi.fn(() => ({ single }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn((table: string) => {
      if (table !== 'users') throw new Error(`unexpected from(${table})`);
      return { select };
    });
    mockAdmin.mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createAdminClient>);

    const response = await POST({} as NextRequest, {
      params: Promise.resolve({ id: DRAFT_ID }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Forbidden',
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('users');
  });
});
