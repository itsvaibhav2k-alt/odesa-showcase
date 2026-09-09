/**
 * generate-daily-digest — daily cron that snapshots "what changed
 * overnight" into `daily_digests`, one row per (org, date).
 *
 * Runs every day at 09:30 UTC — after generate-rent-cycles (06:00) and
 * rent-cycle-daily (08:00), so the digest's rent_activity section sees
 * the morning's ledger movement in its 24h window.
 *
 * Step layout: ONE step for the whole sweep, same rationale as
 * generate-rent-cycles — `generateDailyDigests` is structurally
 * idempotent (uq_daily_digests_org_date + 23505-as-skip), so per-org
 * steps would only buy partial-retry granularity we don't need at
 * 5–50-unit-landlord scale while costing an unbounded step count. If a
 * single org's insert throws, Inngest retries the whole step and every
 * already-written org resolves as `skipped`.
 *
 * This function is SDK-free, so it is served from the Vercel app
 * (src/app/api/inngest/route.ts) — NOT the Railway worker.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { inngest } from '@/lib/inngest/client';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateDailyDigests,
  type GenerateDailyDigestsResult,
} from '@/lib/digest/generate';

export const GENERATE_DAILY_DIGEST_FN_ID = 'generate-daily-digest';
export const GENERATE_DAILY_DIGEST_CRON = '30 9 * * *';

// ---------------------------------------------------------------------------
// Pure runner — exercised directly by unit tests with a mocked step.
// ---------------------------------------------------------------------------

/**
 * Subset of Inngest's `step` API we use. Defining it locally lets tests
 * pass a hand-rolled stub that resolves immediately without spinning up
 * an Inngest runtime.
 */
export interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
}

export interface GenerateDailyDigestDeps {
  /** Service-role client. Defaults to a fresh `createAdminClient()`. */
  db?: SupabaseClient<Database>;
  /** Hook for tests; defaults to the real `generateDailyDigests`. */
  generateDailyDigestsImpl?: typeof generateDailyDigests;
  /** Clock — defaults to real `new Date()`. */
  now?: () => Date;
}

export interface GenerateDailyDigestInput {
  step: StepLike;
  deps?: GenerateDailyDigestDeps;
}

/**
 * One daily sweep: snapshot the trailing 24h for all orgs.
 */
export async function runGenerateDailyDigests(
  input: GenerateDailyDigestInput,
): Promise<GenerateDailyDigestsResult> {
  const { step } = input;
  const deps = input.deps ?? {};
  const db = deps.db ?? createAdminClient();
  const generate = deps.generateDailyDigestsImpl ?? generateDailyDigests;
  const now = deps.now ?? ((): Date => new Date());

  return step.run('generate-daily-digests', () => generate(db, { now: now() }));
}

// ---------------------------------------------------------------------------
// Inngest function — thin wrapper around runGenerateDailyDigests
// ---------------------------------------------------------------------------

export const generateDailyDigestCron = inngest.createFunction(
  {
    id: GENERATE_DAILY_DIGEST_FN_ID,
    triggers: [{ cron: GENERATE_DAILY_DIGEST_CRON }],
  },
  async ({ step }) => {
    return runGenerateDailyDigests({ step: step as unknown as StepLike });
  },
);
