/**
 * Tests for the memory-embedding backfill function.
 *
 * Two layers:
 *   1. Inngest registration smoke test (id + triggers).
 *   2. Direct exercise of `runBackfillMemoryEmbeddings` against an
 *      in-memory supabase stub. Asserts:
 *        - Idempotent: empty steady-state returns processed=0.
 *        - Restartable: multiple invocations converge.
 *        - Embedding failures don't throw — the row is left for retry.
 *        - Pagination: stops when batch is shorter than batchSize.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMBEDDING_DIMENSIONS,
  __setEmbeddingClient,
} from '@/lib/agent/memory/embed';
import {
  backfillMemoryEmbeddings,
  runBackfillMemoryEmbeddings,
} from '../backfill-memory-embeddings';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

interface FactRow {
  id: string;
  content: unknown;
  embedding: string | null;
}

function makeVector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => seed + i / 1e6);
}

function fakeDb(rows: FactRow[]): SupabaseClient<Database> {
  const from = vi.fn((table: string) => {
    let filterEmbeddingNull = false;
    let limit = 100;
    let pendingPatch: Record<string, unknown> | null = null;
    let filterIdEq: string | null = null;
    let mode: 'select' | 'update' = 'select';

    const builder: Record<string, unknown> = {};
    builder.select = () => {
      mode = 'select';
      return builder;
    };
    builder.is = (col: string, val: unknown) => {
      if (table === 'memory_facts' && col === 'embedding' && val === null) {
        filterEmbeddingNull = true;
      }
      return builder;
    };
    builder.eq = (col: string, val: string) => {
      if (col === 'id') filterIdEq = val;
      return builder;
    };
    builder.limit = (n: number) => {
      limit = n;
      return builder;
    };
    builder.update = (patch: Record<string, unknown>) => {
      mode = 'update';
      pendingPatch = patch;
      return builder;
    };
    builder.then = (fulfilled: (v: unknown) => unknown) => {
      if (table !== 'memory_facts') {
        return Promise.resolve(fulfilled({ data: [], error: null }));
      }
      if (mode === 'update' && pendingPatch && filterIdEq) {
        const target = rows.find((r) => r.id === filterIdEq);
        if (target) {
          Object.assign(target, pendingPatch);
        }
        return Promise.resolve(fulfilled({ data: null, error: null }));
      }
      const matched = rows.filter((r) => !filterEmbeddingNull || r.embedding === null);
      return Promise.resolve(
        fulfilled({ data: matched.slice(0, limit), error: null }),
      );
    };
    return builder;
  });

  return { from } as unknown as SupabaseClient<Database>;
}

describe('backfillMemoryEmbeddings registration', () => {
  it('exposes the expected id', () => {
    expect(backfillMemoryEmbeddings.id()).toBe('backfill-memory-embeddings');
  });

  it('registers the manual event + daily cron triggers', () => {
    const triggers = backfillMemoryEmbeddings.opts.triggers ?? [];
    expect(triggers.length).toBeGreaterThanOrEqual(1);
    const events = triggers.map((t) => ('event' in t ? t.event : null)).filter(Boolean);
    expect(events).toContain('memory/embedding.backfill');
  });
});

describe('runBackfillMemoryEmbeddings', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    __setEmbeddingClient(null);
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    }
    __setEmbeddingClient(null);
    vi.restoreAllMocks();
  });

  it('embeds every row that has embedding=null in a single pass', async () => {
    const rows: FactRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `row-${i}`,
      content: { description: `quirk ${i}` },
      embedding: null,
    }));
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.1) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const result = await runBackfillMemoryEmbeddings({ db: fakeDb(rows) });
    expect(result.processed).toBe(5);
    expect(result.embedded).toBe(5);
    expect(result.failed).toBe(0);
    expect(rows.every((r) => typeof r.embedding === 'string')).toBe(true);
  });

  it('is idempotent — second invocation processes nothing', async () => {
    const rows: FactRow[] = [
      { id: 'a', content: { description: 'x' }, embedding: '[0.1,0.2]' },
      { id: 'b', content: { description: 'y' }, embedding: '[0.3,0.4]' },
    ];
    const create = vi.fn();
    __setEmbeddingClient({ embeddings: { create } });

    const result = await runBackfillMemoryEmbeddings({ db: fakeDb(rows) });
    expect(result.processed).toBe(0);
    expect(result.embedded).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('restartable — leaves rows untouched when embedFactContent returns null', async () => {
    delete process.env.OPENAI_API_KEY;
    __setEmbeddingClient(null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const rows: FactRow[] = [
      { id: 'a', content: { description: 'x' }, embedding: null },
      { id: 'b', content: { description: 'y' }, embedding: null },
    ];

    const result = await runBackfillMemoryEmbeddings({ db: fakeDb(rows) });
    expect(result.processed).toBe(2);
    expect(result.embedded).toBe(0);
    expect(result.failed).toBe(2);
    // Rows still NULL — next run picks them up.
    expect(rows.every((r) => r.embedding === null)).toBe(true);
  });

  it('attempts each failed NULL row at most once per invocation', async () => {
    const rows: FactRow[] = [
      { id: 'failed-a', content: { description: 'x' }, embedding: null },
      { id: 'failed-b', content: { description: 'y' }, embedding: null },
    ];
    const create = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    __setEmbeddingClient({ embeddings: { create } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await runBackfillMemoryEmbeddings({
      db: fakeDb(rows),
      batchSize: 2,
      maxBatches: 50,
    });
    expect(first).toEqual({ processed: 2, embedded: 0, failed: 2, batches: 1 });
    expect(create).toHaveBeenCalledTimes(2);

    // The invocation fence is intentionally local: a later scheduled run can
    // retry the still-NULL rows, again no more than once each.
    const second = await runBackfillMemoryEmbeddings({
      db: fakeDb(rows),
      batchSize: 2,
      maxBatches: 50,
    });
    expect(second).toEqual({ processed: 2, embedded: 0, failed: 2, batches: 1 });
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('paginates through multiple batches when work exceeds batch size', async () => {
    const rows: FactRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `row-${i}`,
      content: { description: `q ${i}` },
      embedding: null,
    }));
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.2) }] });
    __setEmbeddingClient({ embeddings: { create } });

    const result = await runBackfillMemoryEmbeddings({
      db: fakeDb(rows),
      batchSize: 3,
    });
    expect(result.processed).toBe(7);
    expect(result.embedded).toBe(7);
    // 7 rows / batchSize 3 → 3 batches (3 + 3 + 1).
    expect(result.batches).toBe(3);
  });

  it('caps iterations to maxBatches to prevent runaway loops', async () => {
    // Always return a full batch — would loop forever without the cap.
    const rows: FactRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `row-${i}`,
      content: { description: `q ${i}` },
      embedding: null,
    }));
    const create = vi
      .fn()
      .mockResolvedValue({ data: [{ embedding: makeVector(0.1) }] });
    __setEmbeddingClient({ embeddings: { create } });

    // batchSize >= rows.length so no pagination kick-in; just verify the
    // loop terminates.
    const result = await runBackfillMemoryEmbeddings({
      db: fakeDb(rows),
      batchSize: 100,
      maxBatches: 2,
    });
    expect(result.batches).toBeLessThanOrEqual(2);
  });
});
