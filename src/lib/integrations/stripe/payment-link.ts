/**
 * Wave 7 — Stripe rent payment link helper.
 *
 * Despite the filename (kept per playbook for cross-stream consistency),
 * this module uses Stripe **Checkout Sessions** rather than Payment
 * Links. Rationale: a `mode: 'payment'` Checkout Session returns a
 * `payment_intent` id at creation time, which lets us write the
 * `rent_payments` row eagerly. Payment Links create the intent lazily
 * when the tenant clicks, which would force us to listen for
 * `payment_intent.created` to bookkeep — strictly more moving parts.
 *
 * Flow:
 *   1. get-or-create the tenant's `stripe_customer_id` (lazy — first
 *      payment-link request is when we mint the customer).
 *   2. stripe.checkout.sessions.create({ mode: 'payment', ... }) with
 *      tenant_id + organization_id + lease_id + rent_event_id stamped
 *      on payment_intent_data.metadata. The webhook reads those to
 *      reconcile when the intent succeeds.
 *   3. INSERT a `rent_payments` row with status='pending' keyed on the
 *      session.payment_intent. The Stream A migration enforces UNIQUE
 *      on stripe_payment_intent_id, so the webhook can do
 *      `INSERT ... ON CONFLICT DO UPDATE` safely.
 *   4. Return the hosted Checkout URL + intent id back to the caller
 *      (handleRequestRentPayment) which texts the tenant.
 *
 * Stable error strings (callers narrate these):
 *   - 'tenant_not_found'
 *   - 'tenant_missing_phone'
 *   - 'stripe_customer_create_failed: <msg>'
 *   - 'checkout_session_create_failed: <msg>'
 *   - 'rent_payment_insert_failed: <msg>'
 *
 * Stripe SDK version: ^20.4.1, apiVersion '2026-02-25.clover'.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { Database } from '@/types/database';

import { getStripeClient } from '@/lib/stripe/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateRentPaymentLinkArgs {
  admin: SupabaseClient<Database>;
  organizationId: string;
  tenantId: string;
  leaseId: string;
  amountCents: number;
  /** ISO date (YYYY-MM-DD). Optional — used for the product_data label. */
  dueDate?: string;
  /** Optional rent_events row to link this payment to. */
  rentEventId?: string | null;
  /** Override the Stripe SDK (test injection). Defaults to getStripeClient(). */
  stripe?: Stripe;
  /** Override the app URL for success_url / cancel_url (test injection). */
  appUrl?: string;
}

export interface CreateRentPaymentLinkOk {
  ok: true;
  paymentLinkUrl: string;
  paymentIntentId: string;
  customerId: string;
  rentPaymentId: string;
}

export interface CreateRentPaymentLinkErr {
  ok: false;
  error: string;
}

export type CreateRentPaymentLinkResult =
  | CreateRentPaymentLinkOk
  | CreateRentPaymentLinkErr;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function createRentPaymentLink(
  args: CreateRentPaymentLinkArgs,
): Promise<CreateRentPaymentLinkResult> {
  const {
    admin,
    organizationId,
    tenantId,
    leaseId,
    amountCents,
    dueDate,
    rentEventId,
  } = args;

  // getStripeClient() throws synchronously when STRIPE_SECRET_KEY is
  // unset — fold that into the result contract so every caller gets the
  // same `ok:false` shape they already handle instead of a crash.
  let stripe: Stripe;
  try {
    stripe = args.stripe ?? getStripeClient();
  } catch (err) {
    return { ok: false, error: `stripe_not_configured: ${errMsg(err)}` };
  }
  const appUrl = args.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://odesa.app';

  // 1. Load tenant so we have name/email/phone to stamp onto the customer.
  const { data: tenant, error: tenantErr } = await admin
    .from('tenants')
    .select('id, full_name, phone_e164, email, stripe_customer_id')
    .eq('organization_id', organizationId)
    .eq('id', tenantId)
    .limit(1)
    .maybeSingle();

  if (tenantErr || !tenant) {
    return { ok: false, error: 'tenant_not_found' };
  }
  if (!tenant.phone_e164) {
    return { ok: false, error: 'tenant_missing_phone' };
  }

  // 2. Get-or-create the Stripe customer. Idempotent on the
  // tenants.stripe_customer_id column — a non-null value is reused.
  let customerId = tenant.stripe_customer_id;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        name: tenant.full_name,
        phone: tenant.phone_e164,
        ...(tenant.email ? { email: tenant.email } : {}),
        metadata: {
          tenant_id: tenantId,
          organization_id: organizationId,
        },
      });
      customerId = customer.id;
      const { error: updateErr } = await admin
        .from('tenants')
        .update({ stripe_customer_id: customerId })
        .eq('organization_id', organizationId)
        .eq('id', tenantId);
      if (updateErr) {
        // Persisting the new customer id failed; we'll still use it for
        // this session, but log so the operator can investigate the next
        // send. Do not fail the rent-link request over a bookkeeping error.
        console.warn(
          '[createRentPaymentLink] failed to persist stripe_customer_id',
          updateErr.message,
        );
      }
    } catch (err) {
      return {
        ok: false,
        error: `stripe_customer_create_failed: ${errMsg(err)}`,
      };
    }
  }

  // 3. Build the Checkout Session. payment_intent_data.metadata is
  // mirrored on the PaymentIntent so the webhook can reconcile by
  // stripe_payment_intent_id (UNIQUE on rent_payments).
  const monthLabel = describeMonthLabel(dueDate);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `Rent — ${monthLabel}` },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      payment_method_types: ['card', 'us_bank_account'],
      payment_intent_data: {
        metadata: {
          tenant_id: tenantId,
          organization_id: organizationId,
          lease_id: leaseId,
          ...(rentEventId ? { rent_event_id: rentEventId } : {}),
        },
      },
      success_url: `${appUrl}/portal/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/portal/payment-cancel`,
    });
  } catch (err) {
    return {
      ok: false,
      error: `checkout_session_create_failed: ${errMsg(err)}`,
    };
  }

  // session.payment_intent on a 'payment'-mode session is the intent id
  // (string). It can technically be the expanded PaymentIntent object —
  // we narrow defensively.
  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  if (!paymentIntentId || !session.url) {
    return {
      ok: false,
      error: 'checkout_session_create_failed: missing payment_intent or url',
    };
  }

  // 4. Eager INSERT into rent_payments. The webhook later UPDATEs by
  // stripe_payment_intent_id (UNIQUE) when the intent succeeds.
  const { data: inserted, error: insertErr } = await admin
    .from('rent_payments')
    .insert({
      organization_id: organizationId,
      lease_id: leaseId,
      tenant_id: tenantId,
      rent_event_id: rentEventId ?? null,
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: customerId,
      amount_cents: amountCents,
      currency: 'usd',
      status: 'pending',
      payment_link_url: session.url,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: `rent_payment_insert_failed: ${insertErr?.message ?? 'unknown'}`,
    };
  }

  return {
    ok: true,
    paymentLinkUrl: session.url,
    paymentIntentId,
    customerId,
    rentPaymentId: inserted.id,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a friendly month label for the Checkout product line. The
 * tenant sees this on their hosted payment page, so it should read
 * naturally ("June 2026", not "2026-06-01").
 */
function describeMonthLabel(dueDate: string | undefined): string {
  if (!dueDate) {
    const now = new Date();
    return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  // Parse as UTC midnight to avoid TZ-induced month flips.
  const parsed = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'this month';
  return parsed.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
