import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  RESERVED_OWNER_CAPABILITIES,
  capabilitiesFor,
  canAccess,
  canAccessRoute,
  landingRouteForAccess,
  requiredCapabilityForRoute,
  type AccessOverride,
  type PortalRole,
} from "../access-policy";

const ROLES: PortalRole[] = ["owner", "manager", "accountant", "va"];

/** Values the DB enum cannot hold, so they must resolve to no access at all. */
const NON_ROLES = [
  null,
  undefined,
  "",
  "admin",
  "OWNER",
  "property_manager",
  "tenant",
];

/** Tenant self-service capabilities deliberately removed from the staff catalog. */
const TENANT_SELF_SERVICE = [
  "view_tenant_home",
  "view_own_messages",
  "view_own_lease",
  "view_own_balance",
  "submit_maintenance",
  "view_own_documents",
  "manage_own_profile",
];

describe("V1 persona access policy", () => {
  it("keeps the capability catalog unique", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("gives owners every capability", () => {
    expect(capabilitiesFor("owner")).toEqual(new Set(CAPABILITIES));
  });

  it("fails closed for missing, unknown, and malformed roles", () => {
    for (const role of NON_ROLES) {
      expect(capabilitiesFor(role)).toEqual(new Set());
      expect(canAccess({ role }, "view_dashboard")).toBe(false);
    }
  });

  it("gives managers an operating console without owner administration", () => {
    const access = capabilitiesFor("manager");

    expect(access).toBeInstanceOf(Set);
    expect(access.size).toBeGreaterThan(0);
    for (const capability of access) {
      expect(CAPABILITIES).toContain(capability);
    }
    expect(access.has("view_dashboard")).toBe(true);
    expect(access.has("view_inbox")).toBe(true);
    expect(access.has("manage_work_orders")).toBe(true);
    expect(access.has("view_financials")).toBe(false);
    expect(access.has("manage_team_access")).toBe(false);
    // Owner-grantable, never default (spec section 6, Decision G).
    expect(access.has("manage_tenants")).toBe(false);
    expect(access.has("manage_vendors")).toBe(false);
    expect(access.has("view_assistant")).toBe(false);
  });

  it("models tenants outside the staff catalog entirely", () => {
    for (const capability of TENANT_SELF_SERVICE) {
      expect(CAPABILITIES).not.toContain(capability);
      const access = capabilitiesFor("manager", [
        { capability, effect: "allow" },
      ]);
      expect([...access]).not.toContain(capability);
    }

    expect(requiredCapabilityForRoute("/tenant")).toBeNull();
    expect(requiredCapabilityForRoute("/tenant/maintenance/new")).toBeNull();
  });

  it("preserves the VA as a conservative draft-preparation preset", () => {
    const access = capabilitiesFor("va");

    expect(access.has("view_dashboard")).toBe(true);
    expect(access.has("view_inbox")).toBe(true);
    expect(access.has("draft_messages")).toBe(true);
    expect(access.has("manage_tenants")).toBe(false);
    expect(access.has("approve_tenant_message")).toBe(false);
  });

  it("gives accountants only scoped reconciliation capabilities", () => {
    const access = capabilitiesFor("accountant");

    expect(access).toEqual(
      new Set([
        "view_dashboard",
        "view_rent",
        "view_financials",
        "view_documents",
        "export_financials",
      ]),
    );
    expect(access.has("view_inbox")).toBe(false);
    expect(access.has("view_calls")).toBe(false);
    expect(access.has("manage_work_orders")).toBe(false);
    expect(access.has("record_payment")).toBe(false);
    expect(access.has("manage_team_access")).toBe(false);
  });

  it("keeps malicious Accountant allows inside the immutable five-cap ceiling", () => {
    const access = capabilitiesFor("accountant", [
      { capability: "view_inbox", effect: "allow" },
      { capability: "view_calls", effect: "allow" },
      { capability: "manage_tenants", effect: "allow" },
      { capability: "view_rent", effect: "deny" },
      { capability: "view_rent", effect: "allow" },
    ]);

    expect(access).toEqual(
      new Set([
        "view_dashboard",
        "view_financials",
        "view_documents",
        "export_financials",
      ]),
    );
  });

  it('lands a capability-narrowed Accountant on the first authorized reconciliation surface', () => {
    expect(
      landingRouteForAccess('accountant', [
        'view_rent',
        'view_financials',
        'view_documents',
      ]),
    ).toBe('/rent');
    expect(
      landingRouteForAccess('accountant', [
        'view_financials',
        'view_documents',
      ]),
    ).toBe('/financials');
    expect(landingRouteForAccess('accountant', ['view_documents'])).toBe(
      '/documents',
    );
    expect(landingRouteForAccess('accountant', ['export_financials'])).toBeNull();
    expect(landingRouteForAccess('owner', [])).toBe('/today');
    expect(landingRouteForAccess('manager', [])).toBe('/today');
    expect(landingRouteForAccess('va', [])).toBe('/today');
    expect(landingRouteForAccess('tenant', ['view_dashboard'])).toBeNull();
  });

  it("keeps the VA preset a strict subset of the manager preset", () => {
    const manager = capabilitiesFor("manager");
    const va = capabilitiesFor("va");

    for (const capability of va) {
      expect(
        manager.has(capability),
        `VA exceeds manager with ${capability}`,
      ).toBe(true);
    }
    expect(va.size).toBeLessThan(manager.size);
  });

  it("grants conversation triage to managers but not VAs", () => {
    expect(capabilitiesFor("manager").has("triage_conversations")).toBe(true);
    expect(capabilitiesFor("va").has("triage_conversations")).toBe(false);
  });

  it("applies explicit non-reserved allows and denies after role defaults", () => {
    const overrides: AccessOverride[] = [
      { capability: "view_financials", effect: "allow" },
      { capability: "view_calls", effect: "deny" },
    ];

    const access = capabilitiesFor("manager", overrides);
    expect(access.has("view_financials")).toBe(true);
    expect(access.has("view_calls")).toBe(false);
  });

  it("uses the last owner-authored override when a capability appears more than once", () => {
    const overrides: AccessOverride[] = [
      { capability: "view_documents", effect: "deny" },
      { capability: "view_documents", effect: "allow" },
      { capability: "view_documents", effect: "deny" },
    ];

    expect(capabilitiesFor("manager", overrides).has("view_documents")).toBe(
      false,
    );
  });

  it("never removes capabilities from the owner preset", () => {
    const denies: AccessOverride[] = CAPABILITIES.map((capability) => ({
      capability,
      effect: "deny",
    }));

    expect(capabilitiesFor("owner", denies)).toEqual(new Set(CAPABILITIES));
  });

  it("never grants reserved owner capabilities to non-owners", () => {
    for (const role of ROLES.filter((candidate) => candidate !== "owner")) {
      const requested: AccessOverride[] = RESERVED_OWNER_CAPABILITIES.map(
        (capability) => ({
          capability,
          effect: "allow",
        }),
      );
      const access = capabilitiesFor(role, requested);

      for (const capability of RESERVED_OWNER_CAPABILITIES) {
        expect(
          access.has(capability),
          `${role} unexpectedly gained ${capability}`,
        ).toBe(false);
      }
    }
  });

  it("keeps the global assistant owner-only even with a persisted allow", () => {
    expect(
      capabilitiesFor("manager", [
        { capability: "view_assistant", effect: "allow" },
      ]).has("view_assistant"),
    ).toBe(false);
  });

  it("never lets an allow override hand a manager unrestricted portfolio access", () => {
    const access = capabilitiesFor("manager", [
      { capability: "access_all_properties", effect: "allow" },
    ]);

    expect(access.has("access_all_properties")).toBe(false);
    expect(RESERVED_OWNER_CAPABILITIES).toContain("access_all_properties");
  });

  it("reserves tenant-message approval and vendor dispatch consistently", () => {
    const access = capabilitiesFor("manager", [
      { capability: "approve_tenant_message", effect: "allow" },
      { capability: "approve_vendor_dispatch", effect: "allow" },
    ]);

    expect(RESERVED_OWNER_CAPABILITIES).toEqual(
      expect.arrayContaining([
        "approve_tenant_message",
        "approve_vendor_dispatch",
      ]),
    );
    expect(access.has("approve_tenant_message")).toBe(false);
    expect(access.has("approve_vendor_dispatch")).toBe(false);
    expect(capabilitiesFor("owner").has("approve_tenant_message")).toBe(true);
    expect(capabilitiesFor("owner").has("approve_vendor_dispatch")).toBe(true);
  });

  it("ignores unknown persisted capability strings instead of widening access", () => {
    const access = capabilitiesFor("manager", [
      { capability: "become_owner", effect: "allow" },
      { capability: "view_calls", effect: "deny" },
    ]);

    expect(access.has("view_calls")).toBe(false);
    expect([...access]).not.toContain("become_owner");
  });

  it("maps staff routes to capabilities and fails closed for unknown routes", () => {
    expect(canAccessRoute({ role: "owner" }, "/owner-queue")).toBe(true);
    expect(canAccessRoute({ role: "owner" }, "/open-items")).toBe(true);
    expect(canAccessRoute({ role: "manager" }, "/open-items")).toBe(false);
    expect(canAccessRoute({ role: "va" }, "/open-items")).toBe(false);
    expect(canAccessRoute({ role: "manager" }, "/properties/abc")).toBe(true);
    expect(canAccessRoute({ role: "owner" }, "/financials")).toBe(true);
    expect(canAccessRoute({ role: "manager" }, "/financials")).toBe(false);
    expect(canAccessRoute({ role: "va" }, "/rent")).toBe(false);
    expect(canAccessRoute({ role: "accountant" }, "/rent")).toBe(true);
    expect(canAccessRoute({ role: "accountant" }, "/documents")).toBe(true);
    expect(canAccessRoute({ role: "accountant" }, "/work-orders")).toBe(false);
    expect(canAccessRoute({ role: "manager" }, "/properties/abc/chat")).toBe(
      false,
    );
    expect(
      canAccessRoute({ role: "manager" }, "/properties/abc/notes/chat"),
    ).toBe(true);
    expect(canAccessRoute({ role: "manager" }, "/calls/settings")).toBe(false);
    expect(canAccessRoute({ role: "manager" }, "/settings/team")).toBe(false);
    expect(canAccessRoute({ role: "manager" }, "/settings/billing")).toBe(
      false,
    );
    expect(canAccessRoute({ role: "owner" }, "/review/work-order/abc")).toBe(
      true,
    );
    expect(canAccessRoute({ role: "manager" }, "/review/work-order/abc")).toBe(
      false,
    );
    expect(canAccessRoute({ role: "owner" }, "/admin/numbers")).toBe(true);
    expect(canAccessRoute({ role: "manager" }, "/admin/numbers")).toBe(false);
    expect(canAccessRoute({ role: "owner" }, "/not-a-real-route")).toBe(false);
  });

  it("gives roles the enum cannot hold no route access at all", () => {
    for (const role of NON_ROLES) {
      expect(canAccessRoute({ role }, "/today")).toBe(false);
      expect(canAccessRoute({ role }, "/financials")).toBe(false);
    }
  });
});
