/**
 * generate-rent-cycles — daily cron that rolls the rent ledger into the
 * current month.
 *
 * Runs every day at 06:00 UTC (NOT just on the 1st): each tick
 * (re)generates the CURRENT month's rent_events for every org via
 * `generateRentCycle`. Because generation is structurally idempotent
 * (uq_rent_events_lease_cycle + pre-read + 23505-as-skip), a daily
 * sweep is nearly free after the 1st — and it self-heals missed runs
 * and picks up leases created mid-month without any extra machinery.
 *
 * Step layout: ONE step for the whole sweep rather than one per org.
 * generateRentCycle is already safe to re-run wholesale, so per-org
 * steps would only buy partial-retry granularity we don't need at
 * 5–50-unit-landlord scale, while costing an unbounded step count as
 * orgs grow. If a single org's insert ever throws, Inngest retries the
 * whole step and every already-written org resolves as `skipped`.
 *
 * Relationship to rent-cycle-daily (08:00 UTC): that cron advances the
 * rent_event state machine and also upserts current-month rows, but
 * its upsert overwrites amount_paid/status on conflict. This function
 * is the canonical generator; see the report accompanying its
 * introduction for the recommended cleanup of the legacy emit step.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { inngest } from '@/lib/inngest/client';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  generateRentCycle,
  type GenerateRentCycleResult,
} from '@/lib/rent/generate-cycle';

export const GENERATE_RENT_CYCLES_FN_ID = 'generate-rent-cycles';
export const GENERATE_RENT_CYCLES_CRON = '0 6 * * *';

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

export interface GenerateRentCyclesDeps {
  /** Service-role client. Defaults to a fresh `createAdminClient()`. */
  db?: SupabaseClient<Database>;
  /** Hook for tests; defaults to the real `generateRentCycle`. */
  generateRentCycleImpl?: typeof generateRentCycle;
  /** Clock — defaults to real `new Date()`. */
  now?: () => Date;
}

export interface GenerateRentCyclesInput {
  step: StepLike;
  deps?: GenerateRentCyclesDeps;
}

/**
 * One daily sweep: generate the current UTC month for all orgs.
 *
 * The period is derived in UTC; at 06:00 UTC every US timezone is
 * already inside the same calendar month, so "current UTC month" and
 * "current org-local month" agree at fire time.
 */
export async function runGenerateRentCycles(
  input: GenerateRentCyclesInput,
): Promise<GenerateRentCycleResult> {
  const { step } = input;
  const deps = input.deps ?? {};
  const db = deps.db ?? createAdminClient();
  const generate = deps.generateRentCycleImpl ?? generateRentCycle;
  const now = deps.now ?? ((): Date => new Date());

  const period = currentUtcPeriod(now());
  return step.run('generate-current-month', () => generate(db, { period }));
}

/** 'YYYY-MM' for the given instant, in UTC. */
function currentUtcPeriod(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// ---------------------------------------------------------------------------
// Inngest function — thin wrapper around runGenerateRentCycles
// ---------------------------------------------------------------------------

export const generateRentCyclesCron = inngest.createFunction(
  {
    id: GENERATE_RENT_CYCLES_FN_ID,
    triggers: [{ cron: GENERATE_RENT_CYCLES_CRON }],
  },
  async ({ step }) => {
    return runGenerateRentCycles({ step: step as unknown as StepLike });
  },
);
