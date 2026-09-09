-- Odesa v1 — RLS policies + post-signup trigger
-- Authored 2026-04-21 (Phase 1.2, Agent B)
--
-- Model:
--   Every table carries organization_id. Every policy gates on
--   organization_id = public.current_user_org_id(). The one exception is
--   the users table, which also allows self-read by id = auth.uid() so
--   that current_user_org_id() can bootstrap from the users row when
--   the JWT does not yet carry an organization_id claim.

-- =========================================================================
-- Helper: current user's organization_id
-- =========================================================================
--
-- Resolution order:
--   1. If JWT has an 'organization_id' custom claim, use it.
--   2. Otherwise, look up public.users.organization_id by auth.uid().
--
-- SECURITY DEFINER so the function can read public.users even when the
-- caller has no SELECT grant on the table directly (RLS still applies
-- to the caller's own queries — this just powers the policy).

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_from_jwt uuid;
  org_from_row uuid;
BEGIN
  BEGIN
    org_from_jwt := (auth.jwt() ->> 'organization_id')::uuid;
  EXCEPTION WHEN others THEN
    org_from_jwt := NULL;
  END;

  IF org_from_jwt IS NOT NULL THEN
    RETURN org_from_jwt;
  END IF;

  SELECT u.organization_id
    INTO org_from_row
    FROM public.users u
   WHERE u.id = auth.uid();

  RETURN org_from_row;
END;
$$;

REVOKE ALL    ON FUNCTION public.current_user_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated, service_role;

-- =========================================================================
-- Post-signup trigger: auto-create organization + users row
-- =========================================================================
--
-- Fires after a row lands in auth.users. Reads
-- raw_user_meta_data->>'organization_name' (and optional 'full_name').
-- Creates a new organizations row + a users row pointing at the
-- auth.users id with role='owner'.
--
-- Defensive fallback: if organization_name is missing, use the user's
-- email-local-part as the org name. This keeps the trigger non-fatal
-- for admin-provisioned or imported users.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id    uuid;
  org_name      text;
  user_full_nm  text;
  user_phone    text;
BEGIN
  org_name := COALESCE(
    NEW.raw_user_meta_data ->> 'organization_name',
    split_part(COALESCE(NEW.email, 'landlord'), '@', 1)
  );

  user_full_nm := NEW.raw_user_meta_data ->> 'full_name';
  user_phone   := NEW.raw_user_meta_data ->> 'phone_e164';

  INSERT INTO public.organizations (name)
  VALUES (org_name)
  RETURNING id INTO new_org_id;

  INSERT INTO public.users (
    id, organization_id, role, full_name, email, phone_e164
  )
  VALUES (
    NEW.id, new_org_id, 'owner', user_full_nm, NEW.email, user_phone
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- =========================================================================
-- Enable RLS on all 12 tables
-- =========================================================================

ALTER TABLE public.organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_reports  ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- organizations
-- =========================================================================
--
-- Users see only their own organization's row. Inserts happen via the
-- post-signup trigger (service_role, bypasses RLS) — regular users
-- cannot create organizations through the API. Updates gated to the
-- current org only.

CREATE POLICY organizations_select_own
  ON public.organizations FOR SELECT
  TO authenticated
  USING (id = public.current_user_org_id());

CREATE POLICY organizations_update_own
  ON public.organizations FOR UPDATE
  TO authenticated
  USING      (id = public.current_user_org_id())
  WITH CHECK (id = public.current_user_org_id());

-- =========================================================================
-- users — special case: self-read bootstrap
-- =========================================================================

CREATE POLICY users_select_self_or_org
  ON public.users FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()) OR organization_id = public.current_user_org_id());

CREATE POLICY users_insert_self_in_org
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY users_update_self_or_org
  ON public.users FOR UPDATE
  TO authenticated
  USING      (id = (SELECT auth.uid()) OR organization_id = public.current_user_org_id())
  WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY users_delete_own_org
  ON public.users FOR DELETE
  TO authenticated
  USING (organization_id = public.current_user_org_id());

-- =========================================================================
-- Org-scoped tables: uniform SELECT / INSERT / UPDATE / DELETE policies
-- =========================================================================
--
-- For each of the ten remaining tables the pattern is identical. We
-- use a DO block to keep the migration DRY and reduce the chance of
-- copy-paste drift between tables.

DO $$
DECLARE
  t text;
  policy_tables text[] := ARRAY[
    'properties',
    'units',
    'tenants',
    'leases',
    'conversations',
    'messages',
    'work_orders',
    'vendors',
    'rent_events',
    'weekly_reports'
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

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.organizations,
  public.users,
  public.properties,
  public.units,
  public.tenants,
  public.leases,
  public.conversations,
  public.messages,
  public.work_orders,
  public.vendors,
  public.rent_events,
  public.weekly_reports
TO authenticated;

GRANT SELECT ON public.v_org_pulse_kpis TO authenticated;
