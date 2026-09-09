/**
 * Seed fixture for the v1.8 channel-parity spec.
 *
 * Two-stage shape because the spec is required to drive the actual
 * `/signup` UI:
 *
 *   1. `prepareSignup()` — pre-mint a unique email/password/orgName
 *      tuple plus a planned operator phone + pooled Sendblue number,
 *      and seed the lone `sendblue_number_pool.status='available'`
 *      row up-front so the onboarding messaging step has a number
 *      to claim.
 *   2. `attachVerifiedPhone()` — once the spec has driven `/signup`
 *      (and the post-signup trigger has provisioned `public.users` +
 *      `public.organizations`), stamp `users.phone_e164` +
 *      `users.phone_verified_at` so the inbound webhook router
 *      classifies the operator's number as `kind: 'operator'`.
 *
 * The split is necessary because Supabase CLI 2.75's local stack
 * uses the new `sb_secret_*` API key format, which GoTrue's admin
 * endpoints do not accept (`auth.admin.createUser` fails with
 * `bad_jwt`). Driving the public `/signup` form via Playwright is the
 * supported path on local — and the brief explicitly calls for UI
 * signup anyway.
 *
 * PostgREST still accepts the new key format for non-auth admin
 * writes, so phone-stamping + pool seeding + teardown work fine
 * through the service-role client.
 *
 * Each invocation generates its own E.164 numbers + email so parallel
 * Playwright workers don't collide on the unique constraints
 * (`organizations.odesa_phone_number`, `sendblue_number_pool.e164`,
 * `users.phone_e164`).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../../src/types/database';

// ---------------------------------------------------------------------------
// Environment resolution (mirrors e2e/messaging/helpers.ts so the spec can
// gate-skip the same way other DB-dependent specs already do).
// ---------------------------------------------------------------------------

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const HAVE_SUPABASE = Boolean(
  SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY,
);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SignupCredentials {
  email: string;
  password: string;
  fullName: string;
  orgName: string;
}

export interface PreparedSeed extends SignupCredentials {
  /**
   * The phone number the spec will stamp on the operator's `users` row
   * post-signup (via `attachVerifiedPhone`). The inbound webhook will
   * use this as the `from_number` to trigger the operator branch in
   * `routeInbound`.
   */
  operatorPhoneE164: string;
  /**
   * Pre-seeded `sendblue_number_pool` E.164 with `status='available'`.
   * The onboarding messaging step's "Assign a number" button claims
   * this row and stamps it onto `organizations.odesa_phone_number`.
   */
  pooledSendblueNumber: string;
  /** Pool row id — needed for explicit cleanup. */
  pooledSendblueNumberId: string;
  /** Resolved during teardown so we can scope deletes to one org. */
  teardown: (organizationId: string | null) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Admin client
// ---------------------------------------------------------------------------

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Uniqueness helpers
// ---------------------------------------------------------------------------
//
// Worker-id + monotonic counter + timestamp. Playwright's parallel
// workers each see their own copy of `counter`, so the worker-id keeps
// inter-worker collisions impossible.

let counter = 0;

