/**
 * Unit tests for the daily-digest generator sweep.
 *
 * Drives `generateDailyDigests` against a recording supabase stub
 * (mirrors src/lib/rent/__tests__/generate-cycle.test.ts). Cases:
 *   1. one org → one daily_digests insert carrying the window, the
 *      sections version, and schema-valid sections.
 *   2. window filters: every time-windowed source query carries
 *      [window_start, window_end) bounds and the org filter.
 *   3. 23505 unique-violation on insert (re-run / concurrent race) →
 *      counted as skipped, sweep continues.
 *   4. non-23505 insert error → throws.
 *   5. multiple orgs → one insert per org.
 *   6. organizationId option scopes the org query.
 *   7. organizations query error → throws before any inserts.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { digestSectionsSchema, SECTIONS_VERSION } from '../types';
import { generateDailyDigests } from '../generate';

const FIXED_NOW = new Date('2026-06-11T09:30:00.000Z');
const WINDOW_START = '2026-06-10T09:30:00.000Z';
const WINDOW_END = '2026-06-11T09:30:00.000Z';
const GALAXY = '11111111-1111-1111-1111-111111111101';
const ORG_2 = '11111111-1111-1111-1111-111111111102';

// ---------------------------------------------------------------------------
// db stub — records every terminated query; a responder supplies results
// ---------------------------------------------------------------------------

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert';
  columns: string | null;
  rows: Array<Record<string, unknown>> | null;
  /** Filter calls in order: ['eq'|'in'|'gte'|'lt', col, val]. */
  filters: Array<[string, ...unknown[]]>;
}

type Responder = (q: RecordedQuery) => {
  data: unknown;
  error: { message: string; code?: string } | null;
};

function makeDb(
  recorded: RecordedQuery[],
  respond: Responder,
): SupabaseClient<Database> {
  return {
    from: vi.fn((table: string) => {
      const q: RecordedQuery = {
        table,
        op: 'select',
        columns: null,
        rows: null,
        filters: [],
      };
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        q.columns = columns;
        return builder;
      };
      builder.insert = (
        rows: Record<string, unknown> | Array<Record<string, unknown>>,
      ) => {
        q.op = 'insert';
        q.rows = Array.isArray(rows) ? rows : [rows];
        return builder;
      };
      for (const filter of ['eq', 'in', 'gte', 'lt'] as const) {
        builder[filter] = (col: string, val: unknown) => {
          q.filters.push([filter, col, val]);
          return builder;
        };
      }
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.then = (
        fulfilled?: (v: ReturnType<Responder>) => unknown,
      ): Promise<unknown> => {
        recorded.push(q);
        const result = respond(q);
        return Promise.resolve(fulfilled ? fulfilled(result) : result);
      };
      return builder;
    }),
  } as unknown as SupabaseClient<Database>;
}

