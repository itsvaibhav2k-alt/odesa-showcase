/**
 * Unit tests for the daily-health-check Inngest cron.
 *
 * Mirrors the generate-daily-digest test surface: a registration smoke
 * (id + cron trigger) plus the pure runner `runDailyHealthCheck`
 * driven against a StepLike stub with an injected sweep impl.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type {
  RunHealthChecksOptions,
  RunHealthChecksResult,
} from '@/lib/health/generate';
import {
  dailyHealthCheckCron,
  runDailyHealthCheck,
  DAILY_HEALTH_CHECK_CRON,
  DAILY_HEALTH_CHECK_FN_ID,
  type StepLike,
} from '../daily-health-check';

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

function fakeResult(
  overrides: Partial<RunHealthChecksResult> = {},
): RunHealthChecksResult {
  return {
    orgs: 2,
    candidates: 3,
    created: 3,
    skippedOpen: 0,
    skippedRace: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — registration
// ---------------------------------------------------------------------------

describe('dailyHealthCheckCron registration', () => {
  it('should expose the expected id', () => {
    expect(dailyHealthCheckCron.id()).toBe(DAILY_HEALTH_CHECK_FN_ID);
    expect(DAILY_HEALTH_CHECK_FN_ID).toBe('daily-health-check');
  });

  it('should run daily at 10:00 UTC', () => {
    const triggers = dailyHealthCheckCron.opts.triggers ?? [];
    const crons = triggers
      .map((t) => ('cron' in t ? t.cron : null))
      .filter(Boolean);
    expect(crons).toContain(DAILY_HEALTH_CHECK_CRON);
    expect(DAILY_HEALTH_CHECK_CRON).toBe('0 10 * * *');
  });
});

// ---------------------------------------------------------------------------
// Tests — runner
// ---------------------------------------------------------------------------

describe('runDailyHealthCheck', () => {
  it('should sweep all orgs in one step with the injected clock', async () => {
    const step = makeStep();
    const calls: RunHealthChecksOptions[] = [];

    const result = await runDailyHealthCheck({
      step,
      deps: {
        db: FAKE_DB,
        now: (): Date => new Date('2026-06-11T10:00:00.000Z'),
        runHealthChecksImpl: async (
          _db,
          options,
        ): Promise<RunHealthChecksResult> => {
          calls.push(options);
          return fakeResult();
        },
      },
    });

    expect(step.ids).toEqual(['run-health-checks']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.now.toISOString()).toBe('2026-06-11T10:00:00.000Z');
    expect(result.created).toBe(3);
  });

  it('should report already-open flags as skipped counts, not errors', async () => {
    const step = makeStep();

    const result = await runDailyHealthCheck({
      step,
      deps: {
        db: FAKE_DB,
        now: (): Date => new Date('2026-06-11T10:00:00.000Z'),
        runHealthChecksImpl: async (): Promise<RunHealthChecksResult> =>
          fakeResult({ created: 0, skippedOpen: 2, skippedRace: 1 }),
      },
    });

    expect(result.created).toBe(0);
    expect(result.skippedOpen).toBe(2);
    expect(result.skippedRace).toBe(1);
  });
});
