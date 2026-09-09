/**
 * Unit tests for createRentPaymentLink (Wave 7 Stream S).
 *
 * Covers:
 *   - reuses existing tenants.stripe_customer_id (no customers.create
 *     when already minted)
 *   - mints a new Stripe customer on first call + persists the id
 *   - constructs the Checkout Session line_items + metadata correctly
 *   - INSERTs rent_payments with status='pending' + the intent id
 *   - propagates errors as stable strings
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRentPaymentLink } from '../payment-link';
import { ORG_ID, TENANT_ID, LEASE_ID, makeAdmin } from
  '@/lib/agent/worker/handlers/__tests__/__helpers';

const stripeCustomersCreate = vi.fn();
const stripeSessionsCreate = vi.fn();

const stripeStub = {
  customers: { create: stripeCustomersCreate },
  checkout: { sessions: { create: stripeSessionsCreate } },
} as unknown as import('stripe').default;

const TENANT_BASE = {
  id: TENANT_ID,
  full_name: 'Test Person',
  phone_e164: '+15551234567',
  email: 'test@example.com',
};

const SESSION_OK = {
  id: 'cs_test_abc',
  url: 'https://checkout.stripe.com/c/cs_test_abc',
  payment_intent: 'pi_test_xyz',
};

beforeEach(() => {
  stripeCustomersCreate.mockReset();
  stripeSessionsCreate.mockReset();
});

describe('createRentPaymentLink', () => {
  it('creates a Stripe customer when tenant has none, persists the id, and INSERTs rent_payments', async () => {
    stripeCustomersCreate.mockResolvedValue({ id: 'cus_new_1' });
    stripeSessionsCreate.mockResolvedValue(SESSION_OK);

    const { admin, calls } = makeAdmin({
      tenants: [
        { data: { ...TENANT_BASE, stripe_customer_id: null }, error: null },
        { data: null, error: null }, // UPDATE stripe_customer_id
      ],
      rent_payments: [{ data: { id: 'rp_1' }, error: null }],
    });

    const result = await createRentPaymentLink({
      admin,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      leaseId: LEASE_ID,
      amountCents: 240000,
      dueDate: '2026-06-01',
      stripe: stripeStub,
      appUrl: 'https://app.example.com',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customerId).toBe('cus_new_1');
    expect(result.paymentIntentId).toBe(SESSION_OK.payment_intent);
    expect(result.paymentLinkUrl).toBe(SESSION_OK.url);
    expect(result.rentPaymentId).toBe('rp_1');

    expect(stripeCustomersCreate).toHaveBeenCalledTimes(1);
    expect(stripeCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: TENANT_BASE.full_name,
        phone: TENANT_BASE.phone_e164,
        email: TENANT_BASE.email,
        metadata: { tenant_id: TENANT_ID, organization_id: ORG_ID },
      }),
    );

    const sessionArgs = stripeSessionsCreate.mock.calls[0][0];
    expect(sessionArgs).toMatchObject({
      mode: 'payment',
      customer: 'cus_new_1',
      success_url:
        'https://app.example.com/portal/payment-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.example.com/portal/payment-cancel',
    });
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(240000);
    expect(sessionArgs.line_items[0].price_data.currency).toBe('usd');
    expect(sessionArgs.line_items[0].price_data.product_data.name).toContain(
      'June 2026',
    );
    expect(sessionArgs.payment_intent_data.metadata).toMatchObject({
      tenant_id: TENANT_ID,
      organization_id: ORG_ID,
      lease_id: LEASE_ID,
    });

    // tenants UPDATE persisted the new customer id.
    const updateCall = calls.find(
      (c) => c.table === 'tenants' && c.op === 'update',
    );
    expect(updateCall?.updateValues).toMatchObject({
      stripe_customer_id: 'cus_new_1',
    });

    // rent_payments INSERT carries status='pending' + intent + URL.
    const insertCall = calls.find(
      (c) => c.table === 'rent_payments' && c.op === 'insert',
    );
    expect(insertCall?.insertValues).toMatchObject({
      organization_id: ORG_ID,
      lease_id: LEASE_ID,
      tenant_id: TENANT_ID,
      stripe_payment_intent_id: SESSION_OK.payment_intent,
      stripe_customer_id: 'cus_new_1',
      amount_cents: 240000,
      status: 'pending',
      payment_link_url: SESSION_OK.url,
    });
  });

  it('reuses an existing stripe_customer_id without calling customers.create', async () => {
    stripeSessionsCreate.mockResolvedValue(SESSION_OK);

    const { admin } = makeAdmin({
      tenants: [
        {
          data: { ...TENANT_BASE, stripe_customer_id: 'cus_existing' },
          error: null,
        },
      ],
      rent_payments: [{ data: { id: 'rp_2' }, error: null }],
    });

    const result = await createRentPaymentLink({
      admin,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      leaseId: LEASE_ID,
      amountCents: 180000,
      stripe: stripeStub,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customerId).toBe('cus_existing');
    expect(stripeCustomersCreate).not.toHaveBeenCalled();
    const sessionArgs = stripeSessionsCreate.mock.calls[0][0];
    expect(sessionArgs.customer).toBe('cus_existing');
    expect(sessionArgs.line_items[0].price_data.unit_amount).toBe(180000);
  });

  it('returns tenant_not_found when tenant row is missing', async () => {
    const { admin } = makeAdmin({
      tenants: [{ data: null, error: null }],
    });

    const result = await createRentPaymentLink({
      admin,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      leaseId: LEASE_ID,
      amountCents: 240000,
      stripe: stripeStub,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('tenant_not_found');
    expect(stripeCustomersCreate).not.toHaveBeenCalled();
    expect(stripeSessionsCreate).not.toHaveBeenCalled();
  });

  it('surfaces checkout_session_create_failed when Stripe throws', async () => {
    stripeCustomersCreate.mockResolvedValue({ id: 'cus_x' });
    stripeSessionsCreate.mockRejectedValue(
      new Error('No such payment_method_type: us_bank_account'),
    );

    const { admin } = makeAdmin({
      tenants: [
        { data: { ...TENANT_BASE, stripe_customer_id: null }, error: null },
        { data: null, error: null },
      ],
    });

    const result = await createRentPaymentLink({
      admin,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
      leaseId: LEASE_ID,
      amountCents: 100000,
      stripe: stripeStub,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/^checkout_session_create_failed:/);
  });
});
