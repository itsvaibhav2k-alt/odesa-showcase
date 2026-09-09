-- Wave 1b S3 — identity / membership split (profiles + organization_memberships).
--
-- WHAT
--   public.users stops being a table. It is RENAMED to public.profiles
--   (identity only: email, name, phone, avatar) and the two authorization
--   columns it carried — organization_id and role — move into a new
--   public.organization_memberships row per (user, organization). Around
--   that sit the four tables the membership layer needs:
--
--     organization_memberships          who belongs where, in what role
--     membership_property_grants        per-property scope for a membership
--     membership_capability_overrides   per-capability allow/deny
--     organization_invitations          hashed, expiring, revocable invites
--
--   public.users comes back at the end as a READ-ONLY compatibility VIEW
--   (profiles JOIN the single ACTIVE membership) exposing the old column
--   set, so e2e/ and scripts/ keep working until S4 drops it. Product code
--   must not read it.
--
-- WHY
--   1. current_user_org_id() trusted an `organization_id` claim on the JWT
--      before it ever looked at a row (20260421000001_rls.sql:34-42). Any
--      token carrying that claim selected its own tenant. That branch is
--      DELETED outright, not reordered: org identity is now resolved from
--      the caller's memberships and nothing else.
--   2. One row in `users` could only ever express one org and one role, so
--      "which org am I acting in" and "who am I" were the same fact.
--      Splitting them is what makes invitations, suspension, per-property
--      scope and (later) org switching expressible at all.
--   3. A member joining an org had no auditable path: someone had to write
--      a users row directly. Invitations replace that with owner-minted,
--      hashed, single-use, expiring tokens bound to a VERIFIED email.
--
-- FAIL-CLOSED RATIONALE
--   Every resolution here refuses to guess. current_user_org_id() and
--   current_user_role() return NULL for ZERO active memberships *and* for
--   MORE THAN ONE — an ambiguous caller gets no org rather than an
--   arbitrary one, and `NULL = anything` is not true, so every org-scoped
--   policy in the database denies. Membership INSERT is not granted to
--   `authenticated` at all; memberships are minted only by the signup
--   trigger, by service contexts, or by claim_organization_invitation().
--   The last-owner invariant, the privilege guard and the reserved
--   capability guard are TRIGGERS/CHECKs, not policies, so they hold for
--   service_role too — an RLS filter that service_role bypasses is not an
--   invariant. The one deliberate escape is an ORGANIZATION cascade: when
--   the organization row is already gone, the last-owner trigger steps
--   aside, because refusing to let an org be deleted is not protecting
--   anybody. Profile/auth-user cascades remain guarded: identity deletion
--   must not strand a surviving organization with zero active owners.
--
--   No data loss: `users` is renamed, never dropped, and every membership
--   is backfilled from it before the two columns go away, so every
--   existing user ends up with exactly one active membership and identical
--   effective access.

-- =========================================================================
-- 0. Rename users -> profiles, and shed what depended on its authz columns
-- =========================================================================
--
-- RENAME (rather than create-and-copy) is what keeps the eight foreign
-- keys that reference users(id) valid without touching them: FKs bind to
-- the table's OID, so operator_chats.user_id, operator_chat_turns.user_id,
-- agent_runs.user_id, phone_verifications.user_id, scheduled_actions
-- (user_id + cancelled_by), oauth_tokens.user_id and documents.uploaded_by
-- all follow the rename and now reference public.profiles(id) with their
-- original ON DELETE behavior intact.

ALTER TABLE public.users RENAME TO profiles;

-- The Wave 1a / role-guard trigger guarded role + organization_id + the
-- phone columns on one table. Role and organization_id are leaving, so the
-- trigger is re-authored below as two separate guards (profiles keeps the
-- phone half; memberships get the privilege half).
DROP TRIGGER IF EXISTS users_privilege_guard ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_users_privilege_columns();

