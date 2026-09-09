-- Wave 5: work-order vendor lifecycle.
-- Adds an explicit, owner-only, optimistically-locked, idempotent state machine
-- for the vendor half of a work order (assign / respond / start / complete /
-- approve / reopen / cancel). Wave 2's five-argument
-- `mutate_work_order_audited` remains callable, but is narrowed to urgency-only
-- semantics so its legacy status/vendor arguments cannot bypass this machine.

-- Vendor's answer to an assignment. `no_response` is ONLY ever set by an
-- explicit operator record_response action — never inferred from a timeout.
CREATE TYPE work_order_vendor_response AS ENUM ('accepted', 'declined', 'no_response');

ALTER TABLE public.work_orders
  ADD COLUMN vendor_response     work_order_vendor_response,
  ADD COLUMN vendor_responded_at timestamptz,
  ADD COLUMN vendor_assigned_at  timestamptz,
  ADD COLUMN reviewed_at         timestamptz,
  ADD COLUMN lifecycle_version   bigint NOT NULL DEFAULT 0;

-- Idempotency + audit ledger for lifecycle mutations. A row is keyed by
-- (work_order_id, request_id); an exact retry replays the stored canonical
-- result verbatim even after lifecycle_version has advanced.
CREATE TABLE public.work_order_mutation_requests (
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  request_id    uuid NOT NULL,
  payload_hash  text NOT NULL,
  result        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, request_id)
);

ALTER TABLE public.work_order_mutation_requests ENABLE ROW LEVEL SECURITY;
-- Ledger is written only by the SECURITY DEFINER function below; no direct app access.
REVOKE ALL ON public.work_order_mutation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_mutation_requests TO service_role;

-- Authenticated callers may no longer manufacture lifecycle/audit state with a
-- raw INSERT, or erase a work order and its cascading request ledger/history.
-- Service-role ingestion/fixtures remain available; owner UI creation uses the
-- audited SECURITY DEFINER function below.
REVOKE INSERT, DELETE ON public.work_orders FROM authenticated;
DROP POLICY IF EXISTS work_orders_insert_own_org ON public.work_orders;
DROP POLICY IF EXISTS work_orders_delete_own_org ON public.work_orders;

CREATE OR REPLACE FUNCTION public.create_work_order_audited(
  p_unit_id uuid,
  p_tenant_id uuid,
  p_category work_order_category,
  p_urgency work_order_urgency,
  p_description text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_org_id uuid;
  actor_role user_role;
  new_id uuid;
BEGIN
  SELECT u.organization_id, u.role
    INTO actor_org_id, actor_role
    FROM public.users u
   WHERE u.id = actor_id;
  IF actor_id IS NULL OR actor_org_id IS NULL OR actor_role IS DISTINCT FROM 'owner'::user_role THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.units u
     WHERE u.id = p_unit_id AND u.organization_id = actor_org_id
  ) THEN
    RAISE EXCEPTION 'unit_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_tenant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.tenants t
      JOIN public.leases l ON l.tenant_id = t.id AND l.unit_id = p_unit_id
     WHERE t.id = p_tenant_id AND t.organization_id = actor_org_id
  ) THEN
    RAISE EXCEPTION 'tenant_not_found_for_unit' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.work_orders (
    organization_id, unit_id, tenant_id, category, urgency, status,
    description, status_timeline, vendor_id, vendor_response,
    vendor_assigned_at, vendor_responded_at, reviewed_at, lifecycle_version
  ) VALUES (
    actor_org_id, p_unit_id, p_tenant_id, p_category, p_urgency, 'open',
    p_description,
    jsonb_build_array(jsonb_build_object(
      'at', clock_timestamp(),
      'status', 'open',
      'source', 'lifecycle',
      'actor_id', actor_id,
      'actor_role', actor_role,
      'transitions', jsonb_build_array(jsonb_build_object(
        'field', 'status', 'from', NULL, 'to', 'open'
      )),
      'note', 'owner created work order.'
    )),
    NULL, NULL, NULL, NULL, NULL, 0
  ) RETURNING id INTO new_id;

  RETURN jsonb_build_object('id', new_id, 'unitId', p_unit_id, 'status', 'open');
END;
$$;

