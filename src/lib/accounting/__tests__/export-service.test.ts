import { describe, expect, it, vi } from 'vitest';

import type { AccountantExportRequest } from '../export-request';
import {
  AccountantExportAccessError,
  createAccountantExport,
} from '../export-service';
import type { AccountantProjectionClient } from '../repository';

const context = [
  {
    property_id: 'property-included',
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
];

const rent = {
  rent_event_id: 'hidden-rent-id',
  property_id: 'property-included',
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
  status: 'paid',
  waived_amount_cents: 0,
  waived_at: null,
};

const payment = {
  payment_id: 'hidden-payment-id',
  property_id: 'property-included',
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
  paid_at: null,
  period_basis: 'record_created_exception',
  rent_event_id: null,
  matched: false,
  receipt_present: false,
};

const document = {
  document_id: 'hidden-document-id',
  property_id: 'property-included',
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
};

function fixtureClient() {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'accountant_property_lease_context'
        ? context
        : name === 'accountant_rent_events'
          ? [
              rent,
              {
                ...rent,
                rent_event_id: 'excluded-rent-id',
                property_id: 'property-excluded',
                property_name: '17th Street Row',
              },
            ]
          : name === 'accountant_payment_history'
            ? [
                payment,
                {
                  ...payment,
                  payment_id: 'excluded-payment-id',
                  property_id: 'property-excluded',
                  property_name: '17th Street Row',
                },
              ]
            : name === 'accountant_document_index'
              ? [
                  document,
                  {
                    ...document,
                    document_id: 'excluded-document-id',
                    unit_id: null,
                    unit_label: null,
                    tenant_id: null,
                    tenant_name: null,
                    lease_id: null,
                    lease_status: null,
                    evidence_class: 'property_accounting_evidence',
                    type: 'tax',
                    title: 'Property tax statement',
                  },
                ]
              : null,
    error: null,
  }));
  return { rpc } as unknown as AccountantProjectionClient & {
    rpc: typeof rpc;
  };
}

const allCapabilities = new Set([
  'view_dashboard',
  'view_rent',
  'view_financials',
  'view_documents',
  'export_financials',
]);

describe('Accountant export service', () => {
  it.each<{
    request: AccountantExportRequest;
    expected: string;
    excluded: string;
  }>([
    {
      request: {
        kind: 'rent-ledger',
        cycleMonth: '2026-08-01',
        propertyId: 'property-included',
        state: 'outstanding',
        query: 'Marcus',
      },
      expected: 'Oakwood Commons',
      excluded: '17th Street Row',
    },
    {
      request: {
        kind: 'payment-history',
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
        propertyId: 'property-included',
        state: 'timestamp_missing',
        query: '',
      },
      expected: 'Recorded exception; payment time unavailable',
      excluded: '2040-01-01',
    },
    {
      request: {
        kind: 'document-index',
        propertyId: 'property-included',
        type: 'lease',
        query: 'signed',
      },
      expected: 'Signed lease evidence',
      excluded: 'Property tax statement',
    },
    {
      request: {
        kind: 'reconciliation',
        cycleMonth: '2026-08-01',
        propertyId: 'property-included',
        issueFilter: 'matching',
        query: 'rent-cycle match',
      },
      expected: 'Payment matching',
      excluded: 'hidden-payment-id',
    },
  ])('builds exact $request.kind projection exports', async ({
    request,
    expected,
    excluded,
  }) => {
    const db = fixtureClient();
    const artifact = await createAccountantExport(
      db,
      allCapabilities,
      request,
    );

    expect(artifact.rowCount).toBe(1);
    expect(artifact.csv).toContain(expected);
    expect(artifact.csv).not.toContain(excluded);
    expect(artifact.csv).not.toContain('provider-secret');
  });

  it('uses an exact half-open payment window', async () => {
    const db = fixtureClient();
    await createAccountantExport(db, allCapabilities, {
      kind: 'payment-history',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      propertyId: null,
      state: 'all',
      query: '',
    });

    expect(db.rpc).toHaveBeenCalledWith('accountant_payment_history', {
      p_from: '2026-08-01T00:00:00.000Z',
      p_before: '2026-09-01T00:00:00.000Z',
      p_include_recorded_exceptions: true,
    });
  });

  it('does not read or export rent evidence when reconciliation lacks view_rent', async () => {
    const db = fixtureClient();
    const artifact = await createAccountantExport(
      db,
      new Set([
        'view_dashboard',
        'view_financials',
        'export_financials',
      ]),
      {
        kind: 'reconciliation',
        cycleMonth: '2026-08-01',
        propertyId: null,
        issueFilter: 'all',
        query: '',
      },
    );

    expect(db.rpc).not.toHaveBeenCalledWith(
      'accountant_rent_events',
      expect.anything(),
    );
    expect(artifact.csv).not.toContain('Open rent balance');
  });

  it.each<{
    domainCapability: string;
    request: AccountantExportRequest;
  }>([
    {
      domainCapability: 'view_dashboard',
      request: {
        kind: 'reconciliation',
        cycleMonth: '2026-08-01',
        propertyId: null,
        issueFilter: 'all',
        query: '',
      },
    },
    {
      domainCapability: 'view_rent',
      request: {
        kind: 'rent-ledger',
        cycleMonth: '2026-08-01',
        propertyId: null,
        state: 'all',
        query: '',
      },
    },
    {
      domainCapability: 'view_financials',
      request: {
        kind: 'payment-history',
        fromDate: '2026-08-01',
        toDate: '2026-08-31',
        propertyId: null,
        state: 'all',
        query: '',
      },
    },
    {
      domainCapability: 'view_documents',
      request: {
        kind: 'document-index',
        propertyId: null,
        type: 'all',
        query: '',
      },
    },
  ])(
    'denies $request.kind before RPC when export or its domain capability is absent',
    async ({ domainCapability, request }) => {
      for (const capabilities of [
        new Set([domainCapability]),
        new Set(['export_financials']),
      ]) {
        const db = fixtureClient();
        await expect(
          createAccountantExport(db, capabilities, request),
        ).rejects.toBeInstanceOf(AccountantExportAccessError);
        expect(db.rpc).not.toHaveBeenCalled();
      }
    },
  );
});
