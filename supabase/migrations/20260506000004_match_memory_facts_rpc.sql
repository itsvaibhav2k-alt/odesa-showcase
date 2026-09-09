-- Odesa v1.8 — RPC for hybrid semantic recall_facts
-- Authored 2026-05-06 (vectors-team)
--
-- The recall_facts MCP tool needs to issue a cosine-similarity query
-- against memory_facts.embedding. supabase-js cannot pass pgvector
-- operators through the PostgREST query DSL, so we wrap the lookup in a
-- SECURITY INVOKER SQL function the client calls via rpc().
--
-- Two variants — property-scoped and org-scoped — so a single call returns
-- the top-K cosine matches without round-trips. Both filter to active
-- (non-superseded) facts that already have an embedding; substring fallback
-- still happens client-side via the existing getActiveFacts loader so a
-- mid-backfill state doesn't drop matches.
--
-- SECURITY INVOKER + the existing memory_facts RLS policies mean callers
-- only see their own org's rows; the service-role admin client used by
-- the operator MCP bypasses RLS as expected.

CREATE OR REPLACE FUNCTION public.match_memory_facts_property(
  query_embedding extensions.vector(1536),
  property_id_arg uuid,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  property_id uuid,
  fact_type text,
  subject_id uuid,
  content jsonb,
  confidence numeric,
  source text,
  evidence_proposal_ids uuid[],
  created_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid,
  similarity float8
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    f.id,
    f.organization_id,
    f.property_id,
    f.fact_type,
    f.subject_id,
    f.content,
    f.confidence,
    f.source,
    f.evidence_proposal_ids,
    f.created_at,
    f.superseded_at,
    f.superseded_by,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM public.memory_facts f
  WHERE f.property_id = property_id_arg
    AND f.superseded_at IS NULL
    AND f.embedding IS NOT NULL
  ORDER BY f.embedding <=> query_embedding ASC
  LIMIT GREATEST(match_limit, 1);
$$;

CREATE OR REPLACE FUNCTION public.match_memory_facts_org(
  query_embedding extensions.vector(1536),
  organization_id_arg uuid,
  match_limit int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  property_id uuid,
  fact_type text,
  subject_id uuid,
  content jsonb,
  confidence numeric,
  source text,
  evidence_proposal_ids uuid[],
  created_at timestamptz,
  superseded_at timestamptz,
  superseded_by uuid,
  similarity float8
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    f.id,
    f.organization_id,
    f.property_id,
    f.fact_type,
    f.subject_id,
    f.content,
    f.confidence,
    f.source,
    f.evidence_proposal_ids,
    f.created_at,
    f.superseded_at,
    f.superseded_by,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM public.memory_facts f
  WHERE f.organization_id = organization_id_arg
    AND f.superseded_at IS NULL
    AND f.embedding IS NOT NULL
  ORDER BY f.embedding <=> query_embedding ASC
  LIMIT GREATEST(match_limit, 1);
$$;
