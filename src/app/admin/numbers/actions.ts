'use server';

/**
 * Server actions for the admin phone-number pool top-up page.
 *
 * Protected by a two-factor check:
 *   1. The caller must be authenticated (Supabase session).
 *   2. Their email must be in the ADMIN_EMAILS env var.
 *
 * Uses the service-role (admin) Supabase client so RLS doesn't block
 * writes to `sendblue_number_pool`.
 *
 * T2b (2026-05-17): created for pool-based provisioning v1.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { addNumbersToPool } from '@/lib/messaging/provisioning';
import type { ApiResponse } from '@/types';

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

async function requireAdminEmail(): Promise<ApiResponse<{ email: string }>> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user || !user.email) {
    return { success: false, error: 'Not authenticated' };
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!adminEmails.includes(user.email.toLowerCase())) {
    return { success: false, error: 'Forbidden' };
  }

  return { success: true, data: { email: user.email } };
}

// ---------------------------------------------------------------------------
// Top-up action
// ---------------------------------------------------------------------------

export interface AddNumbersInput {
  /** Raw textarea value: one E.164 number per line */
  rawNumbers: string;
}

export interface AddNumbersSuccess {
  inserted: number;
  skipped: string[];
}

/**
 * Parse a newline-separated list of E.164 numbers and insert any new
 * ones into `sendblue_number_pool`. Duplicate numbers are rejected by
 * the unique constraint and surfaced as a DB error.
 */
export async function addPoolNumbersAction(
  input: AddNumbersInput,
): Promise<ApiResponse<AddNumbersSuccess>> {
  const auth = await requireAdminEmail();
  if (!auth.success) return auth;

  // Parse: strip blank lines and obvious non-numbers; validate E.164 format.
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  const lines = input.rawNumbers
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const skipped: string[] = [];

  for (const line of lines) {
    if (e164Regex.test(line)) {
      valid.push(line);
    } else {
      skipped.push(line);
    }
  }

  if (valid.length === 0) {
    return {
      success: false,
      error:
        skipped.length > 0
          ? `No valid E.164 numbers found. Invalid entries: ${skipped.join(', ')}`
          : 'No numbers provided',
    };
  }

  const admin = createAdminClient();
  const result = await addNumbersToPool(
    admin,
    valid.map((e164) => ({ e164 })),
  );

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  return { success: true, data: { inserted: result.inserted, skipped } };
}
