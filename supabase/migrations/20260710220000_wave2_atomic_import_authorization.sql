-- Wave 2: atomic, durable portfolio import + work-order role defense.
-- Integration order: intentionally after Wave 1 migration 20260710213000,
-- which owns the one-active-or-pending-lease-per-unit invariant.

CREATE TABLE public.import_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  source text NOT NULL CHECK (source IN ('appfolio', 'buildium', 'rentredi', 'generic')),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE public.import_entities (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('property', 'unit', 'tenant', 'lease')),
  natural_key text NOT NULL,
  entity_id uuid NOT NULL,
  import_request_id uuid NOT NULL REFERENCES public.import_requests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entity_type, natural_key),
  UNIQUE (import_request_id, entity_type, natural_key)
);

ALTER TABLE public.import_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_entities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_requests, public.import_entities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_requests, public.import_entities TO service_role;

CREATE OR REPLACE FUNCTION public.commit_portfolio_import(
  p_organization_id uuid,
  p_idempotency_key text,
  p_source text,
  p_payload_hash text,
  p_plan jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_variable
DECLARE
  request_id uuid;
  prior_hash text;
  prior_result jsonb;
  item jsonb;
  entity_id uuid;
  property_id uuid;
  unit_id uuid;
  tenant_id uuid;
  property_key text;
  unit_key text;
  tenant_key text;
  inserted_properties integer := 0;
  inserted_units integer := 0;
  inserted_tenants integer := 0;
  inserted_leases integer := 0;
  skipped_properties integer := 0;
  skipped_units integer := 0;
  skipped_tenants integer := 0;
  skipped_leases integer := 0;
  canonical_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid idempotency key' USING ERRCODE = '22000';
  END IF;
  IF p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid payload hash' USING ERRCODE = '22000';
  END IF;
  IF p_source NOT IN ('appfolio', 'buildium', 'rentredi', 'generic') THEN
    RAISE EXCEPTION 'invalid import source' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_plan) <> 'object' THEN
    RAISE EXCEPTION 'invalid import plan' USING ERRCODE = '22000';
  END IF;
  IF jsonb_typeof(p_plan->'properties') <> 'array'
     OR jsonb_typeof(p_plan->'units') <> 'array'
     OR jsonb_typeof(p_plan->'tenants') <> 'array'
     OR jsonb_typeof(p_plan->'leases') <> 'array'
     OR jsonb_array_length(p_plan->'leases') = 0 THEN
    RAISE EXCEPTION 'import plan is missing required entity rows' USING ERRCODE = '22000';
  END IF;

  -- Serialize imports per organization. This durable PostgreSQL transaction
  -- lock also protects retries that accidentally use a different request key.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  SELECT id, payload_hash, result
    INTO request_id, prior_hash, prior_result
    FROM public.import_requests
   WHERE organization_id = p_organization_id
     AND idempotency_key = p_idempotency_key;

  IF request_id IS NOT NULL THEN
    IF prior_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'idempotency key already used with a different payload'
        USING ERRCODE = '22000';
    END IF;
    RETURN jsonb_build_object(
      'summary', prior_result->'summary',
      'replay', true,
      'importRequestId', request_id
    );
  END IF;

  INSERT INTO public.import_requests (
    organization_id, idempotency_key, source, payload_hash, result
  ) VALUES (
    p_organization_id, p_idempotency_key, p_source, p_payload_hash, '{}'::jsonb
  ) RETURNING id INTO request_id;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'properties', '[]'::jsonb)) LOOP
    IF nullif(item->>'naturalKey', '') IS NULL OR nullif(item#>>'{data,name}', '') IS NULL THEN
      RAISE EXCEPTION 'invalid required property row' USING ERRCODE = '22000';
    END IF;
    SELECT ie.entity_id INTO entity_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'property'
       AND ie.natural_key = item->>'naturalKey';
    IF entity_id IS NULL THEN
      SELECT p.id INTO entity_id FROM public.properties p
       WHERE p.organization_id = p_organization_id
         AND lower(p.name) = lower(item#>>'{data,name}')
         AND lower(p.address_street) IS NOT DISTINCT FROM lower(nullif(item#>>'{data,addressStreet}', ''))
       LIMIT 1;
    END IF;
    IF entity_id IS NULL THEN
      INSERT INTO public.properties (
        organization_id, name, address_street, address_city, address_state, address_zip
      ) VALUES (
        p_organization_id, item#>>'{data,name}', nullif(item#>>'{data,addressStreet}', ''),
        nullif(item#>>'{data,addressCity}', ''), nullif(item#>>'{data,addressState}', ''),
        nullif(item#>>'{data,addressZip}', '')
      ) RETURNING id INTO entity_id;
      inserted_properties := inserted_properties + 1;
    ELSE
      skipped_properties := skipped_properties + 1;
    END IF;
    INSERT INTO public.import_entities VALUES (
      p_organization_id, 'property', item->>'naturalKey', entity_id, request_id, now()
    ) ON CONFLICT (organization_id, entity_type, natural_key) DO NOTHING;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'units', '[]'::jsonb)) LOOP
    IF nullif(item->>'naturalKey', '') IS NULL OR nullif(item#>>'{data,label}', '') IS NULL THEN
      RAISE EXCEPTION 'invalid required unit row' USING ERRCODE = '22000';
    END IF;
    property_key := array_to_string((string_to_array(item->>'naturalKey', '::'))[1:2], '::');
    SELECT ie.entity_id INTO property_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'property'
       AND ie.natural_key = property_key;
    IF property_id IS NULL THEN
      RAISE EXCEPTION 'unit missing property reference' USING ERRCODE = '23503';
    END IF;
    SELECT ie.entity_id INTO entity_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'unit'
       AND ie.natural_key = item->>'naturalKey';
    IF entity_id IS NULL THEN
      SELECT u.id INTO entity_id FROM public.units u
       WHERE u.organization_id = p_organization_id AND u.property_id = property_id
         AND lower(u.label) = lower(item#>>'{data,label}') LIMIT 1;
    END IF;
    IF entity_id IS NULL THEN
      INSERT INTO public.units (organization_id, property_id, label, bedrooms, bathrooms)
      VALUES (
        p_organization_id, property_id, item#>>'{data,label}',
        nullif(item#>>'{data,bedrooms}', '')::integer,
        nullif(item#>>'{data,bathrooms}', '')::numeric
      ) RETURNING id INTO entity_id;
      inserted_units := inserted_units + 1;
    ELSE
      skipped_units := skipped_units + 1;
    END IF;
    INSERT INTO public.import_entities VALUES (
      p_organization_id, 'unit', item->>'naturalKey', entity_id, request_id, now()
    ) ON CONFLICT (organization_id, entity_type, natural_key) DO NOTHING;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'tenants', '[]'::jsonb)) LOOP
    IF nullif(item->>'naturalKey', '') IS NULL OR nullif(item#>>'{data,fullName}', '') IS NULL
       OR nullif(item#>>'{data,phoneE164}', '') IS NULL THEN
      RAISE EXCEPTION 'invalid required tenant row' USING ERRCODE = '22000';
    END IF;
    SELECT ie.entity_id INTO entity_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'tenant'
       AND ie.natural_key = item->>'naturalKey';
    IF entity_id IS NULL THEN
      SELECT t.id INTO entity_id FROM public.tenants t
       WHERE t.organization_id = p_organization_id
         AND (t.phone_e164 = item#>>'{data,phoneE164}'
           OR (nullif(item#>>'{data,email}', '') IS NOT NULL
             AND lower(t.email) = lower(item#>>'{data,email}'))) LIMIT 1;
    END IF;
    IF entity_id IS NULL THEN
      INSERT INTO public.tenants (
        organization_id, full_name, phone_e164, email, date_of_birth
      ) VALUES (
        p_organization_id, item#>>'{data,fullName}', item#>>'{data,phoneE164}',
        nullif(item#>>'{data,email}', ''), nullif(item#>>'{data,dateOfBirth}', '')::date
      ) RETURNING id INTO entity_id;
      inserted_tenants := inserted_tenants + 1;
    ELSE
      skipped_tenants := skipped_tenants + 1;
    END IF;
    INSERT INTO public.import_entities VALUES (
      p_organization_id, 'tenant', item->>'naturalKey', entity_id, request_id, now()
    ) ON CONFLICT (organization_id, entity_type, natural_key) DO NOTHING;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_plan->'leases', '[]'::jsonb)) LOOP
    IF nullif(item->>'naturalKey', '') IS NULL OR (item#>>'{data,rentAmount}') IS NULL
       OR (item#>>'{data,rentDueDay}') IS NULL THEN
      RAISE EXCEPTION 'invalid required lease row' USING ERRCODE = '22000';
    END IF;
    unit_key := array_to_string((string_to_array(item->>'naturalKey', '::'))[1:3], '::');
    tenant_key := array_to_string(
      (string_to_array(item->>'naturalKey', '::'))[4:array_length(string_to_array(item->>'naturalKey', '::'), 1)-1],
      '::'
    );
    SELECT ie.entity_id INTO unit_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'unit'
       AND ie.natural_key = unit_key;
    SELECT ie.entity_id INTO tenant_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'tenant'
       AND ie.natural_key = tenant_key;
    IF unit_id IS NULL OR tenant_id IS NULL THEN
      RAISE EXCEPTION 'lease missing unit or tenant reference' USING ERRCODE = '23503';
    END IF;
    SELECT ie.entity_id INTO entity_id FROM public.import_entities ie
     WHERE ie.organization_id = p_organization_id AND ie.entity_type = 'lease'
       AND ie.natural_key = item->>'naturalKey';
    IF entity_id IS NULL THEN
      SELECT l.id INTO entity_id FROM public.leases l
       WHERE l.organization_id = p_organization_id AND l.unit_id = unit_id
         AND l.tenant_id = tenant_id
         AND l.start_date IS NOT DISTINCT FROM nullif(item#>>'{data,startDate}', '')::date
       LIMIT 1;
    END IF;
    IF entity_id IS NULL THEN
      -- Wave 1 (20260710213000) establishes one active OR pending lease per
      -- unit. Take the same unit-row lock used by that invariant's write path
      -- so imports cannot race tenant creation or another occupancy import.
      PERFORM 1 FROM public.units u
       WHERE u.id = unit_id AND u.organization_id = p_organization_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'lease missing unit reference' USING ERRCODE = '23503';
      END IF;
      IF (item#>>'{data,status}') IN ('active', 'pending')
         AND EXISTS (
           SELECT 1 FROM public.leases occupied
            WHERE occupied.unit_id = unit_id
              AND occupied.status IN ('active', 'pending')
         ) THEN
        RAISE EXCEPTION 'unit_not_vacant' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.leases (
        organization_id, unit_id, tenant_id, rent_amount, rent_due_day,
        start_date, end_date, status
      ) VALUES (
        p_organization_id, unit_id, tenant_id, (item#>>'{data,rentAmount}')::numeric,
        (item#>>'{data,rentDueDay}')::integer, nullif(item#>>'{data,startDate}', '')::date,
        nullif(item#>>'{data,endDate}', '')::date, (item#>>'{data,status}')::lease_status
      ) RETURNING id INTO entity_id;
      inserted_leases := inserted_leases + 1;
    ELSE
      skipped_leases := skipped_leases + 1;
    END IF;
    INSERT INTO public.import_entities VALUES (
      p_organization_id, 'lease', item->>'naturalKey', entity_id, request_id, now()
    ) ON CONFLICT (organization_id, entity_type, natural_key) DO NOTHING;
  END LOOP;

  canonical_result := jsonb_build_object('summary', jsonb_build_object(
    'inserted', jsonb_build_object(
      'properties', inserted_properties, 'units', inserted_units,
      'tenants', inserted_tenants, 'leases', inserted_leases
    ),
    'skipped', jsonb_build_object(
      'properties', skipped_properties, 'units', skipped_units,
      'tenants', skipped_tenants, 'leases', skipped_leases
    ),
    'errors', '[]'::jsonb
  ));
  UPDATE public.import_requests SET result = canonical_result, completed_at = now()
   WHERE id = request_id;
  RETURN canonical_result || jsonb_build_object('replay', false, 'importRequestId', request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_portfolio_import(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_portfolio_import(uuid, text, text, text, jsonb)
  TO service_role;

-- Human work-order mutation is owner-only and audit construction is entirely
-- database-owned. The row lock makes concurrent timeline appends lossless.
CREATE OR REPLACE FUNCTION public.mutate_work_order_audited(
  p_work_order_id uuid,
  p_urgency work_order_urgency DEFAULT NULL,
  p_status work_order_status DEFAULT NULL,
  p_vendor_id uuid DEFAULT NULL,
  p_set_vendor boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_variable
DECLARE
  actor_id uuid := auth.uid();
  actor_org_id uuid;
  actor_role user_role;
  current_row public.work_orders%ROWTYPE;
  next_urgency work_order_urgency;
  next_status work_order_status;
  next_vendor_id uuid;
  transitions jsonb := '[]'::jsonb;
  audit_entry jsonb;
  changed boolean := false;
BEGIN
  SELECT u.organization_id, u.role
    INTO actor_org_id, actor_role
    FROM public.users u
   WHERE u.id = actor_id;
  IF actor_id IS NULL OR actor_org_id IS NULL OR actor_role IS DISTINCT FROM 'owner'::user_role THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO current_row
    FROM public.work_orders wo
   WHERE wo.id = p_work_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work_order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF current_row.organization_id <> actor_org_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  next_urgency := COALESCE(p_urgency, current_row.urgency);
  next_status := COALESCE(p_status, current_row.status);
  next_vendor_id := CASE WHEN p_set_vendor THEN p_vendor_id ELSE current_row.vendor_id END;

  IF p_set_vendor AND p_vendor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.vendors v
     WHERE v.id = p_vendor_id AND v.organization_id = actor_org_id
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF next_urgency IS DISTINCT FROM current_row.urgency THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'urgency', 'from', current_row.urgency, 'to', next_urgency
    ));
    changed := true;
  END IF;
  IF next_status IS DISTINCT FROM current_row.status THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'status', 'from', current_row.status, 'to', next_status
    ));
    changed := true;
  END IF;
  IF next_vendor_id IS DISTINCT FROM current_row.vendor_id THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'vendor_id', 'from', current_row.vendor_id, 'to', next_vendor_id
    ));
    changed := true;
  END IF;

  IF changed THEN
    audit_entry := jsonb_build_object(
      'at', clock_timestamp(),
      'status', next_status,
      'source', 'human_edit',
      'actor_id', actor_id,
      'actor_role', actor_role,
      'transitions', transitions,
      'note', actor_role::text || ' changed ' || (
        SELECT string_agg(
          t->>'field' || ' from ' || COALESCE(t->>'from', 'unassigned') ||
          ' to ' || COALESCE(t->>'to', 'unassigned'), '; '
        ) FROM jsonb_array_elements(transitions) t
      ) || '.'
    );
    UPDATE public.work_orders
       SET urgency = next_urgency,
           status = next_status,
           vendor_id = next_vendor_id,
           status_timeline = jsonb_build_array(audit_entry) || COALESCE(current_row.status_timeline, '[]'::jsonb)
     WHERE id = current_row.id;
  END IF;

  RETURN jsonb_build_object(
    'changed', changed,
    'unitId', current_row.unit_id,
    'status', next_status,
    'urgency', next_urgency,
    'vendorId', next_vendor_id,
    'audit', audit_entry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_work_order_audited(uuid, work_order_urgency, work_order_status, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_work_order_audited(uuid, work_order_urgency, work_order_status, uuid, boolean)
  TO authenticated;

-- Owners cannot bypass or fabricate the audit through direct table UPDATE.
REVOKE UPDATE ON public.work_orders FROM authenticated;
DROP POLICY IF EXISTS work_orders_update_own_org ON public.work_orders;
CREATE POLICY work_orders_update_owner_only
  ON public.work_orders FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
