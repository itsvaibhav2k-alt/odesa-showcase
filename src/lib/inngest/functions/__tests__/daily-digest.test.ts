/**
 * Unit tests for the generate-daily-digest Inngest cron.
 *
 * Mirrors the generate-rent-cycles test surface: a registration smoke
 * (id + cron trigger) plus the pure runner `runGenerateDailyDigests`
 * driven against a StepLike stub with an injected generator impl.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import type {
  GenerateDailyDigestsOptions,
  GenerateDailyDigestsResult,
} from '@/lib/digest/generate';
import {
  generateDailyDigestCron,
  runGenerateDailyDigests,
  GENERATE_DAILY_DIGEST_CRON,
  GENERATE_DAILY_DIGEST_FN_ID,
  type StepLike,
} from '../daily-digest';

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
  overrides: Partial<GenerateDailyDigestsResult> = {},
): GenerateDailyDigestsResult {
  return {
    digestDate: '2026-06-11',
    windowStart: '2026-06-10T09:30:00.000Z',
    windowEnd: '2026-06-11T09:30:00.000Z',
    orgs: 2,
    created: 2,
    skipped: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — registration
// ---------------------------------------------------------------------------

describe('generateDailyDigestCron registration', () => {
  it('should expose the expected id', () => {
    expect(generateDailyDigestCron.id()).toBe(GENERATE_DAILY_DIGEST_FN_ID);
    expect(GENERATE_DAILY_DIGEST_FN_ID).toBe('generate-daily-digest');
  });

  it('should run daily at 09:30 UTC', () => {
    const triggers = generateDailyDigestCron.opts.triggers ?? [];
    const crons = triggers
      .map((t) => ('cron' in t ? t.cron : null))
      .filter(Boolean);
    expect(crons).toContain(GENERATE_DAILY_DIGEST_CRON);
    expect(GENERATE_DAILY_DIGEST_CRON).toBe('30 9 * * *');
  });
});

// ---------------------------------------------------------------------------
// Tests — runner
// ---------------------------------------------------------------------------

describe('runGenerateDailyDigests', () => {
  it('should sweep all orgs in one step with the injected clock', async () => {
    const step = makeStep();
    const calls: GenerateDailyDigestsOptions[] = [];

    const result = await runGenerateDailyDigests({
      step,
      deps: {
        db: FAKE_DB,
        now: (): Date => new Date('2026-06-11T09:30:00.000Z'),
        generateDailyDigestsImpl: async (
          _db,
          options,
        ): Promise<GenerateDailyDigestsResult> => {
          calls.push(options);
          return fakeResult();
        },
      },
    });

    expect(step.ids).toEqual(['generate-daily-digests']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.now.toISOString()).toBe('2026-06-11T09:30:00.000Z');
    expect(result.created).toBe(2);
    expect(result.digestDate).toBe('2026-06-11');
  });

  it('should report idempotent re-runs as skipped counts, not errors', async () => {
    const step = makeStep();

    const result = await runGenerateDailyDigests({
      step,
      deps: {
        db: FAKE_DB,
        now: (): Date => new Date('2026-06-11T09:30:00.000Z'),
        generateDailyDigestsImpl: async (): Promise<GenerateDailyDigestsResult> =>
          fakeResult({ created: 0, skipped: 2 }),
      },
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(2);
  });
});