-- Policies and indexes that reference the columns about to be dropped.
DROP POLICY IF EXISTS users_select_self_or_org  ON public.profiles;
DROP POLICY IF EXISTS users_insert_self_in_org  ON public.profiles;
DROP POLICY IF EXISTS users_update_self_or_org  ON public.profiles;
DROP POLICY IF EXISTS users_delete_own_org      ON public.profiles;
DROP POLICY IF EXISTS users_delete_owner_only   ON public.profiles;

DROP INDEX IF EXISTS public.idx_users_organization_id;
DROP INDEX IF EXISTS public.idx_users_phone_org;

-- =========================================================================
-- 1. New enum + tables
-- =========================================================================

CREATE TYPE public.membership_status AS ENUM ('active', 'suspended');

-- --- organization_memberships -------------------------------------------
--
-- Decision A: the unique key is (user_id, organization_id) and there is
-- deliberately NO UNIQUE(user_id). A person holding memberships in two
-- organizations is legal at the DATA layer so that org switching can be
-- built later without a migration; the product-level restriction lives in
-- claim_organization_invitation(), which refuses the second one today.
CREATE TABLE public.organization_memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role             public.user_role          NOT NULL DEFAULT 'owner',
  status           public.membership_status  NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_memberships_user_org_key UNIQUE (user_id, organization_id)
);

CREATE INDEX idx_memberships_organization_id ON public.organization_memberships(organization_id);
CREATE INDEX idx_memberships_user_active
  ON public.organization_memberships(user_id)
  WHERE status = 'active';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- --- membership_property_grants ------------------------------------------

CREATE TABLE public.membership_property_grants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  uuid NOT NULL REFERENCES public.organization_memberships(id) ON DELETE CASCADE,
  property_id    uuid NOT NULL REFERENCES public.properties(id)               ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_property_grants_key UNIQUE (membership_id, property_id)
);

CREATE INDEX idx_membership_property_grants_property ON public.membership_property_grants(property_id);

-- --- membership_capability_overrides --------------------------------------
--
-- The reserved-capability guard is a CHECK, not a trigger: the list is a
-- product decision that changes by migration, never by row, and a CHECK is
-- enforced for every writer including service_role. Mirrors
-- RESERVED_OWNER_CAPABILITIES in src/lib/authz/access-policy.ts. effect
-- 'deny' is always legal — taking a capability away can never escalate.
CREATE TABLE public.membership_capability_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  uuid NOT NULL REFERENCES public.organization_memberships(id) ON DELETE CASCADE,
  capability     text NOT NULL,
  effect         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT NOW(),
  updated_at     timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT membership_capability_overrides_key UNIQUE (membership_id, capability),
  CONSTRAINT membership_capability_overrides_effect_check
    CHECK (effect IN ('allow', 'deny')),
  CONSTRAINT membership_capability_overrides_reserved_owner_check
    CHECK (
      effect = 'deny'
      OR capability NOT IN (
        'record_payment',
        'waive_balance',
        'change_lease_terms',
        'approve_payment_request',
        'import_portfolio',
        'manage_team_access',
        'manage_billing',
        'manage_integrations',
        'change_autonomy',
        'access_all_properties'
      )
    )
);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.membership_capability_overrides
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- --- organization_invitations ---------------------------------------------
--
-- Decision K: owner-generated copyable links, no email delivery. The RAW
-- token is never stored — only its sha256 hex digest — so a database read
-- (backup, log, compromised replica) yields nothing claimable.
CREATE TABLE public.organization_invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email            text NOT NULL,
  role             public.user_role NOT NULL,
  token_hash       text NOT NULL,
  invited_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_invitations_ttl_check
    CHECK (expires_at <= created_at + interval '7 days')
);

-- Only ONE open invitation per (organization, email) may exist at a time;
-- accepted or revoked rows drop out of the index so a reissue is legal.
CREATE UNIQUE INDEX organization_invitations_open_key
  ON public.organization_invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX organization_invitations_token_hash_key
  ON public.organization_invitations (token_hash);

