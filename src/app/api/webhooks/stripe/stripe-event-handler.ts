/**
 * Stripe webhook event dispatch and persistence.
 *
 * Kept outside route.ts so the App Router entry exports only supported
 * Route Handler fields while focused tests can exercise dispatch directly.
 */

import type Stripe from 'stripe';

import { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Pure dispatcher — separated from the POST handler so it can be unit-
 * tested with a mocked admin client. Idempotency is per-event-type:
 * every UPDATE keys on stripe_payment_intent_id (UNIQUE) so replays
 * either no-op (status already terminal) or write the same values.
 */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<void> {
  const admin = createAdminClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      // No-op: payment_intent.succeeded is the single authoritative
      // reconciliation signal (handled below via the atomic RPC).
      // Flipping status here raced ahead of the RPC — Stripe sends the
      // two events in no guaranteed order — and made the real
      // reconciliation look like a replay, leaving amount_paid at 0.
      return;
    }
    case 'payment_intent.succeeded': {
      await handlePaymentIntentSucceeded(
        admin,
        event.data.object as Stripe.PaymentIntent,
      );
      return;
    }
    case 'payment_intent.payment_failed': {
      await handlePaymentIntentFailed(
        admin,
        event.data.object as Stripe.PaymentIntent,
      );
      return;
    }
    case 'customer.created': {
      // No-op: we mint customers eagerly via createRentPaymentLink.
      return;
    }
    default: {
      // Unhandled event; log so we can decide whether to support it later.
      console.info(`[stripe-webhook] unhandled event: ${event.type}`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------------

async function handlePaymentIntentSucceeded(
  admin: AdminClient,
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const paidAt = new Date(pi.created * 1000).toISOString();
  const paymentMethodType = derivePaymentMethodType(pi);
  const receiptUrl = deriveReceiptUrl(pi);

  // Atomic reconciliation in one RPC transaction: locks the payment row
  // (FOR UPDATE by the UNIQUE intent id), guards replays, validates the
  // provider-captured amount/currency against the persisted row, flips
  // the payment to 'succeeded', and increments the linked
  // rent_events.amount_paid (clamped at amount_due) so /financials
  // collected/outstanding stay truthful.
  //
  // amount_received — NEVER pi.amount — is what Stripe actually
  // captured; pi.amount is only the requested amount.
  const { data, error } = await admin.rpc('reconcile_succeeded_rent_payment', {
    p_stripe_payment_intent_id: pi.id,
    p_paid_at: paidAt,
    p_payment_method_type: paymentMethodType ?? undefined,
    p_receipt_url: receiptUrl ?? undefined,
    p_provider_amount_cents: pi.amount_received,
    p_provider_currency: pi.currency,
  });

  if (error) {
    // Unknown intent: this instance never minted a rent_payments row for
    // it (e.g. a payment created directly in the Stripe dashboard). Keep
    // 200-semantics — a 500 would make Stripe retry forever.
    if (error.message.includes('rent_payment_not_found')) {
      console.warn(
        '[stripe-webhook] payment_intent.succeeded for unknown intent',
        pi.id,
        '- ignored:',
        error.message,
      );
      return;
    }
    // Everything else fails closed at the HTTP boundary: rethrow so the
    // POST handler returns 500 and Stripe retries. Transient DB errors
    // heal on retry; amount/currency mismatches keep failing and stay
    // visible in the Stripe dashboard as an undelivered webhook instead
    // of being swallowed as fake success.
    throw new Error(
      `reconcile_succeeded_rent_payment failed for intent ${pi.id}: ${error.message}`,
    );
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (result && result.overpayment_cents > 0) {
    // The cycle is capped at amount_due; the payment row keeps the full
    // captured amount. Surface the excess so it is never silently lost.
    console.warn(
      '[stripe-webhook] overpayment on intent',
      pi.id,
      '- cents beyond amount_due:',
      result.overpayment_cents,
    );
  }
}

async function handlePaymentIntentFailed(
  admin: AdminClient,
  pi: Stripe.PaymentIntent,
): Promise<void> {
  const failureMessage =
    pi.last_payment_error?.message ??
    pi.last_payment_error?.code ??
    'unknown';

  await admin
    .from('rent_payments')
    .update({
      status: 'failed',
      // Reuse payment_method_type as a free-text slot for the failure
      // reason — keeps the schema lean. Dispatcher narration reads this.
      payment_method_type: `failed: ${failureMessage}`.slice(0, 200),
    })
    .eq('stripe_payment_intent_id', pi.id)
    .neq('status', 'succeeded');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function derivePaymentMethodType(pi: Stripe.PaymentIntent): string | null {
  // payment_method can be a string id or an expanded PaymentMethod.
  const pm = pi.payment_method;
  if (pm && typeof pm === 'object' && 'type' in pm) {
    return (pm.type as string) ?? null;
  }
  // Fallback: payment_method_types[0] if Stripe didn't expand.
  return pi.payment_method_types?.[0] ?? null;
}

function deriveReceiptUrl(pi: Stripe.PaymentIntent): string | null {
  // The receipt url lives on the latest charge, which we may or may
  // not have expanded. Best-effort lookup.
  const charges = (pi as unknown as {
    charges?: { data?: Array<{ receipt_url?: string | null }> };
  }).charges;
  const fromCharges = charges?.data?.[0]?.receipt_url;
  if (fromCharges) return fromCharges;

  const latestCharge = (pi as unknown as {
    latest_charge?: string | { receipt_url?: string | null };
  }).latest_charge;
  if (latestCharge && typeof latestCharge === 'object') {
    return latestCharge.receipt_url ?? null;
  }
  return null;
}
