-- Wave 1: one occupancy lease per unit + atomic, authorized Add Tenant.

-- Fail loudly if historical conflicts exist; do not silently choose a lease.
DROP INDEX IF EXISTS public.uq_leases_one_active_per_unit;
CREATE UNIQUE INDEX IF NOT EXISTS uq_leases_one_occupancy_per_unit
  ON public.leases(unit_id)
  WHERE status IN ('active', 'pending');

-- A lease document must identify the exact lease it evidences. Historical
-- rows remain NULL/Needs review; tenant+unit is deliberately not backfilled.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS lease_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_leases_organization_id_id
  ON public.leases(organization_id, id);
ALTER TABLE public.documents
  ADD CONSTRAINT documents_organization_lease_fkey
  FOREIGN KEY (organization_id, lease_id)
  REFERENCES public.leases(organization_id, id)
  ON DELETE SET NULL (lease_id);
CREATE INDEX IF NOT EXISTS documents_lease_idx ON public.documents(lease_id);

CREATE TABLE IF NOT EXISTS public.tenant_lease_requests (
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key     uuid NOT NULL,
  request_fingerprint jsonb NOT NULL,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lease_id            uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, idempotency_key)
);

ALTER TABLE public.tenant_lease_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_lease_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_tenant_with_active_lease(
  p_property_id uuid,
  p_unit_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_email text,
  p_rent_amount numeric,
  p_start_date date,
  p_idempotency_key uuid
)
RETURNS TABLE (tenant_id uuid, lease_id uuid, idempotent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org_id uuid;
  v_fingerprint jsonb;
  v_existing public.tenant_lease_requests%ROWTYPE;
  v_tenant_id uuid;
  v_lease_id uuid;
  v_rent_due_day smallint;
BEGIN
  v_org_id := public.current_user_org_id();
  IF auth.uid() IS NULL
     OR v_org_id IS NULL
     OR public.current_user_role() IS DISTINCT FROM 'owner'::public.user_role THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(p_full_name, '')) = ''
     OR p_phone_e164 IS NULL
     OR NOT (
       p_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
       AND (
         p_phone_e164 !~ '^\+1'
         OR p_phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'
       )
     )
     OR p_rent_amount IS NULL
     OR p_rent_amount < 0 THEN
    RAISE EXCEPTION 'invalid_tenant_lease_request' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := jsonb_build_object(
    'property_id', p_property_id,
    'unit_id', p_unit_id,
    'full_name', btrim(p_full_name),
    'phone_e164', p_phone_e164,
    'email', nullif(btrim(COALESCE(p_email, '')), ''),
    'rent_amount', p_rent_amount,
    'start_date', p_start_date
  );

  -- Identical request retries serialize even before a unit is locked.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_org_id::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT * INTO v_existing
    FROM public.tenant_lease_requests r
   WHERE r.organization_id = v_org_id
     AND r.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_existing.tenant_id, v_existing.lease_id, true;
    RETURN;
  END IF;

  -- The row lock serializes different request keys racing for one unit.
  PERFORM 1
    FROM public.units u
   WHERE u.id = p_unit_id
     AND u.property_id = p_property_id
     AND u.organization_id = v_org_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Pending is not vacant either: it represents an assigned move-in.
  IF EXISTS (
    SELECT 1
      FROM public.leases l
     WHERE l.unit_id = p_unit_id
       AND l.organization_id = v_org_id
       AND l.status IN ('active', 'pending')
  ) THEN
    RAISE EXCEPTION 'unit_not_vacant' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.tenants (
    organization_id, full_name, phone_e164, email
  ) VALUES (
    v_org_id, btrim(p_full_name), p_phone_e164,
    nullif(btrim(COALESCE(p_email, '')), '')
  )
  ON CONFLICT (organization_id, phone_e164) DO UPDATE
    SET phone_e164 = EXCLUDED.phone_e164
  RETURNING id INTO v_tenant_id;

  v_rent_due_day := COALESCE(EXTRACT(day FROM p_start_date)::smallint, 1);
  INSERT INTO public.leases (
    organization_id, unit_id, tenant_id, rent_amount, rent_due_day,
    start_date, status
  ) VALUES (
    v_org_id, p_unit_id, v_tenant_id, p_rent_amount, v_rent_due_day,
    p_start_date, 'active'
  )
  RETURNING id INTO v_lease_id;

  INSERT INTO public.tenant_lease_requests (
    organization_id, idempotency_key, request_fingerprint, tenant_id, lease_id
  ) VALUES (
    v_org_id, p_idempotency_key, v_fingerprint, v_tenant_id, v_lease_id
  );

  RETURN QUERY SELECT v_tenant_id, v_lease_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tenant_with_active_lease(
  uuid, uuid, text, text, text, numeric, date, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_active_lease(
  uuid, uuid, text, text, text, numeric, date, uuid
) TO authenticated;

COMMENT ON FUNCTION public.create_tenant_with_active_lease(
  uuid, uuid, text, text, text, numeric, date, uuid
) IS 'Owner-only atomic and idempotent tenant + active lease creation with an active-or-pending vacancy lock.';
