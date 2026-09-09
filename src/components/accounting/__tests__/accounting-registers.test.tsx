import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountantDocumentRegister } from '../accountant-documents';
import { AccountantFinancialRegister } from '../accountant-financials';
import { AccountantRentRegister } from '../accountant-rent';
import {
  normalizeDocumentRegister,
  normalizeFinancialRegister,
  normalizeRentRegister,
} from '@/lib/accounting/register-state';
import type {
  AccountantDocumentsModel,
  AccountantFinancialsModel,
  AccountantPaymentRecord,
  AccountantRentLedgerModel,
} from '@/lib/accounting/types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const rent: AccountantRentLedgerModel = {
  cycleMonth: '2026-08-01',
  periodLabel: 'August 2026',
  billedCents: 180_000,
  collectedCents: 120_000,
  outstandingCents: 60_000,
  canExport: true,
  properties: [
    {
      propertyId: 'property-1',
      propertyName: 'Oakwood Commons',
      propertyArchivedAt: null,
      leaseCount: 1,
      billedCents: 180_000,
      collectedCents: 120_000,
      outstandingCents: 60_000,
      missingCycleCount: 0,
      missingLeaseDocumentCount: 0,
      unmatchedPaymentCount: 0,
      issueCount: 1,
    },
    {
      propertyId: 'property-2',
      propertyName: '17th Street Row',
      propertyArchivedAt: null,
      leaseCount: 0,
      billedCents: 0,
      collectedCents: 0,
      outstandingCents: 0,
      missingCycleCount: 0,
      missingLeaseDocumentCount: 0,
      unmatchedPaymentCount: 0,
      issueCount: 0,
    },
  ],
  rows: [
    {
      rentEventId: 'rent-open',
      propertyId: 'property-1',
      propertyName: 'Oakwood Commons',
      propertyArchivedAt: null,
      unitId: 'unit-101',
      unitLabel: '101',
      tenantId: 'tenant-1',
      tenantName: 'Marcus Alvarez',
      leaseId: 'lease-1',
      cycleMonth: '2026-08-01',
      dueDate: '2026-08-01',
      amountDueCents: 180_000,
      amountPaidCents: 120_000,
      status: 'paid',
      waivedAmountCents: 0,
      waivedAt: null,
    },
    {
      rentEventId: 'rent-excluded',
      propertyId: 'property-2',
      propertyName: '17th Street Row',
      propertyArchivedAt: null,
      unitId: 'unit-c',
      unitLabel: 'C',
      tenantId: 'tenant-2',
      tenantName: 'Jessica Kim',
      leaseId: 'lease-2',
      cycleMonth: '2026-08-01',
      dueDate: '2026-08-01',
      amountDueCents: 200_000,
      amountPaidCents: 200_000,
      status: 'due',
      waivedAmountCents: 0,
      waivedAt: null,
    },
  ],
};

const payment: AccountantPaymentRecord = {
  paymentId: 'payment-1',
  propertyId: 'property-1',
  propertyName: 'Oakwood Commons',
  propertyArchivedAt: null,
  unitId: 'unit-101',
  unitLabel: '101',
  tenantId: 'tenant-1',
  tenantName: 'Marcus Alvarez',
  leaseId: 'lease-1',
  amountCents: 120_000,
  currency: 'USD',
  status: 'succeeded',
  paidAt: null,
  periodBasis: 'record_created_exception',
  rentEventId: 'rent-open',
  matched: true,
  receiptPresent: false,
};

const financials: AccountantFinancialsModel = {
  periodKey: 'mtd',
  cycleStart: '2026-08-01',
  cycleEnd: '2026-08-01',
  fromDate: '2026-08-01',
  toDate: '2026-08-31',
  periodLabel: 'August 2026',
  billedCents: 180_000,
  collectedCents: 120_000,
  outstandingCents: 60_000,
  providerConfirmedCents: 0,
  unmatchedPaymentCount: 0,
  canExport: true,
  events: rent.rows,
  payments: [
    payment,
    {
      ...payment,
      paymentId: 'payment-excluded',
      propertyId: 'property-2',
      propertyName: '17th Street Row',
      tenantName: 'Jessica Kim',
    },
  ],
  properties: rent.properties,
};