REVOKE ALL ON FUNCTION public.create_work_order_audited(uuid, uuid, work_order_category, work_order_urgency, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order_audited(uuid, uuid, work_order_category, work_order_urgency, text)
  TO authenticated;

-- Owner-only vendor lifecycle state machine. All audit construction, version
-- bookkeeping and idempotency live in the database so the app cannot fabricate
-- or skip an audit entry, and a retried request is lossless.
CREATE OR REPLACE FUNCTION public.mutate_work_order_lifecycle(
  p_work_order_id uuid,
  p_action text,
  p_expected_version bigint,
  p_request_id uuid,
  p_vendor_id uuid DEFAULT NULL,
  p_vendor_response work_order_vendor_response DEFAULT NULL
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
  v_payload_hash text;
  v_prior_hash text;
  v_prior_result jsonb;
  next_status work_order_status;
  next_vendor_id uuid;
  next_vendor_response work_order_vendor_response;
  next_vendor_assigned_at timestamptz;
  next_vendor_responded_at timestamptz;
  next_reviewed_at timestamptz;
  transitions jsonb := '[]'::jsonb;
  audit_entry jsonb := NULL;
  changed boolean := false;
  v_new_version bigint;
  v_result jsonb;
BEGIN
  -- 1. Shape validation.
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request id is required' USING ERRCODE = '22000';
  END IF;
  IF p_expected_version IS NULL THEN
    RAISE EXCEPTION 'expected version is required' USING ERRCODE = '22000';
  END IF;
  IF p_action IS NULL OR p_action NOT IN (
    'assign_vendor', 'record_response', 'reassign_vendor',
    'start_work', 'complete', 'approve', 'reopen', 'cancel'
  ) THEN
    RAISE EXCEPTION 'unknown work order action: %', COALESCE(p_action, '(null)')
      USING ERRCODE = '22000';
  END IF;

  -- 2. Owner/org auth gate.
  SELECT u.organization_id, u.role
    INTO actor_org_id, actor_role
    FROM public.users u
   WHERE u.id = actor_id;
  IF actor_id IS NULL OR actor_org_id IS NULL OR actor_role IS DISTINCT FROM 'owner'::user_role THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- 3. Lock the row.
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

  -- 4. Canonical payload hash of the normalized inputs.
  v_payload_hash := md5(
    p_action || ':' ||
    coalesce(p_vendor_id::text, '') || ':' ||
    coalesce(p_vendor_response::text, '')
  );

  -- 5. Idempotency replay — BEFORE the stale check, so an exact retry of an
  -- already-applied request replays its canonical result even though
  -- lifecycle_version has since advanced (retry must NOT get stale_write).
  SELECT payload_hash, result INTO v_prior_hash, v_prior_result
    FROM public.work_order_mutation_requests
   WHERE work_order_id = p_work_order_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_prior_hash = v_payload_hash THEN
      RETURN v_prior_result;
    END IF;
    RAISE EXCEPTION 'idempotency_conflict: request already used with a different payload'
      USING ERRCODE = '22000';
  END IF;

  -- 6. Optimistic stale check.
  -- NON-retryable SQLSTATE on purpose: 40001 (serialization_failure) makes
  -- PostgREST auto-retry the statement, and because this function holds a
  -- FOR UPDATE lock the retry self-contends and hangs to a gateway timeout.
  -- 55000 (object_not_in_prerequisite_state) is not retried, so the stale
  -- write (and the concurrency loser, which re-reads the bumped version after
  -- the FOR UPDATE unblocks) returns promptly. This is also the loser raise.
  IF p_expected_version <> current_row.lifecycle_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = '55000';
  END IF;

  -- 7 + 8 (compute). Seed next_* from current, then apply per-action effects,
  -- validating the transition against the current state.
  next_status              := current_row.status;
  next_vendor_id           := current_row.vendor_id;
  next_vendor_response     := current_row.vendor_response;
  next_vendor_assigned_at  := current_row.vendor_assigned_at;
  next_vendor_responded_at := current_row.vendor_responded_at;
  next_reviewed_at         := current_row.reviewed_at;

  IF p_action = 'assign_vendor' THEN
    IF current_row.status <> 'open' OR current_row.vendor_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_transition: cannot assign_vendor from status %', current_row.status
        USING ERRCODE = '22000';
    END IF;
    IF p_vendor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_transition: assign_vendor requires a vendor' USING ERRCODE = '22000';
    END IF;
    next_status              := 'assigned';
    next_vendor_id           := p_vendor_id;
    next_vendor_assigned_at  := now();
    next_vendor_response     := NULL;
    next_vendor_responded_at := NULL;

  ELSIF p_action = 'reassign_vendor' THEN
    IF current_row.status <> 'assigned' OR current_row.vendor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_transition: cannot reassign_vendor from status %', current_row.status
        USING ERRCODE = '22000';
    END IF;
    IF p_vendor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_transition: reassign_vendor requires a vendor' USING ERRCODE = '22000';
    END IF;
    IF p_vendor_id = current_row.vendor_id THEN
      RAISE EXCEPTION 'invalid_transition: choose a different vendor for reassignment' USING ERRCODE = '22000';
    END IF;
    next_status              := 'assigned';
    next_vendor_id           := p_vendor_id;
    next_vendor_assigned_at  := now();
    next_vendor_response     := NULL;
    next_vendor_responded_at := NULL;
    next_reviewed_at         := NULL;

  ELSIF p_action = 'record_response' THEN
    IF current_row.status <> 'assigned' OR current_row.vendor_id IS NULL THEN
      RAISE EXCEPTION 'invalid_transition: cannot record_response from status % (vendor assigned: %)',
        current_row.status, (current_row.vendor_id IS NOT NULL) USING ERRCODE = '22000';
    END IF;
    IF p_vendor_response IS NULL THEN
      RAISE EXCEPTION 'invalid_transition: record_response requires a vendor_response' USING ERRCODE = '22000';
    END IF;
    -- A duplicate response is a truthful no-op: preserve both the stored
    -- response and its canonical timestamp. Only a semantic response change
    -- receives a new timestamp.
    IF p_vendor_response IS DISTINCT FROM current_row.vendor_response THEN
      next_vendor_response     := p_vendor_response;
      next_vendor_responded_at := now();
    END IF;

  ELSIF p_action = 'start_work' THEN
    IF current_row.status <> 'assigned' OR current_row.vendor_id IS NULL
       OR current_row.vendor_response IS DISTINCT FROM 'accepted'::work_order_vendor_response THEN
      RAISE EXCEPTION 'invalid_transition: start_work requires an accepted vendor response'
        USING ERRCODE = '22000';
    END IF;
    next_status := 'in_progress';

  ELSIF p_action = 'complete' THEN
    IF current_row.status <> 'in_progress' THEN
      RAISE EXCEPTION 'invalid_transition: cannot complete from status %', current_row.status
        USING ERRCODE = '22000';
    END IF;
    next_status := 'completed';

  ELSIF p_action = 'approve' THEN
    IF current_row.status <> 'completed' OR current_row.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_transition: cannot approve from status % (reviewed: %)',
        current_row.status, (current_row.reviewed_at IS NOT NULL) USING ERRCODE = '22000';
    END IF;
    next_reviewed_at := now();

  ELSIF p_action = 'reopen' THEN
    IF current_row.status <> 'completed' OR current_row.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_transition: cannot reopen from status % (reviewed: %)',
        current_row.status, (current_row.reviewed_at IS NOT NULL) USING ERRCODE = '22000';
    END IF;
    next_status      := 'in_progress';
    next_reviewed_at := NULL;

  ELSIF p_action = 'cancel' THEN
    IF current_row.status NOT IN ('open', 'assigned', 'in_progress') THEN
      RAISE EXCEPTION 'invalid_transition: cannot cancel from status %', current_row.status
        USING ERRCODE = '22000';
    END IF;
    next_status := 'cancelled';
  END IF;

  -- Vendor-org check whenever a vendor is being set.
  IF p_action IN ('assign_vendor', 'reassign_vendor') AND NOT EXISTS (
    SELECT 1 FROM public.vendors v
     WHERE v.id = p_vendor_id AND v.organization_id = actor_org_id
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Build the semantic transition list (drives both `changed` and the note).
  IF next_status IS DISTINCT FROM current_row.status THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'status', 'from', current_row.status, 'to', next_status));
  END IF;
  IF next_vendor_id IS DISTINCT FROM current_row.vendor_id THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'vendor_id', 'from', current_row.vendor_id, 'to', next_vendor_id));
  END IF;
  IF next_vendor_response IS DISTINCT FROM current_row.vendor_response THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'vendor_response', 'from', current_row.vendor_response, 'to', next_vendor_response));
  END IF;
  IF (next_reviewed_at IS NOT NULL) IS DISTINCT FROM (current_row.reviewed_at IS NOT NULL) THEN
    transitions := transitions || jsonb_build_array(jsonb_build_object(
      'field', 'reviewed', 'from', (current_row.reviewed_at IS NOT NULL), 'to', (next_reviewed_at IS NOT NULL)));
  END IF;
  changed := jsonb_array_length(transitions) > 0;

  -- Version bumps and audit are written ONLY on a real mutation.
  IF changed THEN
    audit_entry := jsonb_build_object(
      'at', clock_timestamp(),
      'status', next_status,
      'source', 'lifecycle',
      'actor_id', actor_id,
      'actor_role', actor_role,
      'transitions', transitions,
      'note', actor_role::text || ' ' || p_action || ' — ' || (
        SELECT string_agg(
          t->>'field' || ' from ' || COALESCE(t->>'from', 'unassigned') ||
          ' to ' || COALESCE(t->>'to', 'unassigned'), '; '
        ) FROM jsonb_array_elements(transitions) t
      ) || '.'
    );
    v_new_version := current_row.lifecycle_version + 1;
    UPDATE public.work_orders
       SET status              = next_status,
           vendor_id           = next_vendor_id,
           vendor_response     = next_vendor_response,
           vendor_assigned_at  = next_vendor_assigned_at,
           vendor_responded_at = next_vendor_responded_at,
           reviewed_at         = next_reviewed_at,
           lifecycle_version   = v_new_version,
           status_timeline     = jsonb_build_array(audit_entry) || COALESCE(current_row.status_timeline, '[]'::jsonb)
     WHERE id = current_row.id;
  ELSE
    v_new_version := current_row.lifecycle_version;
  END IF;

  v_result := jsonb_build_object(
    'changed', changed,
    'unitId', current_row.unit_id,
    'status', next_status,
    'urgency', current_row.urgency,
    'vendorId', next_vendor_id,
    'vendorResponse', next_vendor_response,
    'vendorAssignedAt', next_vendor_assigned_at,
    'vendorRespondedAt', next_vendor_responded_at,
    'reviewedAt', next_reviewed_at,
    'lifecycleVersion', v_new_version,
    'audit', audit_entry
  );

  -- 9. Persist the canonical result for idempotent replay.
  INSERT INTO public.work_order_mutation_requests (work_order_id, request_id, payload_hash, result)
  VALUES (p_work_order_id, p_request_id, v_payload_hash, v_result);

  -- 10.
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_work_order_lifecycle(uuid, text, bigint, uuid, uuid, work_order_vendor_response)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_work_order_lifecycle(uuid, text, bigint, uuid, uuid, work_order_vendor_response)
  TO authenticated;
