import { describe, expect, it, vi } from 'vitest';

import { AccountantProjectionError } from '../projection';
import {
  loadAccountantDocuments,
  loadAccountantFinancials,
  loadAccountantPaymentHistory,
  loadAccountantReconciliation,
  loadAccountantRentLedger,
  type AccountantProjectionClient,
} from '../repository';

const leaseRows = [
  {
    property_id: 'property-included',
    property_name: 'Oakwood Commons',
    property_archived_at: null,
    unit_id: 'unit-101',
    unit_label: '101',
    tenant_id: 'tenant-1',
    tenant_name: 'Marcus Alvarez',
    lease_id: 'lease-1',
    lease_status: 'active',
    lease_start_date: '2026-01-01',
    lease_end_date: null,
  },
  {
    property_id: 'property-empty',
    property_name: 'Juniper House',
    property_archived_at: '2026-07-01T00:00:00.000Z',
    unit_id: null,
    unit_label: null,
    tenant_id: null,
    tenant_name: null,
    lease_id: null,
    lease_status: null,
    lease_start_date: null,
    lease_end_date: null,
  },
];

const rentRows = [
  {
    rent_event_id: 'rent-1',
    property_id: 'property-included',
    property_name: 'Oakwood Commons',
    property_archived_at: null,
    unit_id: 'unit-101',
    unit_label: '101',
    tenant_id: 'tenant-1',
    tenant_name: 'Marcus Alvarez',
    lease_id: 'lease-1',
    cycle_month: '2026-08-01',
    due_date: '2026-08-01',
    amount_due_cents: 180_000,
    amount_paid_cents: 120_000,
    status: 'partial',
    waived_amount_cents: null,
    waived_at: null,
  },
];

