/**
 * Memory MCP — `recall_facts`.
 *
 * Hybrid retrieval: embed the query once, fetch the top-K cosine matches
 * via the `match_memory_facts_*` SQL RPCs, then dedupe-merge with a
 * substring scan over the same property/org's active facts. Cosine hits
 * surface synonyms ("boiler" ↔ "heating system"); substring hits cover
 * the embedding-NULL backlog and exact-keyword cases. When OPENAI_API_KEY
 * is missing or embedding fails, the path degrades cleanly to
 * substring-only — every existing test stays green.
 *
 * `recall_facts` accepts an optional `propertyName`. When supplied it
 * resolves via `resolvePropertyName` and queries facts for that property
 * only. When omitted it queries org-wide — useful for cross-property
 * queries like "what do we know about any tenant named Smith?".
 *
 * Cosine results are merged before substring; ties broken by confidence
 * DESC. Capped to `limit`. The query is intentionally generous (no
 * min-confidence filter) — operator-side recall is read-only and noisy
 * candidates are cheap to skim.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Database } from '@/types/database';
import { embedFactContent, embeddingToVectorLiteral } from '@/lib/agent/memory/embed';
import {
  getActiveFacts,
  type MemoryFactsClient,
} from '@/lib/agent/memory/query';
import { recordFact } from '@/lib/agent/memory/record';
import { rowToFact, type MemoryFactRow } from '@/lib/agent/memory/row';
import type { FactSource, FactType, MemoryFact } from '@/lib/agent/memory/types';
import type { CommitActor } from '@/lib/authz/policy';
import type { OrganizationContext } from '../org-context';
import { resolvePropertyName } from '../property-resolver';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Cosine top-K cap. Larger than `limit` so dedupe still surfaces strong substring hits. */
const COSINE_OVERFETCH_FACTOR = 2;

/** Bounds for `record_fact.factText`. Mirrors the schema description. */
const FACT_TEXT_MIN = 3;
const FACT_TEXT_MAX = 500;

export interface CreateMemoryMcpDeps {
  admin: SupabaseClient<Database>;
  organizationId: string;
  orgContext: OrganizationContext;
  /** Human actor used to keep owner-stated rules owner-authored. */
  commitActor: CommitActor;
}

