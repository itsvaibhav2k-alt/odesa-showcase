/**
 * Unit tests for the `addTenantAction` role gate.
 *
 * Adding a tenant activates a lease with owner-supplied terms via the
 * authenticated transactional RPC, so it is owner-only both in the action
 * and at the database boundary. The RPC owns vacancy recheck, tenant + lease
 * atomicity, concurrency serialization, and request idempotency.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';

import { addTenantAction } from '../actions';

const mockServer = vi.mocked(createServerClient);
const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const PROPERTY_ID = '33333333-3333-3333-3333-333333333301';
const UNIT_ID = '33333333-3333-3333-3333-333333333302';
const TENANT_ID = 'tenant-1';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';

function stubServerClient(
  role: string | null,
  rpcResult: { data: unknown; error: { message: string } | null } = {
    data: [{ tenant_id: TENANT_ID, lease_id: 'lease-1', idempotent: false }],
    error: null,
  },
): ReturnType<typeof vi.fn> {
  const rpc = vi.fn(async () => rpcResult);
  mockServer.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { organization_id: ORG_ID, role },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected server from(${table})`);
    }),
    rpc,
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
  return rpc;
}

function tenantForm(): FormData {
  const form = new FormData();
  form.set('unitId', UNIT_ID);
  form.set('fullName', 'Jessica Kim');
  form.set('phone', '+15715551111');
  form.set('monthlyRent', '1950');
  form.set('startDate', '2026-08-01');
  form.set('requestId', REQUEST_ID);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addTenantAction', () => {
  it.each(['manager', 'va', null])(
    'should return Forbidden for role %s with no tenant or lease write',
    async (role) => {
      stubServerClient(role);
      const rpc = stubServerClient(role);

      const result = await addTenantAction(
        { propertyId: PROPERTY_ID },
        tenantForm(),
      );

      expect(result).toEqual({ success: false, error: 'Forbidden' });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it('should add the tenant and promote the draft lease for role owner', async () => {
    const rpc = stubServerClient('owner');

    const result = await addTenantAction(
      { propertyId: PROPERTY_ID },
      tenantForm(),
    );

    expect(result).toEqual({ success: true, data: { tenantId: TENANT_ID } });
    expect(rpc).toHaveBeenCalledWith('create_tenant_with_active_lease', {
      p_email: null,
      p_full_name: 'Jessica Kim',
      p_idempotency_key: REQUEST_ID,
      p_phone_e164: '+15715551111',
      p_property_id: PROPERTY_ID,
      p_rent_amount: 1950,
      p_start_date: '2026-08-01',
      p_unit_id: UNIT_ID,
    });
  });

  it('should return a truthful vacancy conflict from the atomic RPC', async () => {
    stubServerClient('owner', {
      data: null,
      error: { message: 'unit_not_vacant' },
    });

    const result = await addTenantAction(
      { propertyId: PROPERTY_ID },
      tenantForm(),
    );

    expect(result).toEqual({
      success: false,
      error: 'That unit is no longer vacant. Refresh and choose another unit.',
    });
  });

  it('should replay an identical request id as a success without another logical write', async () => {
    const rpc = stubServerClient('owner', {
      data: [{ tenant_id: TENANT_ID, lease_id: 'lease-1', idempotent: true }],
      error: null,
    });

    const result = await addTenantAction(
      { propertyId: PROPERTY_ID },
      tenantForm(),
    );

    expect(result).toEqual({ success: true, data: { tenantId: TENANT_ID } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'letters only', '+', '12345', '0000000000'])(
    'should reject invalid phone identity %j before the RPC',
    async (phone) => {
      const rpc = stubServerClient('owner');
      const form = tenantForm();
      form.set('phone', phone);

      const result = await addTenantAction({ propertyId: PROPERTY_ID }, form);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toMatch(/phone/i);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});
