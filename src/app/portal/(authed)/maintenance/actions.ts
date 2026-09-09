"use server";

/**
 * Tenant-portal maintenance server action.
 *
 * Session first, then a 5/day/tenant rate limit, then the shared
 * `createWorkOrder` domain command with `source: "portal"` stamped in the
 * first status_timeline entry. Friendly consumer copy on every failure.
 */

import { revalidatePath } from "next/cache";

import { requirePortalSession } from "@/lib/portal/session";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWorkOrder, workOrderArgsSchema } from "@/lib/work-orders/create";

export interface PortalMaintenanceState {
  ok: boolean;
  error: string | null;
}

/** 5 new maintenance requests per tenant per day. */
const maintenanceLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 24 * 60 * 60 * 1000,
});

/**
 * Create a maintenance request from the portal form. Returns a friendly
 * state for `useActionState`; on success the page revalidates so the new
 * request appears in the list above the form.
 */
export async function createPortalMaintenanceAction(
  _prev: PortalMaintenanceState,
  formData: FormData,
): Promise<PortalMaintenanceState> {
  const session = await requirePortalSession();

  if (!maintenanceLimiter.check(`portal-maintenance:${session.tenantId}`).allowed) {
    return {
      ok: false,
      error:
        "That's the limit for today — if it's urgent, call or text your property manager directly.",
    };
  }

  const parsed = workOrderArgsSchema.safeParse({
    description: formData.get("description"),
    category: formData.get("category"),
    urgency: formData.get("urgency"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "Please describe the issue in a few words (up to 2,000 characters).",
    };
  }

  const result = await createWorkOrder(createAdminClient(), {
    organizationId: session.organizationId,
    tenantId: session.tenantId,
    ...parsed.data,
    source: "portal",
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "active_lease_not_found"
          ? "We couldn't find an active lease for you — reach out to your property manager and they'll get you set up."
          : "Something went wrong on our end. Please try again in a moment.",
    };
  }

  revalidatePath("/portal/maintenance");
  return { ok: true, error: null };
}