CREATE INDEX idx_organization_invitations_email
  ON public.organization_invitations (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- =========================================================================
-- 2. Backfill — the zero-behavior-change checkpoint
-- =========================================================================
--
-- Every pre-existing users row becomes exactly one ACTIVE membership with
-- the same organization_id and role, so effective access is byte-identical
-- across the split. The rename already carried the identity half.

INSERT INTO public.organization_memberships (user_id, organization_id, role, status)
SELECT p.id, p.organization_id, p.role, 'active'
  FROM public.profiles p
ON CONFLICT ON CONSTRAINT organization_memberships_user_org_key DO NOTHING;

-- =========================================================================
-- 3. Org / role resolution — the JWT branch is GONE
-- =========================================================================
--
-- Rewritten BEFORE the columns are dropped so nothing observes a window
-- where these read a column that no longer exists.
--
-- Zero active memberships -> NULL. More than one -> NULL. The aggregate +
-- HAVING shape returns no row (hence NULL) unless the count is exactly 1,
-- which is the fail-closed part: an ambiguous caller is not silently
-- assigned to whichever org sorts first.

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT (array_agg(m.organization_id))[1]
    FROM public.organization_memberships m
   WHERE m.user_id = auth.uid()
     AND m.status = 'active'
  HAVING count(*) = 1;
$$;

REVOKE ALL    ON FUNCTION public.current_user_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT (array_agg(m.role))[1]
    FROM public.organization_memberships m
   WHERE m.user_id = auth.uid()
     AND m.status = 'active'
  HAVING count(*) = 1;
$$;

REVOKE ALL    ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

-- Scope helpers used by the policies below. SECURITY DEFINER so a policy
-- on one table does not have to nest inside another table's policies.
-- Both return false when current_user_org_id() is NULL (`= NULL` is not
-- true), which is the fail-closed default for an ambiguous caller.

CREATE OR REPLACE FUNCTION public.profile_shares_current_org(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.user_id = p_profile_id
       AND m.status = 'active'
       AND m.organization_id = public.current_user_org_id()
  );
$$;

REVOKE ALL    ON FUNCTION public.profile_shares_current_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_shares_current_org(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.membership_in_current_org(p_membership_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.id = p_membership_id
       AND m.organization_id = public.current_user_org_id()
  );
$$;

REVOKE ALL    ON FUNCTION public.membership_in_current_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_in_current_org(uuid) TO authenticated, service_role;

-- Now the authz columns can go.
ALTER TABLE public.profiles
  DROP COLUMN organization_id,
  DROP COLUMN role;

-- The inbound-SMS operator lookup used users(organization_id, phone_e164);
-- organization_id now lives one table over, so the identity half of that
-- index moves to profiles and the org filter comes from the join.
CREATE INDEX idx_profiles_phone_e164
  ON public.profiles(phone_e164)
  WHERE phone_e164 IS NOT NULL;

-- =========================================================================
-- 4. Triggers — invariants that hold for service_role too
-- =========================================================================

-- --- 4a. Last-owner invariant ---------------------------------------------
--
-- An organization must never lose its last ACTIVE owner, whether by DELETE,
-- by role demotion, or by suspension — all three are the same lockout. This
-- is a trigger precisely so the admin/service client cannot step around it.
--
-- The ONLY cascade escape is organization deletion. The FK action deletes
-- memberships after the organization row is gone; blocking there would make
-- organizations undeletable and break fixture teardown. A profile/auth.users
-- deletion is different: the organization survives, so its cascaded
-- membership deletion must still prove another active owner remains.

CREATE OR REPLACE FUNCTION public.guard_membership_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Only an ACTIVE OWNER row can be the last one. NEW is never touched on
  -- the DELETE path (it is not a row there), hence the explicit TG_OP
  -- branching rather than one compound condition.
  IF OLD.role IS DISTINCT FROM 'owner'::public.user_role
     OR OLD.status IS DISTINCT FROM 'active'::public.membership_status THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Still an active owner of the same org after the update: no loss.
  IF TG_OP = 'UPDATE'
     AND NEW.role = 'owner'::public.user_role
     AND NEW.status = 'active'::public.membership_status
     AND NEW.organization_id = OLD.organization_id THEN
    RETURN NEW;
  END IF;

  -- Cascade from a deleted organization only: the parent organization row is
  -- already gone by the time its FK action reaches us. Do NOT exempt a
  -- missing profile: that is exactly how profile/auth-user deletion cascades,
  -- and the surviving organization still needs an owner.
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Serialize owner-loss operations per organization (master plan §4:
  -- "`FOR UPDATE` lock on the org row for concurrency"). The count below
  -- and the write it authorizes are two steps, so without a lock two
  -- transactions each removing a DIFFERENT active owner both read "the
  -- other one is still there" and both commit, leaving the organization
  -- with zero owners — the exact lockout this trigger exists to prevent.
  --
  -- Locking the parent organization row makes check-then-act atomic per
  -- org: the second transaction blocks here, and because this function is
  -- VOLATILE, its next statement takes a FRESH snapshot once the lock is
  -- granted — so it sees the first transaction's committed loss and
  -- raises. Contention is scoped to owner-loss attempts on one org; every
  -- other membership write returned above before reaching this point.
  --
  -- Deliberately AFTER the cascade escape: an organization DELETE already
  -- holds this row's lock, and its cascading membership deletes must never
  -- queue behind it.
  --
  -- Known ceiling, measured rather than assumed: both single-statement
  -- orderings of "demote an owner" against "DELETE the organization" are
  -- clean — whichever arrives second simply waits, and the demote that
  -- loses ends up touching 0 rows. A deadlock (40P01, detected and rolled
  -- back by Postgres, nothing corrupted) needs a MULTI-statement
  -- transaction that already holds the membership row lock before it
  -- demotes. PostgREST runs one statement per transaction and no product
  -- path deletes an organization — only fixture teardown and scripts/ do
  -- — so that shape is not reachable from any client this codebase has.
  PERFORM 1
     FROM public.organizations o
    WHERE o.id = OLD.organization_id
      FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.organization_id = OLD.organization_id
       AND m.id <> OLD.id
       AND m.role = 'owner'::public.user_role
       AND m.status = 'active'::public.membership_status
  ) THEN
    RAISE EXCEPTION
      'membership_last_owner_guard: organization % would be left with no active owner',
      OLD.organization_id
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_membership_last_owner() FROM PUBLIC, anon;

CREATE TRIGGER membership_last_owner_guard
  BEFORE UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.guard_membership_last_owner();

-- --- 4b. Membership privilege guard ---------------------------------------
--
-- Ports guard_users_privilege_columns() verbatim onto the new keying:
--   * service contexts (service_role JWT, or no auth.uid() — migrations,
--     seed.sql as postgres, the GoTrue admin connection, direct psql) may
--     do anything;
--   * nobody self-escalates: an authenticated caller may not change the
--     role or status of their OWN membership;
--   * nobody moves a membership across organizations, or re-points it at
--     another user — owner included;
--   * an owner may change another member's role or status inside their own
--     organization;
--   * INSERT is not a self-service operation at all. The only authenticated
--     path that mints a membership is claim_organization_invitation(),
--     which announces itself with a transaction-local GUC.

CREATE OR REPLACE FUNCTION public.guard_membership_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  jwt_role text;
  caller   uuid;
BEGIN
  -- UPDATE fast path: nothing privileged changed.
  IF TG_OP = 'UPDATE'
     AND NEW.id              IS NOT DISTINCT FROM OLD.id
     AND NEW.role            IS NOT DISTINCT FROM OLD.role
     AND NEW.status          IS NOT DISTINCT FROM OLD.status
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.user_id         IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  EXCEPTION WHEN others THEN
    jwt_role := NULL;
  END;

  caller := auth.uid();

  IF jwt_role = 'service_role' OR caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_setting('odesa.membership_claim', true) = '1' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'membership_privilege_guard: memberships are not self-service; use an invitation'
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE from here down.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'membership_privilege_guard: re-keying or moving a membership to another organization or user is not allowed'
      USING ERRCODE = '42501';
  END IF;

  -- Self-escalation (and self-demotion) is never allowed through the API:
  -- an owner handing themselves a role is exactly the hole this closes.
  IF NEW.user_id = caller THEN
    RAISE EXCEPTION 'membership_privilege_guard: changing your own role or status is not allowed'
      USING ERRCODE = '42501';
  END IF;

  IF public.current_user_role() = 'owner'
     AND public.current_user_org_id() = OLD.organization_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'membership_privilege_guard: changing role or status is owner-only within your own organization'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_membership_privilege_columns() FROM PUBLIC, anon;

CREATE TRIGGER membership_privilege_guard
  BEFORE INSERT OR UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.guard_membership_privilege_columns();

-- --- 4c. Profiles privilege guard (Wave 1a H2, carried forward) -----------
--
-- Phone columns stay self-service ONLY, for every role including owner: a
-- verified profiles.phone_e164 is what src/lib/messaging/route-inbound.ts
-- uses to classify an inbound SMS as an OPERATOR, i.e. agent-command
-- authority over the org. An owner stamping someone else's
-- phone_verified_at bypasses the OTP flow just as completely as a va would.
-- INSERT is still guarded so a caller cannot mint a pre-verified phone.

CREATE OR REPLACE FUNCTION public.guard_profiles_privilege_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  jwt_role text;
  caller   uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.phone_e164        IS NOT DISTINCT FROM OLD.phone_e164
     AND NEW.phone_verified_at IS NOT DISTINCT FROM OLD.phone_verified_at
     AND NEW.id                IS NOT DISTINCT FROM OLD.id THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  EXCEPTION WHEN others THEN
    jwt_role := NULL;
  END;

  caller := auth.uid();

  -- Service contexts. This is also why signup still works with the trigger
  -- firing on INSERT: handle_new_auth_user() runs on the auth-admin
  -- connection, which carries no end-user JWT, so auth.uid() is NULL.
  IF jwt_role = 'service_role' OR caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id = caller AND NEW.phone_verified_at IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'profiles_privilege_guard: inserting a profile for another uid or with a pre-verified phone is not allowed'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'profiles_privilege_guard: changing another member''s phone_e164 or phone_verified_at is not allowed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profiles_privilege_columns() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS profiles_privilege_guard ON public.profiles;
CREATE TRIGGER profiles_privilege_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_privilege_columns();

-- =========================================================================
-- 5. RLS + policies + grant hygiene
-- =========================================================================
--
-- 20260706004500_service_role_grants.sql grants full CRUD on ALL TABLES to
-- `authenticated` and sets ALTER DEFAULT PRIVILEGES so every FUTURE table
-- inherits it. A new table that quietly accepts those defaults is an open
-- table the moment a policy is missing, so each of these REVOKEs the
-- blanket grant first and then grants back only the verbs RLS is written
-- to govern. Absent verbs (membership INSERT, invitation INSERT/DELETE)
-- are denied at the GRANT layer, below RLS, on purpose.

ALTER TABLE public.organization_memberships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_property_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_capability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations        ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.profiles,
  public.organization_memberships,
  public.membership_property_grants,
  public.membership_capability_overrides,
  public.organization_invitations
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.profiles,
  public.organization_memberships,
  public.membership_property_grants,
  public.membership_capability_overrides,
  public.organization_invitations
TO service_role;

-- --- profiles -------------------------------------------------------------
--
-- Wave 1a semantics carried forward onto the new keying: self-read
-- bootstrap, INSERT is self-only (H5), DELETE is owner-only (H1).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

CREATE POLICY profiles_select_self_or_org
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()) OR public.profile_shares_current_org(id));