function uniqDigits(): string {
  counter += 1;
  const workerId = process.env.TEST_PARALLEL_INDEX ?? '0';
  return (
    String(Date.now()).slice(-7) +
    workerId.padStart(2, '0') +
    String(counter).padStart(3, '0')
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — prepareSignup
// ---------------------------------------------------------------------------

export interface PrepareSignupOptions {
  prefix?: string;
  /** Override generated phone (E.164). */
  operatorPhoneE164?: string;
  /** Override generated pool number (E.164). */
  pooledSendblueNumber?: string;
}

/**
 * Mint unique credentials + seed a pool row before the spec drives
 * `/signup`. Returns a teardown closure the spec calls in afterEach.
 *
 * The teardown takes the resolved `organizationId` (the spec extracts
 * it from the database after sign-up) so we don't have to look it up
 * by email here — keeps the helper synchronous of any DB lookup that
 * could race with the signup-trigger.
 */
export async function prepareSignup(
  options: PrepareSignupOptions = {},
): Promise<PreparedSeed> {
  if (!HAVE_SUPABASE) {
    throw new Error(
      'prepareSignup requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and an anon key',
    );
  }

  const admin = createAdmin();
  const stamp = uniqDigits();
  const prefix = options.prefix ?? 'parity';

  const email = `${prefix}.${stamp}@parity.test`;
  const password = `parity-${stamp}-secret`;
  const fullName = `Parity Op ${stamp}`;
  const orgName = `Parity Org ${stamp}`;
  const operatorPhoneE164 =
    options.operatorPhoneE164 ?? `+1666${stamp.slice(-7)}`;
  const pooledSendblueNumber =
    options.pooledSendblueNumber ?? `+1555${stamp.slice(-7)}`;

  // Seed exactly one available pool number. The onboarding step's
  // claim helper picks the oldest available row, so seeding only one
  // means parallel workers can't accidentally swipe each other's
  // number. (Each worker minted a different `e164` value above.)
  const { data: poolRow, error: poolErr } = await admin
    .from('sendblue_number_pool')
    .insert({
      e164: pooledSendblueNumber,
      status: 'available',
    })
    .select('id, e164')
    .single();
  if (poolErr || !poolRow) {
    throw new Error(`failed to seed sendblue_number_pool: ${poolErr?.message}`);
  }

  // ---- Teardown closure ---------------------------------------------------
  //
  // The spec calls this in afterEach with the organizationId it
  // extracted post-signup. PostgREST + RLS allow the service-role key
  // to delete from public.* tables. Auth user removal is deliberately
  // skipped — the local CLI 2.75 GoTrue stack rejects sb_secret_*
  // tokens for `auth.admin.deleteUser`, and the auth.users row is
  // self-contained on local (test runs leak rows but don't conflict).

  const safeDelete = async (
    promise: PromiseLike<{ error: unknown }>,
  ): Promise<void> => {
    try {
      await Promise.resolve(promise);
    } catch {
      /* swallow — best-effort cleanup */
    }
  };

  const teardown = async (organizationId: string | null) => {
    // Always reclaim the pool row (no FK dep on org for `available` rows;
    // when the row got assigned to an org, the FK is `assigned_to_organization_id`
    // which we'll handle by org delete).
    await safeDelete(
      admin.from('sendblue_number_pool').delete().eq('id', poolRow.id),
    );
    if (!organizationId) return;
    // Cleanup chat audit + operator state first, then onboarding rows,
    // then the org. CASCADE on `organizations.id` covers the org's
    // children, but explicit deletes surface FK gaps (e.g. proposals
    // table that doesn't list FK to org with cascade).
    await safeDelete(
      admin
        .from('operator_chat_turns')
        .delete()
        .eq('organization_id', organizationId),
    );
    await safeDelete(
      admin
        .from('operator_chats')
        .delete()
        .eq('organization_id', organizationId),
    );
    await safeDelete(
      admin
        .from('action_proposals')
        .delete()
        .eq('organization_id', organizationId),
    );
    await safeDelete(
      admin
        .from('memory_facts')
        .delete()
        .eq('organization_id', organizationId),
    );
    await safeDelete(
      admin.from('leases').delete().eq('organization_id', organizationId),
    );
    await safeDelete(
      admin.from('tenants').delete().eq('organization_id', organizationId),
    );
    await safeDelete(
      admin.from('units').delete().eq('organization_id', organizationId),
    );
    await safeDelete(
      admin
        .from('properties')
        .delete()
        .eq('organization_id', organizationId),
    );
    await safeDelete(
      admin.from('users').delete().eq('organization_id', organizationId),
    );
    await safeDelete(
      admin.from('organizations').delete().eq('id', organizationId),
    );
  };

  return {
    email,
    password,
    fullName,
    orgName,
    operatorPhoneE164,
    pooledSendblueNumber: poolRow.e164,
    pooledSendblueNumberId: poolRow.id,
    teardown,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — resolveSignupOrg
// ---------------------------------------------------------------------------

/**
 * After the spec drives `/signup`, look up the public.users row by
 * email and return `(userId, organizationId)`. Polls until the
 * post-signup trigger has populated the `public.users` row. The
 * trigger fires inside the same transaction as the auth.users insert,
 * but PostgREST's snapshot may briefly lag the trigger's commit —
 * giving the poll a 10s grace.
 *
 * Implementation note: we go through PostgREST against `public.users`
 * (which has the `email` column populated by the trigger) rather than
 * GoTrue's `auth/v1/admin/users` endpoint, because the local Supabase
 * CLI 2.75 stack rejects `sb_secret_*` keys on every auth-admin
 * endpoint with `bad_jwt`.
 */
export async function resolveSignupOrg(
  email: string,
  timeoutMs = 10_000,
): Promise<{ userId: string; organizationId: string }> {
  const admin = createAdmin();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data: userRow } = await admin
      .from('users')
      .select('id, organization_id')
      .eq('email', email)
      .maybeSingle();
    if (userRow?.id && userRow.organization_id) {
      return {
        userId: userRow.id,
        organizationId: userRow.organization_id,
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Signup org resolution timed out for ${email} after ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — attachVerifiedPhone
// ---------------------------------------------------------------------------

/**
 * Stamp `users.phone_e164` + `users.phone_verified_at` on the
 * resolved user. Bypasses the verify-code flow entirely so the spec
 * can keep its focus on the dispatcher loop. PostgREST accepts the
 * sb_secret_* admin key for this UPDATE.
 */
export async function attachVerifiedPhone(
  userId: string,
  phoneE164: string,
): Promise<void> {
  const admin = createAdmin();
  const verifiedAt = new Date().toISOString();
  const { error } = await admin
    .from('users')
    .update({
      phone_e164: phoneE164,
      phone_verified_at: verifiedAt,
    })
    .eq('id', userId);
  if (error) {
    throw new Error(`failed to attach verified phone: ${error.message}`);
  }
}
