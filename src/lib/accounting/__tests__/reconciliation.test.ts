import { describe, expect, it } from 'vitest';

import { buildAccountantReconciliationDesk } from '../reconciliation';
import type {
  AccountantDocumentRecord,
  AccountantLeaseContext,
  AccountantPaymentRecord,
  AccountantRentEvent,
} from '../types';

const lease: AccountantLeaseContext = {
  contextKind: 'lease',
  propertyId: 'property-in-scope',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'unit-101',
  unitLabel: '101',
  tenantId: 'tenant-marcus',
  tenantName: 'Marcus Alvarez',
  leaseId: 'lease-marcus',
  leaseStatus: 'active',
  leaseStartDate: '2026-01-01',
  leaseEndDate: null,
};

const rentEvent: AccountantRentEvent = {
  rentEventId: 'rent-event-august',
  propertyId: lease.propertyId,
  propertyName: lease.propertyName,
  propertyArchivedAt: null,
  unitId: lease.unitId,
  unitLabel: lease.unitLabel,
  tenantId: lease.tenantId,
  tenantName: lease.tenantName,
  leaseId: lease.leaseId,
  cycleMonth: '2026-08-01',
  dueDate: '2026-08-01',
  amountDueCents: 180_000,
  amountPaidCents: 120_000,
  status: 'partial',
  waivedAmountCents: 0,
  waivedAt: null,
};

const payment: AccountantPaymentRecord = {
  paymentId: 'payment-real-row',
  propertyId: lease.propertyId,
  propertyName: lease.propertyName,
  propertyArchivedAt: null,
  unitId: lease.unitId,
  unitLabel: lease.unitLabel,
  tenantId: lease.tenantId,
  tenantName: lease.tenantName,
  leaseId: lease.leaseId,
  amountCents: 120_000,
  currency: 'USD',
  status: 'succeeded',
  paidAt: '2026-08-04T16:00:00.000Z',
  periodBasis: 'payment_time',
  rentEventId: rentEvent.rentEventId,
  matched: true,
  receiptPresent: true,
};

const leaseDocument: AccountantDocumentRecord = {
  documentId: 'document-lease',
  propertyId: lease.propertyId,
  propertyName: lease.propertyName,
  propertyArchivedAt: null,
  unitId: lease.unitId,
  unitLabel: lease.unitLabel,
  tenantId: lease.tenantId,
  tenantName: lease.tenantName,
  leaseId: lease.leaseId,
  leaseStatus: 'active',
  evidenceClass: 'lease_evidence',
  title: 'Executed lease',
  type: 'lease',
  expiryDate: null,
  createdAt: '2026-01-01T12:00:00.000Z',
};

function build(
  overrides: Partial<
    Parameters<typeof buildAccountantReconciliationDesk>[0]
  > = {},
) {
  return buildAccountantReconciliationDesk({
    cycleMonth: '2026-08-01',
    periodLabel: 'August 2026',
    availability: {
      rent: 'available',
      financials: 'available',
      documents: 'available',
    },
    canExport: true,
    leases: [lease],
    rentEvents: [rentEvent],
    payments: [payment],
    documents: [leaseDocument],
    ...overrides,
  });
}

