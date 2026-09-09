/**
 * Unit tests for `src/lib/portal/session.ts` — mint/verify round-trip
 * plus every fail-closed path: tampered payload, tampered signature,
 * expired session, missing PORTAL_SESSION_SECRET.
 *
 * `requirePortalSession()` (cookies + admin revalidation) is exercised
 * by the portal e2e specs; here we pin the pure crypto contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  PORTAL_SESSION_COOKIE,
  PORTAL_SESSION_TTL_MS,
  mintPortalSessionCookie,
  verifyPortalSessionValue,
} from "@/lib/portal/session";

const TENANT_ID = "55555555-5555-5555-5555-555555555501";
const ORG_ID = "11111111-1111-1111-1111-111111111101";

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}
function b64urlEncode(s: string): string {
  return Buffer.from(s).toString("base64url");
}

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = "test-portal-secret";
});

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET;
  vi.useRealTimers();
});

describe("portal session", () => {
  describe("mintPortalSessionCookie", () => {
    it("should mint a cookie with the locked-down attributes", () => {
      const cookie = mintPortalSessionCookie(TENANT_ID, ORG_ID);

      expect(cookie.name).toBe(PORTAL_SESSION_COOKIE);
      expect(cookie.options).toEqual({
        httpOnly: true,
        secure: false, // NODE_ENV !== 'production' under vitest
        sameSite: "lax",
        path: "/portal",
        maxAge: Math.floor(PORTAL_SESSION_TTL_MS / 1000),
      });
    });

    it("should throw when PORTAL_SESSION_SECRET is unset", () => {
      delete process.env.PORTAL_SESSION_SECRET;

      expect(() => mintPortalSessionCookie(TENANT_ID, ORG_ID)).toThrow(
        /PORTAL_SESSION_SECRET/,
      );
    });
  });

  describe("verifyPortalSessionValue", () => {
    it("should round-trip a minted value back to the session identity", () => {
      const cookie = mintPortalSessionCookie(TENANT_ID, ORG_ID);

      const session = verifyPortalSessionValue(cookie.value);

      expect(session).toEqual({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      });
    });

    it("should reject a tampered payload that keeps the original signature", () => {
      const cookie = mintPortalSessionCookie(TENANT_ID, ORG_ID);
      const [encoded, sig] = cookie.value.split(".");
      const payload = JSON.parse(b64urlDecode(encoded)) as Record<
        string,
        unknown
      >;
      const forged = b64urlEncode(
        JSON.stringify({ ...payload, t: "attacker-tenant" }),
      );

      expect(verifyPortalSessionValue(`${forged}.${sig}`)).toBeNull();
    });

    it("should reject a tampered signature", () => {
      const cookie = mintPortalSessionCookie(TENANT_ID, ORG_ID);
      const [encoded, sig] = cookie.value.split(".");
      const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);

      expect(verifyPortalSessionValue(`${encoded}.${flipped}`)).toBeNull();
    });

    it("should reject garbage and structurally invalid values", () => {
      expect(verifyPortalSessionValue("")).toBeNull();
      expect(verifyPortalSessionValue("no-dot-here")).toBeNull();
      expect(verifyPortalSessionValue(".")).toBeNull();
    });

    it("should reject an expired session", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
      const cookie = mintPortalSessionCookie(TENANT_ID, ORG_ID);

      vi.setSystemTime(
        new Date(Date.now() + PORTAL_SESSION_TTL_MS + 1000),
      );

      expect(verifyPortalSessionValue(cookie.value)).toBeNull();
    });

    it("should fail closed when PORTAL_SESSION_SECRET is unset", () => {
      const cookie = mintPortalSessionCookie(TENANT_ID, ORG_ID);
      delete process.env.PORTAL_SESSION_SECRET;

      expect(verifyPortalSessionValue(cookie.value)).toBeNull();
    });
  });
});
