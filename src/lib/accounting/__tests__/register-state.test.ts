import { describe, expect, it } from 'vitest';

import {
  buildDocumentRegisterParams,
  buildRentRegisterParams,
  deriveRentEvidenceState,
  filterAccountantDocuments,
  filterAccountantPayments,
  filterAccountantRent,
  isConfirmedPaymentRecord,
  normalizeDocumentRegister,
  normalizeFinancialRegister,
  normalizeRentRegister,
  normalizeRegisterPage,
  paymentEvidenceState,
} from '../register-state';
import type {
  AccountantDocumentRecord,
  AccountantPaymentRecord,
  AccountantRentEvent,
} from '../types';

const rentRows: AccountantRentEvent[] = [
  {
    rentEventId: 'open-included',
    propertyId: 'property-included',
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
    rentEventId: 'waived-included',
    propertyId: 'property-included',
    propertyName: 'Oakwood Commons',
    propertyArchivedAt: null,
    unitId: 'unit-102',
    unitLabel: '102',
    tenantId: 'tenant-2',
    tenantName: 'Priya Banerjee',
    leaseId: 'lease-2',
    cycleMonth: '2026-08-01',
    dueDate: '2026-08-01',
    amountDueCents: 0,
    amountPaidCents: 0,
    status: 'overdue',
    waivedAmountCents: 175_000,
    waivedAt: '2026-08-09T12:00:00.000Z',
  },
  {
    rentEventId: 'settled-excluded',
    propertyId: 'property-excluded',
    propertyName: '17th Street Row',
    propertyArchivedAt: null,
    unitId: 'unit-c',
    unitLabel: 'C',
    tenantId: 'tenant-3',
    tenantName: 'Jessica Kim',
    leaseId: 'lease-3',
    cycleMonth: '2026-08-01',
    dueDate: '2026-08-01',
    amountDueCents: 200_000,
    amountPaidCents: 200_000,
    status: 'due',
    waivedAmountCents: 0,
    waivedAt: null,
  },
];

const basePayment: AccountantPaymentRecord = {
  paymentId: 'payment-1',
  propertyId: 'property-included',
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
  paidAt: '2026-08-04T16:00:00.000Z',
  periodBasis: 'payment_time',
  rentEventId: 'open-included',
  matched: true,
  receiptPresent: true,
};

const documentRows: AccountantDocumentRecord[] = [
  {
    documentId: 'lease-safe',
    propertyId: 'property-included',
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
    createdAt: '2026-01-01T12:00:00.000Z',
  },
  {
    documentId: 'tax-safe',
    propertyId: 'property-included',
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
    createdAt: '2026-02-01T12:00:00.000Z',
  },
];