CREATE POLICY profiles_insert_self
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

-- UPDATE is SELF-ONLY, deliberately narrower than SELECT.
--
-- The pre-split policy (20260421000001_rls.sql:161-165) let any member
-- UPDATE any other member's profile row; Wave 1a closed the escalating
-- half of that (H2 — the phone pair) with a trigger, but left the other
-- four identity columns — display_name, full_name, email, avatar_url —
-- writable by every colleague. Nothing in the persona spec, the
-- authorization matrix or ws1-identity asks for member-to-member identity
-- editing: no product surface offers it (the only authenticated profile
-- write in the codebase is the caller's own OTP path in
-- settings/integrations/actions.ts) and no capability in the catalog
-- names it. An org-wide write grant that exists only because it was never
-- narrowed is an impersonation primitive: rewriting a colleague's
-- display_name or email changes who every audit line, digest and Team &
-- Access row appears to be about.
--
-- So the org half is dropped rather than trigger-guarded column by
-- column. The profiles privilege guard stays as defense in depth for the
-- phone pair (it also holds if this policy is ever widened again).
CREATE POLICY profiles_update_self
  ON public.profiles FOR UPDATE
  TO authenticated
  USING      (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY profiles_delete_owner_only
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.profile_shares_current_org(id)
         AND public.current_user_role() = 'owner');

