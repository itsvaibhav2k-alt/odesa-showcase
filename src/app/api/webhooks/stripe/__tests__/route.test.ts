/**
 * Unit tests for the Stripe webhook route (Wave 7 Stream S).
 *
 * The route already verifies signatures via Stripe.webhooks.constructEvent.
 * Stream A landed signature handling; Stream S adds the event-handler
 * dispatch. We test dispatchStripeEvent directly with synthesized
 * Stripe.Event objects + a Supabase chainable mock — that's where the
 * idempotency + cross-row update logic lives. The signature path is
 * covered by a single bad-signature spec via the POST handler.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';

// Mock the @supabase/supabase-js createClient before importing the route.
// We hand the route a chainable mock from __helpers.ts so we can record
// UPDATE values + filter conditions.
import {
  ORG_ID,
  TENANT_ID,
  LEASE_ID,
  makeAdmin,
  type MockAdmin,
} from '@/lib/agent/worker/handlers/__tests__/__helpers';

let currentMock: MockAdmin | null = null;

// Local rpc() stub — the shared chainable helper only mocks .from().
// The succeeded handler now reconciles through a single RPC, so we
// queue rpc responses FIFO here (same pattern as the table queues).
interface RpcResponse {
  data: unknown;
  error: { message: string } | null;
}
let rpcResponses: RpcResponse[] = [];
const rpcMock = vi.fn(
  async (
    _fn: string,
    _args: Record<string, unknown>,
  ): Promise<RpcResponse> => {
    const next = rpcResponses.shift();
    if (!next) {
      // Fail loudly: an un-queued rpc call must never look like success.
      throw new Error('webhook test: rpc called with no queued response');
    }
    return next;
  },
);

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    if (!currentMock) {
      throw new Error(
        'webhook test: currentMock not set — call setMockAdmin first',
      );
    }
    return Object.assign(currentMock.admin, { rpc: rpcMock });
  },
}));

const stripeWebhooksConstructEvent = vi.fn();

vi.mock('@/lib/stripe/client', () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent: stripeWebhooksConstructEvent },
  }),
}));

import { POST } from '../route';
import { dispatchStripeEvent } from '../stripe-event-handler';

const PAYMENT_INTENT_ID = 'pi_test_123';
const RENT_PAYMENT_ID = 'rp_test_1';
const RENT_EVENT_ID = 'rev_test_1';

function setMockAdmin(mock: MockAdmin): void {
  currentMock = mock;
}

beforeEach(() => {
  currentMock = null;
  rpcResponses = [];
  rpcMock.mockClear();
  stripeWebhooksConstructEvent.mockReset();
});

// Build a minimal Stripe.PaymentIntent shape we can pass to the
// dispatcher. Type-cast through unknown — the dispatcher only inspects
// a tiny subset of fields.
function buildPaymentIntentSucceeded(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Event {
  const created = Math.floor(new Date('2026-06-01T12:00:00Z').getTime() / 1000);
  const pi = {
    id: PAYMENT_INTENT_ID,
    object: 'payment_intent',
    created,
    // amount deliberately DIFFERS from amount_received: the handler must
    // reconcile against what Stripe actually captured (amount_received),
    // never the requested amount.
    amount: 111111,
    amount_received: 200000,
    currency: 'usd',
    payment_method: { type: 'card' },
    payment_method_types: ['card'],
    latest_charge: {
      receipt_url: 'https://pay.stripe.com/receipts/abc',
    },
    ...overrides,
  } as unknown as Stripe.PaymentIntent;

  return {
    id: 'evt_test_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: pi },
    created,
  } as unknown as Stripe.Event;
}

function buildPaymentIntentFailed(): Stripe.Event {
  const pi = {
    id: PAYMENT_INTENT_ID,
    object: 'payment_intent',
    last_payment_error: {
      message: 'Your card was declined.',
      code: 'card_declined',
    },
  } as unknown as Stripe.PaymentIntent;

  return {
    id: 'evt_test_2',
    object: 'event',
    type: 'payment_intent.payment_failed',
    data: { object: pi },
    created: 1,
  } as unknown as Stripe.Event;
}

// Row shape returned by the reconcile_succeeded_rent_payment RPC.
function reconcileRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    payment_id: RENT_PAYMENT_ID,
    rent_event_id: RENT_EVENT_ID,
    applied_cents: 200000,
    paid_cents_after: 200000,
    due_cents: 200000,
    event_status: 'paid',
    replay: false,
    overpayment_cents: 0,
    ...overrides,
  };
}

const EXPECTED_RPC_ARGS = {
  p_stripe_payment_intent_id: PAYMENT_INTENT_ID,
  p_paid_at: '2026-06-01T12:00:00.000Z',
  p_payment_method_type: 'card',
  p_receipt_url: 'https://pay.stripe.com/receipts/abc',
  p_provider_amount_cents: 200000,
  p_provider_currency: 'usd',
};

describe('dispatchStripeEvent', () => {
  it('reconciles via rpc with amount_received (never amount) + currency on payment_intent.succeeded', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [{ data: [reconcileRow()], error: null }];

    await dispatchStripeEvent(buildPaymentIntentSucceeded());

    expect(rpcMock).toHaveBeenCalledTimes(1);
    // Exact args: proves amount_received (200000), not amount (111111),
    // reaches the DB, and that paid_at derives from pi.created.
    expect(rpcMock).toHaveBeenCalledWith(
      'reconcile_succeeded_rent_payment',
      EXPECTED_RPC_ARGS,
    );
    // No direct table writes — the reconciliation is atomic in the RPC.
    expect(mock.calls).toHaveLength(0);
  });

  it('handles unlinked payments (rent_event_id null) — rpc called, rent_events never touched', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [
      {
        data: [
          reconcileRow({
            rent_event_id: null,
            applied_cents: 0,
            paid_cents_after: 0,
            due_cents: 0,
            event_status: null,
          }),
        ],
        error: null,
      },
    ];

    await dispatchStripeEvent(buildPaymentIntentSucceeded());

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const reUpdate = mock.calls.find((c) => c.table === 'rent_events');
    expect(reUpdate).toBeUndefined();
  });

  it('is idempotent on replay — second event calls the rpc with identical args and applies nothing client-side', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [
      { data: [reconcileRow()], error: null },
      { data: [reconcileRow({ replay: true, applied_cents: 0 })], error: null },
    ];

    await dispatchStripeEvent(buildPaymentIntentSucceeded());
    await dispatchStripeEvent(buildPaymentIntentSucceeded());

    expect(rpcMock).toHaveBeenCalledTimes(2);
    // Both calls carry the same intent id + provider values — the RPC
    // owns replay detection; the handler never mutates tables directly.
    for (const call of rpcMock.mock.calls) {
      expect(call[0]).toBe('reconcile_succeeded_rent_payment');
      expect(call[1]).toEqual(EXPECTED_RPC_ARGS);
    }
    expect(mock.calls).toHaveLength(0);
  });

  it('throws on rpc errors so the POST handler returns 500 and Stripe retries (fail closed)', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [
      { data: null, error: { message: 'deadlock detected' } },
    ];

    // A transient DB failure must NOT resolve to webhook success — that
    // would mark the event delivered and strand a captured payment as
    // 'pending' forever. The dispatcher rethrows; POST maps it to 500.
    await expect(
      dispatchStripeEvent(buildPaymentIntentSucceeded()),
    ).rejects.toThrow(
      /reconcile_succeeded_rent_payment.*pi_test_123.*deadlock detected/,
    );
  });

  it('throws on amount/currency mismatch errors too — mismatches stay visible, never fake success', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [
      {
        data: null,
        error: {
          message: 'amount_mismatch: provider 999999 vs persisted 200000',
        },
      },
    ];

    await expect(
      dispatchStripeEvent(buildPaymentIntentSucceeded()),
    ).rejects.toThrow(/amount_mismatch/);
  });

  it('warns when the rpc reports overpayment beyond amount_due (never silently lost)', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [
      {
        data: [
          reconcileRow({ applied_cents: 150000, overpayment_cents: 50000 }),
        ],
        error: null,
      },
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await dispatchStripeEvent(buildPaymentIntentSucceeded());

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls[0]!.join(' ');
      expect(logged).toContain('overpayment');
      expect(logged).toContain(PAYMENT_INTENT_ID);
      expect(logged).toContain('50000');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('treats checkout.session.completed as a no-op — payment_intent.succeeded owns reconciliation', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);

    // Stripe sends checkout.session.completed and payment_intent.succeeded
    // in no guaranteed order. Flipping status here would race ahead of the
    // RPC and turn the real reconciliation into a "replay" with
    // amount_paid still 0 — so this event must write NOTHING.
    await dispatchStripeEvent({
      id: 'evt_cs',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          payment_intent: PAYMENT_INTENT_ID,
          payment_status: 'paid',
        },
      },
      created: 1,
    } as unknown as Stripe.Event);

    expect(mock.calls).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('tolerates unknown payment intents (missing-row rpc error) without failing the webhook', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);
    rpcResponses = [
      {
        data: null,
        error: {
          message: `rent_payment_not_found: no rent_payments row for intent ${PAYMENT_INTENT_ID}`,
        },
      },
    ];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // Must NOT throw — Stripe would retry a 500 forever for an intent
      // this instance never minted.
      await dispatchStripeEvent(buildPaymentIntentSucceeded());

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]!.join(' ')).toContain(PAYMENT_INTENT_ID);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('marks rent_payments as failed with the failure reason on payment_intent.payment_failed', async () => {
    const mock = makeAdmin({
      rent_payments: [{ data: null, error: null }],
    });
    setMockAdmin(mock);

    await dispatchStripeEvent(buildPaymentIntentFailed());

    const rpUpdate = mock.calls.find(
      (c) => c.table === 'rent_payments' && c.op === 'update',
    );
    expect(rpUpdate?.updateValues?.status).toBe('failed');
    expect(rpUpdate?.updateValues?.payment_method_type).toContain(
      'Your card was declined.',
    );
  });

  it('no-ops on customer.created and unhandled events', async () => {
    const mock = makeAdmin({});
    setMockAdmin(mock);

    await dispatchStripeEvent({
      id: 'evt_x',
      object: 'event',
      type: 'customer.created',
      data: { object: { id: 'cus_x' } },
      created: 1,
    } as unknown as Stripe.Event);

    await dispatchStripeEvent({
      id: 'evt_y',
      object: 'event',
      type: 'invoice.created',
      data: { object: {} },
      created: 1,
    } as unknown as Stripe.Event);

    expect(mock.calls).toHaveLength(0);
  });
});

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    process.env.BILLING_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.BILLING_ENABLED;
  });

  it('returns 400 with Invalid signature on signature failure', async () => {
    stripeWebhooksConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching');
    });

    // We don't need the admin to do anything — the route bails before
    // dispatch. But createClient is mocked, so it must not crash if
    // imported; setMockAdmin to a benign mock to be safe.
    setMockAdmin(makeAdmin({}));

    const req = new Request('https://x/test', {
      method: 'POST',
      headers: { 'stripe-signature': 'bad' },
      body: '{}',
    });

    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success: boolean; error: string };
    expect(json.success).toBe(false);
    expect(json.error).toBe('Invalid signature');
  });

  it('returns 400 when the stripe-signature header is missing', async () => {
    setMockAdmin(makeAdmin({}));
    const req = new Request('https://x/test', { method: 'POST', body: '{}' });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success: boolean; error: string };
    expect(json.error).toBe('Missing signature');
  });
});

// Reference unused import to satisfy linters for the LEASE_ID constant
// (kept in helpers for symmetry with handler tests).
void LEASE_ID;
void TENANT_ID;
