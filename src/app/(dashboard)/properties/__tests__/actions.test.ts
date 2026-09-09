/**
 * Unit tests for `deletePortfolioProperty` (the property-map trash tool).
 *
 * The action crosses one boundary: the RLS-scoped SSR Supabase client, used
 * for the auth gate and the `properties` delete. A 0-row delete (cross-org
 * or already-deleted id) must surface as 'Property not found', never as a
 * silent success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

import { deletePortfolioProperty } from '../actions';

const mockCreateServerClient = vi.mocked(createServerClient);
const mockRevalidatePath = vi.mocked(revalidatePath);

const TEST_USER_ID = 'user-1';
const TEST_ORG_ID = 'org-1';
// Seed-style id on purpose: zod 4's strict `.uuid()` rejects this shape, the
// lenient schema in the action must accept it.
const PROPERTY_ID = '33333333-3333-3333-3333-333333333301';

interface StubOptions {
  userId?: string | null;
  deletedRow?: { id: string } | null;
  deleteError?: string;
}

function buildServerStub(opts: StubOptions = {}) {
  const userId = opts.userId === undefined ? TEST_USER_ID : opts.userId;
  const deleteCalls: Array<{ column: string; value: unknown }> = [];

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId } : null },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { organization_id: TEST_ORG_ID },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'properties') {
        return {
          delete: () => ({
            eq: (column: string, value: unknown) => {
              deleteCalls.push({ column, value });
              return {
                select: () => ({
                  maybeSingle: async () =>
                    opts.deleteError
                      ? { data: null, error: { message: opts.deleteError } }
                      : { data: opts.deletedRow ?? null, error: null },
                }),
              };
            },
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { client: client as never, deleteCalls };
}

describe('deletePortfolioProperty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should delete the property and revalidate when the row exists', async () => {
    const stub = buildServerStub({ deletedRow: { id: PROPERTY_ID } });
    mockCreateServerClient.mockResolvedValue(stub.client);

    const result = await deletePortfolioProperty({ propertyId: PROPERTY_ID });

    expect(result).toEqual({ success: true, data: { id: PROPERTY_ID } });
    expect(stub.deleteCalls).toEqual([{ column: 'id', value: PROPERTY_ID }]);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/properties');
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/properties/${PROPERTY_ID}`,
    );
  });

  it('should return an error when not authenticated', async () => {
    const stub = buildServerStub({ userId: null });
    mockCreateServerClient.mockResolvedValue(stub.client);

    const result = await deletePortfolioProperty({ propertyId: PROPERTY_ID });

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(stub.deleteCalls).toHaveLength(0);
  });

  it('should reject a non-uuid property id before touching the database', async () => {
    const stub = buildServerStub();
    mockCreateServerClient.mockResolvedValue(stub.client);

    const result = await deletePortfolioProperty({ propertyId: 'not-a-uuid' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid property id');
    }
    expect(stub.deleteCalls).toHaveLength(0);
  });

  it('should return not-found when the delete touches zero rows', async () => {
    const stub = buildServerStub({ deletedRow: null });
    mockCreateServerClient.mockResolvedValue(stub.client);

    const result = await deletePortfolioProperty({ propertyId: PROPERTY_ID });

    expect(result).toEqual({ success: false, error: 'Property not found' });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('should propagate database errors', async () => {
    const stub = buildServerStub({ deleteError: 'permission denied' });
    mockCreateServerClient.mockResolvedValue(stub.client);

    const result = await deletePortfolioProperty({ propertyId: PROPERTY_ID });

    expect(result).toEqual({ success: false, error: 'permission denied' });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
