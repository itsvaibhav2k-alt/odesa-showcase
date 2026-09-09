/**
 * Tenant-portal OTP — request + confirm library (no UI).
 *
 * Modeled on the staff phone-verify flow
 * (src/app/(dashboard)/settings/integrations/actions.ts) with the
 * portal hardening from the tenant-portal plan:
 *
 *   - codes stored as HMAC-SHA256(code, PORTAL_SESSION_SECRET), never
 *     bare sha256 (10^6 codes are offline-brute-forceable);
 *   - enumeration-safe: unknown phone, multi-org phone, suppressed
 *     recipient, and resend-cooldown all return the SAME generic success;
 *   - multi-org phone match fails closed — no chooser
 *     (// ponytail: add an org chooser if a real case appears);
 *   - rate limits 3/phone/15min + 30/IP/15min;
 *   - single-use rows: atomic consume + attempt increment via single
 *     conditional UPDATE … RETURNING statements; 5-attempt lockout;
 *   - constant-time hash compare;
 *   - STOP-consent checked before sending.
 *
 * Codes and full phone numbers are NEVER logged.
 */

import { randomBytes, createHmac } from "node:crypto";
import { z } from "zod";

import { constantTimeEqual } from "@/lib/messaging/sigs";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";
import { createRateLimiter } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

const phoneSchema = z.string().trim().regex(E164_REGEX);
const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

// Enumeration-safe copy. GENERIC_OK never reveals whether the phone is on
// file; GENERIC_INVALID never distinguishes unknown phone / wrong code /
// expired / already-used.
const GENERIC_INVALID =
  "That code didn't work — it may have expired. Send a new one.";
const RATE_LIMITED = "Too many tries — wait a few minutes and try again.";
const SEND_FAILED =
  "We couldn't send the code — reach out to your property manager.";

