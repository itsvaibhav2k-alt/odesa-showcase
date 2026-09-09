import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/agent/worker/providers/select', () => ({
  selectProvider: vi.fn(),
  PrivacyModeMisconfiguredError: class extends Error {},
}));

import { createServerClient } from '@/lib/supabase/server';

import {
  updatePrivacyMode,
  updateProperty,
  updateRulebook,
} from '../actions';

const mockServer = vi.mocked(createServerClient);

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333301';

interface PropertyClientStub {
  update: ReturnType<typeof vi.fn>;
  client: Awaited<ReturnType<typeof createServerClient>>;
}

function stubServerClient(
  role: 'owner' | 'manager' | 'va',
): PropertyClientStub {
  const update = vi.fn((values: Record<string, unknown>) => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: {
            id: PROPERTY_ID,
            rules_text: values.rules_text ?? '',
            privacy_mode: values.privacy_mode ?? 'hosted',
            ollama_host: values.ollama_host ?? null,
          },
          error: null,
        })),
      })),
    })),
  }));

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'users') {
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
      }
      if (table === 'properties') return { update };
      throw new Error(`unexpected from(${table})`);
    }),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>;

  mockServer.mockResolvedValue(client);
  return { update, client };
}

function propertyForm(): FormData {
  const form = new FormData();
  form.set('name', 'Oak Street Homes');
  form.set('addressStreet', '10 Oak Street');
  form.set('addressCity', 'Richmond');
  form.set('addressState', 'VA');
  form.set('addressZip', '23220');
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('property configuration owner gates', () => {
  it.each(['va', 'manager'] as const)(
    'denies rulebook writes for role %s',
    async (role) => {
      const { update } = stubServerClient(role);

      const result = await updateRulebook({
        propertyId: PROPERTY_ID,
        rulesText: 'Owner-authored rules',
      });

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each(['va', 'manager'] as const)(
    'denies name and address writes for role %s',
    async (role) => {
      const { update } = stubServerClient(role);

      const result = await updateProperty(
        { propertyId: PROPERTY_ID },
        propertyForm(),
      );

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each(['va', 'manager'] as const)(
    'denies privacy/provider configuration writes for role %s',
    async (role) => {
      const { update } = stubServerClient(role);

      const result = await updatePrivacyMode({
        propertyId: PROPERTY_ID,
        privacyMode: 'on_prem',
        ollamaHost: 'http://localhost:11434',
      });

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('allows an owner to update the rulebook', async () => {
    const { update } = stubServerClient('owner');

    const result = await updateRulebook({
      propertyId: PROPERTY_ID,
      rulesText: 'Quiet hours start at 10 PM.',
    });

    expect(result).toEqual({
      success: true,
      data: {
        propertyId: PROPERTY_ID,
        rulesText: 'Quiet hours start at 10 PM.',
      },
    });
    expect(update).toHaveBeenCalledWith({
      rules_text: 'Quiet hours start at 10 PM.',
    });
  });

  it('allows an owner to update property name and address', async () => {
    const { update } = stubServerClient('owner');

    const result = await updateProperty(
      { propertyId: PROPERTY_ID },
      propertyForm(),
    );

    expect(result).toEqual({
      success: true,
      data: { propertyId: PROPERTY_ID },
    });
    expect(update).toHaveBeenCalledWith({
      name: 'Oak Street Homes',
      address_street: '10 Oak Street',
      address_city: 'Richmond',
      address_state: 'VA',
      address_zip: '23220',
    });
  });

  it('allows an owner to update privacy/provider configuration', async () => {
    const { update } = stubServerClient('owner');

    const result = await updatePrivacyMode({
      propertyId: PROPERTY_ID,
      privacyMode: 'on_prem',
      ollamaHost: 'http://localhost:11434',
    });

    expect(result).toEqual({
      success: true,
      data: {
        propertyId: PROPERTY_ID,
        privacyMode: 'on_prem',
        ollamaHost: 'http://localhost:11434',
      },
    });
    expect(update).toHaveBeenCalledWith({
      privacy_mode: 'on_prem',
      ollama_host: 'http://localhost:11434',
    });
  });
});
