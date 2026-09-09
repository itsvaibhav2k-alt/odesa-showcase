import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/agent/operator/persist', () => ({
  loadOrCreateChat: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { loadOrCreateChat } from '@/lib/agent/operator/persist';
import { createServerClient } from '@/lib/supabase/server';

import { POST } from '../route';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);
const mockLoadOrCreateChat = vi.mocked(loadOrCreateChat);

describe('POST /api/chat/property/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['manager', 'va', 'accountant'])(
    'rejects the %s role before creating an admin-backed chat',
    async (role) => {
      mockCreateServerClient.mockResolvedValue({
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: 'user-1' } },
            error: null,
          })),
        },
        from: vi.fn((table: string) => {
          if (table !== 'users') {
            throw new Error(`Unexpected table lookup: ${table}`);
          }
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { organization_id: 'org-1', role },
                  error: null,
                }),
              }),
            }),
          };
        }),
      } as unknown as Awaited<ReturnType<typeof createServerClient>>);

      const response = await POST(
        new NextRequest('http://localhost/api/chat/property/property-1', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'Summarize this property' }),
        }),
        { params: Promise.resolve({ id: 'property-1' }) },
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: 'Owner access required',
      });
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
      expect(mockLoadOrCreateChat).not.toHaveBeenCalled();
    },
  );
});
