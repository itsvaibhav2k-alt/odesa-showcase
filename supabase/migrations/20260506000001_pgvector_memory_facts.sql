-- Odesa v1.8 — pgvector + embeddings on memory_facts
-- Authored 2026-05-06 (foundation-eng)
--
-- Wires semantic recall for the recall_facts MCP tool. The substring matcher
-- in src/lib/agent/operator/mcps/memory.ts misses synonyms ("boiler" ≠ "heating
-- system"); embeddings + cosine similarity fix that. Rows already in the table
-- get embedding NULL until the backfill Inngest job
-- (src/inngest/functions/backfill-memory-embeddings.ts) catches them up.
--
-- Dimension 1536 matches OpenAI text-embedding-3-small (and ada-002), the
-- baseline embedding provider for v1.8. The hybrid recall path falls back to
-- substring when embedding is NULL or OPENAI_API_KEY is unset, so this column
-- can ship green ahead of the backfill.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.memory_facts
  ADD COLUMN embedding extensions.vector(1536);

-- HNSW with cosine distance — works incrementally as rows arrive (unlike
-- ivfflat which needs centroids precomputed). Partial-on-NOT-NULL keeps the
-- index lean while backfill runs; the WHERE clause is fine on a non-UNIQUE
-- index (the lesson from 20260423000000_source_aero_indexes_nonpartial.sql
-- only applies to partial UNIQUE indexes).
CREATE INDEX idx_memory_facts_embedding_hnsw
  ON public.memory_facts
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;
