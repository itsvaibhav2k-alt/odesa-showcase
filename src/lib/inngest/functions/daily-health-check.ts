/**
 * daily-health-check — daily cron that runs the deterministic
 * portfolio health checks (Feature 5) and records one `health_flag`
 * action_proposal per finding, ALWAYS gated 'review'.
 *
 * Runs every day at 10:00 UTC — after generate-rent-cycles (06:00),
 * rent-cycle-daily (08:00), and generate-daily-digest (09:30), so the
 * morning's ledger movement has settled before we judge what is stuck.
 *
 * Step layout: ONE step for the whole sweep, same rationale as
 * generate-daily-digest — `runHealthChecks` is structurally idempotent
 * (per-org open-flag pre-read + the uq_action_proposals_open_health_flag
 * partial unique index with 23505-as-skip), so a whole-step retry just
 * resolves already-flagged findings as skipped.
 *
 * This function is SDK-free, so it is served from the Vercel app
 * (src/app/api/inngest/route.ts) — NOT the Railway worker.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { inngest } from '@/lib/inngest/client';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  runHealthChecks,
  type RunHealthChecksResult,
} from '@/lib/health/generate';

export const DAILY_HEALTH_CHECK_FN_ID = 'daily-health-check';
export const DAILY_HEALTH_CHECK_CRON = '0 10 * * *';

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

export interface DailyHealthCheckDeps {
  /** Service-role client. Defaults to a fresh `createAdminClient()`. */
  db?: SupabaseClient<Database>;
  /** Hook for tests; defaults to the real `runHealthChecks`. */
  runHealthChecksImpl?: typeof runHealthChecks;
  /** Clock — defaults to real `new Date()`. */
  now?: () => Date;
}

export interface DailyHealthCheckInput {
  step: StepLike;
  deps?: DailyHealthCheckDeps;
}

/**
 * One daily sweep: detect + flag portfolio health issues for all orgs.
 */
export async function runDailyHealthCheck(
  input: DailyHealthCheckInput,
): Promise<RunHealthChecksResult> {
  const { step } = input;
  const deps = input.deps ?? {};
  const db = deps.db ?? createAdminClient();
  const run = deps.runHealthChecksImpl ?? runHealthChecks;
  const now = deps.now ?? ((): Date => new Date());

  return step.run('run-health-checks', () => run(db, { now: now() }));
}

// ---------------------------------------------------------------------------
// Inngest function — thin wrapper around runDailyHealthCheck
// ---------------------------------------------------------------------------

export const dailyHealthCheckCron = inngest.createFunction(
  {
    id: DAILY_HEALTH_CHECK_FN_ID,
    triggers: [{ cron: DAILY_HEALTH_CHECK_CRON }],
  },
  async ({ step }) => {
    return runDailyHealthCheck({ step: step as unknown as StepLike });
  },
);