-- --- organization_memberships ---------------------------------------------
--
-- No INSERT grant: membership creation is not an API operation. Reads and
-- role/status writes are org-scoped by RLS; WHO may write which row is the
-- privilege trigger's job, which is why the UPDATE policy deliberately lets
-- a member's own row through — a self-escalation attempt must reach the
-- trigger and raise 42501 rather than being silently filtered to zero rows.

GRANT SELECT, UPDATE, DELETE ON public.organization_memberships TO authenticated;

CREATE POLICY memberships_select_own_org
  ON public.organization_memberships FOR SELECT
  TO authenticated
  USING (organization_id = public.current_user_org_id()
         OR user_id = (SELECT auth.uid()));

CREATE POLICY memberships_update_own_org
  ON public.organization_memberships FOR UPDATE
  TO authenticated
  USING      (organization_id = public.current_user_org_id())
  WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY memberships_delete_owner_only
  ON public.organization_memberships FOR DELETE
  TO authenticated
  USING (organization_id = public.current_user_org_id()
         AND public.current_user_role() = 'owner');

-- --- membership_property_grants -------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_property_grants TO authenticated;

CREATE POLICY membership_property_grants_select_own_org
  ON public.membership_property_grants FOR SELECT
  TO authenticated
  USING (public.membership_in_current_org(membership_id));

