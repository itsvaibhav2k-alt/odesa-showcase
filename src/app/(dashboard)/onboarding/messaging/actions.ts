"use server";

/**
 * Server actions for the Messaging onboarding step (Phase B Goal 3).
 *
 * Three actions, all Result-typed via {@link ApiResponse}:
 *
 *   - {@link assignNumberAction} — atomic claim of one row from the
 *     shared `sendblue_number_pool` table (status-conditional UPDATE
 *     standing in for `FOR UPDATE SKIP LOCKED`) and writes the `e164`
 *     onto `organizations.odesa_phone_number`. Surfaces
 *     `'NO_AVAILABLE_NUMBERS'` as a typed error when the pool is
 *     exhausted.
 *
 *   - {@link setAssistantNameAction} — validates and persists
 *     `organizations.assistant_name` (1-30 chars, must contain a
 *     letter, no control chars).
 *
 *   - {@link sendTestSmsAction} — looks up the operator's verified
 *     personal phone (`users.phone_e164` where `phone_verified_at IS
 *     NOT NULL`) and sends a one-off "this is a test from <name>"
 *     message via the org's primary `MessagingProvider`.
 *
 * Atomic assignment runs through `createAdminClient()` because the
 * `sendblue_number_pool` table denies non-service-role writes by RLS.
 * The action layer is the trust boundary: it always calls
 * `requireAuthContext()` first so the org-id baked into the writes is
 * the operator's own, not user-supplied.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { FORBIDDEN_MESSAGE } from "@/lib/authz/policy";
import { sendWithFailover } from "@/lib/messaging/send-with-failover";
import { maybeCapturePoolLowAlert } from "@/lib/messaging/provisioning";
import type { ApiResponse } from "@/types";
import type { UserRole } from "@/types/database";

import {
  ASSISTANT_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_NAME,
  NO_AVAILABLE_NUMBERS_ERROR,
} from "./constants";
import type {
  AssignNumberSuccess,
  SendTestSmsSuccess,
  SetAssistantNameInput,
  SetAssistantNameSuccess,
} from "./types";

// ---------------------------------------------------------------------------
// Auth helper (mirrors the pattern in src/app/(dashboard)/onboarding/actions.ts)
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string;
  organizationId: string;
  role: UserRole | null;
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
    return {
      success: false,
      error: "User profile not found",
    };
  }

  return {
    success: true,
    data: {
      userId: user.id,
      organizationId: userRow.organization_id,
      role: userRow.role ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Number assignment
// ---------------------------------------------------------------------------

/**
 * Atomically claim one Sendblue number from the shared pool and assign
 * it to the operator's organization.
 *
 * Race-safety: see {@link claimNumberInline}. We approximate Postgres'
 * `FOR UPDATE SKIP LOCKED` semantics with a status-conditional UPDATE
 * over a small SELECT'd batch — Postgres serializes UPDATE on the
 * primary key, so concurrent claims that target the same row collapse
 * to one winner and the loser walks to the next candidate.
 *
 * Pool empty → returns `Err('NO_AVAILABLE_NUMBERS')`. The caller (UI)
 * pattern-matches on this code and renders the friendly message.
 *
 * Idempotency: if the org already has an `odesa_phone_number` set we
 * short-circuit and return that number unchanged. This keeps refreshing
 * the onboarding step from re-claiming additional pool rows.
 */
export async function assignNumberAction(): Promise<
  ApiResponse<AssignNumberSuccess>
> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === "va") {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const admin = createAdminClient();

  // Idempotency check first — if an admin re-runs the page, never claim
  // a second number against the same org.
  const { data: existingOrg, error: existingErr } = await admin
    .from("organizations")
    .select("odesa_phone_number")
    .eq("id", auth.data.organizationId)
    .single();

  if (existingErr) {
    return { success: false, error: existingErr.message };
  }
  if (existingOrg?.odesa_phone_number) {
    return {
      success: true,
      data: { e164: existingOrg.odesa_phone_number },
    };
  }

  const claim = await claimNumberInline(admin, auth.data.organizationId);
  return finalizeAssignment(admin, claim, auth.data.organizationId);
}

type ClaimResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "empty_pool" | "db_error"; error?: string };

/**
 * Two-step atomic claim. supabase-js doesn't expose raw SQL, so we
 * approximate `FOR UPDATE SKIP LOCKED` by:
 *
 *   1. SELECT the oldest few rows where `status = 'available'` (we
 *      grab a small batch so contention can step through siblings
 *      instead of failing back to the caller).
 *   2. For each candidate run a status-conditional UPDATE
 *      (`eq('status', 'available')`). Postgres serializes UPDATE
 *      against an indexed primary key, so the first writer wins; any
 *      racing writer's UPDATE matches zero rows and we move to the
 *      next candidate.
 *
 * This is functionally equivalent to FOR UPDATE SKIP LOCKED for our
 * use case (no double-assignment) without requiring a server-side RPC.
 */
async function claimNumberInline(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<ClaimResult> {
  // Step 1: pick an available row. Two concurrent callers may pick the
  // same id — the conditional update in step 2 resolves this.
  const { data: pickRows, error: pickErr } = await admin
    .from("sendblue_number_pool")
    .select("id, e164")
    .eq("status", "available")
    .order("created_at", { ascending: true })
    .limit(5);

  if (pickErr) {
    return { ok: false, reason: "db_error", error: pickErr.message };
  }
  if (!pickRows || pickRows.length === 0) {
    return { ok: false, reason: "empty_pool" };
  }

  // Step 2: try each candidate in turn with a status-conditional update.
  // The first update that succeeds (i.e. returns a row) wins. Anyone
  // else racing us will fail-and-skip because their candidate's status
  // is no longer 'available' by the time their update lands.
  for (const candidate of pickRows) {
    const { data: claimed, error: claimErr } = await admin
      .from("sendblue_number_pool")
      .update({
        status: "assigned",
        assigned_to_organization_id: organizationId,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "available")
      .select("e164")
      .maybeSingle();

    if (claimErr) {
      // Continue trying other candidates — one DB hiccup shouldn't
      // bury the rest.
      continue;
    }
    if (claimed?.e164) {
      return { ok: true, e164: claimed.e164 };
    }
  }

  // All candidates were claimed by other workers between our SELECT and
  // our UPDATE — treat this as pool-exhausted for the caller. They can
  // retry; if rows became available in the meantime they'll see them.
  return { ok: false, reason: "empty_pool" };
}

async function finalizeAssignment(
  admin: ReturnType<typeof createAdminClient>,
  claim: ClaimResult,
  organizationId: string,
): Promise<ApiResponse<AssignNumberSuccess>> {
  if (!claim.ok) {
    if (claim.reason === "empty_pool") {
      return { success: false, error: NO_AVAILABLE_NUMBERS_ERROR };
    }
    return {
      success: false,
      error: claim.error ?? "Failed to assign number",
    };
  }

  const { error: orgErr } = await admin
    .from("organizations")
    .update({
      odesa_phone_number: claim.e164,
      messaging_primary: "linq",
    })
    .eq("id", organizationId);

  if (orgErr) {
    return { success: false, error: orgErr.message };
  }

  // T2b: fire low-pool Sentry alert if the available count drops to threshold.
  // Best-effort — do not await errors, never block the happy path.
  maybeCapturePoolLowAlert(admin, organizationId).catch((err: unknown) => {
    console.warn("[provisioning] low-pool alert failed:", err);
  });

  revalidatePath("/onboarding/messaging");
  revalidatePath("/settings/integrations");

  return { success: true, data: { e164: claim.e164 } };
}

// ---------------------------------------------------------------------------
// Assistant name
// ---------------------------------------------------------------------------

// Disallow ASCII control chars (0x00-0x1F) and DEL (0x7F) so the assistant
// name is safe to interpolate into prompts and the operator UI.
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
const HAS_LETTER_REGEX = /\p{L}/u;

const assistantNameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1, {
    message: `Assistant name must be 1 to ${ASSISTANT_NAME_MAX_LENGTH} characters`,
  })
  .refine((value) => value.length <= ASSISTANT_NAME_MAX_LENGTH, {
    message: `Assistant name must be 1 to ${ASSISTANT_NAME_MAX_LENGTH} characters`,
  })
  .refine((value) => HAS_LETTER_REGEX.test(value), {
    message: "Assistant name must contain at least one letter",
  })
  .refine((value) => !CONTROL_CHAR_REGEX.test(value), {
    message: "Assistant name cannot contain control characters",
  });

/**
 * Validate and persist `organizations.assistant_name`. Trims, requires
 * a non-empty length up to `ASSISTANT_NAME_MAX_LENGTH`, requires at
 * least one letter (Unicode), rejects control characters.
 *
 * The DB column is NOT NULL with a default of 'Odesa', so we never
 * write `null` here — the operator can always reset to that default
 * by typing it back in.
 */
export async function setAssistantNameAction(
  input: SetAssistantNameInput,
): Promise<ApiResponse<SetAssistantNameSuccess>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === "va") {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsed = assistantNameSchema.safeParse(input.name ?? "");
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      success: false,
      error: first?.message ?? "Invalid assistant name",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ assistant_name: parsed.data })
    .eq("id", auth.data.organizationId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/onboarding/messaging");
  revalidatePath("/settings/integrations");

  return { success: true, data: { assistantName: parsed.data } };
}

