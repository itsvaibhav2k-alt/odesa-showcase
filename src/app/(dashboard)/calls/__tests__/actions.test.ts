import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/voice/settings', () => ({
  getVoiceSettings: vi.fn(),
  upsertVoiceSettings: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';
import {
  getVoiceSettings,
  upsertVoiceSettings,
} from '@/lib/voice/settings';

import { updateVoiceSettings } from '../actions';

const mockRevalidatePath = vi.mocked(revalidatePath);
const mockServer = vi.mocked(createServerClient);
const mockGetVoiceSettings = vi.mocked(getVoiceSettings);
const mockUpsertVoiceSettings = vi.mocked(upsertVoiceSettings);

const USER_ID = 'user-1';
const ORG_ID = 'org-1';

function stubServerClient(role: 'owner' | 'manager' | 'va') {
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table !== 'users') throw new Error(`unexpected from(${table})`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { organization_id: ORG_ID, role },
              error: null,
            })),
          })),
        })),
      };
    }),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>;
  mockServer.mockResolvedValue(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertVoiceSettings.mockResolvedValue({ ok: true });
});

describe('updateVoiceSettings', () => {
  it.each(['va', 'manager'] as const)(
    'denies role %s before settings reads or writes',
    async (role) => {
      stubServerClient(role);

      const result = await updateVoiceSettings({ voiceEnabled: true });

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(mockGetVoiceSettings).not.toHaveBeenCalled();
      expect(mockUpsertVoiceSettings).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
      expect(mockServer).toHaveBeenCalledTimes(1);
    },
  );

  it('allows an owner to persist voice settings', async () => {
    const client = stubServerClient('owner');

    const result = await updateVoiceSettings({ voiceEnabled: true });

    expect(result).toEqual({ success: true, data: { saved: true } });
    expect(mockUpsertVoiceSettings).toHaveBeenCalledWith(client, {
      organizationId: ORG_ID,
      voiceEnabled: true,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calls');
  });
});
