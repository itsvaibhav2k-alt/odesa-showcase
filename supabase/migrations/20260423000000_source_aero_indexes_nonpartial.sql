-- Odesa v5 — drop partial unique indexes on source_aero_id, recreate as
-- non-partial so PostgREST's `upsert({onConflict})` can find them.
--
-- Context (Phase 3 bugfix):
-- The earlier `20260422000001_aero_source_ids.sql` used
--   CREATE UNIQUE INDEX … ON table(org_id, source_aero_id)
--     WHERE source_aero_id IS NOT NULL
--
-- PostgreSQL allows this, but `INSERT … ON CONFLICT (cols) DO UPDATE`
-- only matches indexes whose column list AND predicate both line up.
-- supabase-js's upsert helper doesn't let callers pass a WHERE clause,
-- so the migrator hit "no unique or exclusion constraint matching the
-- ON CONFLICT specification" for every upsert.
--
-- Fix: drop the partial indexes and rebuild them without the WHERE.
-- Under the default `NULLS DISTINCT` behaviour, existing seed rows
-- (source_aero_id IS NULL) do NOT collide — two NULL values are
-- considered distinct by a unique index — so no seed data needs to move.

DROP INDEX IF EXISTS public.uq_organizations_source_aero_id;
DROP INDEX IF EXISTS public.uq_properties_org_source_aero_id;
DROP INDEX IF EXISTS public.uq_units_org_source_aero_id;
DROP INDEX IF EXISTS public.uq_tenants_org_source_aero_id;
DROP INDEX IF EXISTS public.uq_leases_org_source_aero_id;
DROP INDEX IF EXISTS public.uq_work_orders_org_source_aero_id;

CREATE UNIQUE INDEX uq_organizations_source_aero_id
  ON public.organizations(source_aero_id);

CREATE UNIQUE INDEX uq_properties_org_source_aero_id
  ON public.properties(organization_id, source_aero_id);

CREATE UNIQUE INDEX uq_units_org_source_aero_id
  ON public.units(organization_id, source_aero_id);

CREATE UNIQUE INDEX uq_tenants_org_source_aero_id
  ON public.tenants(organization_id, source_aero_id);

CREATE UNIQUE INDEX uq_leases_org_source_aero_id
  ON public.leases(organization_id, source_aero_id);

CREATE UNIQUE INDEX uq_work_orders_org_source_aero_id
  ON public.work_orders(organization_id, source_aero_id);
