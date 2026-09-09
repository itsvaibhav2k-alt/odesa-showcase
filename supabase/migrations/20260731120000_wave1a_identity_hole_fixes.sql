-- Wave 1a identity holes: users DELETE, users INSERT, phone columns.
--
-- The role layer added by 20260710012858 covered rent/lease/payment
-- writes and the role/organization_id columns on public.users. Three
-- identity holes survived, all of them reachable by any authenticated
-- org member (manager or va):
--
--   H1  users_delete_own_org let ANY member DELETE ANY users row in the
--       org, owners included. The signup trigger handle_new_auth_user is
--       AFTER INSERT ON auth.users only, so the row never regenerates:
--       one DELETE permanently bricks the account. Now owner-only (org
--       check stays, role check is additive — same shape as 20260710012858).
--
--   H5  users_insert_self_in_org had WITH CHECK (organization_id = ...)
--       and NO id predicate, so a member could INSERT a users row for any
--       auth uid that did not yet have one — including role='owner'.
--       Now the row's id must be the caller's own uid.
--
--   H2  guard_users_privilege_columns guarded only role and
--       organization_id, so any member could UPDATE another member's
--       phone_e164 / phone_verified_at. That is not cosmetic: a verified
--       users.phone_e164 is what src/lib/messaging/route-inbound.ts uses
--       to classify an inbound SMS as an OPERATOR, i.e. agent-command
--       authority over the org. The phone columns are now self-service
--       only — changing another member's phone raises 42501 for EVERY
--       role, owner included, because an owner stamping someone else's
--       phone_verified_at bypasses the OTP flow just as completely as a
--       va doing it. The guard also fires on INSERT now, so H5's WITH
--       CHECK is backed by a trigger that refuses a pre-verified phone.
--
-- Fail-closed: every path that is not explicitly allowed raises 42501.
-- Strictly additive/tightening — no table or column is dropped, no data
-- is mutated.

-- =========================================================================
-- 1. H1 — users DELETE is owner-only
-- =========================================================================

DROP POLICY IF EXISTS users_delete_own_org ON public.users;
CREATE POLICY users_delete_owner_only
  ON public.users FOR DELETE
  TO authenticated
  USING (organization_id = public.current_user_org_id()
         AND public.current_user_role() = 'owner');

-- =========================================================================
-- 2. H5 — users INSERT must be the caller's own row
-- =========================================================================

DROP POLICY IF EXISTS users_insert_self_in_org ON public.users;
CREATE POLICY users_insert_self_in_org
  ON public.users FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid())
              AND organization_id = public.current_user_org_id());

-- =========================================================================
-- 3. H2 — guard phone_e164 / phone_verified_at, and fire on INSERT
-- =========================================================================

CREATE OR REPLACE FUNCTION public.guard_users_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  jwt_role text;
  caller   uuid;
BEGIN
  -- UPDATE fast path: no guarded column changed, nothing to guard.
  -- Guarded with TG_OP because OLD is NULL on INSERT.
  IF TG_OP = 'UPDATE'
     AND NEW.role              IS NOT DISTINCT FROM OLD.role
     AND NEW.organization_id   IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.phone_e164        IS NOT DISTINCT FROM OLD.phone_e164
     AND NEW.phone_verified_at IS NOT DISTINCT FROM OLD.phone_verified_at THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  EXCEPTION WHEN others THEN
    jwt_role := NULL;
  END;

  caller := auth.uid();

  -- Service contexts: service_role API key, or no authenticated uid
  -- (migrations, seed.sql as postgres, direct psql). May change both.
  --
  -- This is also why signup still works with the trigger now firing on
  -- INSERT: handle_new_auth_user() is SECURITY DEFINER and runs on the
  -- auth-admin connection that inserted into auth.users. That connection
  -- carries no end-user JWT, so request.jwt.claims is unset and
  -- auth.uid() is NULL — the org-minting INSERT lands here and passes.
  IF jwt_role = 'service_role' OR caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- An authenticated caller may only insert their OWN row, and may not
    -- self-stamp a verified phone — verification is the OTP flow's job.
    IF NEW.id = caller AND NEW.phone_verified_at IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'users_privilege_guard: inserting a users row for another uid or with a pre-verified phone is not allowed'
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE from here down.
  --
  -- Phone columns are self-service only, for every role including owner:
  -- a verified phone is operator authority over the org's agent.
  IF (NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164
      OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at)
     AND NEW.id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'users_privilege_guard: changing another member''s phone_e164 or phone_verified_at is not allowed'
      USING ERRCODE = '42501';
  END IF;

  -- Only the phone columns changed, and that change was self-service.
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
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
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_privilege_columns();
