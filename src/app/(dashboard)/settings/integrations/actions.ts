"use server";

/**
 * Server actions for the Settings → Integrations page (Phase 5).
 *
 * Two surfaces:
 *
 *   1. Poke MCP keys
 *      - `createApiKey(label)` mints `odesa_mcp_<32-char-base64url>`,
 *        sha256-hashes it into `mcp_api_keys.key_hash`, returns the
 *        plaintext key ONCE so the caller (ApiKeyDisplay modal) can
 *        show + copy it. Once the modal closes the key is unrecoverable.
 *      - `revokeApiKey(id)` sets `revoked_at = now()` for an org-scoped
 *        row.
 *
 *   2. Operator phone verification
 *      - `requestPhoneVerification(phoneE164)` generates a 6-digit code,
 *        stores `phone_verifications(user_id, phone_e164, code_hash,
 *        expires_at)`, sends the code via the org's primary
 *        MessagingProvider.
 *      - `confirmPhoneVerification(phoneE164, code)` verifies the code,
 *        marks the verification consumed, and writes
 *        `users.phone_e164` + `users.phone_verified_at`.
 *
 * Auth follows the `requireAuthContext()` pattern from
 * `src/app/(dashboard)/properties/[id]/actions.ts:31-57`. Writes use
 * the SSR Supabase client so RLS auto-scopes to the caller's org.
 */

import * as crypto from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { FORBIDDEN_MESSAGE } from "@/lib/authz/policy";
import { createServerClient } from "@/lib/supabase/server";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";
import type { ApiResponse } from "@/types";

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string;
  organizationId: string;
}

async function requireAuthContext(): Promise<ApiResponse<AuthContext>> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  if (userErr || !userRow) {
    return { success: false, error: "User profile not found" };
  }
  if (userRow.role === "va") {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  return {
    success: true,
    data: { userId: user.id, organizationId: userRow.organization_id },
  };
}

function firstZodError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string {
  const first = issues[0];
  if (!first) return "Validation failed";
  const path = first.path.map(String).join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

// ---------------------------------------------------------------------------
// MCP API keys — create
// ---------------------------------------------------------------------------

const KEY_PREFIX = "odesa_mcp_";
const KEY_RANDOM_BYTES = 24; // base64url(24) → 32 chars
const VERIFY_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

const createApiKeySchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Label is required")
    .max(80, "Label must be 80 characters or fewer"),
});

export interface CreateApiKeyPayload {
  label: string;
}

export interface CreateApiKeyResult {
  id: string;
  /** Full plaintext key — only returned at mint time. */
  key: string;
  prefix: string;
  label: string;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mintKey(): { plaintext: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(KEY_RANDOM_BYTES).toString("base64url");
  const plaintext = `${KEY_PREFIX}${random}`;
  return {
    plaintext,
    // First 8 chars of the random portion is enough to disambiguate
    // for display without leaking the secret.
    prefix: `${KEY_PREFIX}${random.slice(0, 8)}`,
    hash: sha256Hex(plaintext),
  };
}

export async function createApiKey(
  payload: CreateApiKeyPayload,
): Promise<ApiResponse<CreateApiKeyResult>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = createApiKeySchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const minted = mintKey();

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("mcp_api_keys")
      .insert({
        organization_id: auth.data.organizationId,
        user_id: auth.data.userId,
        key_hash: minted.hash,
        key_prefix: minted.prefix,
        label: parsed.data.label,
      })
      .select("id, key_prefix, label")
      .single();

    if (error || !data) {
      return {
        success: false,
        error: error?.message ?? "Failed to create key",
      };
    }

    revalidatePath("/settings/integrations");

    return {
      success: true,
      data: {
        id: data.id,
        key: minted.plaintext,
        prefix: data.key_prefix,
        label: data.label,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create key",
    };
  }
}

// ---------------------------------------------------------------------------
// MCP API keys — revoke
// ---------------------------------------------------------------------------

const revokeApiKeySchema = z.object({
  id: z.string().uuid("Invalid key id"),
});

export interface RevokeApiKeyPayload {
  id: string;
}

