/**
 * Tenant-portal session — HMAC-signed cookie, no Supabase auth principal.
 *
 * Tenants are not `auth.users` (see the tenant-portal plan): identity is a
 * signed cookie `odesa_portal` whose payload is `{t: tenantId, o: orgId,
 * exp}` encoded as `base64url(payload) + "." + base64url(hmacSha256(
 * payload, PORTAL_SESSION_SECRET))`. Verification is constant-time and
 * fails closed when the secret is unset.
 *
 * `requirePortalSession()` is the single gate every portal page/action
 * calls: verify the cookie, then revalidate the tenant row still exists
 * in that org (one admin-client lookup) so a stale cookie dies when the
 * tenancy does. Any failure redirects to /portal/login.
 *
 * // ponytail: no session table — revocation = rotate PORTAL_SESSION_SECRET;
 * // add a sessions table if per-device revoke is ever needed.
 */

import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { constantTimeEqual } from "@/lib/messaging/sigs";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PORTAL_SESSION_COOKIE = "odesa_portal";
export const PORTAL_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PORTAL_LOGIN_PATH = "/portal/login";

/** Verified portal identity — the only shape portal queries may key on. */
export interface PortalSession {
  tenantId: string;
  organizationId: string;
}

interface PortalSessionPayload {
  /** Tenant id. */
  t: string;
  /** Organization id. */
  o: string;
  /** Expiry, unix epoch ms. */
  exp: number;
}

// ---------------------------------------------------------------------------
// Mint / verify
// ---------------------------------------------------------------------------

function getSecret(): string | null {
  const secret = process.env.PORTAL_SESSION_SECRET;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

/**
 * Mint the signed portal session cookie descriptor.
 *
 * @throws {Error} When PORTAL_SESSION_SECRET is unset (fail closed —
 *   never mint an unsigned/weakly-signed session).
 */
export function mintPortalSessionCookie(
  tenantId: string,
  organizationId: string,
): {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
  };
} {
  const secret = getSecret();
  if (!secret) {
    throw new Error("PORTAL_SESSION_SECRET is not configured");
  }

  const payload: PortalSessionPayload = {
    t: tenantId,
    o: organizationId,
    exp: Date.now() + PORTAL_SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return {
    name: PORTAL_SESSION_COOKIE,
    value: `${encoded}.${sign(encoded, secret)}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/portal",
      maxAge: Math.floor(PORTAL_SESSION_TTL_MS / 1000),
    },
  };
}

/**
 * Verify a raw cookie value. Returns the session identity, or null on ANY
 * failure: missing secret, malformed value, bad signature, expired,
 * or a payload that isn't `{t, o, exp}`. Signature check is constant-time.
 */
export function verifyPortalSessionValue(
  value: string,
): PortalSession | null {
  const secret = getSecret();
  if (!secret) return null; // fail closed — cannot verify without the key

  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const encoded = value.slice(0, dot);
  const providedSig = value.slice(dot + 1);

  if (!constantTimeEqual(sign(encoded, secret), providedSig)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null) return null;
  const { t, o, exp } = payload as Partial<PortalSessionPayload>;
  if (typeof t !== "string" || t.length === 0) return null;
  if (typeof o !== "string" || o.length === 0) return null;
  if (typeof exp !== "number" || exp <= Date.now()) return null;

  return { tenantId: t, organizationId: o };
}

// ---------------------------------------------------------------------------
// Server-side gate
// ---------------------------------------------------------------------------

/**
 * Require a live portal session. Server-only (reads `cookies()`).
 *
 * Verifies the HMAC cookie AND revalidates that the tenant row still
 * exists in the claimed org, so a cookie outlives neither the tenancy
 * nor an org move. Redirects to /portal/login on any failure — callers
 * can rely on the returned session being fully trusted.
 */
export async function requirePortalSession(): Promise<PortalSession> {
  const store = await cookies();
  const raw = store.get(PORTAL_SESSION_COOKIE)?.value;
  const session = raw ? verifyPortalSessionValue(raw) : null;
  if (!session) redirect(PORTAL_LOGIN_PATH);

  const { data: tenant } = await createAdminClient()
    .from("tenants")
    .select("id")
    .eq("id", session.tenantId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!tenant) redirect(PORTAL_LOGIN_PATH);

  return session;
}
