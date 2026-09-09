/**
 * Unit tests for the generate-rent-cycles Inngest cron.
 *
 * Mirrors the agent-run-watchdog test surface: a registration smoke
 * (id + cron trigger) plus the pure runner `runGenerateRentCycles`
 * driven against a StepLike stub with an injected generator impl.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type {
  GenerateRentCycleOptions,
  GenerateRentCycleResult,
} from '@/lib/rent/generate-cycle';
import {
  generateRentCyclesCron,
  runGenerateRentCycles,
  GENERATE_RENT_CYCLES_CRON,
  GENERATE_RENT_CYCLES_FN_ID,
  type StepLike,
} from '../generate-rent-cycles';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeStep(): StepLike & { ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    async run<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
      ids.push(id);
      return fn();
    },
  };
}

const FAKE_DB = {} as SupabaseClient<Database>;

function fakeResult(period: string): GenerateRentCycleResult {
  return {
    period,
    cycleMonth: `${period}-01`,
    leases: 9,
    created: 9,
    skipped: 0,
    skippedNoAmount: 0,
    skippedOutOfTerm: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests — registration
// ---------------------------------------------------------------------------

describe('generateRentCyclesCron registration', () => {
  it('should expose the expected id', () => {
    expect(generateRentCyclesCron.id()).toBe(GENERATE_RENT_CYCLES_FN_ID);
    expect(GENERATE_RENT_CYCLES_FN_ID).toBe('generate-rent-cycles');
  });

  it('should run daily at 06:00 UTC', () => {
    const triggers = generateRentCyclesCron.opts.triggers ?? [];
    const crons = triggers
      .map((t) => ('cron' in t ? t.cron : null))
      .filter(Boolean);
    expect(crons).toContain(GENERATE_RENT_CYCLES_CRON);
    expect(GENERATE_RENT_CYCLES_CRON).toBe('0 6 * * *');
  });
});

// ---------------------------------------------------------------------------
// Tests — runner
// ---------------------------------------------------------------------------

describe('runGenerateRentCycles', () => {
  it('should generate the current UTC month across all orgs in one step', async () => {
    const step = makeStep();
    const calls: GenerateRentCycleOptions[] = [];

    const result = await runGenerateRentCycles({
      step,
      deps: {
        db: FAKE_DB,
        now: (): Date => new Date('2026-06-10T06:00:00.000Z'),
        generateRentCycleImpl: async (
          _db,
          options,
        ): Promise<GenerateRentCycleResult> => {
          calls.push(options);
          return fakeResult(options.period);
        },
      },
    });

    expect(step.ids).toEqual(['generate-current-month']);
    expect(calls).toEqual([{ period: '2026-06' }]);
    expect(result.period).toBe('2026-06');
    expect(result.created).toBe(9);
  });

  it('should report idempotent re-runs as skipped counts, not errors', async () => {
    const step = makeStep();

    const result = await runGenerateRentCycles({
      step,
      deps: {
        db: FAKE_DB,
        now: (): Date => new Date('2026-06-10T06:00:00.000Z'),
        generateRentCycleImpl: async (
          _db,
          options,
        ): Promise<GenerateRentCycleResult> => ({
          ...fakeResult(options.period),
          created: 0,
          skipped: 9,
        }),
      },
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(9);
  });
});