-- Direct UPDATE on work_orders stays revoked from authenticated (Wave 2) — not re-granted here.

-- Preserve the exact Wave 2 five-argument identity for PostgREST callers, but
-- deterministically reject lifecycle arguments. A real urgency change also
-- advances lifecycle_version, so any page holding the previous version cannot
-- perform a stale Wave 5 transition after this legacy call.
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
  audit_entry jsonb := NULL;
  changed boolean := false;
  new_version bigint;
BEGIN
  SELECT u.organization_id, u.role
    INTO actor_org_id, actor_role
    FROM public.users u
   WHERE u.id = actor_id;
  IF actor_id IS NULL OR actor_org_id IS NULL OR actor_role IS DISTINCT FROM 'owner'::user_role THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NOT NULL OR COALESCE(p_set_vendor, false) OR p_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION 'lifecycle_mutation_requires_mutate_work_order_lifecycle'
      USING ERRCODE = '22000';
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
  changed := next_urgency IS DISTINCT FROM current_row.urgency;
  new_version := current_row.lifecycle_version;

  IF changed THEN
    audit_entry := jsonb_build_object(
      'at', clock_timestamp(),
      'status', current_row.status,
      'source', 'human_edit',
      'actor_id', actor_id,
      'actor_role', actor_role,
      'transitions', jsonb_build_array(jsonb_build_object(
        'field', 'urgency', 'from', current_row.urgency, 'to', next_urgency
      )),
      'note', actor_role::text || ' changed urgency from ' || current_row.urgency::text ||
        ' to ' || next_urgency::text || '.'
    );
    new_version := current_row.lifecycle_version + 1;
    UPDATE public.work_orders
       SET urgency = next_urgency,
           lifecycle_version = new_version,
           status_timeline = jsonb_build_array(audit_entry) || COALESCE(current_row.status_timeline, '[]'::jsonb)
     WHERE id = current_row.id;
  END IF;

  RETURN jsonb_build_object(
    'changed', changed,
    'unitId', current_row.unit_id,
    'status', current_row.status,
    'urgency', next_urgency,
    'vendorId', current_row.vendor_id,
    'lifecycleVersion', new_version,
    'audit', audit_entry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mutate_work_order_audited(uuid, work_order_urgency, work_order_status, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_work_order_audited(uuid, work_order_urgency, work_order_status, uuid, boolean)
  TO authenticated;
