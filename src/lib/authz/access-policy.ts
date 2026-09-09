/**
 * Pure V1 persona and capability policy.
 *
 * This module intentionally has no database, Supabase, React, or Next.js
 * dependency. It is the application-side contract shared by route loaders,
 * server actions, API handlers, navigation, and authorization tests.
 *
 * Capabilities answer what an identity may do. Organization/property/tenant
 * scope answers where it may do it and must be enforced separately. Hidden
 * navigation is never sufficient authorization.
 */

export const CAPABILITIES = [
  // Staff visibility.
  "view_dashboard",
  "view_inbox",
  "view_calls",
  "view_owner_queue",
  "view_properties",
  "view_tenants",
  "view_vendors",
  "view_work_orders",
  "view_rent",
  "view_financials",
  "view_documents",
  "export_financials",
  "view_assistant",
  "view_settings",

  // Non-reserved staff work.
  "manage_tenants",
  "manage_work_orders",
  "manage_vendors",
  "draft_messages",
  "triage_conversations",

  // Owner decisions and administration. Approval capabilities remain in the
  // catalog so owner endpoints can name them, but commitments are reserved
  // unless an implemented endpoint safely supports delegation.
  "record_payment",
  "waive_balance",
  "change_lease_terms",
  "approve_tenant_message",
  "approve_payment_request",
  "approve_vendor_dispatch",
  "import_portfolio",
  "manage_team_access",
  "manage_billing",
  "manage_integrations",
  "change_autonomy",

  // Structural scope integrity. Holding this means property scope is not
  // applied and the whole portfolio is visible; it is never granted.
  "access_all_properties",

  // Tenant self-service capabilities used to live here. They are gone on
  // purpose: a tenant is not a staff membership, so a tenant principal cannot
  // be modelled as a role in this catalog. Tenant access arrives later as its
  // own principal type with its own policy module and routes.
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const PORTAL_ROLES = ["owner", "manager", "accountant", "va"] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

/**
 * Capabilities which remain owner-only throughout V1. Persisted overrides
 * cannot grant these to another persona. Changing this list is a product and
 * security decision, not an ordinary Team & Access edit.
 *
 * `view_owner_queue` is deliberately absent: it is a hidden route, not a
 * non-grantable capability.
 *
 * `access_all_properties` is structurally non-grantable: it is the negation of
 * property scope itself, so no override may ever hand it to a non-owner.
 */
export const RESERVED_OWNER_CAPABILITIES = [
  "view_assistant",
  "record_payment",
  "waive_balance",
  "change_lease_terms",
  "approve_tenant_message",
  "approve_payment_request",
  "approve_vendor_dispatch",
  "import_portfolio",
  "manage_team_access",
  "manage_billing",
  "manage_integrations",
  "change_autonomy",
  "access_all_properties",
] as const satisfies readonly Capability[];

const RESERVED_OWNER_SET = new Set<Capability>(RESERVED_OWNER_CAPABILITIES);
const CAPABILITY_SET = new Set<string>(CAPABILITIES);
const ROLE_SET = new Set<string>(PORTAL_ROLES);

const ACCOUNTANT_CEILING = new Set<Capability>([
  "view_dashboard",
  "view_rent",
  "view_financials",
  "view_documents",
  "export_financials",
]);

export interface AccessOverride {
  /** String at the persistence boundary so stale/unknown values fail closed. */
  capability: string;
  effect: "allow" | "deny";
}

export interface AccessSubject {
  role: string | null | undefined;
  overrides?: readonly AccessOverride[];
}

const ROLE_DEFAULTS: Record<PortalRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  manager: [
    "view_dashboard",
    "view_inbox",
    "view_calls",
    "view_properties",
    "view_tenants",
    "view_vendors",
    "view_work_orders",
    "view_rent",
    "view_documents",
    "view_settings",
    "manage_work_orders",
    "draft_messages",
    "triage_conversations",
  ],
  accountant: [
    "view_dashboard",
    "view_rent",
    "view_financials",
    "view_documents",
    "export_financials",
  ],
  // Strict subset of the manager preset: the VA must never exceed a manager.
  // `view_assistant` is absent from both until the Wave 7 scoped-assistant
  // contract exists (Decision G); dropping it from the manager preset alone
  // would have made the VA the more privileged persona.
  va: [
    "view_dashboard",
    "view_inbox",
    "view_calls",
    "view_properties",
    "view_tenants",
    "view_vendors",
    "view_work_orders",
    "view_documents",
    "view_settings",
    "draft_messages",
  ],
};

export function isPortalRole(
  role: string | null | undefined,
): role is PortalRole {
  return typeof role === "string" && ROLE_SET.has(role);
}

function isCapability(capability: string): capability is Capability {
  return CAPABILITY_SET.has(capability);
}

/**
 * Resolve role defaults and explicit owner-authored overrides.
 *
 * Rules:
 * - unknown/missing role => empty set;
 * - owner => immutable full set;
 * - unknown persisted capability => ignored;
 * - reserved capability allow for a non-owner => ignored;
 * - otherwise overrides are processed in persistence order, so the last
 *   owner-authored value wins.
 */