/** Responder: orgs select → fixtures; all source selects → empty; insert → ok. */
function respondWith(options: {
  orgs: Array<{ id: string }>;
  insertError?: { message: string; code?: string };
  orgError?: { message: string };
}): Responder {
  return (q) => {
    if (q.table === 'organizations' && q.op === 'select') {
      if (options.orgError) return { data: null, error: options.orgError };
      return { data: options.orgs, error: null };
    }
    if (q.table === 'daily_digests' && q.op === 'insert') {
      return { data: null, error: options.insertError ?? null };
    }
    return { data: [], error: null };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateDailyDigests', () => {
  it('should insert one schema-valid digest row per org carrying the window and version', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ orgs: [{ id: GALAXY }] }));

    const result = await generateDailyDigests(db, { now: FIXED_NOW });

    expect(result).toEqual({
      digestDate: '2026-06-11',
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      orgs: 1,
      created: 1,
      skipped: 0,
    });

    const insert = recorded.find((r) => r.op === 'insert');
    expect(insert?.table).toBe('daily_digests');
    const row = insert?.rows?.[0];
    expect(row).toMatchObject({
      organization_id: GALAXY,
      digest_date: '2026-06-11',
      version: SECTIONS_VERSION,
      window_start: WINDOW_START,
      window_end: WINDOW_END,
    });
    expect(() => digestSectionsSchema.parse(row?.sections)).not.toThrow();
  });

  it('should scope every time-windowed source query to the org and the [start, end) window', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ orgs: [{ id: GALAXY }] }));

    await generateDailyDigests(db, { now: FIXED_NOW });

    const windowed = [
      ['rent_events', 'updated_at'],
      ['agent_runs', 'finished_at'],
      ['scheduled_actions', 'fired_at'],
    ] as const;
    for (const [table, column] of windowed) {
      const query = recorded.find((r) => r.table === table && r.op === 'select');
      expect(query, table).toBeDefined();
      expect(query?.filters).toContainEqual(['eq', 'organization_id', GALAXY]);
      expect(query?.filters).toContainEqual(['gte', column, WINDOW_START]);
      expect(query?.filters).toContainEqual(['lt', column, WINDOW_END]);
    }

    // work_orders is queried twice: opened (created_at) and closed (updated_at).
    const woQueries = recorded.filter(
      (r) => r.table === 'work_orders' && r.op === 'select',
    );
    expect(woQueries).toHaveLength(2);
    const flatFilters = woQueries.flatMap((r) => r.filters);
    expect(flatFilters).toContainEqual(['gte', 'created_at', WINDOW_START]);
    expect(flatFilters).toContainEqual(['lt', 'updated_at', WINDOW_END]);
    expect(flatFilters).toContainEqual(['in', 'status', ['completed', 'cancelled']]);

    // drafts are a point-in-time snapshot — no window, just the status filter.
    const drafts = recorded.find((r) => r.table === 'messages');
    expect(drafts?.filters).toContainEqual(['eq', 'draft_status', 'pending_review']);
    expect(drafts?.filters).toContainEqual(['eq', 'organization_id', GALAXY]);
  });

  it('should count a 23505 unique-violation as skipped when the digest already exists', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        orgs: [{ id: GALAXY }],
        insertError: { message: 'duplicate key value', code: '23505' },
      }),
    );

    const result = await generateDailyDigests(db, { now: FIXED_NOW });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.orgs).toBe(1);
  });

  it('should throw when the insert fails with a non-23505 error', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({
        orgs: [{ id: GALAXY }],
        insertError: { message: 'permission denied', code: '42501' },
      }),
    );

    await expect(generateDailyDigests(db, { now: FIXED_NOW })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('should insert one digest per org when multiple orgs exist', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({ orgs: [{ id: GALAXY }, { id: ORG_2 }] }),
    );

    const result = await generateDailyDigests(db, { now: FIXED_NOW });

    expect(result.orgs).toBe(2);
    expect(result.created).toBe(2);
    const inserts = recorded.filter((r) => r.op === 'insert');
    expect(inserts.map((r) => r.rows?.[0]?.organization_id)).toEqual([
      GALAXY,
      ORG_2,
    ]);
  });

  it('should scope the org query when organizationId is provided', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(recorded, respondWith({ orgs: [{ id: GALAXY }] }));

    await generateDailyDigests(db, { now: FIXED_NOW, organizationId: GALAXY });

    const orgSelect = recorded.find((r) => r.table === 'organizations');
    expect(orgSelect?.filters).toContainEqual(['eq', 'id', GALAXY]);
  });

  it('should throw without inserting when the organizations query fails', async () => {
    const recorded: RecordedQuery[] = [];
    const db = makeDb(
      recorded,
      respondWith({ orgs: [], orgError: { message: 'connection refused' } }),
    );

    await expect(generateDailyDigests(db, { now: FIXED_NOW })).rejects.toThrow(
      /connection refused/,
    );
    expect(recorded.some((r) => r.op === 'insert')).toBe(false);
  });
});
