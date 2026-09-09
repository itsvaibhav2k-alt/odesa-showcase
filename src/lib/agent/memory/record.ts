/**
 * recordFact — write a typed fact to the `memory_facts` table.
 *
 * Callers (the reflection / synthesis loops, owner-rule extraction, the
 * worker outcome path) hand in a `MemoryFactInsert`; this module derives
 * the org_id from the property, stamps defaults, and inserts.
 *
 * RLS is enforced on `memory_facts` (see migration 20260428000001), so
 * background-job callers must pass a service-role admin client. UI-facing
 * Server Actions can pass the SSR server client; the policy will gate by
 * `current_user_org_id()`.
 */

import {
  FACT_TYPE_DEFAULTS,
  type MemoryFact,
  type MemoryFactInsert,
} from './types';
import { rowToFact, type MemoryFactRow } from './row';
import { embedFactContent } from './embed';

/**
 * Minimal Supabase contract `recordFact` / `query` / `decay` depend on.
 *
 * `from(table)` is typed as returning `any` deliberately:
 *   1. The real `SupabaseClient.from()` returns a `PostgrestQueryBuilder`
 *      whose chained methods return narrower types per filter; mirroring
 *      that surface in a structural type fights the SDK without buying
 *      anything for our handful of call paths.
 *   2. Both `SupabaseClient` and `SupabaseClient<Database>` are trivially
 *      assignable through this shape — meta-eng's reflection/synthesis
 *      pass the typed client; the admin/SSR clients pass without a cast.
 *   3. Tests need a plain-object mock — a permissive return type keeps
 *      that ergonomic. The mock implementation is type-checked at the
 *      mock factory's return type via `MemoryFactsBuilder` below.
 */
export interface MemoryFactsClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/**
 * Structural builder type for mocks. The runtime SupabaseClient is NOT
 * forced to satisfy this — only test mocks do — but tests still get
 * compile-time coverage on the chainable surface.
 */
export interface MemoryFactsBuilder
  extends PromiseLike<{
    data: unknown;
    error: { message: string } | null;
    count?: number | null;
  }> {
  select(cols?: string, options?: { count?: string; head?: boolean }): MemoryFactsBuilder;
  insert(row: Record<string, unknown>): MemoryFactsBuilder;
  update(
    patch: Record<string, unknown>,
    options?: { count?: string },
  ): MemoryFactsBuilder;
  eq(col: string, val: unknown): MemoryFactsBuilder;
  is(col: string, val: unknown): MemoryFactsBuilder;
  order(col: string, options?: { ascending?: boolean }): MemoryFactsBuilder;
  single(): MemoryFactsBuilder;
}

export interface RecordFactOptions {
  /** Service-role or user-scoped Supabase client. */
  db: MemoryFactsClient;
  /** Property the fact belongs to. Org is looked up from this. */
  propertyId: string;
  /** Fact body + discriminator. */
  fact: MemoryFactInsert;
  /**
   * Optional pre-computed embedding for the fact's `content`. Omission asks
   * this central path to embed once before insert. Explicit arrays and explicit
   * null both bypass that call, preventing duplicate attempts by callers that
   * already tried. Missing credentials/provider failures still persist null.
   */
  embedding?: readonly number[] | null;
}

/**
 * Look up the property's organization_id. Kept private; callers shouldn't
 * need to thread `organization_id` through every call site.
 */
async function loadOrganizationId(
  db: MemoryFactsClient,
  propertyId: string,
): Promise<string> {
  const { data, error } = await db
    .from('properties')
    .select('organization_id')
    .eq('id', propertyId)
    .single();

  if (error) {
    throw new Error(
      `[memory.record] property lookup failed for ${propertyId}: ${error.message}`,
    );
  }

  const row = data as { organization_id: string } | null;
  if (!row?.organization_id) {
    throw new Error(`[memory.record] property ${propertyId} not found`);
  }
  return row.organization_id;
}

/**
 * Insert a fact. Returns the persisted row hydrated to a typed `MemoryFact`.
 *
 * The default for `confidence` matches the SQL DEFAULT (0.5). The default
 * for `evidence_proposal_ids` is `[]` so the column is never NULL in
 * practice — simplifies array filters at query time.
 */
export async function recordFact(opts: RecordFactOptions): Promise<MemoryFact> {
  const organizationId = await loadOrganizationId(opts.db, opts.propertyId);

  let embedding = opts.embedding;
  if (embedding === undefined) {
    try {
      embedding = await embedFactContent(opts.fact.content);
    } catch {
      // embedFactContent is already null-on-failure. Keep this boundary
      // defensive so a future client regression can never block persistence.
      embedding = null;
    }
  }

  const defaults = FACT_TYPE_DEFAULTS[opts.fact.factType];
  const confidence =
    typeof opts.fact.confidence === 'number' && Number.isFinite(opts.fact.confidence)
      ? Math.max(0, Math.min(1, opts.fact.confidence))
      : defaults.importance;

  const insertRow: Record<string, unknown> = {
    organization_id: organizationId,
    property_id: opts.propertyId,
    fact_type: opts.fact.factType,
    subject_id: opts.fact.subjectId,
    content: opts.fact.content as unknown,
    confidence,
    source: opts.fact.source,
    evidence_proposal_ids: opts.fact.evidenceProposalIds
      ? [...opts.fact.evidenceProposalIds]
      : [],
  };

  // Embeddings persist as pgvector literal (`[0.1,0.2,...]`) — supabase-js
  // forwards strings to the `vector` column unchanged. Null is fine; the
  // backfill job picks up rows where `embedding IS NULL`.
  if (embedding && embedding.length > 0) {
    insertRow.embedding = `[${embedding.join(',')}]`;
  }

  const { data, error } = await opts.db
    .from('memory_facts')
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    throw new Error(`[memory.record] insert failed: ${error.message}`);
  }

  return rowToFact(data as MemoryFactRow);
}
