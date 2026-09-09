import { describe, expect, it } from 'vitest';

import {
  AccountantProjectionError,
  mapAccountantDocuments,
  mapAccountantLeaseContext,
  mapAccountantPayments,
  mapAccountantRentEvents,
} from '../projection';

describe('Accountant projection decoding', () => {
  it('maps cents without floating conversion and rejects an over-broad projection', () => {
    const rent = {
      rent_event_id: 'rent-1',
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
      amount_due_cents: 180_001,
      amount_paid_cents: 120_000,
      status: 'paid',
      waived_amount_cents: null,
      waived_at: null,
    };
    const [row] = mapAccountantRentEvents([rent]);

    expect(row.amountDueCents).toBe(180_001);
    expect(() =>
      mapAccountantRentEvents([
        { ...rent, phone_e164: '+15555550100', provider_id: 'secret-provider' },
      ]),
    ).toThrow(AccountantProjectionError);
  });

  it('enforces the USD-only payment contract and canonical paid_at separation', () => {
    const payment = {
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
      paid_at: null,
      period_basis: 'record_created_exception',
      rent_event_id: null,
      matched: false,
      receipt_present: false,
    };
    const [row] = mapAccountantPayments([payment]);

    expect(row.currency).toBe('USD');
    expect(row.paidAt).toBeNull();
    expect(row.periodBasis).toBe('record_created_exception');
    expect(() =>
      mapAccountantPayments([
        { ...payment, paid_at: null, period_basis: 'payment_time' },
      ]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantPayments([{ ...payment, currency: 'eur' }]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantPayments([
        { ...payment, record_created_at: '2040-01-01T00:00:00.000Z' },
      ]),
    ).toThrow(AccountantProjectionError);
  });

  it.each(['', 'not-a-date', '2026-02-30T12:00:00.000Z'])
    ('rejects malformed canonical paid_at evidence %j', (paidAt) => {
      expect(() =>
        mapAccountantPayments([
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
            paid_at: paidAt,
            period_basis: 'payment_time',
            rent_event_id: 'rent-1',
            matched: true,
            receipt_present: true,
          },
        ]),
      ).toThrow(AccountantProjectionError);
    });

  it('rejects negative money and inconsistent payment matching evidence', () => {
    const payment = {
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
      paid_at: '2026-08-04T16:00:00+00:00',
      period_basis: 'payment_time',
      rent_event_id: 'rent-1',
      matched: true,
      receipt_present: true,
    };

    expect(mapAccountantPayments([payment])[0].paidAt).toBe(
      '2026-08-04T16:00:00.000000Z',
    );
    expect(
      mapAccountantPayments([
        { ...payment, paid_at: '2026-08-04T16:00:00.123456Z' },
      ])[0].paidAt,
    ).toBe('2026-08-04T16:00:00.123456Z');
    expect(() =>
      mapAccountantPayments([{ ...payment, amount_cents: -1 }]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantPayments([{ ...payment, matched: false }]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantPayments([{ ...payment, rent_event_id: '' }]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantPayments([
        { ...payment, paid_at: '0001-01-01T00:00:00+14:00' },
      ]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantPayments([
        { ...payment, paid_at: '9998-12-31T23:59:59-14:00' },
      ]),
    ).toThrow(AccountantProjectionError);
  });

  it('requires explicit document evidence classification', () => {
    const document = {
      document_id: 'document-1',
      property_id: 'property-1',
      property_name: 'Oakwood Commons',
      property_archived_at: null,
      unit_id: null,
      unit_label: null,
      tenant_id: null,
      tenant_name: null,
      lease_id: null,
      lease_status: null,
      evidence_class: 'property_accounting_evidence',
      title: 'Property tax statement',
      type: 'tax',
      expiry_date: null,
      created_at: '2026-01-01T00:00:00.000Z',
    };

    expect(mapAccountantDocuments([document])[0].evidenceClass).toBe(
      'property_accounting_evidence',
    );
    expect(() =>
      mapAccountantDocuments([
        { ...document, evidence_class: 'private_owner_document' },
      ]),
    ).toThrow(AccountantProjectionError);
    expect(() =>
      mapAccountantDocuments([
        {
          ...document,
          tenant_id: 'tenant-private',
          tenant_name: 'Private Resident',
        },
      ]),
    ).toThrow(AccountantProjectionError);
  });

  it('keeps a scoped property with no lease as explicit property context', () => {
    expect(
      mapAccountantLeaseContext([
        {
          property_id: 'property-empty',
          property_name: 'Juniper House',
          property_archived_at: null,
          unit_id: null,
          unit_label: null,
          tenant_id: null,
          tenant_name: null,
          lease_id: null,
          lease_status: null,
          lease_start_date: null,
          lease_end_date: null,
        },
      ])[0],
    ).toMatchObject({
      contextKind: 'property',
      propertyId: 'property-empty',
      leaseId: null,
    });

    expect(() =>
      mapAccountantLeaseContext([
        {
          property_id: 'property-1',
          property_name: 'Oakwood Commons',
          property_archived_at: null,
          unit_id: 'unit-1',
          unit_label: '101',
          tenant_id: 'tenant-1',
          tenant_name: 'Marcus Alvarez',
          lease_id: '',
          lease_status: 'active',
          lease_start_date: '2026-01-01',
          lease_end_date: null,
        },
      ]),
    ).toThrow(AccountantProjectionError);
  });
});
