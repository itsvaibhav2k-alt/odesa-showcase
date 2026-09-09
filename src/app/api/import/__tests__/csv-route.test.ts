/**
 * Unit tests for `POST /api/import/csv` (preview / dry-run).
 *
 * The route auth-gates, parses CSV, runs the source-specific mapper,
 * annotates the resulting plan against the DB, and returns counts +
 * tagged items.  We mock the Supabase clients at the module boundary
 * and feed in canned auth + DB lookup responses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

import { POST } from '../csv/route';

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
        data: {
          user: userId ? { id: userId, email: 'op@test.test' } : null,
        },
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
 * Stubs an admin client that returns "no existing rows" for every
 * select/lookup — equivalent to a fresh org.
 */
function stubAdminClientEmpty(): void {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.single = vi.fn(async () => ({ data: null, error: null }));

  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => builder),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function makeFormData(opts: { source?: string; file?: File | null }): FormData {
  const fd = new FormData();
  if (opts.source !== undefined) fd.set('source', opts.source);
  if (opts.file) fd.set('file', opts.file);
  return fd;
}

function makeCsvFile(text: string, name = 'test.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

/**
 * Wrap a FormData payload as something the route handler can consume —
 * jsdom doesn't round-trip File entries through new Request(...) cleanly,
 * so we hand-mock the `formData()` method.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(formData: FormData): any {
  return {
    formData: async () => formData,
    nextUrl: new URL('http://test/api/import/csv'),
    url: 'http://test/api/import/csv',
    method: 'POST',
  };
}

const SAMPLE_CSV = `property_name,property_address,unit_label,tenant_first_name,tenant_last_name,tenant_phone,lease_rent,lease_start,lease_due_day
Vaba House,"123 Main St, Arlington, VA 22201",1,Test,Person,(202) 555-0101,1800,2025-06-01,1
Vaba House,"123 Main St, Arlington, VA 22201",2,Maria,Sanchez,7035550102,1950,2025-09-01,1
`;

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/import/csv', () => {
  it('returns 401 when not authenticated', async () => {
    stubServerClient({ userId: null });
    stubAdminClientEmpty();

    const req = makeReq(makeFormData({ source: 'generic', file: makeCsvFile(SAMPLE_CSV) }));
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it.each(['manager', 'va', 'member', null])(
    'returns 403 for authenticated role %s before admin access',
    async (role) => {
      stubServerClient({ role });
      const req = makeReq(makeFormData({ source: 'generic', file: makeCsvFile(SAMPLE_CSV) }));
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing membership', { organizationId: null }],
    ['membership lookup error', { membershipError: { message: 'lookup failed' } }],
  ])('returns 403 for %s before admin access', async (_label, opts) => {
    stubServerClient(opts);
    const res = await POST(makeReq(makeFormData({ source: 'generic', file: makeCsvFile(SAMPLE_CSV) })));
    expect(res.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid source', async () => {
    stubServerClient({});
    stubAdminClientEmpty();

    const req = makeReq(makeFormData({ source: 'unknown', file: makeCsvFile(SAMPLE_CSV) }));
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('source must be one of');
  });

  it('returns 400 when file missing', async () => {
    stubServerClient({});
    stubAdminClientEmpty();

    const req = makeReq(makeFormData({ source: 'generic' }));
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns dry-run counts + tagged plan items for a fresh org', async () => {
    stubServerClient({});
    stubAdminClientEmpty();

    const req = makeReq(makeFormData({
      source: 'generic',
      file: makeCsvFile(SAMPLE_CSV),
    }));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.summary.properties.willInsert).toBe(1);
    expect(json.summary.units.willInsert).toBe(2);
    expect(json.summary.tenants.willInsert).toBe(2);
    expect(json.summary.leases.willInsert).toBe(2);
    expect(json.plan.tenants[0].action).toBe('will_insert');
  });

  it('returns 422 when a required column is missing', async () => {
    stubServerClient({});
    stubAdminClientEmpty();

    const partial = 'property_name,unit_label\nVaba,1\n';
    const req = makeReq(makeFormData({ source: 'generic', file: makeCsvFile(partial) }));
    const res = await POST(req);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('Missing required columns');
    expect(json.validation.issues).toEqual([
      expect.objectContaining({ code: 'invalid_headers', severity: 'error' }),
    ]);
  });

  it('returns structured row feedback and no preview success for a malformed required row', async () => {
    stubServerClient({ role: 'owner' });
    stubAdminClientEmpty();
    const malformed = SAMPLE_CSV.replace('1800,2025', 'not-rent,2025');
    const res = await POST(makeReq(makeFormData({ source: 'generic', file: makeCsvFile(malformed) })));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.validation.issues).toEqual([
      expect.objectContaining({ row: 2, field: 'lease_rent', code: 'required_row_invalid' }),
    ]);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