const documents: AccountantDocumentsModel = {
  canExport: true,
  missingCount: 1,
  missingLeaseEvidence: [
    {
      contextKind: 'lease',
      propertyId: 'property-missing-only',
      propertyName: 'Juniper House',
      propertyArchivedAt: null,
      unitId: 'unit-3',
      unitLabel: '3A',
      tenantId: 'tenant-3',
      tenantName: 'Avery Reed',
      leaseId: 'lease-3',
      leaseStatus: 'active',
      leaseStartDate: '2026-01-01',
      leaseEndDate: null,
    },
  ],
  rows: [
    {
      documentId: 'document-1',
      propertyId: 'property-1',
      propertyName: 'Oakwood Commons',
      propertyArchivedAt: null,
      unitId: 'unit-101',
      unitLabel: '101',
      tenantId: 'tenant-1',
      tenantName: 'Marcus Alvarez',
      leaseId: 'lease-1',
      leaseStatus: 'active',
      evidenceClass: 'lease_evidence',
      title: 'Executed lease',
      type: 'lease',
      expiryDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      documentId: 'document-excluded',
      propertyId: 'property-1',
      propertyName: 'Oakwood Commons',
      propertyArchivedAt: null,
      unitId: null,
      unitLabel: null,
      tenantId: null,
      tenantName: null,
      leaseId: null,
      leaseStatus: null,
      evidenceClass: 'property_accounting_evidence',
      title: 'Property tax statement',
      type: 'tax',
      expiryDate: null,
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  properties: [
    ...rent.properties,
    {
      propertyId: 'property-missing-only',
      propertyName: 'Juniper House',
      propertyArchivedAt: null,
      leaseCount: 1,
      billedCents: null,
      collectedCents: null,
      outstandingCents: null,
      missingCycleCount: null,
      missingLeaseDocumentCount: 1,
      unmatchedPaymentCount: null,
      issueCount: 1,
    },
  ],
};

describe('accountant route registers', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it('derives rent state from canonical amounts and exports exact filters', () => {
    const register = normalizeRentRegister(
      {
        cycle: '2026-08',
        property: 'property-1',
        state: 'outstanding',
        q: 'Marcus',
      },
      rent.rows,
      new Date('2026-08-12T12:00:00.000Z'),
    );
    render(<AccountantRentRegister model={rent} register={register} />);

    expect(screen.getAllByText('Outstanding')).toHaveLength(2);
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).queryByText('17th Street Row'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '17th Street Row' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export filtered rent rows' }))
      .toHaveAttribute(
        'href',
        '/api/accounting/export?kind=rent-ledger&cycle=2026-08&property=property-1&state=outstanding&q=Marcus',
      );
  });

  it('keeps record creation separate from unavailable payment time and bounds export to period', () => {
    const register = normalizeFinancialRegister(
      {
        period: 'mtd',
        property: 'property-1',
        state: 'timestamp_missing',
      },
      financials.payments,
    );
    render(
      <AccountantFinancialRegister model={financials} register={register} />,
    );

    expect(screen.getAllByText('Payment time unavailable')).toHaveLength(2);
    expect(screen.queryByText(/2040/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('table')).queryByText('17th Street Row'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export filtered payment rows' }))
      .toHaveAttribute(
        'href',
        '/api/accounting/export?kind=payment-history&from=2026-08-01&to=2026-08-31&property=property-1&state=timestamp_missing',
      );
  });

  it('renders the full canonical payment time in UTC in the register and dossier', () => {
    const confirmed = {
      ...payment,
      paymentId: 'payment-confirmed',
      paidAt: '2026-08-04T16:05:06.123456Z',
      periodBasis: 'payment_time' as const,
    };
    const register = normalizeFinancialRegister(
      { payment: confirmed.paymentId },
      [confirmed],
    );
    render(
      <AccountantFinancialRegister
        model={{ ...financials, payments: [confirmed] }}
        register={register}
      />,
    );

    expect(
      screen.getAllByText('Aug 4, 2026, 4:05:06 PM UTC'),
    ).toHaveLength(2);
  });

  it('keeps a sparse payment register content-sized beside its dossier', () => {
    const register = normalizeFinancialRegister(
      { payment: payment.paymentId },
      [payment],
    );
    const { container } = render(
      <AccountantFinancialRegister
        model={{ ...financials, payments: [payment] }}
        register={register}
      />,
    );

    const stylesheet = Array.from(container.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    expect(stylesheet).toMatch(
      /\.accounting-route-layout\s*\{[^}]*align-items:\s*start/,
    );
  });

  it('renders the safe document index without download or upload affordances', () => {
    const register = normalizeDocumentRegister(
      { property: 'property-1', type: 'lease' },
      documents.rows,
    );
    render(
      <AccountantDocumentRegister model={documents} register={register} />,
    );

    expect(screen.getByText('Executed lease')).toBeInTheDocument();
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/upload/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Property tax statement')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Juniper House' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '17th Street Row' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export filtered document rows' }))
      .toHaveAttribute(
        'href',
        '/api/accounting/export?kind=document-index&property=property-1&type=lease',
      );
  });

  it('keeps missing-evidence review finite, filtered, and linked to its dossier', () => {
    const missingLeaseEvidence = Array.from({ length: 10 }, (_, index) => ({
      ...documents.missingLeaseEvidence[0],
      leaseId: `lease-missing-${index}`,
      unitId: `unit-missing-${index}`,
      unitLabel: `${index + 1}A`,
    }));
    const register = normalizeDocumentRegister(
      { type: 'lease' },
      documents.rows,
    );
    const rendered = render(
      <AccountantDocumentRegister
        model={{ ...documents, missingCount: 10, missingLeaseEvidence }}
        register={register}
      />,
    );

    expect(
      screen.getAllByRole('link', { name: 'Review discrepancy' }),
    ).toHaveLength(8);
    expect(screen.getByText(/Showing the first 8 of 10/)).toBeVisible();
    expect(
      screen.getAllByRole('link', { name: 'Review discrepancy' })[0],
    ).toHaveAttribute(
      'href',
      '/today?property=property-missing-only&issue=documents&q=Avery+Reed&selected=missing_lease_document%3Alease-missing-0',
    );

    const propertyOnly = normalizeDocumentRegister(
      { type: 'property' },
      documents.rows,
    );
    rendered.rerender(
      <AccountantDocumentRegister
        model={{ ...documents, missingCount: 10, missingLeaseEvidence }}
        register={propertyOnly}
      />,
    );
    expect(
      screen.queryByRole('link', { name: 'Review discrepancy' }),
    ).not.toBeInTheDocument();
  });
});
