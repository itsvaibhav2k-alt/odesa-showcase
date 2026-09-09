/**
 * Unit tests for `POST /api/import/commit`.
 *
 * Verifies UPSERTs are issued in dependency order (properties → units →
 * tenants → leases) on a fresh org, and that re-running the commit on
 * the same CSV is a no-op (every item is tagged will_skip).
 */

import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

import { POST } from '../commit/route';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCreateServerClient = vi.mocked(createServerClient);

const ORG_ID = '11111111-1111-4111-8111-111111111111';

function stubServerClient(opts: {
  userId?: string | null;
  role?: string | null;
  organizationId?: string | null;
  membershipError?: { message: string } | null;
} = {}): void {
  const userId = opts.userId === undefined ? 'user-1' : opts.userId;
  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId, email: 'op@test.test' } : null },
        error: null,
      })),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: opts.membershipError ? null : {
              organization_id: opts.organizationId === undefined ? ORG_ID : opts.organizationId,
              role: opts.role === undefined ? 'owner' : opts.role,
            },
            error: opts.membershipError ?? null,
          }),
        }),
      }),
    })),
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

/**
 * Build an admin client whose select/maybeSingle supports annotation and
 * whose RPC records the single transactional commit boundary.
 */
function stubAdminClient(opts: {
  /** Each select.maybeSingle() pulls one entry from this queue per table. */
  selectQueue: Record<string, Array<{ data: unknown; error: unknown }>>;
  rpcResult?: { data: unknown; error: unknown };
}): { rpcCalls: Array<{ name: string; args: Record<string, unknown> }> } {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.ilike = vi.fn(() => builder);
    builder.is = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => {
      const queue = opts.selectQueue[table] ?? [];
      return queue.shift() ?? { data: null, error: null };
    });
    builder.single = vi.fn(async () => {
      const queue = opts.selectQueue[table] ?? [];
      return queue.shift() ?? { data: null, error: null };
    });
    return builder;
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return opts.rpcResult ?? {
      data: {
        summary: {
          inserted: { properties: 1, units: 1, tenants: 1, leases: 1 },
          skipped: { properties: 0, units: 0, tenants: 0, leases: 0 },
          errors: [],
        },
        replay: false,
      },
      error: null,
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockCreateAdminClient.mockReturnValue({ from, rpc } as any);
  return { rpcCalls };
}

function makeFormData(source: string, csv: string): FormData {
  const fd = new FormData();
  fd.set('source', source);
  fd.set('file', new File([csv], 'test.csv', { type: 'text/csv' }));
  return fd;
}

// jsdom doesn't round-trip File entries through `new Request(...)`. We
// hand-mock the request shape the route handler needs.
function makeReq(formData: FormData): NextRequest {
  return {
    formData: async () => formData,
    nextUrl: new URL('http://test/api/import/commit'),
    url: 'http://test/api/import/commit',
    method: 'POST',
    headers: new Headers({ 'Idempotency-Key': '11111111-1111-4111-8111-111111111199' }),
  } as unknown as NextRequest;
}

function makeReqWithoutKey(formData: FormData): NextRequest {
  return {
    ...makeReq(formData),
    headers: new Headers(),
  } as unknown as NextRequest;
}

const SAMPLE_CSV = `property_name,property_address,unit_label,tenant_first_name,tenant_last_name,tenant_phone,lease_rent,lease_start,lease_due_day
Vaba House,"123 Main St, Arlington, VA 22201",1,Test,Person,(202) 555-0101,1800,2025-06-01,1
`;

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/import/commit', () => {
  it('returns 401 when unauthenticated before admin access', async () => {
    stubServerClient({ userId: null });
    const res = await POST(makeReq(makeFormData('generic', SAMPLE_CSV)));
    expect(res.status).toBe(401);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it.each(['manager', 'va', 'member', null])(
    'returns 403 for authenticated role %s with zero writes',
    async (role) => {
      stubServerClient({ role });
      const res = await POST(makeReq(makeFormData('generic', SAMPLE_CSV)));
      expect(res.status).toBe(403);
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['missing membership', { organizationId: null }],
    ['membership lookup error', { membershipError: { message: 'lookup failed' } }],
  ])('returns 403 for %s with zero writes', async (_label, opts) => {
    stubServerClient(opts);
    const res = await POST(makeReq(makeFormData('generic', SAMPLE_CSV)));
    expect(res.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
  it('requires a durable idempotency key before parsing or writing', async () => {
    stubServerClient();
    const res = await POST(makeReqWithoutKey(makeFormData('generic', SAMPLE_CSV)));
    expect(res.status).toBe(400);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
  it('rejects malformed required rows before opening the transaction', async () => {
    stubServerClient();
    const malformed = SAMPLE_CSV.replace('1800,2025', 'not-rent,2025');
    const res = await POST(makeReq(makeFormData('generic', malformed)));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.validation.issues).toEqual([
      expect.objectContaining({ row: 2, field: 'lease_rent', code: 'required_row_invalid' }),
    ]);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
  it('uses exactly one transactional RPC for a fresh org', async () => {
    stubServerClient();
    const { rpcCalls } = stubAdminClient({
      selectQueue: {
        // annotatePlan: properties / units / tenants / leases each look
        // up "does this exist?" — answer "no":
        properties: [{ data: null, error: null }],
        units: [{ data: null, error: null }],
        tenants: [{ data: null, error: null }],
        leases: [{ data: null, error: null }],
      },
    });

    const res = await POST(makeReq(makeFormData('generic', SAMPLE_CSV)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.summary.inserted.properties).toBe(1);
    expect(json.summary.inserted.units).toBe(1);
    expect(json.summary.inserted.tenants).toBe(1);
    expect(json.summary.inserted.leases).toBe(1);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toMatchObject({
      name: 'commit_portfolio_import',
      args: {
        p_organization_id: ORG_ID,
        p_idempotency_key: '11111111-1111-4111-8111-111111111199',
        p_source: 'generic',
      },
    });
  });

  it('is idempotent: re-running on the same CSV inserts nothing', async () => {
    stubServerClient();
    const { rpcCalls } = stubAdminClient({
      selectQueue: {
        // Everything already exists — annotatePlan tags will_skip.
        properties: [{ data: { id: 'p1' }, error: null }],
        units: [{ data: { id: 'u1' }, error: null }],
        tenants: [{ data: { id: 't1' }, error: null }],
        leases: [{ data: { id: 'l1' }, error: null }],
      },
      rpcResult: {
        data: {
          summary: {
            inserted: { properties: 0, units: 0, tenants: 0, leases: 0 },
            skipped: { properties: 1, units: 1, tenants: 1, leases: 1 },
            errors: [],
          },
          replay: true,
        },
        error: null,
      },
    });

    const res = await POST(makeReq(makeFormData('generic', SAMPLE_CSV)));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.summary.inserted).toEqual({ properties: 0, units: 0, tenants: 0, leases: 0 });
    expect(json.replay).toBe(true);
    expect(rpcCalls).toHaveLength(1);
  });

  it('returns 409 unit_not_vacant for an occupancy conflict', async () => {
    stubServerClient();
    stubAdminClient({
      selectQueue: {},
      rpcResult: { data: null, error: { code: '23505', message: 'unit_not_vacant' } },
    });
    const res = await POST(makeReq(makeFormData('generic', SAMPLE_CSV)));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: 'unit_not_vacant',
    });
  });

  it('returns 400 for invalid source', async () => {
    stubServerClient();
    stubAdminClient({ selectQueue: {} });

    const res = await POST(makeReq(makeFormData('mystery', SAMPLE_CSV)));
    expect(res.status).toBe(400);
  });
});
