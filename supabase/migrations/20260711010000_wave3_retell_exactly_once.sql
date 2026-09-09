-- Wave 3: Retell exactly-once artifacts, durable tool invocations, and
-- truthful proposal execution states.

ALTER TABLE public.conversations ADD COLUMN retell_artifact_key text;
ALTER TABLE public.messages ADD COLUMN retell_artifact_key text;
ALTER TABLE public.action_proposals ADD COLUMN retell_artifact_key text;
ALTER TABLE public.work_orders ADD COLUMN retell_artifact_key text;
ALTER TABLE public.voice_calls ADD COLUMN finalization_richness integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX uq_conversations_retell_artifact_key
  ON public.conversations(retell_artifact_key) WHERE retell_artifact_key IS NOT NULL;
CREATE UNIQUE INDEX uq_messages_retell_artifact_key
  ON public.messages(retell_artifact_key) WHERE retell_artifact_key IS NOT NULL;
CREATE UNIQUE INDEX uq_action_proposals_retell_artifact_key
  ON public.action_proposals(retell_artifact_key) WHERE retell_artifact_key IS NOT NULL;
CREATE UNIQUE INDEX uq_work_orders_retell_artifact_key
  ON public.work_orders(retell_artifact_key) WHERE retell_artifact_key IS NOT NULL;

ALTER TABLE public.action_proposals
  ADD COLUMN execution_evidence jsonb,
  ADD COLUMN retryable boolean NOT NULL DEFAULT false,
  ADD COLUMN last_attempted_at timestamptz;

ALTER TABLE public.action_proposals DROP CONSTRAINT action_proposals_status_check;
ALTER TABLE public.action_proposals ADD CONSTRAINT action_proposals_status_check CHECK (status IN (
  'proposed', 'committing', 'committed', 'failed', 'unsupported',
  'rejected', 'edited', 'expired'
));

CREATE TABLE public.retell_tool_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  tool_name text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'unsupported')),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  claim_generation integer NOT NULL DEFAULT 1,
  lease_expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 seconds'),
  attempt_count integer NOT NULL DEFAULT 1,
  canonical_result jsonb,
  http_status integer,
  error_code text,
  retryable boolean NOT NULL DEFAULT false,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, tool_name, idempotency_key)
);

CREATE INDEX idx_retell_tool_invocations_org_created
  ON public.retell_tool_invocations(organization_id, created_at DESC);

ALTER TABLE public.retell_tool_invocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retell_tool_invocations TO service_role;

