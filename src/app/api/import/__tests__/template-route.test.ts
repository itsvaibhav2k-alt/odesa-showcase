/**
 * Unit tests for `GET /api/import/template`.
 *
 * Returns 401 without auth, 400 for an unknown source, and 200 with the
 * matching CSV template (Content-Disposition: attachment) for valid
 * sources.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@/lib/supabase/server';
import { GET } from '../template/route';

const mockCreateServerClient = vi.mocked(createServerClient);

function stubServer(userId: string | null): void {
  mockCreateServerClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: userId ? { id: userId, email: 'op@test.test' } : null },
        error: null,
      })),
    },
  } as unknown as Awaited<ReturnType<typeof createServerClient>>);
}

afterEach(() => {
  vi.clearAllMocks();
});

function buildReq(source: string | null) {
  const url = source
    ? `http://test/api/import/template?source=${source}`
    : 'http://test/api/import/template';
  // NextRequest is structurally compatible with Request for our purposes.
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/import/template', () => {
  it('401s when not authenticated', async () => {
    stubServer(null);
    const res = await GET(buildReq('appfolio'));
    expect(res.status).toBe(401);
  });

  it('400s on unknown source', async () => {
    stubServer('user-1');
    const res = await GET(buildReq('mystery'));
    expect(res.status).toBe(400);
  });

  it('returns CSV with attachment headers for each known source', async () => {
    stubServer('user-1');
    for (const source of ['appfolio', 'buildium', 'rentredi', 'generic']) {
      const res = await GET(buildReq(source));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/csv');
      expect(res.headers.get('Content-Disposition')).toContain(`odesa-import-${source}.csv`);
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
    }
  });
});
