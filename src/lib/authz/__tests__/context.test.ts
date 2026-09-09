/**
 * Unit tests for `src/lib/authz/context.ts`.
 *
 * `requireAccessContext()` is the single server-side access seam, so the
 * load-bearing assertions here are the fail-closed ones: no session, an
 * unreadable `organization_memberships` row, a row without an organization,
 * and a row without a role must all deny with the exact status/message
 * existing call sites map.
 *
 * Wave 1b moved org + role off `users` onto `organization_memberships`, so the
 * stub models the membership read: the row is targeted by
 * `(user_id, status='active')` and `.single()` carries the "zero or two active
 * memberships both deny" semantics.
 *
 * The module crosses one boundary — the cookie-bound server client — which we
 * mock so nothing touches cookies or the network. The stub only implements the
 * slice of supabase-js this module uses: `auth.getUser()` and
 * `.from().select().eq().eq().single()`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

import { RESERVED_OWNER_CAPABILITIES } from '../access-policy';
import { requireAccessContext } from '../context';

const mockCreateServerClient = vi.mocked(createServerClient);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';

interface MembershipRow {
  id: string;
  organization_id: string | null;
  role: string | null;
  all_properties: boolean;
  membership_capability_overrides: Array<{
    capability: string;
    effect: 'allow' | 'deny';
  }>;
  membership_property_grants: Array<{ property_id: string }>;
}

interface StubOptions {
  /** `null` means "no session". */
  userId?: string | null;
  row?: Partial<MembershipRow> | null;
  rowError?: { message: string } | null;
}

interface ClientStub {
  client: SupabaseClient<Database>;
  from: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  /** `.eq(column, value)` calls recorded from the membership read. */
  eqCalls: Array<[string, unknown]>;
  selectCalls: string[];
}

function buildClientStub(opts: StubOptions = {}): ClientStub {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  const defaultRow: MembershipRow = {
    id: 'membership-1',
    organization_id: TEST_ORG_ID,
    role: 'owner',
    all_properties: true,
    membership_capability_overrides: [],
    membership_property_grants: [],
  };
  const row = opts.row === null
    ? null
    : { ...defaultRow, ...(opts.row ?? {}) };
  const error = opts.rowError ?? null;

  const eqCalls: Array<[string, unknown]> = [];
  const selectCalls: string[] = [];

  const getUser = vi.fn(async () => ({
    data: { user: userId ? { id: userId } : null },
    error: null,
  }));

  const from = vi.fn((table: string) => ({
    // Recorded on the mock so a test can assert WHICH table was read,
    // not just that some read happened.
    table,
    select: (columns: string) => {
      selectCalls.push(columns);
      // `.eq()` chains (user_id, then status), so it returns itself.
      const builder = {
        eq: (column: string, value: unknown) => {
          eqCalls.push([column, value]);
          return builder;
        },
        single: async () => ({ data: error ? null : row, error }),
      };
      return builder;
    },
  }));

  const client = { auth: { getUser }, from } as unknown as SupabaseClient<Database>;
  return { client, from, getUser, eqCalls, selectCalls };
}

