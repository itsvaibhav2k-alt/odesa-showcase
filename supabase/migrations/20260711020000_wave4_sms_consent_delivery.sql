-- Wave 4: durable SMS consent, exactly-once dispatch claims, and truthful delivery.

CREATE TYPE public.messaging_consent_state AS ENUM ('unknown', 'opted_in', 'suppressed');
CREATE TYPE public.message_delivery_status AS ENUM (
  'draft', 'approved', 'queued', 'provider_accepted',
  'delivered', 'undelivered', 'failed', 'suppressed'
);

CREATE TABLE public.messaging_recipient_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_e164 text NOT NULL,
  state public.messaging_consent_state NOT NULL DEFAULT 'unknown',
  transition_version bigint NOT NULL DEFAULT 0,
  last_transition_at timestamptz,
  last_transition_rank smallint NOT NULL DEFAULT 0,
  last_transition_event_key text,
  last_transition_had_provider_time boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, recipient_e164),
  CHECK (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE public.messaging_consent_command_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_e164 text NOT NULL,
  command text NOT NULL CHECK (command IN ('stop', 'start', 'help')),
  provider public.message_provider,
  provider_message_id text,
  event_key text NOT NULL UNIQUE,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE public.messaging_consent_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id uuid NOT NULL REFERENCES public.messaging_recipient_consents(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recipient_e164 text NOT NULL,
  from_state public.messaging_consent_state NOT NULL,
  to_state public.messaging_consent_state NOT NULL,
  command text NOT NULL CHECK (command IN ('stop', 'start', 'help')),
  provider public.message_provider,
  provider_message_id text,
  command_event_id uuid NOT NULL REFERENCES public.messaging_consent_command_events(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (command_event_id)
);

CREATE OR REPLACE FUNCTION public.reject_consent_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Cascaded organization/message erasure is the sole allowed delete path;
  -- direct history edits/deletes remain impossible.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'messaging consent transition history is immutable';
END;
$$;

CREATE TRIGGER messaging_consent_transitions_immutable
  BEFORE UPDATE OR DELETE ON public.messaging_consent_transitions
  FOR EACH ROW EXECUTE FUNCTION public.reject_consent_history_mutation();
CREATE TRIGGER messaging_consent_command_events_immutable
  BEFORE UPDATE OR DELETE ON public.messaging_consent_command_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_consent_history_mutation();

ALTER TABLE public.messages
  ADD COLUMN delivery_status public.message_delivery_status NOT NULL DEFAULT 'draft',
  ADD COLUMN recipient_e164 text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN provider_accepted_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN delivery_status_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN delivery_error text;

CREATE UNIQUE INDEX uq_messages_org_idempotency
  ON public.messages(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_messages_outbound_provider_id
  ON public.messages(provider, provider_message_id)
  WHERE direction = 'outbound' AND provider_message_id IS NOT NULL;

UPDATE public.messages
SET delivery_status = CASE
      WHEN direction = 'inbound' THEN 'delivered'::public.message_delivery_status
      WHEN provider_message_id IS NOT NULL THEN 'provider_accepted'::public.message_delivery_status
      WHEN draft_status = 'sending' THEN 'queued'::public.message_delivery_status
      WHEN draft_status IN ('approved', 'auto_sent', 'sent_by_human') THEN 'approved'::public.message_delivery_status
      ELSE 'draft'::public.message_delivery_status
    END,
    provider_accepted_at = CASE WHEN direction = 'outbound' AND provider_message_id IS NOT NULL
      THEN sent_at ELSE NULL END,
    delivery_status_updated_at = COALESCE(sent_at, created_at);

CREATE OR REPLACE FUNCTION public.sync_message_draft_lifecycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direction = 'outbound' THEN
    IF NEW.draft_status = 'pending_review' AND NEW.delivery_status IN ('draft', 'approved', 'failed') THEN
      NEW.delivery_status := 'draft';
      NEW.delivery_status_updated_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_message_draft_lifecycle
  BEFORE INSERT OR UPDATE OF draft_status ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.sync_message_draft_lifecycle();

CREATE TABLE public.message_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  from_status public.message_delivery_status,
  to_status public.message_delivery_status NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_message_lifecycle_events_message
  ON public.message_lifecycle_events(message_id, occurred_at);
CREATE OR REPLACE FUNCTION public.audit_message_lifecycle_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.delivery_status IS DISTINCT FROM OLD.delivery_status THEN
    INSERT INTO public.message_lifecycle_events(organization_id, message_id, from_status, to_status, occurred_at)
    VALUES (NEW.organization_id, NEW.id,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.delivery_status END,
      NEW.delivery_status, NEW.delivery_status_updated_at);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_message_lifecycle_transition
  AFTER INSERT OR UPDATE OF delivery_status ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.audit_message_lifecycle_transition();
CREATE TRIGGER message_lifecycle_events_immutable
  BEFORE UPDATE OR DELETE ON public.message_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_consent_history_mutation();
ALTER TABLE public.message_lifecycle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_lifecycle_events_org_read ON public.message_lifecycle_events
  FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE TABLE public.outbound_message_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  recipient_e164 text NOT NULL,
  idempotency_key text NOT NULL,
  body_sha256 text NOT NULL,
  status public.message_delivery_status NOT NULL DEFAULT 'queued',
  provider public.message_provider,
  provider_message_id text,
  last_error text,
  attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (provider, provider_message_id),
  CHECK (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE public.outbound_message_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.outbound_message_dispatches(id) ON DELETE CASCADE,
  provider public.message_provider NOT NULL,
  attempt_number integer NOT NULL,
  lease_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  lease_expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN (
    'leased', 'network_started', 'provider_accepted',
    'definitive_failure', 'ambiguous', 'suppressed'
  )),
  network_started_at timestamptz,
  completed_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_id, attempt_number)
);
CREATE INDEX idx_outbound_attempts_dispatch_status
  ON public.outbound_message_attempts(dispatch_id, status);

CREATE TABLE public.message_delivery_callback_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  dispatch_id uuid REFERENCES public.outbound_message_dispatches(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  provider public.message_provider NOT NULL,
  provider_message_id text NOT NULL,
  provider_event_id text NOT NULL,
  status public.message_delivery_status NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_delivery_callback_pending
  ON public.message_delivery_callback_inbox(provider, provider_message_id)
  WHERE dispatch_id IS NULL;

CREATE TABLE public.message_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dispatch_id uuid NOT NULL REFERENCES public.outbound_message_dispatches(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  provider public.message_provider NOT NULL,
  provider_message_id text NOT NULL,
  provider_event_id text NOT NULL,
  status public.message_delivery_status NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_delivery_events_canonical
  ON public.message_delivery_events(dispatch_id, occurred_at DESC, received_at DESC);

ALTER TABLE public.messaging_recipient_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messaging_consent_command_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messaging_consent_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_message_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_message_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_delivery_callback_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY messaging_recipient_consents_org_read ON public.messaging_recipient_consents
  FOR SELECT USING (organization_id = public.current_user_org_id());
CREATE POLICY messaging_consent_command_events_org_read ON public.messaging_consent_command_events
  FOR SELECT USING (organization_id = public.current_user_org_id());
CREATE POLICY messaging_consent_transitions_org_read ON public.messaging_consent_transitions
  FOR SELECT USING (organization_id = public.current_user_org_id());
CREATE POLICY outbound_message_dispatches_org_read ON public.outbound_message_dispatches
  FOR SELECT USING (organization_id = public.current_user_org_id());
CREATE POLICY outbound_message_attempts_org_read ON public.outbound_message_attempts
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.outbound_message_dispatches d
    WHERE d.id = dispatch_id AND d.organization_id = public.current_user_org_id()
  ));
CREATE POLICY message_delivery_callback_inbox_org_read ON public.message_delivery_callback_inbox
  FOR SELECT USING (organization_id = public.current_user_org_id());
CREATE POLICY message_delivery_events_org_read ON public.message_delivery_events
  FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE OR REPLACE FUNCTION public.apply_messaging_consent_command(
  p_organization_id uuid,
  p_recipient_e164 text,
  p_command text,
  p_provider public.message_provider DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now()
) RETURNS TABLE(state public.messaging_consent_state, changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.messaging_recipient_consents%ROWTYPE;
  v_event public.messaging_consent_command_events%ROWTYPE;
  v_next public.messaging_consent_state;
  v_changed boolean := false;
  v_rank smallint;
  v_effective_at timestamptz;
  v_ordered boolean := false;
  v_event_key text;
BEGIN
  IF p_recipient_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'invalid recipient E.164';
  END IF;
  IF p_command NOT IN ('stop', 'start', 'help') THEN
    RAISE EXCEPTION 'unsupported consent command';
  END IF;

  v_rank := CASE p_command WHEN 'stop' THEN 3 WHEN 'start' THEN 2 ELSE 1 END;
  v_event_key := CASE
    WHEN p_provider IS NOT NULL AND p_provider_message_id IS NOT NULL
      THEN p_provider::text || ':' || p_provider_message_id || ':' || p_command
    ELSE encode(extensions.digest(convert_to(
      p_organization_id::text || ':' || p_recipient_e164 || ':' || p_command || ':' ||
      COALESCE(p_occurred_at::text, 'no-provider-time'), 'UTF8'), 'sha256'), 'hex')
  END;

  -- Claim the immutable provider event before calculating or mutating state.
  INSERT INTO public.messaging_consent_command_events(
    organization_id, recipient_e164, command, provider,
    provider_message_id, event_key, occurred_at
  ) VALUES (
    p_organization_id, p_recipient_e164, p_command, p_provider,
    p_provider_message_id, v_event_key, p_occurred_at
  ) ON CONFLICT (event_key) DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT c.state INTO state FROM public.messaging_recipient_consents c
    WHERE c.organization_id = p_organization_id AND c.recipient_e164 = p_recipient_e164;
    state := COALESCE(state, 'unknown'::public.messaging_consent_state);
    changed := false;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.messaging_recipient_consents(organization_id, recipient_e164)
  VALUES (p_organization_id, p_recipient_e164)
  ON CONFLICT (organization_id, recipient_e164) DO NOTHING;

  SELECT * INTO v_row FROM public.messaging_recipient_consents
  WHERE organization_id = p_organization_id AND recipient_e164 = p_recipient_e164
  FOR UPDATE;

  v_effective_at := COALESCE(p_occurred_at, v_event.received_at);
  v_ordered := v_row.last_transition_at IS NULL
    OR v_effective_at > v_row.last_transition_at
    OR (v_effective_at = v_row.last_transition_at AND v_rank > v_row.last_transition_rank);

  -- A timestamp-less START cannot safely prove it happened after a STOP.
  -- STOP remains conservative and wins equal or otherwise ambiguous order.
  IF p_command = 'start' AND p_occurred_at IS NULL THEN
    v_ordered := false;
  ELSIF p_command = 'stop' AND p_occurred_at IS NULL THEN
    v_ordered := true;
  END IF;

  v_next := CASE
    WHEN p_command = 'stop' AND v_ordered THEN 'suppressed'::public.messaging_consent_state
    WHEN p_command = 'start' AND v_ordered AND v_row.state = 'suppressed'
      THEN 'opted_in'::public.messaging_consent_state
    ELSE v_row.state
  END;
  v_changed := v_next IS DISTINCT FROM v_row.state;

  INSERT INTO public.messaging_consent_transitions(
    consent_id, organization_id, recipient_e164, from_state, to_state,
    command, provider, provider_message_id, command_event_id, occurred_at,
    metadata
  ) VALUES (
    v_row.id, p_organization_id, p_recipient_e164, v_row.state, v_next,
    p_command, p_provider, p_provider_message_id, v_event.id, v_effective_at,
    jsonb_build_object('changed', v_changed, 'ordered', v_ordered,
      'provider_time_present', p_occurred_at IS NOT NULL)
  );

  IF v_ordered AND p_command IN ('stop', 'start') THEN
    UPDATE public.messaging_recipient_consents
    SET state = v_next,
        transition_version = transition_version + CASE WHEN v_changed THEN 1 ELSE 0 END,
        last_transition_at = v_effective_at,
        last_transition_rank = v_rank,
        last_transition_event_key = v_event_key,
        last_transition_had_provider_time = p_occurred_at IS NOT NULL,
        updated_at = now()
    WHERE id = v_row.id;
  END IF;

  IF p_command = 'stop' AND v_ordered THEN
    UPDATE public.outbound_message_attempts a
    SET status = 'suppressed', completed_at = now()
    FROM public.outbound_message_dispatches d
    WHERE a.dispatch_id = d.id
      AND d.organization_id = p_organization_id
      AND d.recipient_e164 = p_recipient_e164
      AND a.status = 'leased';

    UPDATE public.outbound_message_dispatches d
    SET status = 'suppressed', updated_at = now()
    WHERE d.organization_id = p_organization_id
      AND d.recipient_e164 = p_recipient_e164
      AND d.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM public.outbound_message_attempts a
        WHERE a.dispatch_id = d.id
          AND a.status IN ('network_started', 'ambiguous', 'provider_accepted')
      );

    UPDATE public.messages m
    SET delivery_status = 'suppressed', delivery_status_updated_at = now()
    WHERE m.id IN (
      SELECT d.message_id FROM public.outbound_message_dispatches d
      WHERE d.organization_id = p_organization_id
        AND d.recipient_e164 = p_recipient_e164
        AND d.status = 'suppressed'
        AND d.message_id IS NOT NULL
    ) AND m.delivery_status IN ('approved', 'queued');
  END IF;

  state := v_next;
  changed := v_changed;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_outbound_message_dispatch(
  p_organization_id uuid,
  p_message_id uuid,
  p_recipient_e164 text,
  p_idempotency_key text,
  p_body_sha256 text
) RETURNS TABLE(
  dispatch_id uuid,
  outcome text,
  canonical_provider public.message_provider,
  canonical_provider_message_id text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_consent public.messaging_recipient_consents%ROWTYPE;
  v_dispatch public.outbound_message_dispatches%ROWTYPE;
  v_inserted boolean := false;
BEGIN
  INSERT INTO public.messaging_recipient_consents(organization_id, recipient_e164)
  VALUES (p_organization_id, p_recipient_e164)
  ON CONFLICT (organization_id, recipient_e164) DO NOTHING;
  SELECT * INTO v_consent FROM public.messaging_recipient_consents
  WHERE organization_id = p_organization_id AND recipient_e164 = p_recipient_e164
  FOR UPDATE;

  INSERT INTO public.outbound_message_dispatches(
    organization_id, message_id, recipient_e164, idempotency_key, body_sha256,
    status
  ) VALUES (
    p_organization_id, p_message_id, p_recipient_e164, p_idempotency_key,
    p_body_sha256,
    CASE WHEN v_consent.state = 'suppressed'
      THEN 'suppressed'::public.message_delivery_status
      ELSE 'queued'::public.message_delivery_status END
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING * INTO v_dispatch;
  v_inserted := FOUND;

  IF NOT v_inserted THEN
    SELECT * INTO v_dispatch FROM public.outbound_message_dispatches
    WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF v_dispatch.body_sha256 <> p_body_sha256 OR v_dispatch.recipient_e164 <> p_recipient_e164 THEN
      RAISE EXCEPTION 'idempotency key reused with different outbound payload';
    END IF;
  END IF;

  IF v_consent.state = 'suppressed' AND v_dispatch.status NOT IN ('delivered', 'undelivered', 'failed') THEN
    UPDATE public.outbound_message_dispatches SET status = 'suppressed', updated_at = now()
    WHERE id = v_dispatch.id;
    IF p_message_id IS NOT NULL THEN
      UPDATE public.messages SET delivery_status = 'suppressed', recipient_e164 = p_recipient_e164,
        idempotency_key = COALESCE(idempotency_key, p_idempotency_key),
        delivery_status_updated_at = now()
      WHERE id = p_message_id;
    END IF;
    RETURN QUERY SELECT v_dispatch.id, 'suppressed'::text, v_dispatch.provider, v_dispatch.provider_message_id;
    RETURN;
  END IF;

  IF NOT v_inserted THEN
    IF v_dispatch.status IN ('provider_accepted', 'delivered', 'undelivered') AND v_dispatch.provider_message_id IS NOT NULL THEN
      RETURN QUERY SELECT v_dispatch.id, 'replay'::text, v_dispatch.provider, v_dispatch.provider_message_id;
    ELSE
      RETURN QUERY SELECT v_dispatch.id, 'in_flight'::text, v_dispatch.provider, v_dispatch.provider_message_id;
    END IF;
    RETURN;
  END IF;

  IF p_message_id IS NOT NULL THEN
    UPDATE public.messages SET delivery_status = 'queued', recipient_e164 = p_recipient_e164,
      idempotency_key = COALESCE(idempotency_key, p_idempotency_key),
      delivery_status_updated_at = now()
    WHERE id = p_message_id;
  END IF;
  RETURN QUERY SELECT v_dispatch.id, 'claimed'::text, NULL::public.message_provider, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_pending_delivery_callbacks(p_dispatch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dispatch public.outbound_message_dispatches%ROWTYPE;
  v_canonical public.message_delivery_events%ROWTYPE;
BEGIN
  SELECT * INTO v_dispatch FROM public.outbound_message_dispatches
  WHERE id = p_dispatch_id FOR UPDATE;
  IF NOT FOUND OR v_dispatch.provider IS NULL OR v_dispatch.provider_message_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.message_delivery_callback_inbox
  SET organization_id = v_dispatch.organization_id,
      dispatch_id = v_dispatch.id,
      message_id = v_dispatch.message_id
  WHERE provider = v_dispatch.provider
    AND provider_message_id = v_dispatch.provider_message_id
    AND dispatch_id IS NULL;

  INSERT INTO public.message_delivery_events(
    organization_id, dispatch_id, message_id, provider, provider_message_id,
    provider_event_id, status, occurred_at, received_at, raw_payload
  ) SELECT
    v_dispatch.organization_id, v_dispatch.id, v_dispatch.message_id,
    i.provider, i.provider_message_id, i.provider_event_id, i.status,
    i.occurred_at, i.received_at, i.raw_payload
  FROM public.message_delivery_callback_inbox i
  WHERE i.dispatch_id = v_dispatch.id
  ON CONFLICT (provider, provider_event_id) DO NOTHING;

  SELECT e.* INTO v_canonical FROM public.message_delivery_events e
  WHERE e.dispatch_id = v_dispatch.id
  ORDER BY CASE e.status
      WHEN 'delivered' THEN 5 WHEN 'undelivered' THEN 4 WHEN 'failed' THEN 3
      WHEN 'provider_accepted' THEN 2 ELSE 1 END DESC,
    e.occurred_at DESC NULLS LAST, e.received_at DESC, e.provider_event_id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.outbound_message_dispatches
  SET status = v_canonical.status, updated_at = now()
  WHERE id = v_dispatch.id;
  IF v_dispatch.message_id IS NOT NULL THEN
    UPDATE public.messages SET delivery_status = v_canonical.status,
      delivery_status_updated_at = COALESCE(v_canonical.occurred_at, v_canonical.received_at),
      delivered_at = CASE WHEN v_canonical.status = 'delivered'
        THEN COALESCE(v_canonical.occurred_at, v_canonical.received_at) ELSE delivered_at END,
      delivery_error = CASE WHEN v_canonical.status IN ('failed', 'undelivered')
        THEN COALESCE(v_canonical.raw_payload->>'error', v_canonical.status::text) ELSE NULL END
    WHERE id = v_dispatch.message_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_outbound_dispatch_accepted(
  p_attempt_id uuid,
  p_provider_message_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message_id uuid; v_dispatch_id uuid; v_provider public.message_provider;
BEGIN
  UPDATE public.outbound_message_attempts
  SET status = 'provider_accepted', provider_message_id = p_provider_message_id,
      completed_at = now()
  WHERE id = p_attempt_id AND status = 'network_started'
  RETURNING dispatch_id, provider INTO v_dispatch_id, v_provider;
  IF v_dispatch_id IS NULL THEN
    RAISE EXCEPTION 'attempt is not network-started';
  END IF;
  UPDATE public.outbound_message_dispatches
  SET status = 'provider_accepted', provider = v_provider,
      provider_message_id = p_provider_message_id,
      last_error = NULL, updated_at = now()
  WHERE id = v_dispatch_id
  RETURNING message_id INTO v_message_id;
  IF v_message_id IS NOT NULL THEN
    UPDATE public.messages SET delivery_status = 'provider_accepted', provider = v_provider,
      provider_message_id = p_provider_message_id, provider_accepted_at = now(),
      sent_at = COALESCE(sent_at, now()), delivery_status_updated_at = now(), delivery_error = NULL
    WHERE id = v_message_id;
  END IF;
  PERFORM public.attach_pending_delivery_callbacks(v_dispatch_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.lease_outbound_message_attempt(
  p_dispatch_id uuid,
  p_provider public.message_provider,
  p_lease_seconds integer DEFAULT 120
) RETURNS TABLE(attempt_id uuid, lease_token uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dispatch public.outbound_message_dispatches%ROWTYPE;
  v_consent public.messaging_recipient_consents%ROWTYPE;
  v_attempt public.outbound_message_attempts%ROWTYPE;
  v_attempt_number integer;
BEGIN
  -- Read routing data first, then lock consent before dispatch everywhere.
  SELECT * INTO v_dispatch FROM public.outbound_message_dispatches WHERE id = p_dispatch_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_consent FROM public.messaging_recipient_consents
  WHERE organization_id = v_dispatch.organization_id
    AND recipient_e164 = v_dispatch.recipient_e164 FOR UPDATE;
  SELECT * INTO v_dispatch FROM public.outbound_message_dispatches
  WHERE id = p_dispatch_id FOR UPDATE;

  IF v_dispatch.status <> 'queued' OR v_consent.state = 'suppressed' THEN
    IF v_consent.state = 'suppressed' AND v_dispatch.status = 'queued' THEN
      UPDATE public.outbound_message_dispatches SET status = 'suppressed', updated_at = now()
      WHERE id = p_dispatch_id;
      IF v_dispatch.message_id IS NOT NULL THEN
        UPDATE public.messages SET delivery_status = 'suppressed', delivery_status_updated_at = now()
        WHERE id = v_dispatch.message_id AND delivery_status IN ('approved', 'queued');
      END IF;
    END IF;
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'suppressed'::text;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.outbound_message_attempts
    WHERE dispatch_id = p_dispatch_id
      AND status IN ('leased', 'network_started', 'ambiguous')) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, 'in_flight'::text;
    RETURN;
  END IF;

  SELECT COALESCE(max(attempt_number), 0) + 1 INTO v_attempt_number
  FROM public.outbound_message_attempts WHERE dispatch_id = p_dispatch_id;
  INSERT INTO public.outbound_message_attempts(
    dispatch_id, provider, attempt_number, lease_expires_at, status
  ) VALUES (
    p_dispatch_id, p_provider, v_attempt_number,
    now() + make_interval(secs => greatest(1, least(p_lease_seconds, 300))), 'leased'
  ) RETURNING * INTO v_attempt;
  RETURN QUERY SELECT v_attempt.id, v_attempt.lease_token, 'leased'::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_outbound_message_attempt(
  p_attempt_id uuid,
  p_lease_token uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt public.outbound_message_attempts%ROWTYPE;
  v_dispatch public.outbound_message_dispatches%ROWTYPE;
  v_state public.messaging_consent_state;
BEGIN
  SELECT d.* INTO v_dispatch FROM public.outbound_message_attempts a
  JOIN public.outbound_message_dispatches d ON d.id = a.dispatch_id
  WHERE a.id = p_attempt_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT state INTO v_state FROM public.messaging_recipient_consents
  WHERE organization_id = v_dispatch.organization_id
    AND recipient_e164 = v_dispatch.recipient_e164 FOR UPDATE;
  SELECT * INTO v_dispatch FROM public.outbound_message_dispatches
  WHERE id = v_dispatch.id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.outbound_message_attempts
  WHERE id = p_attempt_id FOR UPDATE;

  IF v_state = 'suppressed' OR v_dispatch.status <> 'queued'
    OR v_attempt.status <> 'leased' OR v_attempt.lease_token <> p_lease_token
    OR v_attempt.lease_expires_at < now() THEN
    IF v_attempt.status = 'leased' THEN
      UPDATE public.outbound_message_attempts SET status = 'suppressed', completed_at = now()
      WHERE id = p_attempt_id;
    END IF;
    IF v_state = 'suppressed' AND v_dispatch.status = 'queued' THEN
      UPDATE public.outbound_message_dispatches SET status = 'suppressed', updated_at = now()
      WHERE id = v_dispatch.id;
      IF v_dispatch.message_id IS NOT NULL THEN
        UPDATE public.messages SET delivery_status = 'suppressed', delivery_status_updated_at = now()
        WHERE id = v_dispatch.message_id AND delivery_status IN ('approved', 'queued');
      END IF;
    END IF;
    RETURN false;
  END IF;

  UPDATE public.outbound_message_attempts
  SET status = 'network_started', network_started_at = now()
  WHERE id = p_attempt_id;
  UPDATE public.outbound_message_dispatches
  SET attempt_count = attempt_count + 1, updated_at = now()
  WHERE id = v_dispatch.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_outbound_dispatch_failure(
  p_attempt_id uuid,
  p_ambiguous boolean,
  p_error text,
  p_terminal boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_message_id uuid; v_dispatch_id uuid; v_provider public.message_provider;
BEGIN
  UPDATE public.outbound_message_attempts
  SET status = CASE WHEN p_ambiguous THEN 'ambiguous' ELSE 'definitive_failure' END,
      error = left(p_error, 1000), completed_at = now()
  WHERE id = p_attempt_id AND status = 'network_started'
  RETURNING dispatch_id, provider INTO v_dispatch_id, v_provider;
  IF v_dispatch_id IS NULL THEN RAISE EXCEPTION 'attempt is not network-started'; END IF;
  UPDATE public.outbound_message_dispatches
  SET status = CASE WHEN p_ambiguous OR NOT p_terminal
        THEN 'queued'::public.message_delivery_status
        ELSE 'failed'::public.message_delivery_status END,
      provider = v_provider,
      last_error = left(p_error, 1000), updated_at = now()
  WHERE id = v_dispatch_id RETURNING message_id INTO v_message_id;
  IF v_message_id IS NOT NULL THEN
    UPDATE public.messages SET delivery_status = CASE WHEN p_ambiguous OR NOT p_terminal
        THEN 'queued'::public.message_delivery_status
        ELSE 'failed'::public.message_delivery_status END,
      delivery_status_updated_at = now(), delivery_error = left(p_error, 1000)
    WHERE id = v_message_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_message_delivery_event(
  p_provider public.message_provider,
  p_provider_message_id text,
  p_provider_event_id text,
  p_status public.message_delivery_status,
  p_occurred_at timestamptz,
  p_raw_payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  message_id uuid,
  dispatch_id uuid,
  canonical_status public.message_delivery_status,
  duplicate boolean,
  pending boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dispatch public.outbound_message_dispatches%ROWTYPE;
  v_inbox_id uuid;
BEGIN
  IF p_status NOT IN ('queued', 'provider_accepted', 'delivered', 'undelivered', 'failed') THEN
    RAISE EXCEPTION 'invalid provider delivery status';
  END IF;
  INSERT INTO public.message_delivery_callback_inbox(
    provider, provider_message_id, provider_event_id, status, occurred_at, raw_payload
  ) VALUES (
    p_provider, p_provider_message_id, p_provider_event_id, p_status,
    p_occurred_at, p_raw_payload
  ) ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_inbox_id;

  SELECT * INTO v_dispatch FROM public.outbound_message_dispatches
  WHERE provider = p_provider AND provider_message_id = p_provider_message_id
  FOR UPDATE;

  duplicate := v_inbox_id IS NULL;
  IF NOT FOUND THEN
    message_id := NULL; dispatch_id := NULL; canonical_status := p_status; pending := true;
    RETURN NEXT;
    RETURN;
  END IF;

  PERFORM public.attach_pending_delivery_callbacks(v_dispatch.id);
  SELECT d.status, d.message_id INTO canonical_status, message_id
  FROM public.outbound_message_dispatches d WHERE d.id = v_dispatch.id;
  dispatch_id := v_dispatch.id; pending := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_messaging_consent_command(uuid,text,text,public.message_provider,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_outbound_message_dispatch(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_outbound_dispatch_accepted(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_pending_delivery_callbacks(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lease_outbound_message_attempt(uuid,public.message_provider,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_outbound_message_attempt(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_outbound_dispatch_failure(uuid,boolean,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_message_delivery_event(public.message_provider,text,text,public.message_delivery_status,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_messaging_consent_command(uuid,text,text,public.message_provider,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_outbound_message_dispatch(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_outbound_dispatch_accepted(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_pending_delivery_callbacks(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lease_outbound_message_attempt(uuid,public.message_provider,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_outbound_message_attempt(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_outbound_dispatch_failure(uuid,boolean,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_message_delivery_event(public.message_provider,text,text,public.message_delivery_status,timestamptz,jsonb) TO service_role;