CREATE POLICY membership_property_grants_insert_owner_only
  ON public.membership_property_grants FOR INSERT
  TO authenticated
  WITH CHECK (public.membership_in_current_org(membership_id)
              AND public.current_user_role() = 'owner');

CREATE POLICY membership_property_grants_update_owner_only
  ON public.membership_property_grants FOR UPDATE
  TO authenticated
  USING      (public.membership_in_current_org(membership_id)
              AND public.current_user_role() = 'owner')
  WITH CHECK (public.membership_in_current_org(membership_id)
              AND public.current_user_role() = 'owner');

CREATE POLICY membership_property_grants_delete_owner_only
  ON public.membership_property_grants FOR DELETE
  TO authenticated
  USING (public.membership_in_current_org(membership_id)
         AND public.current_user_role() = 'owner');

-- --- membership_capability_overrides --------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.membership_capability_overrides TO authenticated;

CREATE POLICY membership_capability_overrides_select_own_org
  ON public.membership_capability_overrides FOR SELECT
  TO authenticated
  USING (public.membership_in_current_org(membership_id));

CREATE POLICY membership_capability_overrides_insert_owner_only
  ON public.membership_capability_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.membership_in_current_org(membership_id)
              AND public.current_user_role() = 'owner');

CREATE POLICY membership_capability_overrides_update_owner_only
  ON public.membership_capability_overrides FOR UPDATE
  TO authenticated
  USING      (public.membership_in_current_org(membership_id)
              AND public.current_user_role() = 'owner')
  WITH CHECK (public.membership_in_current_org(membership_id)
              AND public.current_user_role() = 'owner');

CREATE POLICY membership_capability_overrides_delete_owner_only
  ON public.membership_capability_overrides FOR DELETE
  TO authenticated
  USING (public.membership_in_current_org(membership_id)
         AND public.current_user_role() = 'owner');

