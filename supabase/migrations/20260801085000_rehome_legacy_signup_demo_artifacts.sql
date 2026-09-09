-- Re-home a legacy demo batch that was created under the temporary
-- `signuptest` organization while referencing Galaxy Estates tenants and
-- properties. The relationship targets are authoritative: the source org has
-- zero properties, and moving the Galaxy-linked graph preserves history while
-- preventing cross-organization references from surviving the scope foundation.
--
-- This is deliberately count-guarded against the observed production batch.
-- Fresh/local databases do not contain the temporary org and no-op. If the
-- source exists but the graph differs, fail rather than guessing.
DO $$
DECLARE
  source_org constant uuid := '01982304-11f7-482f-a0f1-2c12adf0308d';
  target_org constant uuid := '11111111-1111-1111-1111-111111111101';
  conversation_ids uuid[];
  proposal_ids uuid[];
  scheduled_ids uuid[];
  conversation_count integer;
  message_count integer;
  proposal_count integer;
  scheduled_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = source_org AND name = 'signuptest'
  ) THEN
    RAISE NOTICE 'Legacy signuptest organization absent; demo re-home skipped';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations
    WHERE id = target_org AND name = 'Galaxy Estates'
  ) THEN
    RAISE EXCEPTION 'Galaxy Estates target organization is missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.properties WHERE organization_id = source_org
  ) THEN
    RAISE EXCEPTION 'signuptest has properties; refusing legacy demo re-home';
  END IF;

  SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[])
  INTO conversation_ids
  FROM public.conversations c
  JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.organization_id = source_org
    AND t.organization_id = target_org;

  SELECT coalesce(array_agg(ap.id ORDER BY ap.id), '{}'::uuid[])
  INTO proposal_ids
  FROM public.action_proposals ap
  JOIN public.properties p ON p.id = ap.property_id
  WHERE ap.organization_id = source_org
    AND p.organization_id = target_org;

  SELECT coalesce(array_agg(sa.id ORDER BY sa.id), '{}'::uuid[])
  INTO scheduled_ids
  FROM public.scheduled_actions sa
  JOIN public.properties p ON p.id = sa.property_id
  WHERE sa.organization_id = source_org
    AND p.organization_id = target_org;

  conversation_count := cardinality(conversation_ids);
  proposal_count := cardinality(proposal_ids);
  scheduled_count := cardinality(scheduled_ids);

  SELECT count(*)::integer
  INTO message_count
  FROM public.messages
  WHERE organization_id = source_org
    AND conversation_id = ANY(conversation_ids);

  IF conversation_count = 0
     AND message_count = 0
     AND proposal_count = 0
     AND scheduled_count = 0 THEN
    RAISE NOTICE 'Legacy signuptest demo graph already re-homed; skipped';
    RETURN;
  END IF;

  IF conversation_count <> 10
     OR message_count <> 10
     OR proposal_count <> 8
     OR scheduled_count <> 5 THEN
    RAISE EXCEPTION
      'Unexpected signuptest demo graph counts: conversations %, messages %, proposals %, scheduled %',
      conversation_count, message_count, proposal_count, scheduled_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voice_calls
    WHERE conversation_id = ANY(conversation_ids)
  ) THEN
    RAISE EXCEPTION 'Legacy signuptest demo conversations have voice calls; refusing partial re-home';
  END IF;

  UPDATE public.messages
  SET organization_id = target_org
  WHERE organization_id = source_org
    AND conversation_id = ANY(conversation_ids);

  UPDATE public.conversations
  SET organization_id = target_org
  WHERE id = ANY(conversation_ids)
    AND organization_id = source_org;

  UPDATE public.action_proposals
  SET organization_id = target_org
  WHERE id = ANY(proposal_ids)
    AND organization_id = source_org;

  UPDATE public.scheduled_actions
  SET organization_id = target_org
  WHERE id = ANY(scheduled_ids)
    AND organization_id = source_org;

  RAISE NOTICE
    'Re-homed legacy signuptest demo graph: conversations %, messages %, proposals %, scheduled %',
    conversation_count, message_count, proposal_count, scheduled_count;
END;
$$;
