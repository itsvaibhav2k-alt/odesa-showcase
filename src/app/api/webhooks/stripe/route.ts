/**
 * Wave 7 — Stripe webhook receiver.
 *
 * Stream A landed signature verification + a no-op handler. Stream S
 * (this file) implements the event handlers that close the loop on
 * tenant rent payments. Every UPDATE is keyed on the row's
 * `stripe_payment_intent_id` (UNIQUE) so webhook replays are no-ops.
 *
 * Events handled:
 *   - checkout.session.completed   — defensive UPDATE (we mostly rely
 *                                    on payment_intent.succeeded).
 *   - payment_intent.succeeded     — atomic reconciliation via the
 *                                    reconcile_succeeded_rent_payment
 *                                    RPC: flips rent_payments →
 *                                    'succeeded' (+ paid_at/method/
 *                                    receipt), increments the linked
 *                                    rent_events.amount_paid (clamped
 *                                    at amount_due) and derives status
 *                                    from the balance — all under a
 *                                    row lock with a replay guard and
 *                                    provider amount/currency checks.
 *   - payment_intent.payment_failed — flip rent_payments → 'failed';
 *                                    capture last_payment_error.message
 *                                    on payment_method_type column for
 *                                    dispatcher narration.
 *   - customer.created             — no-op (we mint customers eagerly).
 *
 * Idempotency: the succeeded path is guarded inside the RPC (an
 * already-succeeded row returns a stable replay result with zero
 * mutation); the remaining UPDATEs set only columns derived from the
 * event payload, so re-running an event is a no-op.
 *
 * Security: the route uses the **service-role** Supabase client so it
 * can bypass RLS and write to rent_payments + rent_events without a
 * user JWT. Stripe signature verification is the auth boundary.
 */

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { getStripeClient } from '@/lib/stripe/client';
import { dispatchStripeEvent } from './stripe-event-handler';

// ---------------------------------------------------------------------------
// Billing feature flag
// ---------------------------------------------------------------------------
// Stripe billing is deferred at launch. The entire webhook surface is gated
// behind BILLING_ENABLED so the route compiles and is reachable without a
// STRIPE_WEBHOOK_SECRET in the environment, and returns 503 with a clear
// body when the feature is disabled.

function isBillingEnabled(): boolean {
  const v = process.env.BILLING_ENABLED;
  return v === 'true' || v === '1';
}

/**
 * GET /api/webhooks/stripe
 *
 * Health-check endpoint. Returns 200 with the current feature-flag state
 * so monitoring + E2E smoke tests can verify the route is reachable without
 * needing a real Stripe signature.
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ enabled: isBillingEnabled() }, { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Gate the entire POST handler behind the billing feature flag.
  // When disabled, return 503 immediately without referencing
  // STRIPE_WEBHOOK_SECRET so the server can start without that secret.
  if (!isBillingEnabled()) {
    return NextResponse.json(
      { success: false, error: 'Billing is not enabled on this instance.' },
      { status: 503 },
    );
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { success: false, error: 'Missing signature' },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { success: false, error: 'Invalid signature' },
      { status: 400 },
    );
  }

  try {
    await dispatchStripeEvent(event);
  } catch (err) {
    console.error(
      `[stripe-webhook] handler failed for ${event.type}:`,
      err instanceof Error ? err.message : err,
    );
    // Stripe retries on non-2xx, so we surface a 500 to trigger retry
    // for transient infra errors. Idempotency on UPDATE keeps replays
    // safe.
    return NextResponse.json(
      { success: false, error: 'handler_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, received: event.type });
}