-- --- organization_invitations ---------------------------------------------
--
-- No INSERT grant: create_organization_invitation() is the only mint. No
-- DELETE grant: an invitation is revoked (revoked_at), never erased, so the
-- audit trail survives. UPDATE is owner-only and exists for exactly that.

GRANT SELECT, UPDATE ON public.organization_invitations TO authenticated;

CREATE POLICY organization_invitations_select_owner_only
  ON public.organization_invitations FOR SELECT
  TO authenticated
  USING (organization_id = public.current_user_org_id()
         AND public.current_user_role() = 'owner');

CREATE POLICY organization_invitations_update_owner_only
  ON public.organization_invitations FOR UPDATE
  TO authenticated
  USING      (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id()
              AND public.current_user_role() = 'owner');

-- =========================================================================
-- 6. Invitation RPCs (Decision K + the Decision A lockout guard)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_organization_invitation(
  p_organization_id uuid,
  p_email           text,
  p_role            public.user_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller     uuid := auth.uid();
  raw_token  text;
  expires    timestamptz := now() + interval '7 days';
  new_id     uuid;
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.user_id = caller
       AND m.organization_id = p_organization_id
       AND m.role = 'owner'::public.user_role
       AND m.status = 'active'::public.membership_status
  ) THEN
    RAISE EXCEPTION 'create_organization_invitation: owner-only'
      USING ERRCODE = '42501';
  END IF;

  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'create_organization_invitation: a valid email is required'
      USING ERRCODE = '22023';
  END IF;

  -- 32 random bytes, hex-encoded. Returned to the caller exactly once and
  -- never persisted; only the digest below is stored.
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.organization_invitations (
    organization_id, email, role, token_hash, invited_by, expires_at
  )
  VALUES (
    p_organization_id,
    lower(btrim(p_email)),
    p_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    caller,
    expires
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'status', 'created',
    'invitation_id', new_id,
    'token', raw_token,
    'expires_at', expires
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_invitation(uuid, text, public.user_role)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invitation(uuid, text, public.user_role)
  TO authenticated, service_role;

-- claim_organization_invitation reports outcomes in its payload rather than
-- raising, because "this token is not for you" is a normal answer, not a
-- fault. Every non-'claimed' payload is JUST the status: an unknown token
-- must not confirm that some invitation exists, nor for which org or email.
--
-- Email verification is read from auth.users.email_confirmed_at, not from a
-- JWT claim: a forged or stale token carrying email_verified would
-- otherwise be enough to join an organization.
CREATE OR REPLACE FUNCTION public.claim_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller        uuid := auth.uid();
  caller_email  text;
  confirmed_at  timestamptz;
  inv           public.organization_invitations%ROWTYPE;
  hashed        text;
  other_active  int;
BEGIN
  IF caller IS NULL OR p_token IS NULL OR p_token = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  -- Serialize every invitation claim for this caller, including claims for
  -- DIFFERENT invitation rows. Locking only the invitation cannot protect the
  -- later "does this user already have an active membership?" check: two
  -- transactions can otherwise lock two invitations, both count zero, and
  -- both insert. The stable profile row is the per-user mutex. Under READ
  -- COMMITTED the membership query below takes a fresh snapshot after a wait,
  -- so the loser observes the winner's committed membership and returns the
  -- honest switching_unavailable outcome without consuming its invitation.
  PERFORM 1
     FROM public.profiles p
    WHERE p.id = caller
      FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  hashed := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT * INTO inv
    FROM public.organization_invitations i
   WHERE i.token_hash = hashed
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF inv.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'revoked');
  END IF;

  -- Single use: a spent token is indistinguishable from a bogus one.
  IF inv.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF inv.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT au.email, au.email_confirmed_at
    INTO caller_email, confirmed_at
    FROM auth.users au
   WHERE au.id = caller;

  IF confirmed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'email_unverified');
  END IF;

  IF caller_email IS NULL OR lower(caller_email) IS DISTINCT FROM lower(inv.email) THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.user_id = caller
       AND m.organization_id = inv.organization_id
       AND m.status = 'active'::public.membership_status
  ) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;

  -- Decision A lockout guard. The data layer permits a second membership,
  -- but nothing in the product can switch between them yet, and
  -- current_user_org_id() returns NULL for an ambiguous caller — accepting
  -- here would lock the user out of the org they already have. The
  -- invitation is left OPEN so a future org-switching phase can honour it.
  SELECT count(*) INTO other_active
    FROM public.organization_memberships m
   WHERE m.user_id = caller
     AND m.status = 'active'::public.membership_status;

  IF other_active > 0 THEN
    RETURN jsonb_build_object('status', 'switching_unavailable');
  END IF;

  -- Compare-and-set on accepted_at: the replay guard, even under a race.
  UPDATE public.organization_invitations
     SET accepted_at = now()
   WHERE id = inv.id
     AND accepted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  PERFORM set_config('odesa.membership_claim', '1', true);
  INSERT INTO public.organization_memberships (user_id, organization_id, role, status)
  VALUES (caller, inv.organization_id, inv.role, 'active'::public.membership_status);
  PERFORM set_config('odesa.membership_claim', '0', true);

  RETURN jsonb_build_object(
    'status', 'claimed',
    'organization_id', inv.organization_id,
    'role', inv.role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_organization_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_organization_invitation(text) TO authenticated, service_role;

-- =========================================================================
-- 7. Signup trigger — org minting is now conditional
-- =========================================================================
--
-- Before, EVERY signup minted an organization (falling back to the email
-- local part for a name), which is why an invited user arrived owning a
-- junk org and could never be a clean first-time invitee. Now:
--
--   organization_name present AND no open invitation for this email
--     -> mint the organization + an owner membership (self-serve signup)
--   otherwise
--     -> create the profile only, leaving the user in an explicit
--        "assignment required" state with NO membership, which
--        current_user_org_id() resolves to NULL, i.e. no access to
--        anything until an invitation is claimed.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_org_id  uuid;
  org_name    text;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone_e164)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.email,
    NEW.raw_user_meta_data ->> 'phone_e164'
  )
  ON CONFLICT (id) DO NOTHING;

  org_name := nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'organization_name', '')), '');

  IF org_name IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.organization_invitations i
     WHERE lower(i.email) = lower(coalesce(NEW.email, ''))
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
  ) THEN
    INSERT INTO public.organizations (name)
    VALUES (org_name)
    RETURNING id INTO new_org_id;

    INSERT INTO public.organization_memberships (user_id, organization_id, role, status)
    VALUES (NEW.id, new_org_id, 'owner', 'active');
  END IF;

  RETURN NEW;
END;
$$;

-- =========================================================================
-- 8. public.users — read-only compatibility VIEW (created LAST)
-- =========================================================================
--
-- Exposes the pre-split column set for e2e/ and scripts/ READS only, so the
-- Wave 1b cutover does not have to land in one commit. Product code must
-- not read it; S4 drops it.
--
-- security_invoker = true so the underlying profiles/memberships RLS
-- applies to the caller (same rationale as
-- 20260422000000_fix_view_security_invoker.sql). A definer-semantics view
-- here would be a cross-org read of exactly the table we just split apart.
-- Read-only: no INSERT/UPDATE/DELETE grant and no rules, so a stale writer
-- fails loudly instead of writing somewhere that no longer exists.

CREATE VIEW public.users AS
SELECT
  p.id,
  m.organization_id,
  m.role,
  p.email,
  p.full_name,
  p.display_name,
  p.phone_e164,
  p.phone_verified_at,
  p.avatar_url,
  p.created_at,
  p.updated_at
FROM public.profiles p
JOIN public.organization_memberships m
  ON m.user_id = p.id
 AND m.status = 'active'::public.membership_status;

ALTER VIEW public.users SET (security_invoker = true);

REVOKE ALL  ON public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.users TO authenticated, service_role;
