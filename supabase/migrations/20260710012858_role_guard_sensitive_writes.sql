-- Role guard for sensitive writes (release-readiness 2026-07-09).
--
-- Until now RLS was org-only: every member of an org (owner/manager/va)
-- could update rent ledgers, lease terms, payments — and even any users
-- row in the org, including role and organization_id (a self-escalation
-- and cross-org hole). This migration:
--
--   1. Adds public.current_user_role() (mirrors current_user_org_id).
--   2. Makes UPDATE on rent_events / leases and INSERT/UPDATE/DELETE on
--      rent_payments owner-only (org check stays; role check additive).
--      SELECT policies unchanged. INSERT on rent_events stays org-only:
--      the only writers today are service-role paths (seed.sql as
--      postgres, generateRentCycle via createAdminClient in the Inngest
--      cron) which bypass RLS anyway.
--   3. Adds a BEFORE UPDATE trigger on public.users that blocks changes
--      to role/organization_id except: service contexts (service_role
--      JWT or no auth.uid() — migrations/seeds/psql) may change both;
--      owners may change role ONLY (org scoping still enforced by the
--      existing RLS UPDATE policy). organization_id changes are
--      service-only for everyone.
--
-- Fail-closed: current_user_role() returns NULL when there is no users
-- row / no uid, and NULL = 'owner' is not true, so unknown role = deny.

-- =========================================================================
-- 1. Helper: current user's role
-- =========================================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.role FROM public.users u WHERE u.id = auth.uid();
$$;

REVOKE ALL    ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

-- =========================================================================
-- 2. Owner-only write policies (org check stays, role check is additive)
-- =========================================================================

DROP POLICY IF EXISTS rent_events_update_own_org ON public.rent_events;
CREATE POLICY rent_events_update_owner_only
  ON public.rent_events FOR UPDATE
  TO authenticated
  USING      (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS leases_update_own_org ON public.leases;
CREATE POLICY leases_update_owner_only
  ON public.leases FOR UPDATE
  TO authenticated
  USING      (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS rent_payments_insert_own_org ON public.rent_payments;
CREATE POLICY rent_payments_insert_owner_only
  ON public.rent_payments FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS rent_payments_update_own_org ON public.rent_payments;
CREATE POLICY rent_payments_update_owner_only
  ON public.rent_payments FOR UPDATE
  TO authenticated
  USING      (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS rent_payments_delete_own_org ON public.rent_payments;
CREATE POLICY rent_payments_delete_owner_only
  ON public.rent_payments FOR DELETE
  TO authenticated
  USING      (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner');

-- =========================================================================
-- 3. users escalation guard
-- =========================================================================

CREATE OR REPLACE FUNCTION public.guard_users_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  jwt_role text;
BEGIN
  -- No privileged column changed: nothing to guard.
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  EXCEPTION WHEN others THEN
    jwt_role := NULL;
  END;

  -- Service contexts: service_role API key, or no authenticated uid
  -- (migrations, seed.sql as postgres, direct psql). May change both.
  IF jwt_role = 'service_role' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Owners may change role ONLY (never organization_id). Org scoping is
  -- already enforced by the users RLS UPDATE policy.
  IF NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND public.current_user_role() = 'owner' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'users_privilege_guard: changing role or organization_id is not allowed for this user'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_users_privilege_columns() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS users_privilege_guard ON public.users;
CREATE TRIGGER users_privilege_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_privilege_columns();