// In-memory limiters, module scope so they survive across requests.
// ponytail: per-instance only — move to a DB counter if multi-instance
// deploys become real.
const phoneLimiter = createRateLimiter({
  maxRequests: 3,
  windowMs: 15 * 60 * 1000,
});
const ipLimiter = createRateLimiter({
  // A whole building can sit behind one NAT IP, so this bounds abuse
  // without locking out a lobby of tenants; per-phone (3) is the tight one.
  maxRequests: 30,
  windowMs: 15 * 60 * 1000,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestPortalOtpResult =
  | { ok: true }
  | { ok: false; error: string };

export type ConfirmPortalOtpResult =
  | { ok: true; tenantId: string; organizationId: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSecret(): string | null {
  const secret = process.env.PORTAL_SESSION_SECRET;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

/** Keyed hash of an OTP code. Exported for the Wave-0 test hook. */
export function hashPortalOtpCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

function generateCode(): string {
  // Cryptographically random 6-digit code with leading-zero preservation.
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * Request an OTP for a tenant phone. Enumeration-safe: every outcome the
 * caller could probe with (unknown phone, multi-org phone, suppressed
 * recipient, resend cooldown) returns the identical `{ ok: true }`.
 * Honest failures are limited to validation, rate limiting, and send
 * infrastructure errors.
 *
 * @param phoneE164 - Tenant-entered phone in E.164.
 * @param ip - Caller IP for the per-IP limiter.
 */
export async function requestPortalOtp(
  phoneE164: string,
  ip: string,
): Promise<RequestPortalOtpResult> {
  const parsed = phoneSchema.safeParse(phoneE164);
  if (!parsed.success) {
    return {
      ok: false,
      error: "That doesn't look like a phone number — check it and try again.",
    };
  }
  const phone = parsed.data;

  if (!ipLimiter.check(ip).allowed || !phoneLimiter.check(phone).allowed) {
    return { ok: false, error: RATE_LIMITED };
  }

  const secret = getSecret();
  if (!secret) {
    // Fail closed — without the pepper we can neither store nor verify.
    console.error("[portal-otp] PORTAL_SESSION_SECRET is not configured");
    return { ok: false, error: SEND_FAILED };
  }

  const admin = createAdminClient();

  const { data: tenantRows } = await admin
    .from("tenants")
    .select("id, organization_id")
    .eq("phone_e164", phone)
    .order("created_at", { ascending: false });
  const matches = tenantRows ?? [];

  if (matches.length === 0) return { ok: true }; // enumeration-safe

  const orgIds = new Set(matches.map((row) => row.organization_id));
  if (orgIds.size > 1) {
    // Multi-org phone — fail closed, generic response, no chooser.
    console.warn(
      "[portal-otp] phone matches tenants in multiple orgs — failing closed",
    );
    return { ok: true };
  }
  const tenant = matches[0];

  // 60s resend cooldown: if a live code was minted moments ago, silently
  // do nothing (the earlier SMS is still on its way).
  const cooldownFloorIso = new Date(
    Date.now() - RESEND_COOLDOWN_MS,
  ).toISOString();
  const { data: recent } = await admin
    .from("portal_otps")
    .select("id")
    .eq("tenant_id", tenant.id)
    .is("consumed_at", null)
    .gte("created_at", cooldownFloorIso)
    .limit(1)
    .maybeSingle();
  if (recent) return { ok: true };

  // STOP-consent check before sending. sendWithFailover would also
  // suppress, but checking first avoids minting a code that can never
  // arrive. Suppressed recipients get the generic response; the login UI
  // carries the "didn't get a code? text START" hint for everyone.
  const { data: consent } = await admin
    .from("messaging_recipient_consents")
    .select("state")
    .eq("organization_id", tenant.organization_id)
    .eq("recipient_e164", phone)
    .maybeSingle();
  if (consent?.state === "suppressed") return { ok: true };

  const { data: org } = await admin
    .from("organizations")
    .select("odesa_phone_number")
    .eq("id", tenant.organization_id)
    .maybeSingle();
  const fromE164 = org?.odesa_phone_number;
  if (!fromE164) {
    console.error(
      `[portal-otp] org ${tenant.organization_id} has no Odesa number provisioned`,
    );
    return { ok: false, error: SEND_FAILED };
  }

  const code = generateCode();
  const { data: otpRow, error: insertErr } = await admin
    .from("portal_otps")
    .insert({
      organization_id: tenant.organization_id,
      tenant_id: tenant.id,
      phone_e164: phone,
      code_hash: hashPortalOtpCode(code, secret),
      expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  const inserted = otpRow;
  if (insertErr || !inserted) {
    console.error(
      `[portal-otp] insert failed: ${insertErr?.message ?? "no row"}`,
    );
    return { ok: false, error: SEND_FAILED };
  }

  const sendResult = await sendWithFailover(tenant.organization_id, {
    toE164: phone,
    fromE164,
    body: `Your Odesa login code is ${code}. It expires in 10 minutes.`,
    idempotencyKey: `portal-otp:${inserted.id}`,
  });

  if (!sendResult.ok) {
    if (sendResult.status === "suppressed") return { ok: true }; // enumeration-safe
    // Never log the code or the full phone number.
    console.error(
      `[portal-otp] provider send failed for tenant ${tenant.id}: ${sendResult.status ?? "failed"}`,
    );
    return { ok: false, error: SEND_FAILED };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

/**
 * Confirm an OTP code. On success the row is atomically consumed and the
 * verified (tenantId, organizationId) pair is returned for session mint.
 * ALL failure modes (unknown phone, wrong code, expired, consumed,
 * locked out) return the same generic copy — any distinct message would
 * leak whether the phone is on file.
 */
export async function confirmPortalOtp(
  phoneE164: string,
  code: string,
): Promise<ConfirmPortalOtpResult> {
  const parsedPhone = phoneSchema.safeParse(phoneE164);
  const parsedCode = codeSchema.safeParse(code);
  if (!parsedPhone.success || !parsedCode.success) {
    return { ok: false, error: GENERIC_INVALID };
  }

  const secret = getSecret();
  if (!secret) {
    console.error("[portal-otp] PORTAL_SESSION_SECRET is not configured");
    return { ok: false, error: GENERIC_INVALID };
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Most recent live row for the phone. We do NOT match on code_hash so a
  // wrong code counts against `attempts` instead of silently reading as
  // "expired".
  const { data: row } = await admin
    .from("portal_otps")
    .select("id, organization_id, tenant_id, code_hash, attempts")
    .eq("phone_e164", parsedPhone.data)
    .is("consumed_at", null)
    .gte("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const otp = row;
  if (!otp) return { ok: false, error: GENERIC_INVALID };

  // 5-attempt lockout: consume the row so no further codes can be tried
  // against it; the tenant must request a fresh OTP. Copy stays GENERIC:
  // a live row only exists for phones that are on file, so a distinct
  // "too many attempts" message would be a phone-enumeration oracle
  // (request a code blind, then burn 6 wrong confirms and read the copy).
  if (otp.attempts >= MAX_OTP_ATTEMPTS) {
    await admin
      .from("portal_otps")
      .update({ consumed_at: nowIso })
      .eq("id", otp.id)
      .is("consumed_at", null);
    return { ok: false, error: GENERIC_INVALID };
  }

  if (!constantTimeEqual(hashPortalOtpCode(parsedCode.data, secret), otp.code_hash)) {
    // Atomic-ish attempt increment: single conditional UPDATE guarded on
    // the read value, so concurrent racers can't overwrite each other's
    // count downward.
    // ponytail: CAS on `attempts` — a parallel burst counts as one
    // attempt; move to an `attempts = attempts + 1` RPC if that matters.
    await admin
      .from("portal_otps")
      .update({ attempts: otp.attempts + 1 })
      .eq("id", otp.id)
      .eq("attempts", otp.attempts)
      .is("consumed_at", null);
    return { ok: false, error: GENERIC_INVALID };
  }

  // Atomic single-use consume: one conditional UPDATE … RETURNING. If a
  // concurrent confirm won the race, zero rows come back and this call
  // fails closed.
  const { data: consumed } = await admin
    .from("portal_otps")
    .update({ consumed_at: nowIso })
    .eq("id", otp.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!consumed) return { ok: false, error: GENERIC_INVALID };

  return {
    ok: true,
    tenantId: otp.tenant_id,
    organizationId: otp.organization_id,
  };
}
