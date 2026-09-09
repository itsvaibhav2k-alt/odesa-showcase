import { describe, expect, it } from 'vitest';

import {
  ACCOUNTANT_EXPORT_MAX_BYTES,
  ACCOUNTANT_EXPORT_MAX_ROWS,
  AccountantExportLimitError,
  buildDocumentIndexExport,
  buildPaymentHistoryExport,
  buildReconciliationExport,
  buildRentLedgerExport,
} from '../exports';
import type {
  AccountantDocumentRecord,
  AccountantPaymentRecord,
  AccountantReconciliationIssue,
  AccountantRentEvent,
} from '../types';

const rentBase: AccountantRentEvent = {
  rentEventId: 'hidden-rent-id',
  propertyId: 'property-included',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'hidden-unit-id',
  unitLabel: '101',
  tenantId: 'hidden-tenant-id',
  tenantName: 'Marcus Alvarez',
  leaseId: 'hidden-lease-id',
  cycleMonth: '2026-08-01',
  dueDate: '2026-08-01',
  amountDueCents: 180_000,
  amountPaidCents: 120_000,
  status: 'paid',
  waivedAmountCents: 0,
  waivedAt: null,
};

const paymentBase: AccountantPaymentRecord & {
  recordCreatedAt: string;
  paymentMethodType: string;
} = {
  paymentId: 'hidden-payment-id',
  propertyId: 'property-included',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'hidden-unit-id',
  unitLabel: '101',
  tenantId: 'hidden-tenant-id',
  tenantName: 'Marcus Alvarez',
  leaseId: 'hidden-lease-id',
  amountCents: 120_000,
  currency: 'USD',
  status: 'succeeded',
  paidAt: null,
  recordCreatedAt: '2040-01-01T00:00:00.000Z',
  periodBasis: 'record_created_exception',
  paymentMethodType: 'provider-secret-method',
  rentEventId: 'hidden-rent-id',
  matched: true,
  receiptPresent: false,
};

