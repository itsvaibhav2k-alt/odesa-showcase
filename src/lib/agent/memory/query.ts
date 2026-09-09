/**
 * Memory query surface. Two read paths:
 *
 *   1. `getActiveFacts(propertyId, factType?)` — non-superseded facts for
 *      the property. This is the worker's primary read; results feed into
 *      `buildWorkerSystemPrompt(context)`.
 *   2. `supersedeFact(currentId, replacementId)` — soft-delete the older
 *      fact when a new one replaces it. Used by reflection/synthesis loops
 *      and by the compaction job.
 *
 * Both default to a service-role admin client so background callers work,
 * but UI Server Actions can pass the SSR client and rely on RLS.
 */

import type { FactType, MemoryFact } from './types';
import { rowToFact, type MemoryFactRow } from './row';
import type { MemoryFactsClient } from './record';

export type { MemoryFactsClient } from './record';

export interface GetActiveFactsOptions {
  db: MemoryFactsClient;
  propertyId: string;
  /** Optional discriminator filter. Omit for all active facts. */
  factType?: FactType;
}

/**
 * Active facts = `superseded_at IS NULL`. Sorted newest-first so the
 * worker's prompt builder can take the most recent evidence per subject.
 */
export async function getActiveFacts(
  opts: GetActiveFactsOptions,
): Promise<MemoryFact[]> {
  let query = opts.db
    .from('memory_facts')
    .select('*')
    .eq('property_id', opts.propertyId)
    .is('superseded_at', null)
    .order('created_at', { ascending: false });

  if (opts.factType) {
    query = query.eq('fact_type', opts.factType);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`[memory.query] getActiveFacts failed: ${error.message}`);
  }
  const rows = (data ?? []) as MemoryFactRow[];
  return rows.map(rowToFact);
}

export interface SupersedeFactOptions {
  db: MemoryFactsClient;
  /** Older fact being replaced (gets `superseded_at = NOW()`). */
  currentId: string;
  /** Newer fact ID, or null if simply archiving. */
  replacementId: string | null;
}

/**
 * Mark a fact as no longer active. Idempotent: passing an already-
 * superseded ID is a no-op (Supabase update with no matching rows just
 * returns no error). Returns the count of rows updated for callers that
 * want to assert it actually happened.
 */
export async function supersedeFact(
  opts: SupersedeFactOptions,
): Promise<number> {
  const now = new Date().toISOString();
  const { error, count } = await opts.db
    .from('memory_facts')
    .update(
      {
        superseded_at: now,
        superseded_by: opts.replacementId,
      },
      { count: 'exact' },
    )
    .eq('id', opts.currentId)
    .is('superseded_at', null);

  if (error) {
    throw new Error(`[memory.query] supersedeFact failed: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * Convenience: count of active facts per fact_type, used by the decay
 * loop to enforce the per-property cap.
 */
export async function countActiveFacts(
  opts: GetActiveFactsOptions,
): Promise<number> {
  let query = opts.db
    .from('memory_facts')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', opts.propertyId)
    .is('superseded_at', null);

  if (opts.factType) {
    query = query.eq('fact_type', opts.factType);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`[memory.query] countActiveFacts failed: ${error.message}`);
  }
  return count ?? 0;
}
