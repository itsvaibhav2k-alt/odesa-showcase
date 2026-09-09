-- Odesa v1.5 — RLS policies for the property-worker surfaces
-- Authored 2026-04-28 (migrations-eng)
--
-- Policies enforced (one per table per operation):
--   memory_facts      — SELECT / INSERT / UPDATE / DELETE gated on
--                        organization_id = current_user_org_id()
--   action_proposals  — SELECT / INSERT / UPDATE / DELETE gated on
--                        organization_id = current_user_org_id()
--   meta_insights     — SELECT / INSERT / UPDATE / DELETE gated on
--                        organization_id = current_user_org_id()
--
-- The helper public.current_user_org_id() is defined in
-- 20260421000001_rls.sql; do NOT redefine it here.
--
-- Pattern matches the DO-block loop in the v1 RLS migration so that all
-- org-scoped tables stay uniform: the only difference is the table list.

-- =========================================================================
-- Enable RLS
-- =========================================================================

ALTER TABLE public.memory_facts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_insights    ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- Uniform org-scoped CRUD policies
-- =========================================================================

DO $$
DECLARE
  t text;
  policy_tables text[] := ARRAY[
    'memory_facts',
    'action_proposals',
    'meta_insights'
  ];
BEGIN
  FOREACH t IN ARRAY policy_tables LOOP
    EXECUTE format($fmt$
      CREATE POLICY %I_select_own_org
        ON public.%I FOR SELECT
        TO authenticated
        USING (organization_id = public.current_user_org_id());

      CREATE POLICY %I_insert_own_org
        ON public.%I FOR INSERT
        TO authenticated
        WITH CHECK (organization_id = public.current_user_org_id());

      CREATE POLICY %I_update_own_org
        ON public.%I FOR UPDATE
        TO authenticated
        USING      (organization_id = public.current_user_org_id())
        WITH CHECK (organization_id = public.current_user_org_id());

      CREATE POLICY %I_delete_own_org
        ON public.%I FOR DELETE
        TO authenticated
        USING (organization_id = public.current_user_org_id());
    $fmt$, t, t, t, t, t, t, t, t);
  END LOOP;
END
$$;

-- =========================================================================
-- Grants — let authenticated touch the tables (RLS still gates rows)
-- =========================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.memory_facts,
  public.action_proposals,
  public.meta_insights
TO authenticated;
