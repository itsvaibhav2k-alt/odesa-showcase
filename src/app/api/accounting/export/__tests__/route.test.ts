import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/authz/context', () => ({ requireAccessContext: vi.fn() }));
vi.mock('@/lib/accounting/export-http', () => ({
  handleAccountantExportHttp: vi.fn(),
}));

import { handleAccountantExportHttp } from '@/lib/accounting/export-http';
import { requireAccessContext } from '@/lib/authz/context';
import { createServerClient } from '@/lib/supabase/server';

import { GET } from '../route';

const createClientMock = vi.mocked(createServerClient);
const accessMock = vi.mocked(requireAccessContext);
const handlerMock = vi.mocked(handleAccountantExportHttp);
const client = { rpc: vi.fn() };

describe('GET /api/accounting/export wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClientMock.mockResolvedValue(client as never);
    handlerMock.mockResolvedValue(new Response('csv', { status: 200 }));
  });

  it('preserves a fail-closed membership status and never invokes the exporter', async () => {
    accessMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });

    const response = await GET(
      new Request('http://localhost/api/accounting/export?kind=document-index') as never,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it('passes the freshly resolved role, capabilities, and same scoped client', async () => {
    const capabilities = new Set([
      'view_documents',
      'export_financials',
    ] as const);
    accessMock.mockResolvedValue({
      ok: true,
      context: {
        userId: 'accountant-user',
        membershipId: 'membership-1',
        organizationId: 'org-1',
        role: 'accountant',
        propertyScope: ['property-1'],
        capabilities,
      },
    });
    const request = new Request(
      'http://localhost/api/accounting/export?kind=document-index',
    );

    expect(await GET(request as never)).toHaveProperty('status', 200);
    expect(accessMock).toHaveBeenCalledWith({ auth: client, db: client });
    expect(handlerMock).toHaveBeenCalledWith({
      request,
      principal: { role: 'accountant', capabilities },
      client,
    });
  });
});