describe('accounting register state', () => {
  it('derives rent evidence state from money truth, not stale stored status', () => {
    expect(deriveRentEvidenceState(rentRows[0])).toBe('outstanding');
    expect(deriveRentEvidenceState(rentRows[1])).toBe('waived');
    expect(deriveRentEvidenceState(rentRows[2])).toBe('settled');
    expect(
      deriveRentEvidenceState({
        ...rentRows[0],
        amountPaidCents: 0,
        waivedAmountCents: 50_000,
        waivedAt: '2026-08-05T12:00:00.000Z',
      }),
    ).toBe('outstanding');
  });

  it('filters rent by the same property/state/query contract used by export', () => {
    expect(
      filterAccountantRent(rentRows, {
        cycleMonth: '2026-08-01',
        propertyId: 'property-included',
        state: 'outstanding',
        query: 'marcus',
      }).map((row) => row.rentEventId),
    ).toEqual(['open-included']);
  });

  it('counts only settled rows with paid_at as confirmed payment evidence', () => {
    expect(isConfirmedPaymentRecord(basePayment)).toBe(true);
    expect(
      isConfirmedPaymentRecord({ ...basePayment, status: 'refunded' }),
    ).toBe(false);
    expect(isConfirmedPaymentRecord({ ...basePayment, status: 'paid' })).toBe(
      false,
    );
    expect(
      isConfirmedPaymentRecord({
        ...basePayment,
        paidAt: null,
        periodBasis: 'record_created_exception',
      }),
    ).toBe(false);

    const rows: AccountantPaymentRecord[] = [
      basePayment,
      {
        ...basePayment,
        paymentId: 'missing-time',
        paidAt: null,
        periodBasis: 'record_created_exception',
      },
      {
        ...basePayment,
        paymentId: 'unmatched-missing-time',
        paidAt: null,
        periodBasis: 'record_created_exception',
        matched: false,
        rentEventId: null,
      },
      {
        ...basePayment,
        paymentId: 'unmatched',
        rentEventId: null,
        matched: false,
      },
    ];
    expect(
      filterAccountantPayments(rows, {
        propertyId: null,
        state: 'timestamp_missing',
        query: '',
      }).map((row) => row.paymentId),
    ).toEqual(['missing-time', 'unmatched-missing-time']);
  });

  it.each([
    ['pending', 'pending'],
    ['failed', 'other'],
    ['canceled', 'other'],
    ['refunded', 'other'],
  ] as const)(
    'does not turn an unlinked %s row into succeeded-payment matching work',
    (status, expectedState) => {
      const row = {
        ...basePayment,
        status,
        matched: false,
        rentEventId: null,
      };
      expect(paymentEvidenceState(row)).toBe(expectedState);
      expect(
        filterAccountantPayments([row], {
          propertyId: null,
          state: 'unmatched',
          query: '',
        }),
      ).toEqual([]);
    },
  );

  it('filters only already-classified document projection rows', () => {
    expect(
      filterAccountantDocuments(documentRows, {
        propertyId: 'property-included',
        type: 'lease',
        query: 'executed',
      }).map((row) => row.documentId),
    ).toEqual(['lease-safe']);
  });

  it('bounds page and resolves a valid deep-linked row onto its actual page', () => {
    const rows = Array.from({ length: 45 }, (_, index) => ({ id: `row-${index}` }));
    const result = normalizeRegisterPage(rows, {
      requestedPage: 99,
      selectedId: 'row-1',
      pageSize: 20,
      id: (row) => row.id,
    });

    expect(result.page).toBe(1);
    expect(result.rows).toHaveLength(20);
    expect(result.selectedId).toBe('row-1');
    expect(result.staleSelectionCleared).toBe(false);
    expect(result.range).toEqual({ from: 1, to: 20, total: 45 });
  });

  it('round-trips each route register and clears filtered-out direct selections', () => {
    const rent = normalizeRentRegister(
      {
        cycle: '2026-08',
        property: 'property-included',
        state: 'outstanding',
        event: 'settled-excluded',
      },
      rentRows,
      new Date('2026-08-12T12:00:00.000Z'),
    );
    expect(rent.state).toMatchObject({
      cycleMonth: '2026-08-01',
      propertyId: 'property-included',
      state: 'outstanding',
      eventId: null,
    });
    expect(rent.page.staleSelectionCleared).toBe(true);

    const financial = normalizeFinancialRegister(
      { period: 'last', state: 'confirmed', payment: 'payment-1' },
      [basePayment],
    );
    expect(financial.state).toMatchObject({
      period: 'last',
      state: 'confirmed',
      paymentId: 'payment-1',
    });

    const documents = normalizeDocumentRegister(
      { type: 'lease', document: 'tax-safe' },
      documentRows,
    );
    expect(documents.state.documentId).toBeNull();
    expect(documents.page.staleSelectionCleared).toBe(true);
  });

  it('rejects a year-zero rent cycle before querying a database date', () => {
    const rent = normalizeRentRegister(
      { cycle: '0000-02' },
      rentRows,
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(rent.state.cycleMonth).toBe('2026-08-01');
    expect(
      normalizeRentRegister(
        { cycle: '9999-12' },
        rentRows,
        new Date('2026-08-12T12:00:00.000Z'),
      ).state.cycleMonth,
    ).toBe('2026-08-01');
  });

  it('defensively excludes rows outside the selected rent cycle', () => {
    const rent = normalizeRentRegister(
      { cycle: '2026-08' },
      [
        rentRows[0],
        {
          ...rentRows[0],
          rentEventId: 'september-row',
          cycleMonth: '2026-09-01',
        },
      ],
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(rent.filteredRows.map((row) => row.rentEventId)).toEqual([
      'open-included',
    ]);
  });

  it('distinguishes an assigned empty property from an unknown direct id', () => {
    const authorized = new Set([
      'property-included',
      'property-excluded',
      'property-empty',
    ]);
    const empty = normalizeRentRegister(
      { cycle: '2026-08', property: 'property-empty' },
      rentRows,
      new Date('2026-08-12T12:00:00.000Z'),
      40,
      authorized,
    );
    expect(empty.state.propertyId).toBe('property-empty');
    expect(empty.filteredRows).toEqual([]);
    expect(empty.unknownPropertyRequested).toBe(false);

    const unknown = normalizeRentRegister(
      { cycle: '2026-08', property: 'known-but-out-of-scope' },
      rentRows,
      new Date('2026-08-12T12:00:00.000Z'),
      40,
      authorized,
    );
    expect(unknown.state.propertyId).toBeNull();
    expect(unknown.unknownPropertyRequested).toBe(true);
    expect(unknown.filteredRows).toEqual([]);
    expect(unknown.page.rows).toEqual([]);
  });

  it('applies the same unknown-property denial signal to financials and documents', () => {
    const authorized = new Set(['property-included', 'property-empty']);
    const unknownFinancial = normalizeFinancialRegister(
      { property: 'property-revoked' },
      [basePayment],
      40,
      authorized,
    );
    expect(unknownFinancial.unknownPropertyRequested).toBe(true);
    expect(unknownFinancial.filteredRows).toEqual([]);

    const unknownDocument = normalizeDocumentRegister(
      { property: 'property-revoked' },
      documentRows,
      40,
      authorized,
    );
    expect(unknownDocument.unknownPropertyRequested).toBe(true);
    expect(unknownDocument.filteredRows).toEqual([]);

    expect(
      normalizeDocumentRegister(
        { property: 'property-empty' },
        documentRows,
        40,
        authorized,
      ),
    ).toMatchObject({
      unknownPropertyRequested: false,
      state: { propertyId: 'property-empty' },
      filteredRows: [],
    });
  });

  it.each([
    { label: 'wildcard', property: '*' },
    { label: 'overlong', property: 'x'.repeat(129) },
    {
      label: 'duplicate',
      property: ['property-included', 'property-empty'],
    },
  ])(
    'denies $label property input in every register',
    ({ property }) => {
      const authorized = new Set(['property-included', 'property-empty']);
      const rent = normalizeRentRegister(
        { cycle: '2026-08', property },
        rentRows,
        new Date('2026-08-12T12:00:00.000Z'),
        40,
        authorized,
      );
      const financial = normalizeFinancialRegister(
        { property },
        [basePayment],
        40,
        authorized,
      );
      const documents = normalizeDocumentRegister(
        { property },
        documentRows,
        40,
        authorized,
      );

      for (const register of [rent, financial, documents]) {
        expect(register.unknownPropertyRequested).toBe(true);
        expect(register.filteredRows).toEqual([]);
      }
    },
  );

  it('round-trips only the two safe missing-evidence handoff contexts', () => {
    const rent = normalizeRentRegister(
      { cycle: '2026-08', context: 'missing_cycle' },
      rentRows,
      new Date('2026-08-12T12:00:00.000Z'),
    );
    expect(rent.state.context).toBe('missing_cycle');
    expect(buildRentRegisterParams(rent.state).get('context')).toBe(
      'missing_cycle',
    );

    const documents = normalizeDocumentRegister(
      { context: 'missing_lease_evidence' },
      documentRows,
    );
    expect(documents.state.context).toBe('missing_lease_evidence');
    expect(buildDocumentRegisterParams(documents.state).get('context')).toBe(
      'missing_lease_evidence',
    );
    expect(
      normalizeDocumentRegister({ context: 'private' }, documentRows).state
        .context,
    ).toBeNull();
  });
});
