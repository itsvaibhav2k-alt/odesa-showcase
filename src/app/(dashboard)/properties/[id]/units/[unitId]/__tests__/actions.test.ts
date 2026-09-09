/**
 * Unit tests for `createWorkOrderAction` (the unit-detail "file a request"
 * server action).
 *
 * The action crosses one boundary: the RLS-scoped SSR Supabase client, used
 * for the auth gate, the `units` → `property_id` lookup, the security lease
 * check, and the audited work-order creation RPC. Every read/write goes through
 * `createServerClient()` — there is no admin-client path here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

// The action module also imports the admin client (for a sibling action); we
// stub it so the module loads, but createWorkOrderAction never touches it.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/agent/worker/handlers/update-tenant-preference', () => ({
  handleUpdateTenantPreference: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

import { createWorkOrderAction } from '../actions';

const mockCreateServerClient = vi.mocked(createServerClient);
const mockRevalidatePath = vi.mocked(revalidatePath);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
const UNIT_ID = '11111111-1111-4111-8111-111111111111';
const PROP_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ID = '33333333-3333-4333-8333-333333333333';

interface StubTables {
  users: Array<Record<string, unknown>>;
  units: Array<Record<string, unknown>>;
  leases: Array<Record<string, unknown>>;
  work_orders: Array<Record<string, unknown>>;
}

interface StubOptions {
  userId?: string | null;
  users?: Array<Record<string, unknown>>;
  units?: Array<Record<string, unknown>>;
  leases?: Array<Record<string, unknown>>;
  insertError?: string;
}

interface ServerStub {
  client: Awaited<ReturnType<typeof createServerClient>>;
  tables: StubTables;
  inserted: Array<{ table: string; row: Record<string, unknown> }>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function buildServerStub(opts: StubOptions = {}): ServerStub {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  const tables: StubTables = {
    users: opts.users ?? [{ id: TEST_USER_ID, organization_id: TEST_ORG_ID }],
    units: opts.units ?? [],
    leases: opts.leases ?? [],
    work_orders: [],
  };
  const inserted: ServerStub['inserted'] = [];
  const rpcCalls: ServerStub['rpcCalls'] = [];

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId, email: 'op@test.test' } : null },
        error: null,
      })),
    },
    from: (table: keyof StubTables) => {
      const rows = tables[table] ?? [];
      const predicates: Array<{ col: string; value: unknown }> = [];
      const match = () =>
        rows.find((r) => predicates.every((p) => r[p.col] === p.value)) ?? null;

      const chain: Record<string, unknown> = {
        select() {
          return chain;
        },
        eq(col: string, value: unknown) {
          predicates.push({ col, value });
          return chain;
        },
        maybeSingle() {
          return Promise.resolve({ data: match(), error: null });
        },
        single() {
          return Promise.resolve({ data: match(), error: null });
        },
        insert(row: Record<string, unknown>) {
          if (opts.insertError) {
            return {
              select() {
                return {
                  single: async () => ({
                    data: null,
                    error: { message: opts.insertError },
                  }),
                };
              },
            };
          }
          const id = (row.id as string | undefined) ?? `wo-${inserted.length + 1}`;
          const persisted = { ...row, id };
          tables[table]!.push(persisted);
          inserted.push({ table: table as string, row: persisted });
          return {
            select() {
              return {
                single: async () => ({ data: { id }, error: null }),
              };
            },
          };
        },
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (opts.insertError) {
        return { data: null, error: { message: opts.insertError } };
      }
      return { data: { id: 'wo-1' }, error: null };
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>;

  return { client, tables, inserted, rpcCalls };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    unitId: UNIT_ID,
    tenantId: null as string | null,
    category: 'plumbing' as const,
    urgency: 'routine' as const,
    description: 'Kitchen sink is leaking under the cabinet.',
    entryConsent: true,
    ...overrides,
  };
}

describe('properties/units/actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createWorkOrderAction', () => {
    it('should fail when no signed-in user', async () => {
      const stub = buildServerStub({ userId: null });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(validPayload());

      expect(result).toEqual({ success: false, error: 'Not authenticated' });
      expect(stub.inserted).toHaveLength(0);
    });

    it('should reject an invalid category via zod', async () => {
      const stub = buildServerStub();
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(
        validPayload({ category: 'banana' }),
      );

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        'category',
      );
      expect(stub.inserted).toHaveLength(0);
    });

    it('should reject an invalid urgency via zod', async () => {
      const stub = buildServerStub();
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(
        validPayload({ urgency: 'high' }),
      );

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        'urgency',
      );
    });

    it('should reject an empty description via zod', async () => {
      const stub = buildServerStub();
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(
        validPayload({ description: '   ' }),
      );

      expect(result.success).toBe(false);
      expect((result as { success: false; error: string }).error).toContain(
        'description',
      );
      expect(stub.inserted).toHaveLength(0);
    });

    it('should fail with "Unit not found" when the unit is not visible', async () => {
      const stub = buildServerStub({ units: [] });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(validPayload());

      expect(result).toEqual({ success: false, error: 'Unit not found' });
      expect(stub.inserted).toHaveLength(0);
    });

    it('should fail with "Tenant not found for unit" when no lease joins them', async () => {
      const stub = buildServerStub({
        units: [{ id: UNIT_ID, property_id: PROP_ID }],
        leases: [], // no lease for this tenant/unit
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(
        validPayload({ tenantId: TENANT_ID }),
      );

      expect(result).toEqual({
        success: false,
        error: 'Tenant not found for unit',
      });
      expect(stub.inserted).toHaveLength(0);
    });

    it('should create through the audited RPC and revalidate on the happy path', async () => {
      const stub = buildServerStub({
        units: [{ id: UNIT_ID, property_id: PROP_ID }],
        leases: [{ id: 'lease-1', unit_id: UNIT_ID, tenant_id: TENANT_ID }],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(
        validPayload({
          tenantId: TENANT_ID,
          category: 'hvac',
          urgency: 'emergency',
          applianceLabel: 'HVAC · Carrier 24ABC6',
        }),
      );

      expect(result.success).toBe(true);
      expect((result as { success: true; data: { id: string } }).data.id).toBe(
        'wo-1',
      );

      expect(stub.rpcCalls).toEqual([
        {
          name: 'create_work_order_audited',
          args: expect.objectContaining({
            p_unit_id: UNIT_ID,
            p_tenant_id: TENANT_ID,
            p_category: 'hvac',
            p_urgency: 'emergency',
            p_description: expect.stringContaining(
              'Related appliance: HVAC · Carrier 24ABC6.',
            ),
          }),
        },
      ]);

      // 3 revalidatePath calls, all using the SERVER-derived property id.
      expect(mockRevalidatePath).toHaveBeenCalledTimes(3);
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        `/properties/${PROP_ID}/units/${UNIT_ID}`,
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/properties/${PROP_ID}`);
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        `/properties/${PROP_ID}/maintenance`,
      );
    });

    it('should insert with a null tenant_id when no tenant is provided', async () => {
      const stub = buildServerStub({
        units: [{ id: UNIT_ID, property_id: PROP_ID }],
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(validPayload());

      expect(result.success).toBe(true);
      expect(stub.rpcCalls[0]?.args.p_tenant_id).toBeNull();
    });

    it('should propagate the insert error message', async () => {
      const stub = buildServerStub({
        units: [{ id: UNIT_ID, property_id: PROP_ID }],
        insertError: 'duplicate key value violates unique constraint',
      });
      mockCreateServerClient.mockResolvedValue(stub.client);

      const result = await createWorkOrderAction(validPayload());

      expect(result).toEqual({
        success: false,
        error: 'duplicate key value violates unique constraint',
      });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });
});
