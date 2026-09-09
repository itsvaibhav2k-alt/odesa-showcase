import { describe, expect, it, vi } from 'vitest';

import { handleAccountantExportHttp } from '../export-http';
import type { AccountantProjectionClient } from '../repository';

function db(rentCount = 1) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'accountant_property_lease_context'
        ? [
            {
              property_id: 'property-1',
              property_name: 'Oakwood Commons',
              property_archived_at: null,
              unit_id: 'unit-1',
              unit_label: '101',
              tenant_id: 'tenant-1',
              tenant_name: 'Marcus Alvarez',
              lease_id: 'lease-1',
              lease_status: 'active',
              lease_start_date: '2026-01-01',
              lease_end_date: null,
            },
          ]
        : name === 'accountant_rent_events'
          ? Array.from({ length: rentCount }, (_, index) => ({
                rent_event_id: `rent-${index}`,
                property_id: 'property-1',
                property_name: 'Oakwood Commons',
                property_archived_at: null,
                unit_id: 'unit-1',
                unit_label: '101',
                tenant_id: 'tenant-1',
                tenant_name: 'Marcus Alvarez',
                lease_id: 'lease-1',
                cycle_month: '2026-08-01',
                due_date: '2026-08-01',
                amount_due_cents: 180_000,
                amount_paid_cents: 120_000,
                status: 'partial',
                waived_amount_cents: 0,
                waived_at: null,
              }))
          : name === 'accountant_payment_history'
            ? [
                {
                  payment_id: 'payment-1',
                  property_id: 'property-1',
                  property_name: 'Oakwood Commons',
                  property_archived_at: null,
                  unit_id: 'unit-1',
                  unit_label: '101',
                  tenant_id: 'tenant-1',
                  tenant_name: 'Marcus Alvarez',
                  lease_id: 'lease-1',
                  amount_cents: 120_000,
                  currency: 'usd',
                  status: 'succeeded',
                  paid_at: '2026-08-04T16:00:00.000Z',
                  period_basis: 'payment_time',
                  rent_event_id: 'rent-1',
                  matched: true,
                  receipt_present: true,
                },
              ]
            : name === 'accountant_document_index'
              ? [
                  {
                    document_id: 'document-1',
                    property_id: 'property-1',
                    property_name: 'Oakwood Commons',
                    property_archived_at: null,
                    unit_id: 'unit-1',
                    unit_label: '101',
                    tenant_id: 'tenant-1',
                    tenant_name: 'Marcus Alvarez',
                    lease_id: 'lease-1',
                    lease_status: 'active',
                    evidence_class: 'lease_evidence',
                    title: 'Signed lease evidence',
                    type: 'lease',
                    expiry_date: null,
                    created_at: '2026-01-01T00:00:00.000Z',
                  },
                ]
          : [],
    error: null,
  }));
  return { rpc } as unknown as AccountantProjectionClient & {
    rpc: typeof rpc;
  };
}

const principal = {
  role: 'accountant',
  capabilities: new Set(['view_rent', 'export_financials']),
};

describe('Accountant export HTTP contract', () => {
  it('returns 405 with the allowed method before any projection read', async () => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08',
        { method: 'POST' },
      ),
      principal,
      client,
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns a private attachment for one exact authorized projection', async () => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08&property=property-1&state=outstanding&q=Marcus',
      ),
      principal,
      client,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'text/csv; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="odesa-rent-ledger-2026-08.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-accounting-row-count')).toBe('1');
    expect(await response.text()).toContain('Oakwood Commons');
  });

  it.each([
    {
      name: 'reconciliation',
      url: 'http://localhost/api/accounting/export?kind=reconciliation&cycle=2026-08',
      capabilities: [
        'view_dashboard',
        'view_rent',
        'view_financials',
        'view_documents',
        'export_financials',
      ],
    },
    {
      name: 'payment history',
      url: 'http://localhost/api/accounting/export?kind=payment-history&from=2026-08-01&to=2026-08-31',
      capabilities: ['view_financials', 'export_financials'],
    },
    {
      name: 'document index',
      url: 'http://localhost/api/accounting/export?kind=document-index',
      capabilities: ['view_documents', 'export_financials'],
    },
  ])('returns a successful exact $name attachment', async ({ url, capabilities }) => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(url),
      principal: { role: 'accountant', capabilities: new Set(capabilities) },
      client,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-accounting-row-count')).toBe('1');
    expect(response.headers.get('content-type')).toBe(
      'text/csv; charset=utf-8',
    );
  });

  it('returns 401 before parsing or querying for an absent principal', async () => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger',
      ),
      principal: null,
      client,
    });

    expect(response.status).toBe(401);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(['owner', 'manager', 'va', 'tenant', 'unknown'])
    ('returns 403 with zero projection reads for %s', async (role) => {
      const client = db();
      const response = await handleAccountantExportHttp({
        request: new Request(
          'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08',
        ),
        principal: { ...principal, role },
        client,
      });

      expect(response.status).toBe(403);
      expect(client.rpc).not.toHaveBeenCalled();
    });

  it('rejects duplicate or unknown query keys without broadening the export', async () => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&kind=document-index&cycle=2026-08&surprise=all',
      ),
      principal,
      client,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid export request' });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns a header-only exact export for an out-of-scope property id', async () => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08&property=property-revoked',
      ),
      principal,
      client,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-accounting-row-count')).toBe('0');
    expect((await response.text()).split('\r\n')).toHaveLength(1);
  });

  it('returns 413 instead of truncating an oversized exact export', async () => {
    const client = db(10_001);
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08',
      ),
      principal,
      client,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'Accounting export is too large',
    });
  });

  it('fails closed for a malformed runtime capability collection', async () => {
    const client = db();
    const response = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08',
      ),
      principal: { role: 'accountant', capabilities: null as never },
      client,
    });

    expect(response.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps capability denial and projection failure to non-leaking responses', async () => {
    const client = db();
    const denied = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08',
      ),
      principal: { role: 'accountant', capabilities: new Set(['view_rent']) },
      client,
    });
    expect(denied.status).toBe(403);
    expect(client.rpc).not.toHaveBeenCalled();

    const broken = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'XX000' } })),
    } as unknown as AccountantProjectionClient;
    const unavailable = await handleAccountantExportHttp({
      request: new Request(
        'http://localhost/api/accounting/export?kind=rent-ledger&cycle=2026-08',
      ),
      principal,
      client: broken,
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: 'Accounting export is temporarily unavailable',
    });
  });
});