describe('authz/context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requireAccessContext', () => {
    it('should return 401 Not authenticated when there is no session', async () => {
      const stub = buildClientStub({ userId: null });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result).toEqual({ ok: false, status: 401, error: 'Not authenticated' });
      // Fail closed BEFORE any row read.
      expect(stub.from).not.toHaveBeenCalled();
    });

    it('should return 403 Forbidden when the membership row read errors', async () => {
      const stub = buildClientStub({ rowError: { message: 'no rows returned' } });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    });

    it('should return 403 Forbidden when the caller has more than one active membership', async () => {
      // PostgREST `.single()` errors rather than picking a winner, which is
      // the whole point: current_user_org_id() resolves NULL in that state.
      const stub = buildClientStub({
        rowError: { message: 'JSON object requested, multiple (or no) rows returned' },
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    });

    it('should return 403 Forbidden when organization_id is null', async () => {
      const stub = buildClientStub({ row: { organization_id: null, role: 'owner' } });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    });

    it('should return 403 Forbidden when role is null', async () => {
      const stub = buildClientStub({ row: { organization_id: TEST_ORG_ID, role: null } });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    });

    it('should return the context with propertyScope all when the role is owner', async () => {
      const stub = buildClientStub({ row: { organization_id: TEST_ORG_ID, role: 'owner' } });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.userId).toBe(TEST_USER_ID);
      expect(result.context.organizationId).toBe(TEST_ORG_ID);
      expect(result.context.role).toBe('owner');
      expect(result.context.propertyScope).toBe('all');
      expect(result.context.capabilities.has('record_payment')).toBe(true);
      // The row is targeted by the authenticated user id, never a client value.
      expect(stub.selectCalls).toEqual([
        'id, organization_id, role, all_properties, membership_capability_overrides(capability, effect), membership_property_grants!membership_property_grants_membership_id_fkey(property_id)',
      ]);
      expect(stub.eqCalls).toEqual([
        ['user_id', TEST_USER_ID],
        ['status', 'active'],
      ]);
    });

    it('should grant managers a non-empty set without reserved owner capabilities', async () => {
      const stub = buildClientStub({ row: { role: 'manager', all_properties: false } });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { capabilities } = result.context;
      expect(capabilities.size).toBeGreaterThan(0);
      expect(capabilities.has('view_inbox')).toBe(true);
      for (const reserved of RESERVED_OWNER_CAPABILITIES) {
        expect(capabilities.has(reserved)).toBe(false);
      }
      expect(result.context.propertyScope).toEqual([]);
    });

    it('should fail closed when the persisted role is unknown', async () => {
      const stub = buildClientStub({
        row: { role: 'super_admin', all_properties: true },
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' });
    });

    it('should resolve explicit property grants without widening to the organization', async () => {
      const stub = buildClientStub({
        row: {
          role: 'manager',
          all_properties: false,
          membership_property_grants: [
            { property_id: 'property-b' },
            { property_id: 'property-a' },
            { property_id: 'property-b' },
          ],
        },
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.propertyScope).toEqual(['property-a', 'property-b']);
    });

    it('should honor all-properties only when the membership explicitly carries it', async () => {
      const stub = buildClientStub({ row: { role: 'manager', all_properties: true } });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.propertyScope).toBe('all');
    });

    it('should apply persisted capability overrides in database order', async () => {
      const stub = buildClientStub({
        row: {
          role: 'manager',
          all_properties: false,
          membership_capability_overrides: [
            { capability: 'view_calls', effect: 'deny' },
            { capability: 'view_financials', effect: 'allow' },
          ],
        },
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await requireAccessContext();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.capabilities.has('view_calls')).toBe(false);
      expect(result.context.capabilities.has('view_financials')).toBe(true);
    });

    it('should read the membership row through the db option when one is passed', async () => {
      const passed = buildClientStub({ row: { organization_id: TEST_ORG_ID, role: 'manager' } });
      const server = buildClientStub({ row: { organization_id: 'org-default', role: 'owner' } });
      mockCreateServerClient.mockResolvedValue(server.client);

      const result = await requireAccessContext({ db: passed.client });

      expect(passed.from).toHaveBeenCalledWith('organization_memberships');
      expect(server.from).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.organizationId).toBe(TEST_ORG_ID);
      expect(result.context.role).toBe('manager');
    });

    it('should resolve the signed-in user through the auth option when one is passed', async () => {
      const passed = buildClientStub({ userId: 'user-from-auth-option' });
      const server = buildClientStub({ userId: 'user-from-server-client' });
      mockCreateServerClient.mockResolvedValue(server.client);

      const result = await requireAccessContext({ auth: passed.client });

      expect(passed.getUser).toHaveBeenCalledTimes(1);
      expect(server.getUser).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.userId).toBe('user-from-auth-option');
      // The row read still falls back to the server client.
      expect(server.from).toHaveBeenCalledWith('organization_memberships');
    });

    it('should create the server client at most once when no options are passed', async () => {
      const stub = buildClientStub();
      mockCreateServerClient.mockResolvedValue(stub.client);

      await requireAccessContext();

      expect(mockCreateServerClient).toHaveBeenCalledTimes(1);
    });

    it('should not create a server client when both options are passed', async () => {
      const stub = buildClientStub({ row: { organization_id: TEST_ORG_ID, role: 'va' } });

      const result = await requireAccessContext({ db: stub.client, auth: stub.client });

      expect(mockCreateServerClient).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });
});
