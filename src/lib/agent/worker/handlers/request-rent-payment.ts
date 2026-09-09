/**
 * Wave 7 — handler for `request_rent_payment`.
 *
 * Generates a Stripe-hosted Checkout Session URL for the tenant's
 * upcoming rent and SMS-delivers it via sendWithFailover. The webhook
 * (`/api/webhooks/stripe/route.ts`) closes the loop when the tenant
 * pays — UPDATEing the `rent_payments` row to status='succeeded'.
 *
 * Defaults when the dispatcher omits payload fields:
 *   - amountCents → tenant's active lease.rent_amount × 100
 *   - dueDate     → next occurrence of the lease's rent_due_day
 *   - rentEventId → null (ad-hoc; not linked to a generated rent_events row)
 *
 * Stable error strings (humanizeHandlerError + dispatcher narration):
 *   - 'tenant_not_found'
 *   - 'ambiguous_tenant'
 *   - 'no_active_lease'
 *   - 'tenant_missing_phone'
 *   - 'org_missing_phone'
 *   - 'stripe_customer_create_failed: <msg>'
 *   - 'checkout_session_create_failed: <msg>'
 *   - 'rent_payment_insert_failed: <msg>'
 *   - 'sms_send_failed: <msg>' (the rent_payments row stays 'pending' so
 *      the operator can resend the link from the unit-detail UI)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

import { sendWithFailover } from "@/lib/messaging/send-with-failover";
import { createRentPaymentLink } from "@/lib/integrations/stripe/payment-link";

import { resolveTenant } from "../resolve-refs";
import type { RequestRentPaymentPayload } from "../types";
import type { HandlerArgs, HandlerResult } from "./index";

interface ResolvedTenant {
  id: string;
  fullName: string;
  phoneE164: string;
  byId: boolean;
}

export async function handleRequestRentPayment(
  args: HandlerArgs<RequestRentPaymentPayload>,
): Promise<HandlerResult> {
  const { admin, organizationId, payload } = args;

  // 1. Resolve tenantRef → tenant id + name + phone.
  const tenantResult = await resolveTenantPayload(
    admin,
    organizationId,
    payload,
  );
  if (!tenantResult.ok) {
    return {
      ok: false,
      error:
        tenantResult.reason === "ambiguous"
          ? "ambiguous_tenant"
          : "tenant_not_found",
      confidence: tenantResult.reason === "ambiguous" ? 0.2 : 0,
    };
  }
  const tenant = tenantResult.tenant;
  if (!tenant.phoneE164) {
    return { ok: false, error: "tenant_missing_phone", confidence: 0 };
  }

  // 2. Find the tenant's active lease (or pending — onboarding flow).
  // Pick the latest start_date so a tenant with both a draft pending
  // lease AND an active one resolves to the active row.
  const { data: leaseRows, error: leaseErr } = await admin
    .from("leases")
    .select("id, rent_amount, rent_due_day, start_date, status")
    .eq("organization_id", organizationId)
    .eq("tenant_id", tenant.id)
    .in("status", ["active", "pending"])
    .order("status", { ascending: true }) // active < pending alphabetically
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(1);

  if (leaseErr) {
    return { ok: false, error: "no_active_lease", confidence: 0 };
  }
  const lease = leaseRows?.[0];
  if (!lease) {
    return { ok: false, error: "no_active_lease", confidence: 0 };
  }

  // 3. Compute amount + due date defaults.
  const amountCents =
    payload.amountCents ?? Math.round(Number(lease.rent_amount) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "no_active_lease", confidence: 0 };
  }
  const dueDate = payload.dueDate ?? computeNextDueDate(lease.rent_due_day);

  // 4. Fetch org's outbound phone before creating the Stripe session —
  // saves a wasted Stripe call when the org isn't configured yet.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id, odesa_phone_number")
    .eq("id", organizationId)
    .limit(1)
    .maybeSingle();
  if (orgErr || !org || !org.odesa_phone_number) {
    return { ok: false, error: "org_missing_phone", confidence: 0 };
  }

  // 5. Create the Stripe Checkout Session + INSERT rent_payments row.
  const linkResult = await createRentPaymentLink({
    admin,
    organizationId,
    tenantId: tenant.id,
    leaseId: lease.id,
    amountCents,
    dueDate,
    rentEventId: null,
  });
  if (!linkResult.ok) {
    return { ok: false, error: linkResult.error, confidence: 0 };
  }

  // 6. Text the tenant the URL via sendWithFailover. If this fails the
  // rent_payments row stays 'pending' — the operator can re-send from
  // the unit-detail Payment History section.
  const monthLabel = describeMonthLabel(dueDate);
  const firstName = tenant.fullName.split(/\s+/)[0] ?? tenant.fullName;
  const smsBody = `Hey ${firstName}, here's your rent payment link for ${monthLabel}: ${linkResult.paymentLinkUrl}`;

  const sendResult = await sendWithFailover(organizationId, {
    toE164: tenant.phoneE164,
    fromE164: org.odesa_phone_number,
    body: smsBody,
    idempotencyKey: `rent-payment:${linkResult.rentPaymentId}`,
  });

  if (!sendResult.ok) {
    const firstErr = sendResult.errors[0]?.error ?? "unknown";
    return {
      ok: false,
      error: `sms_send_failed: ${firstErr}`,
      confidence: 0.4,
    };
  }

  return {
    ok: true,
    data: {
      paymentLinkUrl: linkResult.paymentLinkUrl,
      paymentIntentId: linkResult.paymentIntentId,
      rentPaymentId: linkResult.rentPaymentId,
      customerId: linkResult.customerId,
      sentTo: tenant.phoneE164,
      amountCents,
      monthLabel,
      tenantName: tenant.fullName,
    },
    confidence: tenant.byId ? 0.95 : 0.85,
    reasoning:
      `Created Stripe Checkout Session and texted ${tenant.fullName} ` +
      `the rent link for ${monthLabel} ($${(amountCents / 100).toLocaleString()}).`,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ResolveOk {
  ok: true;
  tenant: ResolvedTenant;
}
interface ResolveErr {
  ok: false;
  reason: "not_found" | "ambiguous";
}
type ResolveResult = ResolveOk | ResolveErr;

async function resolveTenantPayload(
  admin: SupabaseClient<Database>,
  organizationId: string,
  payload: RequestRentPaymentPayload,
): Promise<ResolveResult> {
  const ref = payload.tenantRef;
  let tenantId: string | null = null;
  let byId = false;

  if ("tenantId" in ref) {
    tenantId = ref.tenantId;
    byId = true;
  } else {
    const result = await resolveTenant(admin, organizationId, ref.tenantName);
    if (!result.ok) return { ok: false, reason: result.reason };
    tenantId = result.id;
  }

  const { data, error } = await admin
    .from("tenants")
    .select("id, full_name, phone_e164")
    .eq("organization_id", organizationId)
    .eq("id", tenantId)
    .limit(1)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "not_found" };

  return {
    ok: true,
    tenant: {
      id: data.id,
      fullName: data.full_name,
      phoneE164: data.phone_e164,
      byId,
    },
  };
}

/**
 * Compute the next ISO calendar date matching a lease's rent_due_day.
 * If today's day-of-month is on or before the due day, target this
 * month; otherwise roll to next month. Always anchored to UTC so
 * test snapshots are deterministic.
 */
function computeNextDueDate(dueDay: number): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const target =
    today <= dueDay
      ? new Date(Date.UTC(year, month, dueDay))
      : new Date(Date.UTC(year, month + 1, dueDay));
  return target.toISOString().slice(0, 10);
}

function describeMonthLabel(dueDate: string): string {
  const parsed = new Date(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "this month";
  return parsed.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
