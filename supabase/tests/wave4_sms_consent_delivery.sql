-- Run only against an explicitly local/loopback database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(1);

DO $$
DECLARE
  org uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  conv uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  m_suppressed uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  m_replay uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  m_ambiguous uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  m_callback uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';
  d_suppressed uuid; d_replay uuid; d_ambiguous uuid; d_callback uuid; d_unlinked uuid;
  a_suppressed uuid; a_replay uuid; a_ambiguous uuid; a_callback uuid; a_unlinked uuid;
  t_suppressed uuid; t_replay uuid; t_ambiguous uuid; t_callback uuid; t_unlinked uuid;
  v_outcome text; v_pending boolean;
  state_text text; changed_value boolean; statuses text[];
BEGIN
  INSERT INTO public.organizations(id,name,odesa_phone_number)
  VALUES (org,'Wave 4 isolated verification','+12025550100');
  INSERT INTO public.conversations(id,organization_id,channel) VALUES (conv,org,'sms');
  INSERT INTO public.messages(id,organization_id,conversation_id,direction,provider,body,draft_status) VALUES
    (m_suppressed,org,conv,'outbound','linq','suppressed body','pending_review'),
    (m_replay,org,conv,'outbound','linq','replay body','pending_review'),
    (m_ambiguous,org,conv,'outbound','linq','ambiguous body','pending_review'),
    (m_callback,org,conv,'outbound','linq','callback body','pending_review');

  -- Event is claimed before mutation; replay returns canonical state and no second transition.
  SELECT c.state::text,c.changed INTO state_text,changed_value
  FROM public.apply_messaging_consent_command(org,'+12025550101','stop','linq','stop-1','2026-07-11T12:00:00Z') c;
  IF state_text<>'suppressed' OR NOT changed_value THEN RAISE EXCEPTION 'STOP transition failed'; END IF;
  SELECT c.state::text,c.changed INTO state_text,changed_value
  FROM public.apply_messaging_consent_command(org,'+12025550101','stop','linq','stop-1','2026-07-11T13:00:00Z') c;
  IF state_text<>'suppressed' OR changed_value THEN RAISE EXCEPTION 'STOP replay was not canonical'; END IF;
  IF (SELECT count(*) FROM public.messaging_consent_transitions WHERE provider_message_id='stop-1')<>1
    THEN RAISE EXCEPTION 'STOP replay wrote duplicate transition'; END IF;

  -- START is valid only from suppressed and only when ordered after STOP.
  SELECT c.state::text,c.changed INTO state_text,changed_value
  FROM public.apply_messaging_consent_command(org,'+12025550102','start','linq','start-invalid','2026-07-11T12:00:00Z') c;
  IF state_text<>'unknown' OR changed_value THEN RAISE EXCEPTION 'START incorrectly opted in unknown recipient'; END IF;
  PERFORM public.apply_messaging_consent_command(org,'+12025550102','stop','linq','stop-2','2026-07-11T12:02:00Z');
  SELECT c.state::text,c.changed INTO state_text,changed_value
  FROM public.apply_messaging_consent_command(org,'+12025550102','start','linq','start-delayed','2026-07-11T12:01:00Z') c;
  IF state_text<>'suppressed' OR changed_value THEN RAISE EXCEPTION 'delayed START overrode newer STOP'; END IF;
  SELECT c.state::text,c.changed INTO state_text,changed_value
  FROM public.apply_messaging_consent_command(org,'+12025550102','start','linq','start-valid','2026-07-11T12:03:00Z') c;
  IF state_text<>'opted_in' OR NOT changed_value THEN RAISE EXCEPTION 'valid START transition failed'; END IF;
  PERFORM public.apply_messaging_consent_command(org,'+12025550102','stop','linq','stop-equal','2026-07-11T12:03:00Z');
  IF (SELECT state FROM public.messaging_recipient_consents WHERE organization_id=org AND recipient_e164='+12025550102')<>'suppressed'
    THEN RAISE EXCEPTION 'STOP did not win equal timestamp'; END IF;
  PERFORM public.apply_messaging_consent_command(org,'+12025550102','start','linq','start-equal-late','2026-07-11T12:03:00Z');
  IF (SELECT state FROM public.messaging_recipient_consents WHERE organization_id=org AND recipient_e164='+12025550102')<>'suppressed'
    THEN RAISE EXCEPTION 'equal delayed START overrode STOP'; END IF;

  -- A leased but unsent attempt is canceled by STOP; begin/handoff cannot follow.
  SELECT c.dispatch_id,c.outcome INTO d_suppressed,v_outcome
  FROM public.claim_outbound_message_dispatch(org,m_suppressed,'+12025550103','message:suppressed',encode(digest('suppressed body','sha256'),'hex')) c;
  SELECT l.attempt_id,l.lease_token,l.outcome INTO a_suppressed,t_suppressed,v_outcome
  FROM public.lease_outbound_message_attempt(d_suppressed,'linq',120) l;
  PERFORM public.apply_messaging_consent_command(org,'+12025550103','stop','linq','stop-lease','2026-07-11T12:04:00Z');
  IF public.begin_outbound_message_attempt(a_suppressed,t_suppressed)
    OR (SELECT status FROM public.outbound_message_attempts WHERE id=a_suppressed)<>'suppressed'
    THEN RAISE EXCEPTION 'STOP failed to cancel unsent lease'; END IF;

  -- Accepted replay and ambiguous timeout are exactly-once canonical.
  PERFORM public.apply_messaging_consent_command(org,'+12025550104','stop','linq','stop-opt','2026-07-11T11:00:00Z');
  PERFORM public.apply_messaging_consent_command(org,'+12025550104','start','linq','start-opt','2026-07-11T11:01:00Z');
  SELECT c.dispatch_id,c.outcome INTO d_replay,v_outcome
  FROM public.claim_outbound_message_dispatch(org,m_replay,'+12025550104','message:replay',encode(digest('replay body','sha256'),'hex')) c;
  SELECT l.attempt_id,l.lease_token INTO a_replay,t_replay FROM public.lease_outbound_message_attempt(d_replay,'linq',120) l;
  IF NOT public.begin_outbound_message_attempt(a_replay,t_replay) THEN RAISE EXCEPTION 'attempt handoff failed'; END IF;
  PERFORM public.record_outbound_dispatch_accepted(a_replay,'pm-replay');
  SELECT c.outcome INTO v_outcome FROM public.claim_outbound_message_dispatch(org,m_replay,'+12025550104','message:replay',encode(digest('replay body','sha256'),'hex')) c;
  IF v_outcome<>'replay' THEN RAISE EXCEPTION 'accepted dispatch replay failed'; END IF;

  SELECT c.dispatch_id INTO d_ambiguous FROM public.claim_outbound_message_dispatch(org,m_ambiguous,'+12025550104','message:ambiguous',encode(digest('ambiguous body','sha256'),'hex')) c;
  SELECT l.attempt_id,l.lease_token INTO a_ambiguous,t_ambiguous FROM public.lease_outbound_message_attempt(d_ambiguous,'linq',120) l;
  PERFORM public.begin_outbound_message_attempt(a_ambiguous,t_ambiguous);
  PERFORM public.record_outbound_dispatch_failure(a_ambiguous,true,'timeout after request write',true);
  SELECT c.outcome INTO v_outcome FROM public.claim_outbound_message_dispatch(org,m_ambiguous,'+12025550104','message:ambiguous',encode(digest('ambiguous body','sha256'),'hex')) c;
  IF v_outcome<>'in_flight' OR (SELECT count(*) FROM public.outbound_message_attempts WHERE dispatch_id=d_ambiguous)<>1
    THEN RAISE EXCEPTION 'ambiguous retry re-armed attempt'; END IF;

  -- Callback may precede provider acceptance mapping and is attached afterward.
  SELECT c.dispatch_id INTO d_callback FROM public.claim_outbound_message_dispatch(org,m_callback,'+12025550104','message:callback',encode(digest('callback body','sha256'),'hex')) c;
  SELECT l.attempt_id,l.lease_token INTO a_callback,t_callback FROM public.lease_outbound_message_attempt(d_callback,'linq',120) l;
  PERFORM public.begin_outbound_message_attempt(a_callback,t_callback);
  PERFORM public.apply_messaging_consent_command(org,'+12025550104','stop','linq','stop-after-handoff','2026-07-11T12:10:00Z');
  IF (SELECT status FROM public.outbound_message_attempts WHERE id=a_callback)<>'network_started'
    OR (SELECT status FROM public.outbound_message_dispatches WHERE id=d_callback)<>'queued'
    THEN RAISE EXCEPTION 'STOP incorrectly claimed cancellation after network handoff'; END IF;
  SELECT r.pending INTO v_pending FROM public.reconcile_message_delivery_event('linq','pm-early','evt-early','delivered',NULL,'{}') r;
  IF NOT v_pending THEN RAISE EXCEPTION 'early callback was not persisted pending'; END IF;
  PERFORM public.record_outbound_dispatch_accepted(a_callback,'pm-early');
  IF (SELECT status FROM public.outbound_message_dispatches WHERE id=d_callback)<>'delivered'
    OR (SELECT delivery_status FROM public.messages WHERE id=m_callback)<>'delivered'
    THEN RAISE EXCEPTION 'pending callback did not reconcile after mapping'; END IF;

  -- Missing timestamp/event-id retries use a stable caller-derived id and monotonic precedence.
  PERFORM public.reconcile_message_delivery_event('linq','pm-early','stable-hash','delivered',NULL,'{}');
  PERFORM public.reconcile_message_delivery_event('linq','pm-early','stable-hash','delivered',NULL,'{}');
  PERFORM public.reconcile_message_delivery_event('linq','pm-early','late-sent-hash','provider_accepted',NULL,'{}');
  IF (SELECT delivery_status FROM public.messages WHERE id=m_callback)<>'delivered'
    OR (SELECT count(*) FROM public.message_delivery_callback_inbox WHERE provider_event_id='stable-hash')<>1
    THEN RAISE EXCEPTION 'timestamp-less callback duplicate/regression failed'; END IF;

  -- An outbound without messages.id remains callback-reconcilable through its canonical dispatch.
  SELECT c.dispatch_id INTO d_unlinked FROM public.claim_outbound_message_dispatch(org,NULL,'+12025550105','phone-verification:v1',encode(digest('code body','sha256'),'hex')) c;
  SELECT l.attempt_id,l.lease_token INTO a_unlinked,t_unlinked FROM public.lease_outbound_message_attempt(d_unlinked,'twilio',120) l;
  PERFORM public.begin_outbound_message_attempt(a_unlinked,t_unlinked);
  PERFORM public.record_outbound_dispatch_accepted(a_unlinked,'pm-unlinked');
  PERFORM public.reconcile_message_delivery_event('twilio','pm-unlinked','evt-unlinked','delivered',NULL,'{}');
  IF (SELECT status FROM public.outbound_message_dispatches WHERE id=d_unlinked)<>'delivered'
    OR (SELECT count(*) FROM public.message_delivery_events WHERE dispatch_id=d_unlinked)<>1
    THEN RAISE EXCEPTION 'unlinked outbound callback was not reconciled'; END IF;

  SELECT array_agg(to_status::text ORDER BY occurred_at,id) INTO statuses
  FROM public.message_lifecycle_events WHERE message_id=m_replay;
  IF NOT statuses @> ARRAY['draft','queued','provider_accepted']
    THEN RAISE EXCEPTION 'lifecycle incomplete: %',statuses; END IF;
  BEGIN
    UPDATE public.messaging_consent_transitions SET metadata='{}' WHERE organization_id=org;
    RAISE EXCEPTION 'history mutation unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%immutable%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'wave4 assertions passed: command_events=%, transitions=%, dispatches=%, attempts=%, callbacks=%, delivery_events=%',
    (SELECT count(*) FROM public.messaging_consent_command_events WHERE organization_id=org),
    (SELECT count(*) FROM public.messaging_consent_transitions WHERE organization_id=org),
    (SELECT count(*) FROM public.outbound_message_dispatches WHERE organization_id=org),
    (SELECT count(*) FROM public.outbound_message_attempts a JOIN public.outbound_message_dispatches d ON d.id=a.dispatch_id WHERE d.organization_id=org),
    (SELECT count(*) FROM public.message_delivery_callback_inbox WHERE organization_id=org),
    (SELECT count(*) FROM public.message_delivery_events WHERE organization_id=org);
  DELETE FROM public.organizations WHERE id=org;
  IF EXISTS(SELECT 1 FROM public.messaging_recipient_consents WHERE organization_id=org)
    OR EXISTS(SELECT 1 FROM public.outbound_message_dispatches WHERE organization_id=org)
    OR EXISTS(SELECT 1 FROM public.message_delivery_callback_inbox WHERE organization_id=org)
    OR EXISTS(SELECT 1 FROM public.message_delivery_events WHERE organization_id=org)
    OR EXISTS(SELECT 1 FROM public.message_lifecycle_events WHERE organization_id=org)
    THEN RAISE EXCEPTION 'cleanup failed'; END IF;
  RAISE NOTICE 'cleanup verified: zero Wave 4 rows remain';
END $$;

SELECT extensions.pass('Wave 4 consent and delivery assertions with cleanup');
SELECT * FROM extensions.finish();
ROLLBACK;
