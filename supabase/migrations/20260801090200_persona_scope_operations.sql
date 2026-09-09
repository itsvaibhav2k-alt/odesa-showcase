-- Odesa V1 personas — scope-aware staff invitations only.
--
-- The stable reference continues below this selected section with Manager
-- contact-creation work. Accountant does not depend on that product surface,
-- so it is deliberately absent from this worktree.

-- Invitations minted before this scope contract retained the old org-wide
-- meaning. Preserve that meaning explicitly; new invitations default closed.
UPDATE public.organization_invitations
   SET all_properties = true;

DROP FUNCTION public.create_organization_invitation(uuid, text, public.user_role);

CREATE FUNCTION public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.user_role,
  p_all_properties boolean DEFAULT false,
  p_property_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller uuid := auth.uid();
  raw_token text;
  expires timestamptz := now() + interval '7 days';
  new_id uuid;
  normalized_property_ids uuid[];
  effective_all_properties boolean;
BEGIN
  IF caller IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.user_id = caller
       AND m.organization_id = p_organization_id
       AND m.role = 'owner'::public.user_role
       AND m.status = 'active'::public.membership_status
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'create_organization_invitation: a valid email is required'
      USING ERRCODE = '22023';
  END IF;

  effective_all_properties := p_role = 'owner'::public.user_role
                              OR coalesce(p_all_properties, false);

  SELECT coalesce(array_agg(DISTINCT requested_id), '{}'::uuid[])
    INTO normalized_property_ids
    FROM unnest(coalesce(p_property_ids, '{}'::uuid[])) requested(requested_id)
   WHERE requested_id IS NOT NULL;

  IF NOT effective_all_properties AND EXISTS (
    SELECT 1
      FROM unnest(normalized_property_ids) requested(property_id)
      LEFT JOIN public.properties p
        ON p.id = requested.property_id
       AND p.organization_id = p_organization_id
     WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'create_organization_invitation: invalid property scope'
      USING ERRCODE = '22023';
  END IF;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.organization_invitations (
    organization_id,
    email,
    role,
    token_hash,
    invited_by,
    expires_at,
    all_properties
  )
  VALUES (
    p_organization_id,
    lower(btrim(p_email)),
    p_role,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    caller,
    expires,
    effective_all_properties
  )
  RETURNING id INTO new_id;

  IF NOT effective_all_properties THEN
    INSERT INTO public.organization_invitation_property_grants (
      invitation_id,
      organization_id,
      property_id
    )
    SELECT new_id, p_organization_id, requested.property_id
      FROM unnest(normalized_property_ids) requested(property_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'created',
    'invitation_id', new_id,
    'token', raw_token,
    'expires_at', expires,
    'all_properties', effective_all_properties,
    'property_count', CASE
      WHEN effective_all_properties THEN NULL
      ELSE cardinality(normalized_property_ids)
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_invitation(
  uuid, text, public.user_role, boolean, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invitation(
  uuid, text, public.user_role, boolean, uuid[]
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_organization_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_email text;
  confirmed_at timestamptz;
  inv public.organization_invitations%ROWTYPE;
  hashed text;
  other_active int;
  new_membership_id uuid;
BEGIN
  IF caller IS NULL OR p_token IS NULL OR p_token = '' THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

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

  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF inv.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF inv.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;

  SELECT au.email, au.email_confirmed_at
    INTO caller_email, confirmed_at
    FROM auth.users au
   WHERE au.id = caller;
  IF confirmed_at IS NULL THEN RETURN jsonb_build_object('status', 'email_unverified'); END IF;
  IF caller_email IS NULL OR lower(caller_email) IS DISTINCT FROM lower(inv.email) THEN
    RETURN jsonb_build_object('status', 'email_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_memberships m
     WHERE m.user_id = caller
       AND m.organization_id = inv.organization_id
       AND m.status = 'active'
  ) THEN
    RETURN jsonb_build_object('status', 'already_member');
  END IF;

  SELECT count(*) INTO other_active
    FROM public.organization_memberships m
   WHERE m.user_id = caller
     AND m.status = 'active';
  IF other_active > 0 THEN
    RETURN jsonb_build_object('status', 'switching_unavailable');
  END IF;

  UPDATE public.organization_invitations
     SET accepted_at = now()
   WHERE id = inv.id
     AND accepted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;

  PERFORM set_config('odesa.membership_claim', '1', true);
  INSERT INTO public.organization_memberships (
    user_id,
    organization_id,
    role,
    status,
    all_properties
  )
  VALUES (
    caller,
    inv.organization_id,
    inv.role,
    'active'::public.membership_status,
    inv.all_properties
  )
  RETURNING id INTO new_membership_id;

  INSERT INTO public.membership_property_grants (
    membership_id,
    organization_id,
    property_id
  )
  SELECT new_membership_id, g.organization_id, g.property_id
    FROM public.organization_invitation_property_grants g
   WHERE g.invitation_id = inv.id
     AND inv.all_properties = false;
  PERFORM set_config('odesa.membership_claim', '0', true);

  RETURN jsonb_build_object(
    'status', 'claimed',
    'organization_id', inv.organization_id,
    'role', inv.role,
    'all_properties', inv.all_properties
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_organization_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_organization_invitation(text)
  TO authenticated, service_role;