export function createMemoryMcp(deps: CreateMemoryMcpDeps) {
  return createSdkMcpServer({
    name: 'odesa-operator-memory',
    version: '0.1.0',
    // 16 tools total — always in the prompt; deferral behind ToolSearch
    // costs a full model round trip per fresh conversation.
    alwaysLoad: true,
    tools: [
      tool(
        'recall_facts',
        'Search memory for facts matching the query. Returns vendor relationships, tenant patterns, building quirks, and rules. Pass propertyName to scope to one property; omit for an org-wide search. Call this early when the operator asks about a tenant or vendor.',
        {
          propertyName: z
            .string()
            .optional()
            .describe(
              'Name (or substring) of the property to scope to. Omit to search across all org properties.',
            ),
          query: z
            .string()
            .min(1)
            .describe('Keywords or topic to search for in fact content.'),
          limit: z
            .number()
            .int()
            .positive()
            .max(MAX_LIMIT)
            .optional()
            .describe(`Cap on results returned. Default ${DEFAULT_LIMIT}.`),
        },
        async (args) => {
          const limit = args.limit ?? DEFAULT_LIMIT;

          // Property-scoped recall.
          if (args.propertyName !== undefined) {
            const resolved = resolvePropertyName(
              deps.orgContext.properties,
              args.propertyName,
            );
            if (resolved.kind !== 'unique') {
              const allNames = deps.orgContext.properties.map((p) => p.name).join(', ');
              if (resolved.kind === 'none') {
                return text(
                  `No property matches '${args.propertyName}'. Org has: ${allNames}.`,
                );
              }
              const matchNames = resolved.matches.map((m) => m.name).join(', ');
              return text(
                `Multiple properties match '${args.propertyName}': ${matchNames}. Be more specific.`,
              );
            }

            const propertyId = resolved.property.id;
            let facts: MemoryFact[];
            try {
              facts = await hybridRecall({
                admin: deps.admin,
                scope: { kind: 'property', propertyId },
                query: args.query,
                limit,
              });
            } catch (err) {
              return text(
                `recall_facts failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }

            return text(JSON.stringify(toRecalledFacts(facts)));
          }

          // Org-wide recall.
          const allPropertyIds = deps.orgContext.properties.map((p) => p.id);
          if (allPropertyIds.length === 0) {
            return text('No properties in this organization.');
          }

          let facts: MemoryFact[];
          try {
            facts = await hybridRecall({
              admin: deps.admin,
              scope: {
                kind: 'org',
                organizationId: deps.organizationId,
                propertyIds: allPropertyIds,
              },
              query: args.query,
              limit,
            });
          } catch (err) {
            return text(
              `recall_facts failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }

          return text(JSON.stringify(toRecalledFacts(facts)));
        },
      ),
      tool(
        'record_fact',
        'Persist an owner-stated fact to durable memory. Use when the operator says "remember", "note that", "FYI for next time", or otherwise gives a durable instruction. Returns the new fact id.',
        {
          propertyName: z
            .string()
            .min(1)
            .describe(
              'Name (or substring) of the property the fact applies to.',
            ),
          factText: z
            .string()
            .min(FACT_TEXT_MIN)
            .max(FACT_TEXT_MAX)
            .describe(
              'The owner-stated rule or note, in their words. 3-500 chars.',
            ),
        },
        async (args) => {
          if (!canRecordOwnerFact(deps.commitActor)) {
            return text(
              'Owner approval is required to save this as an owner rule. I can prepare the note for an owner handoff.',
            );
          }

          // 1. Resolve propertyName.
          const resolved = resolvePropertyName(
            deps.orgContext.properties,
            args.propertyName,
          );
          if (resolved.kind !== 'unique') {
            const allNames = deps.orgContext.properties
              .map((p) => p.name)
              .join(', ');
            if (resolved.kind === 'none') {
              return text(
                `No property matches '${args.propertyName}'. Org has: ${allNames}.`,
              );
            }
            const matchNames = resolved.matches
              .map((m) => m.name)
              .join(', ');
            return text(
              `Multiple properties match '${args.propertyName}': ${matchNames}. Be more specific.`,
            );
          }
          const property = resolved.property;

          // 2. Insert. Confidence 1.0 — owner-stated facts carry the
          // contract; reflection/synthesis can lower this later if
          // contradicted by observation.
          try {
            const inserted = await recordFact({
              db: deps.admin as unknown as MemoryFactsClient,
              propertyId: property.id,
              fact: {
                factType: 'owner_rule',
                source: 'owner_stated',
                subjectId: null,
                content: { rule_text: args.factText, source_text: null },
                confidence: 1.0,
              },
            });
            return text(
              `Saved as memory_fact ${inserted.id} for ${property.name}.`,
            );
          } catch (err) {
            return text(
              `record_fact failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        },
      ),
    ],
  });
}

function canRecordOwnerFact(actor: CommitActor): boolean {
  return actor.kind === 'system' || actor.role === 'owner';
}

// ---------------------------------------------------------------------------
// Hybrid retrieval pipeline
// ---------------------------------------------------------------------------

type RecallScope =
  | { kind: 'property'; propertyId: string }
  | { kind: 'org'; organizationId: string; propertyIds: readonly string[] };

interface HybridRecallOptions {
  admin: SupabaseClient<Database>;
  scope: RecallScope;
  query: string;
  limit: number;
}

/**
 * Run cosine + substring concurrently, dedupe-merge, sort, slice. Both
 * branches return their own ranked `MemoryFact[]`; merge prefers cosine
 * order then falls back on substring-confidence-DESC for ties.
 *
 * Cosine path can be a no-op (empty array) when:
 *   - OPENAI_API_KEY is missing → `embedFactContent` returns null
 *   - the RPC errors → caught and logged (substring still serves)
 *   - no rows have embeddings yet → RPC returns empty, substring fills in
 *
 * Substring path always runs over `getActiveFacts` so the contract for
 * embedding-NULL rows is preserved.
 */
async function hybridRecall(opts: HybridRecallOptions): Promise<MemoryFact[]> {
  const [cosineHits, substringHits] = await Promise.all([
    runCosineRecall(opts).catch((err) => {
      console.error(
        '[recall_facts] cosine path failed; falling back to substring',
        err instanceof Error ? err.message : err,
      );
      return [] as MemoryFact[];
    }),
    runSubstringRecall(opts),
  ]);

  return mergeHybridResults(cosineHits, substringHits, opts.limit);
}

/**
 * Embed the query → call the matching RPC → hydrate rows. Returns an
 * empty array (NOT throw) when embedding fails, so substring stays
 * authoritative in degraded mode.
 */
async function runCosineRecall(
  opts: HybridRecallOptions,
): Promise<MemoryFact[]> {
  const embedding = await embedFactContent(opts.query);
  if (!embedding) return [];

  const matchLimit = opts.limit * COSINE_OVERFETCH_FACTOR;
  const literal = embeddingToVectorLiteral(embedding);

  // Cast: `match_memory_facts_*` are post-Wave-0 RPCs not yet in the
  // generated `Database` types — the next `supabase gen types` run will
  // refresh them. Returning rows are typed narrowly via `RpcRow` and
  // validated through `rowToFact`.
  type RpcCall = (
    name: string,
    args: unknown,
  ) => // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Promise<{ data: any; error: { message: string } | null }>;
  const rpc = opts.admin.rpc as unknown as RpcCall;

  if (opts.scope.kind === 'property') {
    const { data, error } = await rpc('match_memory_facts_property', {
      query_embedding: literal,
      property_id_arg: opts.scope.propertyId,
      match_limit: matchLimit,
    });
    if (error) throw new Error(error.message);
    return hydrateRpcRows(data as RpcRow[] | null);
  }

  const { data, error } = await rpc('match_memory_facts_org', {
    query_embedding: literal,
    organization_id_arg: opts.scope.organizationId,
    match_limit: matchLimit,
  });
  if (error) throw new Error(error.message);
  return hydrateRpcRows(data as RpcRow[] | null);
}

/**
 * Substring-match path — same shape as the legacy implementation.
 * Reads `getActiveFacts` per-property (org-wide fans out, like the v1.7
 * implementation) and runs `filterAndRank` over the union.
 */
async function runSubstringRecall(
  opts: HybridRecallOptions,
): Promise<MemoryFact[]> {
  const dbForFacts = opts.admin as unknown as MemoryFactsClient;

  if (opts.scope.kind === 'property') {
    const facts = await getActiveFacts({
      db: dbForFacts,
      propertyId: opts.scope.propertyId,
    });
    return filterAndRank(facts, opts.query, opts.limit);
  }

  const propertyIds = opts.scope.propertyIds;
  if (propertyIds.length === 0) return [];

  const results = await Promise.all(
    propertyIds.map((pid) =>
      getActiveFacts({ db: dbForFacts, propertyId: pid }),
    ),
  );
  const all = results.flat();
  return filterAndRank(all, opts.query, opts.limit);
}

/**
 * Merge cosine hits (already ordered by similarity) with substring hits
 * (already ordered by confidence). Cosine wins ties; substring fills in
 * candidates the embedder missed (e.g. embedding-NULL rows).
 *
 * Pure so callers can drive it from tests.
 */
export function mergeHybridResults(
  cosine: ReadonlyArray<MemoryFact>,
  substring: ReadonlyArray<MemoryFact>,
  limit: number,
): MemoryFact[] {
  const merged: MemoryFact[] = [];
  const seen = new Set<string>();

  for (const f of cosine) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    merged.push(f);
    if (merged.length >= limit) return merged;
  }
  for (const f of substring) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    merged.push(f);
    if (merged.length >= limit) return merged;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecalledFact {
  factType: MemoryFact['factType'];
  content: MemoryFact['content'];
  confidence: number;
  source: MemoryFact['source'];
  createdAt: string;
}

function toRecalledFacts(facts: ReadonlyArray<MemoryFact>): RecalledFact[] {
  return facts.map((f) => ({
    factType: f.factType,
    content: f.content,
    confidence: f.confidence,
    source: f.source,
    createdAt: f.createdAt,
  }));
}

interface RpcRow {
  id: string;
  organization_id: string;
  property_id: string;
  fact_type: string;
  subject_id: string | null;
  content: unknown;
  confidence: number | string;
  source: string;
  evidence_proposal_ids: string[] | null;
  created_at: string;
  superseded_at: string | null;
  superseded_by: string | null;
  similarity?: number;
}

function hydrateRpcRows(rows: RpcRow[] | null): MemoryFact[] {
  if (!rows || rows.length === 0) return [];
  const out: MemoryFact[] = [];
  for (const row of rows) {
    const memoryRow: MemoryFactRow = {
      id: row.id,
      organization_id: row.organization_id,
      property_id: row.property_id,
      fact_type: row.fact_type as FactType,
      subject_id: row.subject_id,
      content: row.content,
      confidence: row.confidence,
      source: row.source as FactSource,
      evidence_proposal_ids: row.evidence_proposal_ids,
      created_at: row.created_at,
      superseded_at: row.superseded_at,
      superseded_by: row.superseded_by,
    };
    out.push(rowToFact(memoryRow));
  }
  return out;
}

/**
 * Substring match across the JSON-encoded `content` plus the
 * factType. Returns top `limit` by confidence DESC.
 *
 * Pure so callers can drive it from tests without the MCP wrapper.
 * Retained as a named export for backward compatibility with the v1.7
 * test suite — the hybrid path uses it as the substring branch.
 */
export function filterAndRank(
  facts: ReadonlyArray<MemoryFact>,
  query: string,
  limit: number,
): MemoryFact[] {
  const needle = query.toLowerCase().trim();
  const matched = facts.filter((f) => {
    const haystack = `${f.factType} ${JSON.stringify(f.content)}`.toLowerCase();
    return haystack.includes(needle);
  });
  // getActiveFacts already returns newest-first within fact_type; we
  // re-sort by confidence DESC so high-signal results bubble up.
  return matched
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: s }] };
}
