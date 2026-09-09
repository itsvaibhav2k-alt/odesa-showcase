-- Temporary compatibility writes for the shipped production callers that
-- still target public.users after the stable membership split.
--
-- public.users remains a security-invoker projection. This adapter does not
-- make it a second source of truth: identity writes land in profiles and role
-- writes land in the caller's one concrete membership. It exists only to
-- preserve shipped Owner/VA behavior while new Accountant code uses the
-- membership access seam directly.

CREATE OR REPLACE FUNCTION public.write_legacy_users_view()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_role text := coalesce(auth.role(), '');
  is_service boolean := caller_role = 'service_role' OR caller IS NULL;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_service THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.profiles (
      id, email, full_name, display_name, phone_e164,
      phone_verified_at, avatar_url, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.email, NEW.full_name, NEW.display_name, NEW.phone_e164,
      NEW.phone_verified_at, NEW.avatar_url,
      coalesce(NEW.created_at, now()), coalesce(NEW.updated_at, now())
    );

    INSERT INTO public.organization_memberships (
      user_id, organization_id, role, status, all_properties
    ) VALUES (
      NEW.id, NEW.organization_id, NEW.role,
      'active'::public.membership_status, true
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT is_service THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.profiles WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'legacy users identity cannot be re-keyed'
      USING ERRCODE = '42501';
  END IF;

  IF NOT is_service THEN
    IF OLD.id = caller THEN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
      END IF;
    ELSE
      IF public.current_user_role() IS DISTINCT FROM 'owner'::public.user_role
         OR public.current_user_org_id() IS DISTINCT FROM OLD.organization_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
         OR NEW.email IS DISTINCT FROM OLD.email
         OR NEW.full_name IS DISTINCT FROM OLD.full_name
         OR NEW.display_name IS DISTINCT FROM OLD.display_name
         OR NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164
         OR NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at
         OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
        RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles
     SET email = NEW.email,
         full_name = NEW.full_name,
         display_name = NEW.display_name,
         phone_e164 = NEW.phone_e164,
         phone_verified_at = NEW.phone_verified_at,
         avatar_url = NEW.avatar_url
   WHERE id = OLD.id;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.role IS DISTINCT FROM OLD.role THEN
    UPDATE public.organization_memberships
       SET organization_id = NEW.organization_id,
           role = NEW.role
     WHERE user_id = OLD.id
       AND organization_id = OLD.organization_id
       AND status = 'active'::public.membership_status;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'legacy users membership is missing or ambiguous'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.write_legacy_users_view()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER users_compat_write
  INSTEAD OF INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.write_legacy_users_view();

GRANT UPDATE ON public.users TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.users TO service_role;
