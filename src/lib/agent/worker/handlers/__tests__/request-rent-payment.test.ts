/**
 * Unit tests for handleRequestRentPayment (Wave 7 Stream S).
 *
 * Mocks Stripe's Checkout Sessions + the Customers API and the
 * sendWithFailover SMS path so the handler runs end-to-end without
 * network or DB. The Supabase chainable mock comes from __helpers.ts.
 *
 * Specs:
 *   - happy path: resolves tenant by id, finds active lease, calls
 *     stripe.checkout.sessions.create with the right line_items +
 *     metadata + customer, INSERTs rent_payments row, sends SMS.
 *   - missing amountCents: handler defaults to lease.rent_amount × 100.
 *   - no active lease: returns 'no_active_lease', confidence 0.
 *   - sendWithFailover failure: rent_payments row stays 'pending'
 *     (handler returns sms_send_failed).
 *   - tenant ambiguity: returns 'ambiguous_tenant', confidence 0.2.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Stripe client + sendWithFailover BEFORE importing the handler.
const stripeCustomersCreate = vi.fn();
const stripeSessionsCreate = vi.fn();

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    customers: { create: stripeCustomersCreate },
    checkout: { sessions: { create: stripeSessionsCreate } },
  }),
}));

vi.mock('@/lib/messaging/send-with-failover', () => ({
  sendWithFailover: vi.fn(),
}));

import { sendWithFailover } from '@/lib/messaging/send-with-failover';

import { handleRequestRentPayment } from '../request-rent-payment';
import { ORG_ID, TENANT_ID, LEASE_ID, makeAdmin } from './__helpers';

const mockSendWithFailover = vi.mocked(sendWithFailover);

const TENANT_ROW = {
  id: TENANT_ID,
  full_name: 'Test Person',
  phone_e164: '+15551234567',
  email: 'test@example.com',
  stripe_customer_id: null,
};

const LEASE_ROW = {
  id: LEASE_ID,
  rent_amount: 2400, // dollars in DB
  rent_due_day: 1,
  start_date: '2026-06-01',
  status: 'active',
};

const ORG_ROW = {
  id: ORG_ID,
  odesa_phone_number: '+18005551111',
};

const SESSION_OK = {
  id: 'cs_test_abc',
  url: 'https://checkout.stripe.com/c/cs_test_abc',
  payment_intent: 'pi_test_xyz',
};

beforeEach(() => {
  stripeCustomersCreate.mockReset();
  stripeSessionsCreate.mockReset();
  mockSendWithFailover.mockReset();
});

describe('handleRequestRentPayment', () => {
  it('creates checkout session, INSERTs rent_payments row, sends SMS on happy path', async () => {
    stripeCustomersCreate.mockResolvedValue({ id: 'cus_test_123' });
    stripeSessionsCreate.mockResolvedValue(SESSION_OK);
    mockSendWithFailover.mockResolvedValue({
      ok: true,
      provider: 'linq',
      providerMessageId: 'lq_send_1',
      attempted: ['linq'],
      failedOver: false,
    });

    const { admin, calls } = makeAdmin({
      tenants: [
        { data: TENANT_ROW, error: null }, // tenant fetch (ref by id path)
        { data: TENANT_ROW, error: null }, // payment-link helper tenant fetch
        { data: null, error: null }, // UPDATE stripe_customer_id
      ],
      leases: [{ data: [LEASE_ROW], error: null }],
      organizations: [{ data: ORG_ROW, error: null }],
      rent_payments: [{ data: { id: 'rp_1' }, error: null }],
    });

    const result = await handleRequestRentPayment({
      admin,
      organizationId: ORG_ID,
      payload: {
        tenantRef: { tenantId: TENANT_ID },
        amountCents: 240000,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe(0.95);
    expect(result.data).toMatchObject({
      paymentLinkUrl: SESSION_OK.url,
      paymentIntentId: SESSION_OK.payment_intent,
      rentPaymentId: 'rp_1',
      customerId: 'cus_test_123',
      sentTo: TENANT_ROW.phone_e164,
      amountCents: 240000,
      tenantName: TENANT_ROW.full_name,
    });

    // Stripe customers.create called with tenant metadata.
    expect(stripeCustomersCreate).toHaveBeenCalledTimes(1);
    expect(stripeCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: TENANT_ROW.full_name,
        phone: TENANT_ROW.phone_e164,
        email: TENANT_ROW.email,
        metadata: { tenant_id: TENANT_ID, organization_id: ORG_ID },
      }),
    );

    // Checkout Session has the right shape.
    expect(stripeSessionsCreate).toHaveBeenCalledTimes(1);
    const sessionArgs = stripeSessionsCreate.mock.calls[0][0];
    expect(sessionArgs).toMatchObject({
      mode: 'payment',
      customer: 'cus_test_123',
      payment_method_types: ['card', 'us_bank_account'],
      line_items: [
        expect.objectContaining({
          quantity: 1,
          price_data: expect.objectContaining({
            currency: 'usd',
            unit_amount: 240000,
          }),
        }),
      ],
      payment_intent_data: expect.objectContaining({
        metadata: expect.objectContaining({
          tenant_id: TENANT_ID,
          organization_id: ORG_ID,
          lease_id: LEASE_ID,
        }),
      }),
    });

    // SMS was sent with the URL.
    expect(mockSendWithFailover).toHaveBeenCalledTimes(1);
    expect(mockSendWithFailover).toHaveBeenCalledWith(ORG_ID, {
      toE164: TENANT_ROW.phone_e164,
      fromE164: ORG_ROW.odesa_phone_number,
      body: expect.stringContaining(SESSION_OK.url),
      idempotencyKey: 'rent-payment:rp_1',
    });

    // rent_payments INSERT carries the right intent + status.
    const insertCall = calls.find(
      (c) => c.table === 'rent_payments' && c.op === 'insert',
    );
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      lease_id: LEASE_ID,
      tenant_id: TENANT_ID,
      stripe_payment_intent_id: SESSION_OK.payment_intent,
      stripe_customer_id: 'cus_test_123',
      amount_cents: 240000,
      currency: 'usd',
      status: 'pending',
      payment_link_url: SESSION_OK.url,
    });
  });

  it('defaults amountCents to lease.rent_amount × 100 when payload omits it', async () => {
    stripeCustomersCreate.mockResolvedValue({ id: 'cus_test_456' });
    stripeSessionsCreate.mockResolvedValue(SESSION_OK);
    mockSendWithFailover.mockResolvedValue({
      ok: true,
      provider: 'linq',
      providerMessageId: 'lq_send_1',
      attempted: ['linq'],
      failedOver: false,
    });

    const { admin } = makeAdmin({
      tenants: [
        { data: TENANT_ROW, error: null },
        { data: TENANT_ROW, error: null },
        { data: null, error: null },
      ],
      leases: [{ data: [LEASE_ROW], error: null }],
      organizations: [{ data: ORG_ROW, error: null }],
      rent_payments: [{ data: { id: 'rp_1' }, error: null }],
    });

    const result = await handleRequestRentPayment({
      admin,
      organizationId: ORG_ID,
      payload: { tenantRef: { tenantId: TENANT_ID } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.amountCents).toBe(240000); // 2400 dollars × 100

    const sessionArgs = stripeSessionsCreate.mock.calls[0][0];
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(240000);
  });

  it('returns no_active_lease when tenant has no active or pending lease', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: TENANT_ROW, error: null }],
      leases: [{ data: [], error: null }],
    });

    const result = await handleRequestRentPayment({
      admin,
      organizationId: ORG_ID,
      payload: { tenantRef: { tenantId: TENANT_ID } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('no_active_lease');
    expect(result.confidence).toBe(0);
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });

  it('keeps rent_payments status pending when sendWithFailover fails', async () => {
    stripeCustomersCreate.mockResolvedValue({ id: 'cus_test_789' });
    stripeSessionsCreate.mockResolvedValue(SESSION_OK);
    mockSendWithFailover.mockResolvedValue({
      ok: false,
      attempted: ['linq', 'twilio'],
      errors: [
        { provider: 'linq', error: 'rate_limited' },
        { provider: 'twilio', error: 'auth_failed' },
      ],
    });

    const { admin, calls } = makeAdmin({
      tenants: [
        { data: TENANT_ROW, error: null },
        { data: TENANT_ROW, error: null },
        { data: null, error: null },
      ],
      leases: [{ data: [LEASE_ROW], error: null }],
      organizations: [{ data: ORG_ROW, error: null }],
      rent_payments: [{ data: { id: 'rp_1' }, error: null }],
    });

    const result = await handleRequestRentPayment({
      admin,
      organizationId: ORG_ID,
      payload: { tenantRef: { tenantId: TENANT_ID } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('sms_send_failed: rate_limited');
    expect(result.confidence).toBeCloseTo(0.4);

    // rent_payments INSERT still happened with status='pending'.
    const insertCall = calls.find(
      (c) => c.table === 'rent_payments' && c.op === 'insert',
    );
    expect(insertCall?.insertValues?.status).toBe('pending');

    // No follow-up UPDATE on rent_payments to flip status — operator
    // can resend from the unit-detail UI.
    const updateCall = calls.find(
      (c) => c.table === 'rent_payments' && c.op === 'update',
    );
    expect(updateCall).toBeUndefined();
  });

  it('returns ambiguous_tenant with confidence 0.2 when name resolves to multiple tenants', async () => {
    // resolveTenant uses an .ilike + .limit(2) chain that resolves via
    // the .then trap — first tenants response is two rows.
    const { admin } = makeAdmin({
      tenants: [
        { data: [{ id: TENANT_ID }, { id: 'other-tenant-id' }], error: null },
      ],
    });

    const result = await handleRequestRentPayment({
      admin,
      organizationId: ORG_ID,
      payload: { tenantRef: { tenantName: 'Test' } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('ambiguous_tenant');
    expect(result.confidence).toBe(0.2);
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
    expect(mockSendWithFailover).not.toHaveBeenCalled();
  });
});
