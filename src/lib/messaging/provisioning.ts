/**
 * Phone number pool utilities — v1 pool-based provisioning.
 *
 * Numbers are purchased manually in the Sendblue dashboard and seeded into
 * `sendblue_number_pool`. This module owns pool administration helpers that
 * are NOT in the onboarding action layer:
 *
 *   - {@link countAvailableNumbers}   — read current available count
 *   - {@link addNumbersToPool}        — insert new rows (admin top-up)
 *   - {@link maybeCapturePoolLowAlert} — fire a Sentry event when the
 *       remaining available count drops below the configured threshold
 *
 * Post-launch backlog: investigate Sendblue API for programmatic purchase.
 *
 * T2b (2026-05-17): created as part of pool-based provisioning work.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import * as Sentry from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default low-pool threshold. When the available count drops to or below
 * this value after a successful assignment, we fire a Sentry alert.
 *
 * Overridable via PHONE_POOL_LOW_THRESHOLD env var (see src/lib/env.ts).
 */
export const DEFAULT_POOL_LOW_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolNumberInput {
  /** E.164 phone number, e.g. "+16502345678" */
  e164: string;
}

export type AddNumbersResult =
  | { ok: true; inserted: number }
  | { ok: false; error: string };

export type CountResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of rows currently in `available` status.
 * Uses the service-role (admin) client — this table is write-only for
 * non-service-role users.
 */
export async function countAvailableNumbers(
  admin: SupabaseClient<Database>,
): Promise<CountResult> {
  const { count, error } = await admin
    .from('sendblue_number_pool')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'available');

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, count: count ?? 0 };
}

/**
 * Insert new numbers into the pool with `status = 'available'`.
 *
 * Duplicate e164 values (unique constraint on the table) are rejected by
 * Postgres. We rely on the unique constraint to surface the error message
 * back to the admin so they know a number is already in the pool.
 *
 * @param admin - Service-role Supabase client
 * @param numbers - Array of E.164 numbers to add
 */
export async function addNumbersToPool(
  admin: SupabaseClient<Database>,
  numbers: PoolNumberInput[],
): Promise<AddNumbersResult> {
  if (numbers.length === 0) {
    return { ok: true, inserted: 0 };
  }

  const rows = numbers.map((n) => ({
    e164: n.e164,
    status: 'available' as const,
  }));

  const { data, error } = await admin
    .from('sendblue_number_pool')
    .insert(rows)
    .select('id');

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, inserted: data?.length ?? 0 };
}

/**
 * Fire a Sentry `captureMessage` alert when the available pool drops at or
 * below the threshold. Call this immediately after a successful number
 * assignment.
 *
 * No debounce in v1 — the threshold is low enough (default: 3) that the
 * alert frequency is acceptable.
 *
 * @param admin        - Service-role client (to count available rows)
 * @param orgId        - The org that just claimed a number (for Sentry context)
 * @param threshold    - Defaults to PHONE_POOL_LOW_THRESHOLD or env override
 */
export async function maybeCapturePoolLowAlert(
  admin: SupabaseClient<Database>,
  orgId: string,
  threshold?: number,
): Promise<void> {
  const effectiveThreshold =
    threshold ??
    (process.env.PHONE_POOL_LOW_THRESHOLD
      ? Number(process.env.PHONE_POOL_LOW_THRESHOLD)
      : DEFAULT_POOL_LOW_THRESHOLD);

  const result = await countAvailableNumbers(admin);
  if (!result.ok) {
    // Count failed — log but don't throw; alerting is best-effort.
    console.warn('[provisioning] could not count pool for low-pool check:', result.error);
    return;
  }

  if (result.count <= effectiveThreshold) {
    Sentry.captureMessage('Phone pool low', {
      level: 'warning',
      extra: {
        availableCount: result.count,
        threshold: effectiveThreshold,
        triggeredByOrgId: orgId,
      },
    });
  }
}
