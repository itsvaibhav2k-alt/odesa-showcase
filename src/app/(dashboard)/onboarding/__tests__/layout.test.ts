/**
 * Unit tests for the onboarding layout's auth + completion guards.
 *
 * The layout has three side-effecting branches we care about:
 *   1. The `users` row lookup must be scoped to the current auth'd user
 *      via `.eq('id', user.id)` before `.single()`. Without that filter
 *      the query relies on RLS alone, which has historically returned
 *      the wrong row in tests where RLS is bypassed (service role) and
 *      in production when multiple rows could match.
 *   2. When the org has an `odesa_phone_number` AND the user has
 *      `phone_verified_at`, the operator is bounced to `/today`.
 *   3. When the org has `odesa_phone_number` but the user is not yet
 *      verified, the operator is funnelled to `/onboarding/verify-phone`
 *      from any other onboarding subroute (and is allowed to remain on
 *      verify-phone itself without redirect-looping).
 *
 * We mock `next/navigation` so `redirect` is observable instead of
 * throwing, `next/headers` so `headers().get('x-pathname')` returns the
 * route the test is exercising, and `@/lib/supabase/server` so we can
 * assert the exact query chain the layout issues.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createServerClient } from '@/lib/supabase/server';

import OnboardingLayout from '../layout';

const mockRedirect = vi.mocked(redirect);
const mockHeaders = vi.mocked(headers);
const mockCreateServerClient = vi.mocked(createServerClient);

const TEST_USER_ID = 'user-abc';
const TEST_ORG_ID = 'org-xyz';

interface SupabaseStubOptions {
  user?: { id: string } | null;
  userRow?:
    | {
        organization_id: string;
        phone_verified_at: string | null;
        role: 'owner' | 'manager' | 'va';
      }
    | null;
  org?: { odesa_phone_number: string | null } | null;
}

interface SupabaseStubHandles {
  usersSelect: ReturnType<typeof vi.fn>;
  usersEq: ReturnType<typeof vi.fn>;
  usersSingle: ReturnType<typeof vi.fn>;
  orgsSelect: ReturnType<typeof vi.fn>;
  orgsEq: ReturnType<typeof vi.fn>;
  orgsSingle: ReturnType<typeof vi.fn>;
}

function stubSupabase(options: SupabaseStubOptions = {}): SupabaseStubHandles {
  const {
    user = { id: TEST_USER_ID },
    userRow = {
      organization_id: TEST_ORG_ID,
      phone_verified_at: null,
      role: 'owner',
    },
    org = null,
  } = options;

  const getUser = vi.fn(async () => ({ data: { user }, error: null }));

  const usersSingle = vi.fn(async () => ({ data: userRow, error: null }));
  const usersEq = vi.fn(() => ({ single: usersSingle }));
  const usersSelect = vi.fn(() => ({ eq: usersEq }));

  const orgsSingle = vi.fn(async () => ({ data: org, error: null }));
  const orgsEq = vi.fn(() => ({ single: orgsSingle }));
  const orgsSelect = vi.fn(() => ({ eq: orgsEq }));

  const from = vi.fn((table: string) => {
    if (table === 'users') {
      return { select: usersSelect };
    }
    if (table === 'organizations') {
      return { select: orgsSelect };
    }
    throw new Error(`Unexpected from("${table}")`);
  });

  mockCreateServerClient.mockResolvedValue({
    auth: { getUser },
    from,
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);

  return {
    usersSelect,
    usersEq,
    usersSingle,
    orgsSelect,
    orgsEq,
    orgsSingle,
  };
}

function stubHeaders(pathname: string): void {
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === 'x-pathname' ? pathname : null),
  } as unknown as Awaited<ReturnType<typeof headers>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubHeaders('/onboarding/property');
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('OnboardingLayout', () => {
  describe('users row lookup', () => {
    it('should scope the users query to the auth user via .eq("id", user.id) before .single()', async () => {
      const handles = stubSupabase();

      await OnboardingLayout({ children: null });

      expect(handles.usersSelect).toHaveBeenCalledWith(
        'organization_id, phone_verified_at, role',
      );
      expect(handles.usersEq).toHaveBeenCalledTimes(1);
      expect(handles.usersEq).toHaveBeenCalledWith('id', TEST_USER_ID);
      expect(handles.usersSingle).toHaveBeenCalledTimes(1);
      // .eq must be invoked before .single — eq returns the object that
      // exposes .single, so call order falls out of the chain shape, but
      // we double-check by invocation counts and call sequence.
      const eqOrder = handles.usersEq.mock.invocationCallOrder[0];
      const singleOrder = handles.usersSingle.mock.invocationCallOrder[0];
      expect(eqOrder).toBeLessThan(singleOrder);
    });
  });

  describe('auth guard', () => {
    it('should redirect to /login when the user is unauthenticated', async () => {
      stubSupabase({ user: null });

      await expect(
        OnboardingLayout({ children: null }),
      ).rejects.toThrow('REDIRECT:/login');

      expect(mockRedirect).toHaveBeenCalledWith('/login');
    });
  });

  describe('completion guard', () => {
    it('should redirect to /today when the org has a number AND user is verified', async () => {
      stubSupabase({
        userRow: {
          organization_id: TEST_ORG_ID,
          phone_verified_at: '2026-05-07T00:00:00Z',
          role: 'owner',
        },
        org: { odesa_phone_number: '+12025550100' },
      });

      await expect(
        OnboardingLayout({ children: null }),
      ).rejects.toThrow('REDIRECT:/today');

      expect(mockRedirect).toHaveBeenCalledWith('/today');
    });

    it('should redirect to /onboarding/verify-phone when number assigned but user unverified', async () => {
      stubHeaders('/onboarding/messaging');
      stubSupabase({
        userRow: {
          organization_id: TEST_ORG_ID,
          phone_verified_at: null,
          role: 'owner',
        },
        org: { odesa_phone_number: '+12025550100' },
      });

      await expect(
        OnboardingLayout({ children: null }),
      ).rejects.toThrow('REDIRECT:/onboarding/verify-phone');

      expect(mockRedirect).toHaveBeenCalledWith('/onboarding/verify-phone');
    });

    it('should NOT redirect when already on /onboarding/verify-phone with number assigned but user unverified', async () => {
      stubHeaders('/onboarding/verify-phone');
      stubSupabase({
        userRow: {
          organization_id: TEST_ORG_ID,
          phone_verified_at: null,
          role: 'owner',
        },
        org: { odesa_phone_number: '+12025550100' },
      });

      await OnboardingLayout({ children: null });

      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('should not redirect when org row is missing or has no number', async () => {
      stubSupabase({
        org: { odesa_phone_number: null },
      });

      // Returns the rendered tree without throwing.
      await OnboardingLayout({ children: null });

      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('redirects a VA away from every owner onboarding subroute', async () => {
      stubHeaders('/onboarding/property');
      const handles = stubSupabase({
        userRow: {
          organization_id: TEST_ORG_ID,
          phone_verified_at: null,
          role: 'va',
        },
      });

      await expect(
        OnboardingLayout({ children: null }),
      ).rejects.toThrow('REDIRECT:/today');

      expect(mockRedirect).toHaveBeenCalledWith('/today');
      expect(handles.orgsSelect).not.toHaveBeenCalled();
    });
  });
});
