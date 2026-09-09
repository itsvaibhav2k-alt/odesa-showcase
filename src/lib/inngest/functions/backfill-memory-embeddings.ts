/**
 * Backfill missing embeddings on `memory_facts`.
 *
 * Runs as both an Inngest event handler (`memory/embedding.backfill`) and
 * a hand-callable function (so a unit test can drive it without an Inngest
 * runtime). Idempotent + restartable: each invocation pulls a batch of
 * rows where `embedding IS NULL`, computes embeddings, writes them back.
 * If the function is killed mid-batch the next invocation just picks up
 * the survivors.
 *
 * Sized for Galaxy's current scale (<200 facts) — completes in a few
 * seconds. The loop exits when the page returns 0 rows so we don't burn
 * on an empty steady-state.
 *
 * Failure modes:
 *   - `embedFactContent` returns null → the row is left with NULL embedding
 *     and the next run retries it. No exception escapes.
 *   - Update errors are logged and counted; the loop continues so a single
 *     bad row doesn't poison the whole batch.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';
import { embedFactContent } from '@/lib/agent/memory/embed';
import { inngest } from '@/lib/inngest/client';

export const BACKFILL_BATCH_SIZE = 100;
export const BACKFILL_MAX_BATCHES = 50;

export interface BackfillRunResult {
  processed: number;
  embedded: number;
  failed: number;
  batches: number;
}

interface BackfillRow {
  id: string;
  content: unknown;
}

export interface RunBackfillOptions {
  /** Service-role client. */
  db: SupabaseClient<Database>;
  /** Override batch size for tests; defaults to 100. */
  batchSize?: number;
  /** Cap on iterations to prevent runaway loops. Defaults to 50 (= 5000 rows). */
  maxBatches?: number;
}

/**
 * Drive the backfill loop directly. Public so tests + manual scripts can
 * invoke it without spinning up Inngest.
 */
export async function runBackfillMemoryEmbeddings(
  opts: RunBackfillOptions,
): Promise<BackfillRunResult> {
  const batchSize = opts.batchSize ?? BACKFILL_BATCH_SIZE;
  const maxBatches = opts.maxBatches ?? BACKFILL_MAX_BATCHES;

  let processed = 0;
  let embedded = 0;
  let failed = 0;
  let batches = 0;
  // Invocation-scoped fence: failed/update-error rows stay NULL for a later
  // scheduled run, but no row can consume the retry budget twice in this run.
  const attemptedIds = new Set<string>();

  for (let i = 0; i < maxBatches; i++) {
    const { data, error } = await opts.db
      .from('memory_facts')
      .select('id, content')
      .is('embedding', null)
      .limit(batchSize);

    if (error) {
      throw new Error(
        `[backfill-embeddings] select failed: ${error.message}`,
      );
    }

    const rows = (data ?? []) as BackfillRow[];
    if (rows.length === 0) break;

    const unattemptedRows = rows.filter((row) => !attemptedIds.has(row.id));
    if (unattemptedRows.length === 0) break;
    batches++;

    for (const row of unattemptedRows) {
      attemptedIds.add(row.id);
      processed++;
      const embedding = await embedFactContent((row.content ?? {}) as object);
      if (!embedding) {
        // Embedding service returned null (missing key, timeout, etc.).
        // Leave the row alone; next run picks it up.
        failed++;
        continue;
      }

      const literal = `[${embedding.join(',')}]`;
      const { error: updateError } = await opts.db
        .from('memory_facts')
        // Cast: generated Database types don't carry the new `embedding`
        // column yet (next supabase gen types run will refresh them).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ embedding: literal } as any)
        .eq('id', row.id);

      if (updateError) {
        console.error(
          `[backfill-embeddings] update failed for ${row.id}: ${updateError.message}`,
        );
        failed++;
        continue;
      }
      embedded++;
    }

    // If we got fewer rows than batchSize, we're done.
    if (rows.length < batchSize) break;
  }

  return { processed, embedded, failed, batches };
}

/**
 * Inngest function — triggered manually via the `memory/embedding.backfill`
 * event or on a daily cron. Idempotent: no-op when no rows have
 * `embedding IS NULL`.
 */
export const backfillMemoryEmbeddings = inngest.createFunction(
  {
    id: 'backfill-memory-embeddings',
    triggers: [
      { event: 'memory/embedding.backfill' },
      // Daily safety net — pick up any rows that failed earlier in the day.
      { cron: '0 4 * * *' },
    ],
  },
  async ({ step }) => {
    const db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const result = await step.run('backfill', () =>
      runBackfillMemoryEmbeddings({ db }),
    );

    return result;
  },
);
