-- Odesa v5 — source_aero_id columns for the Galaxy pull migrator
-- Authored 2026-04-22 (Phase 3, Agent K)
--
-- Adds a nullable `source_aero_id` text column to the six tables that
-- the Galaxy migrator populates from the legacy Aero backend:
--   organizations, properties, units, tenants, leases, work_orders
--
-- Each column is paired with a partial unique index keyed on
-- (organization_id, source_aero_id) so the migrator can upsert
-- idempotently without blowing up on NULLs for rows that didn't come
-- from Aero (e.g. Supabase seed.sql entries, hand-created test rows).
--
-- Organizations get a standalone unique index (no org scoping — the
-- Aero business id IS the natural key there).
--
-- These are additive, nullable columns. Running the migrator twice
-- produces the same row set; rows not touched by the migrator keep
-- source_aero_id = NULL and are unaffected.

-- =========================================================================
-- organizations
-- =========================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS source_aero_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_source_aero_id
  ON public.organizations(source_aero_id)
  WHERE source_aero_id IS NOT NULL;

-- =========================================================================
-- properties
-- =========================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS source_aero_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_properties_org_source_aero_id
  ON public.properties(organization_id, source_aero_id)
  WHERE source_aero_id IS NOT NULL;

-- =========================================================================
-- units
-- =========================================================================

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS source_aero_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_units_org_source_aero_id
  ON public.units(organization_id, source_aero_id)
  WHERE source_aero_id IS NOT NULL;

-- =========================================================================
-- tenants
-- =========================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS source_aero_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_org_source_aero_id
  ON public.tenants(organization_id, source_aero_id)
  WHERE source_aero_id IS NOT NULL;

-- =========================================================================
-- leases
-- =========================================================================

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS source_aero_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leases_org_source_aero_id
  ON public.leases(organization_id, source_aero_id)
  WHERE source_aero_id IS NOT NULL;

-- =========================================================================
-- work_orders
-- =========================================================================

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS source_aero_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_org_source_aero_id
  ON public.work_orders(organization_id, source_aero_id)
  WHERE source_aero_id IS NOT NULL;
