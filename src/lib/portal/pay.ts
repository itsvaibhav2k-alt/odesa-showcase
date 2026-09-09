/**
 * Tenant-portal pay flow — the ONE write path behind the home-page Pay
 * button. Portal actions call {@link createPortalCheckout} with the
 * verified session and nothing else: the active lease, current open rent
 * event, and payable balance are all derived server-side here, so a
 * tampered form can never choose what (or how much) gets paid.
 *
 * Double-tap safety: an unexpired pending `rent_payments` row for the
 * same rent event already carries a hosted-checkout URL
 * (`payment_link_url` — written eagerly by
 * `src/lib/integrations/stripe/payment-link.ts`), so we send the tenant
 * back to that session instead of minting a duplicate. Rows missing the
 * URL (pre-portal legacy) just mint fresh.
 *
 * Errors are consumer-voice strings, ready to render on the home card.
 */

import { createRentPaymentLink } from "@/lib/integrations/stripe/payment-link";
import { createAdminClient } from "@/lib/supabase/admin";

import { fetchActiveLease, fetchCurrentCycle, localTodayIso } from "./queries";
import type { PortalSession } from "./session";

/**
 * Stripe Checkout Sessions expire 24h after creation; reuse a pending
 * link only inside 23h so we never hand out an about-to-expire URL.
 */
const CHECKOUT_REUSE_WINDOW_MS = 23 * 60 * 60 * 1000;

export type PortalCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const NOTHING_DUE_ERROR =
  "Looks like nothing is due right now. If that seems off, reach out to your property manager.";
const CHECKOUT_FAILED_ERROR =
  "We couldn't open the payment page. Nothing was charged — please try again in a moment.";

/**
 * Derive the payable balance for the session's tenant and return a Stripe
 * Checkout URL for it — reusing an unexpired pending session when one
 * exists, minting (and recording) a fresh one otherwise.
 */
export async function createPortalCheckout(
  session: PortalSession,
): Promise<PortalCheckoutResult> {
  const admin = createAdminClient();

  const lease = await fetchActiveLease(admin, session);
  if (!lease) return { ok: false, error: NOTHING_DUE_ERROR };

  const cycle = await fetchCurrentCycle(
    admin,
    session,
    lease.id,
    localTodayIso(),
  );
  // Zero, already-paid, or stale (newest cycle settled) all land here —
  // the derived status is the single source of "is money actually owed".
  if (!cycle || !cycle.status.isOutstanding || cycle.status.balanceCents <= 0) {
    return { ok: false, error: NOTHING_DUE_ERROR };
  }

  // Reuse only when the pending session's amount still equals today's
  // derived balance — a partial payment recorded since mint would make
  // the old link overcharge; mismatches fall through to a fresh mint.
  const { data: pending } = await admin
    .from("rent_payments")
    .select("id, payment_link_url, created_at")
    .eq("tenant_id", session.tenantId)
    .eq("organization_id", session.organizationId)
    .eq("rent_event_id", cycle.rentEventId)
    .eq("status", "pending")
    .eq("amount_cents", cycle.status.balanceCents)
    .not("payment_link_url", "is", null)
    .gte(
      "created_at",
      new Date(Date.now() - CHECKOUT_REUSE_WINDOW_MS).toISOString(),
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending?.payment_link_url) {
    return { ok: true, url: pending.payment_link_url };
  }

  const minted = await createRentPaymentLink({
    admin,
    organizationId: session.organizationId,
    tenantId: session.tenantId,
    leaseId: lease.id,
    amountCents: cycle.status.balanceCents,
    dueDate: cycle.dueDate ?? undefined,
    rentEventId: cycle.rentEventId,
  });
  if (!minted.ok) {
    // Stable machine error strings stay server-side; log for the operator.
    console.error("[createPortalCheckout] mint failed:", minted.error);
    return { ok: false, error: CHECKOUT_FAILED_ERROR };
  }
  return { ok: true, url: minted.paymentLinkUrl };
}
