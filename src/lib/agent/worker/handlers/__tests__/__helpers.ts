/**
 * Shared test helpers for wave-6 handler unit tests.
 *
 * All handler tests use the same Supabase chainable mock pattern.
 * Centralizing here keeps each spec readable and avoids re-implementing
 * the builder per file.
 *
 * Each test queues responses per (table, operation) and the mock plays
 * them back FIFO. Operations are:
 *   - 'select' → resolved via .limit() OR .single()/.maybeSingle()
 *   - 'insert' → resolved via .single() after .select()
 *   - 'update' → resolved via .single() after .select()
 *
 * Each handler in this wave performs a small finite number of queries
 * per call, so queueing per table is sufficient discrimination — every
 * spec can predict the order of queries from the handler source.
 */

import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export interface QueueResponse {
  data: unknown;
  error: { message: string } | null;
}

export interface RecordedCall {
  table: string;
  op: 'select' | 'insert' | 'update';
  eqs: Array<[string, unknown]>;
  ilikes: Array<[string, string]>;
  ins: Array<[string, ReadonlyArray<unknown>]>;
  gtes: Array<[string, unknown]>;
  iss: Array<[string, unknown]>;
  insertValues?: Record<string, unknown>;
  updateValues?: Record<string, unknown>;
}

export interface MockAdmin {
  admin: SupabaseClient<Database>;
  calls: RecordedCall[];
}

/**
 * Build a mock Supabase admin client.
 *
 * `responsesByTable` is a map of table name → queue of response objects
 * (FIFO). Each handler call dequeues one response per query against
 * that table.
 */
export function makeAdmin(
  responsesByTable: Record<string, QueueResponse[]>,
): MockAdmin {
  const calls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const queue = responsesByTable[table] ?? [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let insertValues: Record<string, unknown> | undefined;
    let updateValues: Record<string, unknown> | undefined;
    const eqs: Array<[string, unknown]> = [];
    const ilikes: Array<[string, string]> = [];
    const ins: Array<[string, ReadonlyArray<unknown>]> = [];
    const gtes: Array<[string, unknown]> = [];
    const iss: Array<[string, unknown]> = [];

    const record = (): void => {
      calls.push({
        table,
        op,
        eqs: [...eqs],
        ilikes: [...ilikes],
        ins: [...ins],
        gtes: [...gtes],
        iss: [...iss],
        insertValues,
        updateValues,
      });
    };

    let recorded = false;
    const recordOnce = (): void => {
      if (!recorded) {
        record();
        recorded = true;
      }
    };

    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      insert: vi.fn((values: Record<string, unknown>) => {
        op = 'insert';
        insertValues = values;
        return builder;
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        op = 'update';
        updateValues = values;
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        eqs.push([column, value]);
        return builder;
      }),
      ilike: vi.fn((column: string, pattern: string) => {
        ilikes.push([column, pattern]);
        return builder;
      }),
      in: vi.fn((column: string, values: ReadonlyArray<unknown>) => {
        ins.push([column, values]);
        return builder;
      }),
      gte: vi.fn((column: string, value: unknown) => {
        gtes.push([column, value]);
        return builder;
      }),
      is: vi.fn((column: string, value: unknown) => {
        iss.push([column, value]);
        return builder;
      }),
      gt: vi.fn(() => builder),
      lt: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      neq: vi.fn(() => builder),
      not: vi.fn(() => builder),
      order: vi.fn(() => builder),
      // .limit() can be either a chainable terminator (awaited directly,
      // like resolve-refs uses) or a chain step before .single() /
      // .maybeSingle(). The .then() trap below makes the builder itself
      // awaitable; .single() and .maybeSingle() resolve from the queue
      // and short-circuit the .then() trap.
      limit: vi.fn(() => builder),
      single: vi.fn(async () => {
        recordOnce();
        return queue.shift() ?? { data: null, error: null };
      }),
      maybeSingle: vi.fn(async () => {
        recordOnce();
        return queue.shift() ?? { data: null, error: null };
      }),
      then: vi.fn(
        (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resolve: (value: { data: unknown; error: unknown }) => any,
        ) => {
          recordOnce();
          const next = queue.shift() ?? { data: [], error: null };
          return Promise.resolve(resolve(next));
        },
      ),
    };

    return builder;
  });

  return {
    admin: { from } as unknown as SupabaseClient<Database>,
    calls,
  };
}

// Stable v4 UUID fixtures — Zod's .uuid() rejects all-zeros.
export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222';
export const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
export const UNIT_ID = '44444444-4444-4444-8444-444444444444';
export const TENANT_ID = '55555555-5555-4555-8555-555555555555';
export const LEASE_ID = '66666666-6666-4666-8666-666666666666';