describe('buildAccountantReconciliationDesk', () => {
  it('builds a finite discrepancy register from supplied authorized evidence', () => {
    const model = build({
      rentEvents: [{ ...rentEvent, status: 'paid' }],
    });

    expect(model.fullCloseAvailable).toBe(false);
    expect(model.fullCloseUnavailableReason).toBe(
      'expense_imports_not_connected',
    );
    expect(model.billedCents).toBe(180_000);
    expect(model.collectedCents).toBe(120_000);
    expect(model.providerConfirmedCents).toBe(120_000);
    expect(model.issues).toEqual([
      expect.objectContaining({
        id: 'outstanding_balance:rent-event-august',
        kind: 'outstanding_balance',
        propertyId: 'property-in-scope',
        amountCents: 60_000,
        evidence: expect.arrayContaining([
          { label: 'Evidence state', value: 'Outstanding' },
        ]),
      }),
    ]);
    expect(JSON.stringify(model.issues)).not.toContain('"value":"paid"');
  });

  it('surfaces matching, missing-cycle, and missing-document discrepancies', () => {
    const model = build({
      rentEvents: [],
      payments: [{ ...payment, rentEventId: null, matched: false }],
      documents: [],
    });

    expect(model.closeState).toBe('payment_matching_required');
    expect(model.issues.map((issue) => issue.kind)).toEqual([
      'unmatched_payment',
      'missing_rent_cycle',
      'missing_lease_document',
    ]);
    expect(model.issues.every((issue) => issue.propertyId === lease.propertyId))
      .toBe(true);
  });

  it('never treats an unrelated or unclassified document as lease evidence', () => {
    const model = build({
      documents: [
        {
          ...leaseDocument,
          documentId: 'document-notice',
          evidenceClass: 'property_accounting_evidence',
          leaseId: null,
          type: 'notice',
        },
      ],
    });

    expect(model.missingLeaseDocumentCount).toBe(1);
    expect(model.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'missing_lease_document' }),
      ]),
    );
  });

  it('uses paid_at only for confirmed totals and labels settled rows without it as missing evidence', () => {
    const model = build({
      payments: [
        {
          ...payment,
          paidAt: null,
          periodBasis: 'record_created_exception',
        },
      ],
    });

    expect(model.providerConfirmedPaymentCount).toBe(0);
    expect(model.providerConfirmedCents).toBe(0);
    expect(model.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'payment_time_unavailable',
          occurredAt: null,
        }),
      ]),
    );
  });

  it('does not call an expected pending payment a missing timestamp', () => {
    const model = build({
      payments: [
        {
          ...payment,
          status: 'pending',
          paidAt: null,
          periodBasis: 'record_created_exception',
        },
      ],
    });

    expect(model.issues.map((issue) => issue.kind)).not.toContain(
      'payment_time_unavailable',
    );
    expect(model.issues.map((issue) => issue.kind)).not.toContain(
      'unmatched_payment',
    );

    const nonCanonical = build({
      payments: [
        {
          ...payment,
          status: 'paid',
          paidAt: null,
          periodBasis: 'record_created_exception',
        },
      ],
    });
    expect(nonCanonical.issues.map((issue) => issue.kind)).not.toContain(
      'payment_time_unavailable',
    );
  });

  it('ignores supplied rent rows when rent evidence availability is denied', () => {
    const model = build({
      availability: {
        rent: 'denied',
        financials: 'available',
        documents: 'available',
      },
      rentEvents: [rentEvent],
    });

    expect(model.billedCents).toBeNull();
    expect(model.outstandingCents).toBeNull();
    expect(model.issues.map((item) => item.kind)).not.toContain(
      'outstanding_balance',
    );
  });

  it('reports revoked evidence as unavailable instead of zero or reviewed', () => {
    const model = build({
      availability: {
        rent: 'denied',
        financials: 'denied',
        documents: 'denied',
      },
      rentEvents: [],
      payments: [],
      documents: [],
    });

    expect(model.closeState).toBe('access_limited');
    expect(model.billedCents).toBeNull();
    expect(model.collectedCents).toBeNull();
    expect(model.providerConfirmedCents).toBeNull();
    expect(model.missingCycleCount).toBeNull();
    expect(model.missingLeaseDocumentCount).toBeNull();
    expect(model.issues).toEqual([]);
  });

  it('preserves explicit zero-scope and archived-property truth', () => {
    const zero = build({ leases: [], rentEvents: [], payments: [], documents: [] });
    expect(zero.closeState).toBe('no_properties');
    expect(zero.propertyCount).toBe(0);

    const archived = build({
      leases: [{ ...lease, propertyArchivedAt: '2026-07-31T00:00:00.000Z' }],
      rentEvents: [
        { ...rentEvent, propertyArchivedAt: '2026-07-31T00:00:00.000Z' },
      ],
    });
    expect(archived.properties[0]?.propertyArchivedAt).toBe(
      '2026-07-31T00:00:00.000Z',
    );
    expect(archived.issues[0]?.propertyArchivedAt).toBe(
      '2026-07-31T00:00:00.000Z',
    );
  });
});