CREATE OR REPLACE FUNCTION public.claim_retell_tool_invocation(
  p_organization_id uuid,
  p_call_id text,
  p_tool_name text,
  p_idempotency_key text,
  p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.retell_tool_invocations%ROWTYPE;
  v_inserted boolean := false;
  v_takeover boolean := false;
BEGIN
  INSERT INTO public.retell_tool_invocations (
    organization_id, call_id, tool_name, idempotency_key, request_hash
  ) VALUES (
    p_organization_id, p_call_id, p_tool_name, p_idempotency_key, p_request_hash
  )
  ON CONFLICT (call_id, tool_name, idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_inserted := true;
  ELSE
    SELECT * INTO v_row
      FROM public.retell_tool_invocations
      WHERE call_id = p_call_id
        AND tool_name = p_tool_name
        AND idempotency_key = p_idempotency_key
      FOR UPDATE;
  END IF;

  IF v_row.organization_id <> p_organization_id OR v_row.request_hash <> p_request_hash THEN
    RAISE EXCEPTION 'retell idempotency key reused with different request'
      USING ERRCODE = '22000';
  END IF;

  IF NOT v_inserted AND v_row.status = 'processing' AND v_row.lease_expires_at <= now() THEN
    UPDATE public.retell_tool_invocations
       SET claim_token = gen_random_uuid(),
           lease_expires_at = now() + interval '5 seconds',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,
           updated_at = now()
     WHERE id = v_row.id
       AND status = 'processing'
       AND lease_expires_at <= now()
    RETURNING * INTO v_row;
    v_takeover := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'claimed', v_inserted OR v_takeover,
    'takeover', v_takeover,
    'claim_token', CASE WHEN v_inserted OR v_takeover THEN v_row.claim_token ELSE NULL END,
    'claim_generation', v_row.claim_generation,
    'lease_expires_at', v_row.lease_expires_at,
    'status', v_row.status,
    'canonical_result', v_row.canonical_result,
    'http_status', v_row.http_status,
    'retryable', v_row.retryable,
    'evidence', v_row.evidence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_retell_tool_invocation(
  p_invocation_id uuid,
  p_claim_token uuid,
  p_claim_generation integer,
  p_status text,
  p_canonical_result jsonb,
  p_http_status integer,
  p_error_code text DEFAULT NULL,
  p_retryable boolean DEFAULT false,
  p_evidence jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.retell_tool_invocations%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed', 'failed', 'unsupported') THEN
    RAISE EXCEPTION 'invalid terminal Retell invocation status: %', p_status;
  END IF;

  UPDATE public.retell_tool_invocations
     SET status = p_status,
         canonical_result = p_canonical_result,
         http_status = p_http_status,
         error_code = p_error_code,
         retryable = p_retryable,
         evidence = COALESCE(p_evidence, '{}'::jsonb),
         completed_at = now(),
         updated_at = now()
   WHERE id = p_invocation_id
     AND claim_token = p_claim_token
     AND claim_generation = p_claim_generation
     AND status = 'processing'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.retell_tool_invocations WHERE id = p_invocation_id;
  END IF;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Retell invocation not found';
  END IF;
  IF v_row.claim_token <> p_claim_token OR v_row.claim_generation <> p_claim_generation THEN
    RAISE EXCEPTION 'stale Retell invocation ownership fence'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'canonical_result', v_row.canonical_result,
    'http_status', v_row.http_status,
    'retryable', v_row.retryable,
    'evidence', v_row.evidence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_retell_tool_invocation_lease(
  p_invocation_id uuid,
  p_claim_token uuid,
  p_claim_generation integer
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH renewed AS (
    UPDATE public.retell_tool_invocations
       SET lease_expires_at = now() + interval '5 seconds', updated_at = now()
     WHERE id = p_invocation_id
       AND claim_token = p_claim_token
       AND claim_generation = p_claim_generation
       AND status = 'processing'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM renewed);
$$;

REVOKE ALL ON FUNCTION public.claim_retell_tool_invocation(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_retell_tool_invocation(uuid, uuid, integer, text, jsonb, integer, text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_retell_tool_invocation_lease(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_retell_tool_invocation(uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_retell_tool_invocation(uuid, uuid, integer, text, jsonb, integer, text, boolean, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_retell_tool_invocation_lease(uuid, uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_retell_call_artifacts(
  p_retell_call_id text,
  p_session jsonb,
  p_transcript text,
  p_summary text,
  p_outcome jsonb,
  p_message_body text,
  p_ended_at timestamptz,
  p_needs_review boolean,
  p_property_id uuid,
  p_tenant_id uuid,
  p_proposal_payload jsonb DEFAULT NULL,
  p_proposal_reasoning text DEFAULT NULL,
  p_richness integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_call public.voice_calls%ROWTYPE;
  v_conversation_id uuid;
  v_message_id uuid;
  v_proposal_id uuid;
  v_conversation_key text := p_retell_call_id || ':final:conversation';
  v_message_key text := p_retell_call_id || ':final:message';
  v_proposal_key text := p_retell_call_id || ':final:proposal';
  v_should_enrich boolean;
BEGIN
  SELECT * INTO v_call
    FROM public.voice_calls
    WHERE retell_call_id = p_retell_call_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'voice call % not found', p_retell_call_id;
  END IF;

  IF v_call.status = 'completed' THEN
    v_should_enrich := p_richness > v_call.finalization_richness;
    IF v_should_enrich THEN
      UPDATE public.voice_calls
         SET transcript = p_transcript,
             session = COALESCE(p_session, '{}'::jsonb),
             summary = p_summary,
             outcome = p_outcome,
             finalization_richness = p_richness,
             updated_at = now()
       WHERE id = v_call.id;
      UPDATE public.conversations
         SET summary = p_summary,
             status = CASE WHEN p_needs_review THEN 'escalated'::public.conversation_status
                           ELSE 'open'::public.conversation_status END
       WHERE retell_artifact_key = v_conversation_key;
      UPDATE public.messages SET body = p_message_body
       WHERE retell_artifact_key = v_message_key;
      IF p_needs_review AND p_property_id IS NOT NULL THEN
        INSERT INTO public.action_proposals (
          organization_id, property_id, worker_model, action_type, payload,
          reasoning, confidence, context_fact_ids, gate_decision, status, routing,
          retell_artifact_key
        ) VALUES (
          v_call.organization_id, p_property_id, 'voice-operator', 'voice_call_review',
          COALESCE(p_proposal_payload, '{}'::jsonb), COALESCE(p_proposal_reasoning, 'Call needs owner review'),
          1, NULL, 'review', 'proposed',
          jsonb_strip_nulls(jsonb_build_object('conversationId', v_call.conversation_id, 'tenantId', p_tenant_id)),
          v_proposal_key
        )
        ON CONFLICT (retell_artifact_key) WHERE retell_artifact_key IS NOT NULL
        DO UPDATE SET payload = EXCLUDED.payload, reasoning = EXCLUDED.reasoning,
                      routing = EXCLUDED.routing
        RETURNING id INTO v_proposal_id;
      END IF;
    END IF;

    SELECT id INTO v_conversation_id FROM public.conversations
      WHERE retell_artifact_key = v_conversation_key;
    SELECT id INTO v_message_id FROM public.messages
      WHERE retell_artifact_key = v_message_key;
    SELECT id INTO v_proposal_id FROM public.action_proposals
      WHERE retell_artifact_key = v_proposal_key;
    RETURN jsonb_build_object(
      'duplicate', true,
      'conversation_id', COALESCE(v_conversation_id, v_call.conversation_id),
      'message_id', v_message_id,
      'proposal_id', v_proposal_id,
      'summary', CASE WHEN v_should_enrich THEN p_summary ELSE v_call.summary END
    );
  END IF;

  INSERT INTO public.conversations (
    organization_id, tenant_id, property_id, channel, status, summary,
    last_message_at, retell_artifact_key
  ) VALUES (
    v_call.organization_id, p_tenant_id, p_property_id, 'voice',
    CASE WHEN p_needs_review THEN 'escalated'::public.conversation_status
         ELSE 'open'::public.conversation_status END,
    p_summary, p_ended_at, v_conversation_key
  ) RETURNING id INTO v_conversation_id;

  INSERT INTO public.messages (
    conversation_id, organization_id, direction, provider, body,
    draft_status, sent_at, retell_artifact_key
  ) VALUES (
    v_conversation_id, v_call.organization_id, 'inbound', 'retell', p_message_body,
    'auto_sent', p_ended_at, v_message_key
  ) RETURNING id INTO v_message_id;

  IF p_needs_review AND p_property_id IS NOT NULL THEN
    INSERT INTO public.action_proposals (
      organization_id, property_id, worker_model, action_type, payload,
      reasoning, confidence, context_fact_ids, gate_decision, status, routing,
      retell_artifact_key
    ) VALUES (
      v_call.organization_id, p_property_id, 'voice-operator', 'voice_call_review',
      COALESCE(p_proposal_payload, '{}'::jsonb), COALESCE(p_proposal_reasoning, 'Call needs owner review'),
      1, NULL, 'review', 'proposed',
      jsonb_strip_nulls(jsonb_build_object('conversationId', v_conversation_id, 'tenantId', p_tenant_id)),
      v_proposal_key
    ) RETURNING id INTO v_proposal_id;
  END IF;

  UPDATE public.voice_calls
     SET status = 'completed', ended_at = p_ended_at, transcript = p_transcript,
         summary = p_summary, outcome = p_outcome, conversation_id = v_conversation_id,
         session = p_session, finalization_richness = p_richness, updated_at = now()
   WHERE id = v_call.id;

  RETURN jsonb_build_object(
    'duplicate', false,
    'conversation_id', v_conversation_id,
    'message_id', v_message_id,
    'proposal_id', v_proposal_id,
    'summary', p_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_retell_call_artifacts(
  text, jsonb, text, text, jsonb, text, timestamptz, boolean, uuid, uuid, jsonb, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_retell_call_artifacts(
  text, jsonb, text, text, jsonb, text, timestamptz, boolean, uuid, uuid, jsonb, text, integer
) TO service_role;
