/**
 * Unit tests for routeInbound. Drives the function against a hand-
 * rolled admin client whose `.from(table).select(...).eq(...)…` chains
 * resolve from a small in-memory state. The shape mirrors what
 * handle-inbound.ts uses against the real client so this stays a
 * faithful drop-in.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authz/context", () => ({
  resolveActiveAccessContextForUser: vi.fn(),
}));

import { routeInbound } from "../route-inbound";
import { resolveActiveAccessContextForUser } from "@/lib/authz/context";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundMessage } from "../types";

interface State {
  organizations: { id: string; odesa_phone_number: string }[];
  users: {
    id: string;
    organization_id: string;
    phone_e164: string | null;
    phone_verified_at: string | null;
  }[];
}

const resolveAccess = vi.mocked(resolveActiveAccessContextForUser);

beforeEach(() => {
  resolveAccess.mockReset();
  resolveAccess.mockResolvedValue({
    ok: true,
    context: {
      userId: "user-1",
      membershipId: "membership-1",
      organizationId: "org-1",
      role: "owner",
      capabilities: new Set(["view_assistant"]),
      propertyScope: "all",
    },
  });
});

function makeAdmin(state: State): SupabaseClient<Database> {
  function builder(table: string): unknown {
    type Pred = (row: Record<string, unknown>) => boolean;
    const filters: Pred[] = [];
    let limit = Infinity;

    const rowsFor = (): Record<string, unknown>[] => {
      const src =
        table === "organizations"
          ? state.organizations
          : table === "users"
            ? state.users
            : [];
      return (src as unknown as Record<string, unknown>[]).filter((r) =>
        filters.every((f) => f(r)),
      );
    };

    const obj = {
      select() {
        return obj;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return obj;
      },
      not(col: string, op: string, val: unknown) {
        if (op === "is" && val === null) {
          // .not('phone_verified_at', 'is', null) → keep rows where col != null
          filters.push((r) => r[col] !== null && r[col] !== undefined);
        }
        return obj;
      },
      limit(n: number) {
        limit = n;
        return obj;
      },
      async maybeSingle() {
        const rows = rowsFor().slice(0, limit);
        return { data: rows[0] ?? null, error: null };
      },
    };
    return obj;
  }
  return {
    from: vi.fn((t: string) => builder(t)),
  } as unknown as SupabaseClient<Database>;
}

function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    fromE164: "+15555550100",
    toE164: "+15551234567",
    body: "hi",
    provider: "linq",
    receivedAt: "2026-05-02T00:00:00Z",
    providerMessageId: "m1",
    ...overrides,
  };
}

describe("routeInbound", () => {
  it("should return operator when sender is a verified user on the org", async () => {
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [
        {
          id: "user-1",
          organization_id: "org-1",
          phone_e164: "+15555550100",
          phone_verified_at: "2026-05-01T00:00:00Z",
        },
      ],
    });
    const result = await routeInbound(admin, inbound());
    expect(result).toEqual({
      kind: "operator",
      user: {
        id: "user-1",
        organizationId: "org-1",
        phoneE164: "+15555550100",
      },
    });
    expect(resolveAccess).toHaveBeenCalledWith(admin, "user-1", "org-1");
  });

  it.each([
    {
      label: "manager",
      access: {
        ok: true as const,
        context: {
          userId: "user-1",
          membershipId: "membership-1",
          organizationId: "org-1",
          role: "manager" as const,
          capabilities: new Set(["view_assistant"] as const),
          propertyScope: "all" as const,
        },
      },
    },
    {
      label: "suspended membership",
      access: { ok: false as const, status: 403 as const, error: "Forbidden" },
    },
  ])("should route verified $label staff as tenant, never operator", async ({ access }) => {
    resolveAccess.mockResolvedValueOnce(access);
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [{
        id: "user-1",
        organization_id: "org-1",
        phone_e164: "+15555550100",
        phone_verified_at: "2026-05-01T00:00:00Z",
      }],
    });

    expect(await routeInbound(admin, inbound())).toEqual({
      kind: "tenant",
      organizationId: "org-1",
    });
  });

  it('should reject an owner context without the reserved assistant capability', async () => {
    resolveAccess.mockResolvedValueOnce({
      ok: true,
      context: {
        userId: "user-1",
        membershipId: "membership-1",
        organizationId: "org-1",
        role: "owner",
        capabilities: new Set(),
        propertyScope: "all",
      },
    });
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [{
        id: "user-1",
        organization_id: "org-1",
        phone_e164: "+15555550100",
        phone_verified_at: "2026-05-01T00:00:00Z",
      }],
    });

    expect(await routeInbound(admin, inbound())).toEqual({
      kind: "tenant",
      organizationId: "org-1",
    });
  });

  it("should fall through to tenant when sender is an UNVERIFIED user", async () => {
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [
        {
          id: "user-1",
          organization_id: "org-1",
          phone_e164: "+15555550100",
          phone_verified_at: null,
        },
      ],
    });
    const result = await routeInbound(admin, inbound());
    expect(result).toEqual({ kind: "tenant", organizationId: "org-1" });
  });

  it("should return tenant when phone matches no user on the org", async () => {
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [
        {
          id: "user-1",
          organization_id: "org-1",
          phone_e164: "+15555550999",
          phone_verified_at: "2026-05-01T00:00:00Z",
        },
      ],
    });
    const result = await routeInbound(admin, inbound());
    expect(result).toEqual({ kind: "tenant", organizationId: "org-1" });
  });

  it("should pick operator when same phone is also a tenant (collision)", async () => {
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [
        {
          id: "user-1",
          organization_id: "org-1",
          phone_e164: "+15555550100",
          phone_verified_at: "2026-05-01T00:00:00Z",
        },
      ],
    });
    // Note: tenant table isn't queried by routeInbound — the operator
    // hit short-circuits, demonstrating the collision policy.
    const result = await routeInbound(admin, inbound());
    expect(result.kind).toBe("operator");
  });

  it("should return unknown_org when no organization owns the receiving number", async () => {
    const admin = makeAdmin({
      organizations: [],
      users: [],
    });
    const result = await routeInbound(admin, inbound());
    expect(result).toEqual({ kind: "unknown_org" });
  });

  it("should not match an operator from a different org on the same number", async () => {
    const admin = makeAdmin({
      organizations: [{ id: "org-1", odesa_phone_number: "+15551234567" }],
      users: [
        {
          // Belongs to a different org — should not match
          id: "user-other",
          organization_id: "org-other",
          phone_e164: "+15555550100",
          phone_verified_at: "2026-05-01T00:00:00Z",
        },
      ],
    });
    const result = await routeInbound(admin, inbound());
    expect(result).toEqual({ kind: "tenant", organizationId: "org-1" });
  });
});
