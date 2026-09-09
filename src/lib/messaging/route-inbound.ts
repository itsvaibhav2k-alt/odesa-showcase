/**
 * Inbound routing — Phase 2 (operator dispatcher).
 *
 * One pure function: given a normalised `InboundMessage`, decide
 * whether the sender is an operator (a verified `users.phone_e164`
 * belonging to the org that owns `msg.toE164`) or a tenant (everyone
 * else with a hit on the org). Operator wins over tenant when the
 * landlord's personal cell is also recorded as a tenant — that's a
 * data-entry artifact, not a routing signal.
 *
 * Pure of side effects beyond the two reads. The webhook routes use
 * the result to fork between `handleOperatorInbound` and the
 * existing `handleInbound` tenant pipeline.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveActiveAccessContextForUser } from "@/lib/authz/context";

import type { InboundMessage } from "./types";

type AdminClient = SupabaseClient<Database>;

export interface RoutedOperator {
  kind: "operator";
  user: {
    id: string;
    organizationId: string;
    phoneE164: string;
  };
}

export interface RoutedTenant {
  kind: "tenant";
  organizationId: string;
}

export interface RoutedUnknownOrg {
  kind: "unknown_org";
}

export type InboundRoute = RoutedOperator | RoutedTenant | RoutedUnknownOrg;

/**
 * Resolve the sender's role for the inbound message.
 *
 * Order of operations:
 *   1. `organizations.odesa_phone_number = msg.toE164` → org lookup.
 *      Miss → `unknown_org` (caller logs + 200s; an unprovisioned
 *      number should not 5xx the webhook).
 *   2. `users` row matching `(organization_id, phone_e164,
 *      phone_verified_at IS NOT NULL)` → operator hit.
 *   3. Default → `tenant`. The tenant pipeline does its own upsert.
 */
export async function routeInbound(
  admin: AdminClient,
  msg: InboundMessage,
): Promise<InboundRoute> {
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("odesa_phone_number", msg.toE164)
    .limit(1)
    .maybeSingle();
  if (!org) return { kind: "unknown_org" };

  const { data: operator } = await admin
    .from("users")
    .select("id, organization_id, phone_e164")
    .eq("organization_id", org.id)
    .eq("phone_e164", msg.fromE164)
    .not("phone_verified_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (operator && operator.phone_e164) {
    const access = await resolveActiveAccessContextForUser(
      admin,
      operator.id,
      org.id,
    );
    if (
      access.ok &&
      access.context.role === "owner" &&
      access.context.capabilities.has("view_assistant") &&
      access.context.propertyScope === "all"
    ) {
      return {
        kind: "operator",
        user: {
          id: operator.id,
          organizationId: access.context.organizationId,
          phoneE164: operator.phone_e164,
        },
      };
    }
  }

  return { kind: "tenant", organizationId: org.id };
}