export async function revokeApiKey(
  payload: RevokeApiKeyPayload,
): Promise<ApiResponse<{ id: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = revokeApiKeySchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  try {
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("mcp_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .is("revoked_at", null);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/settings/integrations");

    return { success: true, data: { id: parsed.data.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to revoke key",
    };
  }
}

// ---------------------------------------------------------------------------
// Phone verification — request
// ---------------------------------------------------------------------------

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

const requestPhoneVerificationSchema = z.object({
  phoneE164: z
    .string()
    .trim()
    .regex(E164_REGEX, "Phone number must be in E.164 format"),
});

export interface RequestPhoneVerificationPayload {
  phoneE164: string;
}

function generateCode(): string {
  // Cryptographically random 6-digit code with leading-zero preservation.
  const buf = crypto.randomBytes(4);
  const n = buf.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

async function getOrgOdesaNumber(
  organizationId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("odesa_phone_number")
    .eq("id", organizationId)
    .single();
  return data?.odesa_phone_number ?? null;
}

export async function requestPhoneVerification(
  payload: RequestPhoneVerificationPayload,
): Promise<ApiResponse<{ phoneE164: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = requestPhoneVerificationSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const fromE164 = await getOrgOdesaNumber(auth.data.organizationId);
  if (!fromE164) {
    return {
      success: false,
      error: "No Odesa phone number provisioned for this org yet.",
    };
  }

  const code = generateCode();
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + VERIFY_CODE_TTL_MS).toISOString();

  try {
    const supabase = await createServerClient();
    const { data: verification, error: insertErr } = await supabase
      .from("phone_verifications")
      .insert({
        organization_id: auth.data.organizationId,
        user_id: auth.data.userId,
        phone_e164: parsed.data.phoneE164,
        code_hash: codeHash,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertErr || !verification) {
      return { success: false, error: insertErr.message };
    }

    const sendResult = await sendWithFailover(auth.data.organizationId, {
      toE164: parsed.data.phoneE164,
      fromE164,
      body: `Your Odesa verification code: ${code}`,
      idempotencyKey: `phone-verification:${verification.id}`,
    });

    if (!sendResult.ok) {
      // Raw provider failures (e.g. Sendblue's full JSON error body) are
      // logged server-side only — they leak plan/config internals and
      // read as broken product when rendered in the onboarding form.
      console.error(
        `[phone-verification] provider send failed for user ${auth.data.userId}: ${sendResult.status ?? "failed"}`,
      );
      return {
        success: false,
        error:
          "Couldn't send the code — double-check the number and try again in a minute.",
      };
    }

    return { success: true, data: { phoneE164: parsed.data.phoneE164 } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send code",
    };
  }
}

// ---------------------------------------------------------------------------
// Google Calendar — disconnect
// ---------------------------------------------------------------------------

/**
 * Delete the current user's `google_calendar` OAuth row. Idempotent:
 * if no row exists, returns success anyway so the UI flips back to
 * the unconnected state without surfacing a noise error.
 */
export async function disconnectGoogleCalendar(): Promise<
  ApiResponse<{ disconnected: boolean }>
> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  try {
    const supabase = await createServerClient();
    const { error } = await supabase
      .from("oauth_tokens")
      .delete()
      .eq("user_id", auth.data.userId)
      .eq("organization_id", auth.data.organizationId)
      .eq("provider", "google_calendar");

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/settings/integrations");

    return { success: true, data: { disconnected: true } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to disconnect",
    };
  }
}

// ---------------------------------------------------------------------------
// Phone verification — confirm
// ---------------------------------------------------------------------------

const confirmPhoneVerificationSchema = z.object({
  phoneE164: z
    .string()
    .trim()
    .regex(E164_REGEX, "Phone number must be in E.164 format"),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export interface ConfirmPhoneVerificationPayload {
  phoneE164: string;
  code: string;
}

export async function confirmPhoneVerification(
  payload: ConfirmPhoneVerificationPayload,
): Promise<ApiResponse<{ phoneE164: string }>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;

  const parsed = confirmPhoneVerificationSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodError(parsed.error.issues) };
  }

  const codeHash = sha256Hex(parsed.data.code);
  const nowIso = new Date().toISOString();

  try {
    const supabase = await createServerClient();

    // Find the most recent un-consumed, un-expired verification for
    // (user, phone). We do NOT match on code_hash here so a wrong code
    // counts against `attempts` instead of returning "expired" silently.
    // RLS scopes to the caller's row; the explicit user_id is defence-
    // in-depth.
    const { data: verification, error: lookupErr } = await supabase
      .from("phone_verifications")
      .select("id, code_hash, attempts")
      .eq("user_id", auth.data.userId)
      .eq("phone_e164", parsed.data.phoneE164)
      .is("consumed_at", null)
      .gte("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      return { success: false, error: lookupErr.message };
    }
    if (!verification) {
      return {
        success: false,
        error: "Code is invalid or has expired. Send a new one.",
      };
    }

    // Brute-force cap. Once attempts hits MAX_VERIFY_ATTEMPTS the row is
    // locked out (consumed_at = now()) so no further codes can be tried
    // against it; the operator must re-request a new OTP.
    if (verification.attempts >= MAX_VERIFY_ATTEMPTS) {
      await supabase
        .from("phone_verifications")
        .update({ consumed_at: nowIso })
        .eq("id", verification.id);
      return {
        success: false,
        error: "Too many attempts. Send a new code and try again.",
      };
    }

    if (verification.code_hash !== codeHash) {
      await supabase
        .from("phone_verifications")
        .update({ attempts: verification.attempts + 1 })
        .eq("id", verification.id);
      return {
        success: false,
        error: "Code is invalid or has expired. Send a new one.",
      };
    }

    const { error: consumeErr } = await supabase
      .from("phone_verifications")
      .update({ consumed_at: nowIso })
      .eq("id", verification.id);

    if (consumeErr) {
      return { success: false, error: consumeErr.message };
    }

    const { error: userUpdateErr } = await supabase
      .from("users")
      .update({
        phone_e164: parsed.data.phoneE164,
        phone_verified_at: nowIso,
      })
      .eq("id", auth.data.userId);

    if (userUpdateErr) {
      return { success: false, error: userUpdateErr.message };
    }

    revalidatePath("/settings/integrations");

    return { success: true, data: { phoneE164: parsed.data.phoneE164 } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Verification failed",
    };
  }
}