export function capabilitiesFor(
  role: string | null | undefined,
  overrides: readonly AccessOverride[] = [],
): Set<Capability> {
  if (!isPortalRole(role)) return new Set();
  if (role === "owner") return new Set(CAPABILITIES);

  if (role === "accountant") {
    const effective = new Set<Capability>(ROLE_DEFAULTS.accountant);
    const denied = new Set<Capability>();
    for (const override of overrides) {
      if (!isCapability(override.capability)) continue;
      const capability = override.capability;
      if (!ACCOUNTANT_CEILING.has(capability)) continue;
      if (override.effect === "deny") denied.add(capability);
      else if (!denied.has(capability)) effective.add(capability);
    }
    for (const capability of denied) effective.delete(capability);
    return effective;
  }

  const effective = new Set<Capability>(ROLE_DEFAULTS[role]);
  for (const override of overrides) {
    if (!isCapability(override.capability)) continue;

    const capability = override.capability;
    if (override.effect === "allow") {
      if (!RESERVED_OWNER_SET.has(capability)) effective.add(capability);
    } else {
      effective.delete(capability);
    }
  }

  // Defense in depth if a future role preset accidentally includes one.
  for (const capability of RESERVED_OWNER_CAPABILITIES) {
    effective.delete(capability);
  }
  return effective;
}

export function canAccess(
  subject: AccessSubject,
  capability: Capability,
): boolean {
  return capabilitiesFor(subject.role, subject.overrides).has(capability);
}

/**
 * Choose the first useful post-auth surface from an already-resolved exact
 * capability set. Owner, Manager, and VA preserve the shipped `/today`
 * landing. Accountant fallbacks are ordered by reconciliation workflow so a
 * deny override narrows access without stranding the user on a denied page.
 * Unknown roles and an Accountant with no readable surface fail closed.
 */
export function landingRouteForAccess(
  role: string | null | undefined,
  capabilities: Iterable<string>,
): '/today' | '/rent' | '/financials' | '/documents' | null {
  if (!isPortalRole(role)) return null;
  if (role !== 'accountant') return '/today';

  const effective = new Set(capabilities);
  if (effective.has('view_dashboard')) return '/today';
  if (effective.has('view_rent')) return '/rent';
  if (effective.has('view_financials')) return '/financials';
  if (effective.has('view_documents')) return '/documents';
  return null;
}

interface RouteRule {
  prefix: string;
  capability: Capability;
}

/**
 * Ordered from specific to broad. Unknown routes fail closed rather than
 * inheriting a nearby page's access by accident.
 */
const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: "/settings/integrations", capability: "manage_integrations" },
  { prefix: "/settings/import", capability: "import_portfolio" },
  { prefix: "/settings/team", capability: "manage_team_access" },
  { prefix: "/settings/billing", capability: "manage_billing" },
  { prefix: "/settings/reliability", capability: "change_autonomy" },
  { prefix: "/calls/settings", capability: "manage_integrations" },
  { prefix: "/calls/scripts", capability: "manage_integrations" },
  { prefix: "/calls/test", capability: "manage_integrations" },
  { prefix: "/properties/:id/chat", capability: "view_assistant" },
  { prefix: "/review", capability: "view_owner_queue" },
  { prefix: "/onboarding", capability: "import_portfolio" },
  { prefix: "/admin", capability: "manage_team_access" },
  { prefix: "/owner-queue", capability: "view_owner_queue" },
  // This legacy aggregate mixes rent, proposals, and owner-only queue data.
  // Managers and VAs use the property-scoped Work register instead.
  { prefix: "/open-items", capability: "view_owner_queue" },
  { prefix: "/accounting", capability: "view_dashboard" },
  { prefix: "/work-orders", capability: "view_work_orders" },
  { prefix: "/financials", capability: "view_financials" },
  { prefix: "/properties", capability: "view_properties" },
  { prefix: "/documents", capability: "view_documents" },
  { prefix: "/assistant", capability: "view_assistant" },
  { prefix: "/settings", capability: "view_settings" },
  { prefix: "/tenants", capability: "view_tenants" },
  { prefix: "/vendors", capability: "view_vendors" },
  { prefix: "/inbox", capability: "view_inbox" },
  { prefix: "/calls", capability: "view_calls" },
  { prefix: "/today", capability: "view_dashboard" },
  { prefix: "/rent", capability: "view_rent" },
];

function routeMatches(pathname: string, prefix: string): boolean {
  if (prefix.includes("/:")) {
    const routeParts = pathname.split("/").filter(Boolean);
    const ruleParts = prefix.split("/").filter(Boolean);
    if (routeParts.length < ruleParts.length) return false;
    return ruleParts.every(
      (part, index) => part.startsWith(":") || part === routeParts[index],
    );
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function requiredCapabilityForRoute(
  pathname: string,
): Capability | null {
  const normalizedPath =
    pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  return (
    ROUTE_RULES.find((rule) => routeMatches(normalizedPath, rule.prefix))
      ?.capability ?? null
  );
}

export function canAccessRoute(
  subject: AccessSubject,
  pathname: string,
): boolean {
  const capability = requiredCapabilityForRoute(pathname);
  return capability !== null && canAccess(subject, capability);
}
