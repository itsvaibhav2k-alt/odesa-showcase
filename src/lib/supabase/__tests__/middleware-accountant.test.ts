import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));

import { createServerClient } from '@supabase/ssr';

import { updateSession } from '../middleware';

const createSsrClientMock = vi.mocked(createServerClient);
const getUser = vi.fn();
const rpc = vi.fn();

function request(path: string, headers?: HeadersInit): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe('Accountant middleware authority', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'local-anon-key');
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    rpc.mockResolvedValue({ data: 'accountant', error: null });
    createSsrClientMock.mockReturnValue({ auth: { getUser }, rpc } as never);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('denies a cookie-bound Accountant before a broad provider prefix', async () => {
    const response = await updateSession(request('/api/retell/test-call'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('allows unauthenticated health checks through to the handler', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await updateSession(request('/api/healthz'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('location')).toBeNull();
  });

  it('allows only the exact accounting export API through to its handler', async () => {
    const response = await updateSession(
      request('/api/accounting/export?kind=document-index'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('denies Accountant server-action posts even on an allowed read route', async () => {
    const response = await updateSession(
      request('/rent', { 'next-action': 'fictional-action-id' }),
    );

    expect(response.status).toBe(403);
  });

  it('preserves Owner APIs and the zero-membership invitation claim exception', async () => {
    rpc.mockResolvedValueOnce({ data: 'owner', error: null });
    expect((await updateSession(request('/api/import'))).status).toBe(200);

    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(
      (
        await updateSession(
          request('/invite/local-token', {
            'next-action': 'fictional-claim-action',
          }),
        )
      ).status,
    ).toBe(200);
  });

  it('allows an unauthenticated invitee to reach the opaque invitation page', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });

    const response = await updateSession(request('/invite/opaque-token'));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('routes authenticated auth pages through the capability-aware root resolver', async () => {
    const response = await updateSession(request('/login'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/');
  });

  it.each([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ])('fails protected routes closed when %s is absent while public routes remain reachable', async (key) => {
    vi.stubEnv(key, '');

    for (const path of ['/today', '/api/chat/runs']) {
      const response = await updateSession(request(path));
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    for (const path of ['/login', '/api/healthz', '/api/messaging/inbound/linq', '/work']) {
      const response = await updateSession(request(path));
      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    }
    expect(createSsrClientMock).not.toHaveBeenCalled();
  });
});
