"use server";

/**
 * Tenant-portal authed server actions.
 *
 * `createPortalPaymentAction` takes ZERO client parameters — the session
 * cookie is the only input. Everything payable is derived server-side in
 * `src/lib/portal/pay.ts`; on success we redirect straight to the Stripe
 * hosted checkout page.
 */

import { redirect } from "next/navigation";

import { createPortalCheckout } from "@/lib/portal/pay";
import { requirePortalSession } from "@/lib/portal/session";
import { createRateLimiter } from "@/lib/rate-limit";

export interface PortalPayState {
  error: string | null;
}

/** 5 checkout attempts per tenant per hour. */
const payLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60 * 60 * 1000,
});

/**
 * Mint (or reuse) a Stripe Checkout session for the tenant's payable
 * balance and redirect to it. Returns a friendly error state instead
 * when nothing is due or checkout can't open.
 *
 * Deliberately takes NO parameters (a fewer-args function is assignable
 * to useActionState's `(state, formData)` shape) — the session cookie is
 * the only input, so a tampered form can't influence anything.
 */
export async function createPortalPaymentAction(): Promise<PortalPayState> {
  const session = await requirePortalSession();

  if (!payLimiter.check(`portal-pay:${session.tenantId}`).allowed) {
    return {
      error:
        "That's a few tries in a row — give it an hour and try again, or reach out to your property manager.",
    };
  }

  const result = await createPortalCheckout(session);
  if (!result.ok) return { error: result.error };

  redirect(result.url);
}