const documentBase: AccountantDocumentRecord = {
  documentId: 'hidden-document-id',
  propertyId: 'property-included',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'hidden-unit-id',
  unitLabel: '101',
  tenantId: 'hidden-tenant-id',
  tenantName: 'Marcus Alvarez',
  leaseId: 'hidden-lease-id',
  leaseStatus: 'active',
  evidenceClass: 'lease_evidence',
  title: '=HYPERLINK("https://bad.example")',
  type: 'lease',
  expiryDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const issueBase: AccountantReconciliationIssue = {
  id: 'hidden-issue-id',
  kind: 'unmatched_payment',
  priority: 'high',
  title: 'Payment needs a rent-cycle match',
  summary: 'Canonical payment evidence is not linked.',
  propertyId: 'property-included',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'hidden-unit-id',
  unitLabel: '101',
  tenantId: 'hidden-tenant-id',
  tenantName: 'Marcus Alvarez',
  leaseId: 'hidden-lease-id',
  amountCents: 120_000,
  occurredAt: null,
  evidence: [{ label: 'Provider id', value: 'hidden-provider-id' }],
};

describe('Accountant exact filtered exports', () => {
  it('exports every filter-matched rent row, not just one UI page', () => {
    const included = Array.from({ length: 41 }, (_, index) => ({
      ...rentBase,
      rentEventId: `hidden-rent-${index}`,
      unitLabel: `A${String(index).padStart(2, '0')}`,
    }));
    const artifact = buildRentLedgerExport(
      [
        ...included,
        {
          ...rentBase,
          rentEventId: 'excluded-cycle',
          cycleMonth: '2026-09-01',
        },
        {
          ...rentBase,
          rentEventId: 'excluded-property',
          propertyId: 'property-excluded',
          propertyName: '17th Street Row',
        },
      ],
      {
        cycleMonth: '2026-08-01',
        propertyId: 'property-included',
        state: 'outstanding',
        query: 'oakwood',
        eventId: null,
        page: 2,
      },
    );

    expect(artifact.rowCount).toBe(41);
    expect(artifact.csv.split('\r\n')[0]).toBe(
      'Property,Archived property,Unit,Due date,Current obligation,Collected in ledger,Open balance,Waived amount,Evidence state',
    );
    expect(artifact.csv.split('\r\n')).toHaveLength(42);
    expect(artifact.csv).not.toContain('17th Street Row');
    expect(artifact.csv).not.toContain('Marcus Alvarez');
    expect(artifact.csv).not.toContain('hidden-rent-');
    expect(artifact.csv).not.toContain(',paid,');
    expect(artifact.csv).toContain('Outstanding');
  });

  it('exports only visible payment fields and never substitutes record creation for paid_at', () => {
    const artifact = buildPaymentHistoryExport(
      [
        paymentBase,
        {
          ...paymentBase,
          paymentId: 'excluded-payment',
          propertyId: 'property-excluded',
          propertyName: '17th Street Row',
        },
      ],
      {
        period: 'mtd',
        propertyId: 'property-included',
        state: 'timestamp_missing',
        query: '',
        paymentId: null,
        page: 1,
      },
      { fromDate: '2026-08-01', toDate: '2026-08-31' },
    );

    expect(artifact.rowCount).toBe(1);
    expect(artifact.csv.split('\r\n')[0]).toBe(
      'Property,Archived property,Unit,Amount,Currency,Status,Payment time,Period inclusion,Evidence state,Matched to rent event,Receipt present',
    );
    expect(artifact.csv).toContain('Payment time');
    expect(artifact.csv).toContain('Unavailable');
    expect(artifact.csv).toContain(
      'Recorded exception; payment time unavailable',
    );
    expect(artifact.csv).not.toContain('2040-01-01');
    expect(artifact.csv).not.toContain('provider-secret-method');
    expect(artifact.csv).not.toContain('hidden-payment-id');
    expect(artifact.csv).not.toContain('17th Street Row');
    expect(artifact.csv).not.toContain('Marcus Alvarez');
  });

  it('exports only classified document metadata selected by the exact filters', () => {
    const artifact = buildDocumentIndexExport(
      [
        documentBase,
        {
          ...documentBase,
          documentId: 'excluded-document',
          evidenceClass: 'property_accounting_evidence',
          title: 'Property tax statement',
          type: 'tax',
        },
      ],
      {
        propertyId: 'property-included',
        type: 'lease',
        query: 'hyperlink',
        documentId: null,
        page: 1,
      },
    );

    expect(artifact.rowCount).toBe(1);
    expect(artifact.csv.split('\r\n')[0]).toBe(
      'Document,Property,Archived property,Unit,Evidence class,Type,Expires,Indexed',
    );
    expect(artifact.csv).toContain("'=HYPERLINK");
    expect(artifact.csv).not.toContain('Property tax statement');
    expect(artifact.csv).not.toContain('hidden-document-id');
    expect(artifact.csv).not.toContain('file_key');
    expect(artifact.csv).not.toContain('Marcus Alvarez');
  });

  it('keeps dossier-only evidence and all internal identifiers out of reconciliation export', () => {
    const artifact = buildReconciliationExport([issueBase], {
      cycleMonth: '2026-08-01',
      propertyId: 'property-included',
      issueFilter: 'matching',
      query: 'marcus',
      selectedIssueId: issueBase.id,
      page: 9,
    });

    expect(artifact.rowCount).toBe(1);
    expect(artifact.csv.split('\r\n')[0]).toBe(
      'Discrepancy,Priority,Finding,Property,Archived property,Unit,Amount under review,Canonical payment time',
    );
    expect(artifact.csv).toContain('Payment matching');
    expect(artifact.csv).not.toContain('hidden-issue-id');
    expect(artifact.csv).not.toContain('hidden-provider-id');
    expect(artifact.csv).not.toContain('hidden-tenant-id');
    expect(artifact.csv).not.toContain('Marcus Alvarez');
  });

  it('fails explicitly instead of truncating an exact export over the row ceiling', () => {
    const rows = Array.from(
      { length: ACCOUNTANT_EXPORT_MAX_ROWS + 1 },
      (_, index) => ({
        ...rentBase,
        rentEventId: `rent-${index}`,
      }),
    );

    expect(() =>
      buildRentLedgerExport(rows, {
        cycleMonth: '2026-08-01',
        propertyId: null,
        state: 'all',
        query: '',
        eventId: null,
        page: 1,
      }),
    ).toThrow(AccountantExportLimitError);
  });

  it('fails explicitly when an exact export exceeds the byte ceiling', () => {
    expect(() =>
      buildRentLedgerExport(
        [
          {
            ...rentBase,
            propertyName: 'x'.repeat(ACCOUNTANT_EXPORT_MAX_BYTES + 1),
          },
        ],
        {
          cycleMonth: '2026-08-01',
          propertyId: null,
          state: 'all',
          query: '',
          eventId: null,
          page: 1,
        },
      ),
    ).toThrow(AccountantExportLimitError);
  });
});