// ---------------------------------------------------------------------------
// Test SMS
// ---------------------------------------------------------------------------

const TEST_SMS_BODY_TEMPLATE = (assistantName: string) =>
  `This is a test from ${assistantName}. Reply with anything to confirm.`;

/**
 * Send a one-off test message to the operator's verified personal
 * phone. Used to confirm wiring during onboarding (and to retest from
 * Settings → Integrations).
 *
 * Preconditions:
 *   - operator has verified their personal phone (sets
 *     `users.phone_verified_at`)
 *   - the org has been assigned an `odesa_phone_number`
 *
 * Both preconditions must hold. The action returns a Result type so
 * the UI can render the specific error inline.
 */
export async function sendTestSmsAction(
  requestId: string,
): Promise<ApiResponse<SendTestSmsSuccess>> {
  const auth = await requireAuthContext();
  if (!auth.success) return auth;
  if (auth.data.role === "va") {
    return { success: false, error: FORBIDDEN_MESSAGE };
  }

  const parsedRequestId = z.string().uuid().safeParse(requestId);
  if (!parsedRequestId.success) {
    return { success: false, error: "Invalid test-message request" };
  }

  const admin = createAdminClient();

  // Operator must have verified their personal cell.
  const { data: userRow, error: userErr } = await admin
    .from("users")
    .select("phone_e164, phone_verified_at")
    .eq("id", auth.data.userId)
    .single();

  if (userErr || !userRow) {
    return {
      success: false,
      error: "Could not load your account",
    };
  }

  if (!userRow.phone_e164 || !userRow.phone_verified_at) {
    return {
      success: false,
      error:
        "Verify your personal phone first (Settings → Integrations) so the test message has a destination.",
    };
  }

  // Org must have a Sendblue number assigned.
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("odesa_phone_number, assistant_name")
    .eq("id", auth.data.organizationId)
    .single();

  if (orgErr || !orgRow) {
    return {
      success: false,
      error: "Could not load your organization",
    };
  }

  if (!orgRow.odesa_phone_number) {
    return {
      success: false,
      error:
        "Assign a number first — without an Odesa number we have nothing to send from.",
    };
  }

  const assistantName = orgRow.assistant_name || DEFAULT_ASSISTANT_NAME;
  const body = TEST_SMS_BODY_TEMPLATE(assistantName);

  const result = await sendWithFailover(auth.data.organizationId, {
    toE164: userRow.phone_e164,
    fromE164: orgRow.odesa_phone_number,
    body,
    idempotencyKey: `onboarding-test:${auth.data.userId}:${parsedRequestId.data}`,
  });

  if (!result.ok) {
    return {
      success: false,
      error:
        result.status === "suppressed"
          ? "Couldn't send the test SMS: this number is opted out"
          : "Couldn't send the test SMS safely",
    };
  }

  return {
    success: true,
    data: {
      providerMessageId: result.providerMessageId,
      toE164: userRow.phone_e164,
    },
  };
}
