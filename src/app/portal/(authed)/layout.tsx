/**
 * Gated tenant-portal layout — everything in the (authed) group renders
 * only after `requirePortalSession()` verifies the signed cookie and
 * revalidates the tenant row (redirects to /portal/login otherwise).
 *
 * Holds /portal, /portal/payments, /portal/lease, /portal/maintenance,
 * /portal/messages. Login and payment-success/cancel live OUTSIDE this
 * group and must never gain this gate.
 */

import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal/portal-shell";
import { getPortalOverview } from "@/lib/portal/queries";
import { requirePortalSession } from "@/lib/portal/session";

export default async function PortalAuthedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requirePortalSession();
  const overview = await getPortalOverview(session);
  const homeLabel = overview.hasActiveLease ? overview.addressLine : null;

  return <PortalShell homeLabel={homeLabel}>{children}</PortalShell>;
}
