"use server";

/**
 * Tenant-portal login server actions.
 *
 * Thin wrappers over `src/lib/portal/otp.ts` (which owns rate limiting,
 * enumeration safety, consent checks, and atomic consume) plus the session
 * mint on confirm success. All consumer-facing copy lives here or in the
 * login form; the security behavior lives in the lib.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { confirmPortalOtp, requestPortalOtp } from "@/lib/portal/otp";
import { mintPortalSessionCookie } from "@/lib/portal/session";

export interface PortalLoginState {
  ok: boolean;
  error: string | null;
  /** Normalized E.164 carried into the code step after a request. */
  phoneE164: string | null;
}

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Consumer-friendly phone normalization: strip formatting, assume US (+1)
 * for bare 10-digit numbers. The OTP lib validates strict E.164 after this.
 */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

async function callerIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Step 1 — text a code to the entered phone. Enumeration-safe by design. */
export async function requestPortalCodeAction(
  _prev: PortalLoginState,
  formData: FormData,
): Promise<PortalLoginState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!E164_REGEX.test(phone)) {
    return {
      ok: false,
      error: "That doesn't look like a phone number — check it and try again.",
      phoneE164: null,
    };
  }

  const result = await requestPortalOtp(phone, await callerIp());
  if (!result.ok) {
    return { ok: false, error: result.error, phoneE164: null };
  }
  return { ok: true, error: null, phoneE164: phone };
}

/** Step 2 — confirm the code; on success mint the session and enter the portal. */
export async function confirmPortalCodeAction(
  _prev: PortalLoginState,
  formData: FormData,
): Promise<PortalLoginState> {
  const phone = String(formData.get("phone") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  const result = await confirmPortalOtp(phone, code);
  if (!result.ok) {
    return { ok: false, error: result.error, phoneE164: phone };
  }

  const cookie = mintPortalSessionCookie(
    result.tenantId,
    result.organizationId,
  );
  const store = await cookies();
  store.set(cookie.name, cookie.value, cookie.options);
  redirect("/portal");
}