const paymentRows = [
  {
    payment_id: 'payment-confirmed',
    property_id: 'property-included',
    property_name: 'Oakwood Commons',
    property_archived_at: null,
    unit_id: 'unit-101',
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
  {
    payment_id: 'payment-undated',
    property_id: 'property-included',
    property_name: 'Oakwood Commons',
    property_archived_at: null,
    unit_id: 'unit-101',
    unit_label: '101',
    tenant_id: 'tenant-1',
    tenant_name: 'Marcus Alvarez',
    lease_id: 'lease-1',
    amount_cents: 25_000,
    currency: 'usd',
    status: 'succeeded',
    paid_at: null,
    period_basis: 'record_created_exception',
    rent_event_id: null,
    matched: false,
    receipt_present: false,
  },
];

const documentRows = [
  {
    document_id: 'document-lease',
    property_id: 'property-included',
    property_name: 'Oakwood Commons',
    property_archived_at: null,
    unit_id: 'unit-101',
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
];

function client(overrides: Record<string, unknown> = {}) {
  const rowsByRpc: Record<string, unknown> = {
    accountant_property_lease_context: leaseRows,
    accountant_rent_events: rentRows,
    accountant_payment_history: paymentRows,
    accountant_document_index: documentRows,
    ...overrides,
  };
  const rpc = vi.fn(async (name: string) => ({
    data: rowsByRpc[name],
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

describe('Accountant projection repository', () => {
  it('loads the reconciliation register with UTC half-open payment bounds', async () => {
    const db = client();
    const desk = await loadAccountantReconciliation(db, {
      cycleMonth: '2026-08-01',
      capabilities: allCapabilities,
    });

    expect(db.rpc).toHaveBeenCalledWith('accountant_payment_history', {
      p_from: '2026-08-01T00:00:00.000Z',
      p_before: '2026-09-01T00:00:00.000Z',
      p_include_recorded_exceptions: true,
    });
    expect(desk.propertyCount).toBe(2);
    expect(desk.providerConfirmedCents).toBe(120_000);
    expect(desk.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'unmatched_payment:payment-undated',
          occurredAt: null,
        }),
      ]),
    );
    expect(
      desk.issues.filter((issue) =>
        issue.id.endsWith(':payment-undated'),
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(desk.issues)).not.toContain(
      '2026-08-05T10:00:00.000Z',
    );
  });

  it('does not call denied projections or turn unavailable totals into zero', async () => {
    const db = client();
    const desk = await loadAccountantReconciliation(db, {
      cycleMonth: '2026-08-01',
      capabilities: new Set(['view_dashboard', 'view_rent']),
    });

    expect(db.rpc).not.toHaveBeenCalledWith(
      'accountant_payment_history',
      expect.anything(),
    );
    expect(db.rpc).not.toHaveBeenCalledWith(
      'accountant_document_index',
      expect.anything(),
    );
    expect(desk.availability).toEqual({
      rent: 'available',
      financials: 'denied',
      documents: 'denied',
    });
    expect(desk.providerConfirmedCents).toBeNull();
    expect(desk.missingLeaseDocumentCount).toBeNull();
  });

  it('does not treat view_financials as permission to read rent evidence', async () => {
    const db = client();
    const desk = await loadAccountantReconciliation(db, {
      cycleMonth: '2026-08-01',
      capabilities: new Set(['view_dashboard', 'view_financials']),
    });

    expect(db.rpc).not.toHaveBeenCalledWith(
      'accountant_rent_events',
      expect.anything(),
    );
    expect(desk.availability.rent).toBe('denied');
    expect(desk.billedCents).toBeNull();
    expect(desk.outstandingCents).toBeNull();
    expect(desk.issues.map((issue) => issue.kind)).not.toContain(
      'outstanding_balance',
    );
  });

  it('keeps assigned properties with no rows in Rent selectors', async () => {
    const db = client();
    const model = await loadAccountantRentLedger(db, {
      cycleMonth: '2026-08-01',
      capabilities: allCapabilities,
    });

    expect(model.rows).toHaveLength(1);
    expect(model.properties.map((property) => property.propertyId)).toEqual([
      'property-included',
      'property-empty',
    ]);
    expect(model.canExport).toBe(true);
  });

  it('uses one exact period population for Financials and labels undated exceptions', async () => {
    const db = client();
    const model = await loadAccountantFinancials(db, {
      periodKey: 'last',
      currentCycleMonth: '2026-09-01',
      capabilities: allCapabilities,
    });

    expect(model).toMatchObject({
      periodKey: 'last',
      cycleStart: '2026-08-01',
      cycleEnd: '2026-08-01',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      providerConfirmedCents: 120_000,
    });
    expect(model.payments.map((payment) => payment.periodBasis)).toEqual([
      'payment_time',
      'record_created_exception',
    ]);
  });

  it('keeps payment evidence available while a rent-capability denial makes obligation totals unavailable', async () => {
    const db = client();
    const model = await loadAccountantFinancials(db, {
      periodKey: 'mtd',
      currentCycleMonth: '2026-08-01',
      capabilities: new Set(['view_financials']),
    });

    expect(db.rpc).not.toHaveBeenCalledWith(
      'accountant_rent_events',
      expect.anything(),
    );
    expect(model.payments).toHaveLength(2);
    expect(model.billedCents).toBeNull();
    expect(model.collectedCents).toBeNull();
    expect(model.outstandingCents).toBeNull();
  });

  it('derives missing lease evidence only from explicitly classified documents', async () => {
    const db = client({ accountant_document_index: [] });
    const model = await loadAccountantDocuments(db, {
      capabilities: new Set(['view_documents']),
    });

    expect(model.missingCount).toBe(1);
    expect(model.missingLeaseEvidence.map((lease) => lease.leaseId)).toEqual([
      'lease-1',
    ]);
    expect(model.canExport).toBe(false);
  });

  it('treats explicit lease_evidence classification as authoritative regardless of display type', async () => {
    const db = client({
      accountant_document_index: [
        { ...documentRows[0], type: 'renewal_packet' },
      ],
    });
    const model = await loadAccountantDocuments(db, {
      capabilities: new Set(['view_documents']),
    });

    expect(model.missingCount).toBe(0);
  });

  it('fails closed when an RPC errors or returns a malformed projection', async () => {
    const rpcError = {
      rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    } as unknown as AccountantProjectionClient;
    await expect(
      loadAccountantRentLedger(rpcError, {
        cycleMonth: '2026-08-01',
        capabilities: new Set(['view_rent']),
      }),
    ).rejects.toBeInstanceOf(AccountantProjectionError);

    const malformed = client({ accountant_rent_events: [{ surprise: true }] });
    await expect(
      loadAccountantRentLedger(malformed, {
        cycleMonth: '2026-08-01',
        capabilities: new Set(['view_rent']),
      }),
    ).rejects.toBeInstanceOf(AccountantProjectionError);

    const malformedEnvelope = {
      rpc: vi.fn(async () => null),
    } as unknown as AccountantProjectionClient;
    await expect(
      loadAccountantRentLedger(malformedEnvelope, {
        cycleMonth: '2026-08-01',
        capabilities: new Set(['view_rent']),
      }),
    ).rejects.toBeInstanceOf(AccountantProjectionError);
  });

  it('denies every domain loader before RPC when its view capability is absent', async () => {
    const cases = [
      (db: AccountantProjectionClient) =>
        loadAccountantRentLedger(db, {
          cycleMonth: '2026-08-01',
          capabilities: new Set(),
        } as never),
      (db: AccountantProjectionClient) =>
        loadAccountantFinancials(db, {
          periodKey: 'mtd',
          currentCycleMonth: '2026-08-01',
          capabilities: new Set(),
        } as never),
      (db: AccountantProjectionClient) =>
        loadAccountantDocuments(db, {
          capabilities: new Set(),
        } as never),
      (db: AccountantProjectionClient) =>
        loadAccountantPaymentHistory(db, {
          fromDate: '2026-08-01',
          toDate: '2026-08-31',
          capabilities: new Set(),
        } as never),
    ];

    for (const load of cases) {
      const db = client();
      await expect(load(db)).rejects.toBeInstanceOf(
        AccountantProjectionError,
      );
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['2026-02-30', '2026-03-01'],
    ['2026-08-31', '2026-08-01'],
    ['2020-01-01', '2026-08-31'],
  ])('rejects unsafe payment window %s through %s before RPC', async (fromDate, toDate) => {
    const db = client();
    await expect(
      loadAccountantPaymentHistory(db, {
        fromDate,
        toDate,
        capabilities: new Set(['view_financials']),
      }),
    ).rejects.toBeInstanceOf(AccountantProjectionError);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
