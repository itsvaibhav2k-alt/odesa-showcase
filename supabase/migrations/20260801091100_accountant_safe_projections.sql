-- Accountant is a projection-only STAFF persona.
--
-- Canonical business rows are denied even when the caller knows an id. Exact
-- SECURITY DEFINER projections enforce the one active Accountant membership,
-- the matching capability, and assigned/all-property scope before returning
-- an explicit column set. Provider ids, contact coordinates, storage keys,
-- receipt URLs, canonical write fields, and inferred document access never
-- cross this boundary.

BEGIN;

-- Keep the database catalog aligned with the application policy and the final
-- shared Manager handoff. An Accountant allow can never expand the immutable
-- five-capability ceiling; a deny always narrows it.
UPDATE public.membership_capability_overrides o
   SET effect = 'deny'
  FROM public.organization_memberships m
 WHERE m.id = o.membership_id
   AND m.role = 'accountant'::public.user_role
   AND o.effect = 'allow'
   AND o.capability NOT IN (
     'view_dashboard', 'view_rent', 'view_financials',
     'view_documents', 'export_financials'
   );

ALTER TABLE public.membership_capability_overrides
  DROP CONSTRAINT IF EXISTS membership_capability_overrides_reserved_owner_check;

ALTER TABLE public.membership_capability_overrides
  ADD CONSTRAINT membership_capability_overrides_reserved_owner_check
  CHECK (
    effect = 'deny'
    OR capability NOT IN (
      'view_assistant', 'record_payment', 'waive_balance',
      'change_lease_terms', 'approve_tenant_message',
      'approve_payment_request', 'approve_vendor_dispatch',
      'import_portfolio', 'manage_team_access', 'manage_billing',
      'manage_integrations', 'change_autonomy', 'access_all_properties'
    )
  );

CREATE OR REPLACE FUNCTION public.guard_accountant_capability_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.effect = 'allow'
     AND EXISTS (
       SELECT 1
         FROM public.organization_memberships m
        WHERE m.id = NEW.membership_id
          AND m.role = 'accountant'::public.user_role
     )
     AND NEW.capability NOT IN (
       'view_dashboard', 'view_rent', 'view_financials',
       'view_documents', 'export_financials'
     ) THEN
    RAISE EXCEPTION 'accountant capability ceiling is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_accountant_capability_override()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS accountant_capability_override_guard
  ON public.membership_capability_overrides;
CREATE TRIGGER accountant_capability_override_guard
  BEFORE INSERT OR UPDATE ON public.membership_capability_overrides
  FOR EACH ROW EXECUTE FUNCTION public.guard_accountant_capability_override();

-- An Accountant needs its own membership row to resolve its request-scoped
-- role, capabilities, and property grants. That narrow bootstrap read must
-- never turn into Team & Access visibility or mutation. These restrictive
-- policies compose with the shared permissive policies: Owner/Manager/VA
-- retain their shipped behavior, an unambiguous Accountant sees only its own
-- row, and zero/ambiguous identities see nothing. Accountant writes are
-- denied even for non-privileged columns such as updated_at.
DROP POLICY IF EXISTS accountant_membership_bootstrap_read
  ON public.organization_memberships;
CREATE POLICY accountant_membership_bootstrap_read
  ON public.organization_memberships
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role()::text IN ('owner', 'manager', 'va')
    OR (
      public.current_user_role() = 'accountant'::public.user_role
      AND user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS accountant_membership_no_update
  ON public.organization_memberships;
CREATE POLICY accountant_membership_no_update
  ON public.organization_memberships
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (public.current_user_role()::text IN ('owner', 'manager', 'va'))
  WITH CHECK (public.current_user_role()::text IN ('owner', 'manager', 'va'));

DROP POLICY IF EXISTS accountant_membership_no_delete
  ON public.organization_memberships;
CREATE POLICY accountant_membership_no_delete
  ON public.organization_memberships
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (public.current_user_role()::text IN ('owner', 'manager', 'va'));

CREATE OR REPLACE FUNCTION public.current_user_has_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p_capability <> ALL (ARRAY[
        'view_dashboard','view_inbox','view_calls','view_owner_queue',
        'view_properties','view_tenants','view_vendors','view_work_orders',
        'view_rent','view_financials','view_documents','export_financials',
        'view_assistant','view_settings','manage_tenants','manage_work_orders',
        'manage_vendors','draft_messages','triage_conversations',
        'record_payment','waive_balance','change_lease_terms',
        'approve_tenant_message','approve_payment_request',
        'approve_vendor_dispatch','import_portfolio','manage_team_access',
        'manage_billing','manage_integrations','change_autonomy',
        'access_all_properties'
      ]) THEN false
      WHEN m.role = 'owner'::public.user_role THEN true
      WHEN m.role = 'accountant'::public.user_role THEN
        p_capability = ANY (ARRAY[
          'view_dashboard','view_rent','view_financials','view_documents',
          'export_financials'
        ])
        AND o.effect IS DISTINCT FROM 'deny'
      WHEN o.effect = 'deny' THEN false
      WHEN o.effect = 'allow'
       AND p_capability <> ALL (ARRAY[
         'view_assistant','record_payment','waive_balance',
         'change_lease_terms','approve_tenant_message',
         'approve_payment_request','approve_vendor_dispatch',
         'import_portfolio','manage_team_access','manage_billing',
         'manage_integrations','change_autonomy','access_all_properties'
       ]) THEN true
      WHEN m.role = 'manager'::public.user_role THEN p_capability = ANY (ARRAY[
        'view_dashboard','view_inbox','view_calls','view_properties',
        'view_tenants','view_vendors','view_work_orders','view_rent',
        'view_documents','view_settings','manage_work_orders','draft_messages',
        'triage_conversations'
      ])
      WHEN m.role = 'va'::public.user_role THEN p_capability = ANY (ARRAY[
        'view_dashboard','view_inbox','view_calls','view_properties',
        'view_tenants','view_vendors','view_work_orders','view_documents',
        'view_settings','draft_messages'
      ])
      ELSE false
    END
      FROM public.organization_memberships m
      LEFT JOIN public.membership_capability_overrides o
        ON o.membership_id = m.id
       AND o.capability = p_capability
     WHERE m.id = public.current_membership_id()
  ), false);
$$;

REVOKE ALL ON FUNCTION public.current_user_has_capability(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_capability(text)
  TO authenticated, service_role;

-- Identity/team resolver helpers disclose only self, or an Owner's own org.
CREATE OR REPLACE FUNCTION public.profile_shares_current_org(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_profile_id = auth.uid()
     OR (
       public.current_user_role() = 'owner'::public.user_role
       AND EXISTS (
         SELECT 1
           FROM public.organization_memberships m
          WHERE m.user_id = p_profile_id
            AND m.status = 'active'::public.membership_status
            AND m.organization_id = public.current_user_org_id()
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.membership_in_current_org(p_membership_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_membership_id = public.current_membership_id()
     OR (
       public.current_user_role() = 'owner'::public.user_role
       AND EXISTS (
         SELECT 1
           FROM public.organization_memberships m
          WHERE m.id = p_membership_id
            AND m.organization_id = public.current_user_org_id()
       )
     );
$$;

REVOKE ALL ON FUNCTION public.profile_shares_current_org(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.membership_in_current_org(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_shares_current_org(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.membership_in_current_org(uuid)
  TO authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Private, non-executable scope helper used only by Accountant projections.
CREATE OR REPLACE FUNCTION private.accountant_can_see_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_property_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.organization_memberships m
         JOIN public.properties p
           ON p.id = p_property_id
          AND p.organization_id = m.organization_id
        WHERE m.id = public.current_membership_id()
          AND m.role = 'accountant'::public.user_role
          AND m.status = 'active'::public.membership_status
          AND (
            m.all_properties = true
            OR EXISTS (
              SELECT 1
                FROM public.membership_property_grants g
               WHERE g.membership_id = m.id
                 AND g.organization_id = m.organization_id
                 AND g.property_id = p_property_id
            )
          )
     );
$$;

REVOKE ALL ON FUNCTION private.accountant_can_see_property(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Public scope/resolver RPCs remain usable by the existing Owner/Manager/VA
-- paths but intentionally return no known-id oracle to Accountant.
CREATE OR REPLACE FUNCTION public.visible_property_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id
    FROM public.organization_memberships m
    JOIN public.properties p ON p.organization_id = m.organization_id
   WHERE m.id = public.current_membership_id()
     AND public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
     AND (m.role = 'owner'::public.user_role OR m.all_properties = true)
  UNION
  SELECT g.property_id
    FROM public.organization_memberships m
    JOIN public.membership_property_grants g
      ON g.membership_id = m.id
     AND g.organization_id = m.organization_id
   WHERE m.id = public.current_membership_id()
     AND public.current_user_role()::text = ANY (ARRAY['manager','va'])
     AND m.all_properties = false;
$$;

CREATE OR REPLACE FUNCTION public.can_see_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_property_id IS NOT NULL
     AND public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
     AND EXISTS (
       SELECT 1
         FROM public.visible_property_ids() visible(property_id)
        WHERE visible.property_id = p_property_id
     );
$$;

CREATE OR REPLACE FUNCTION private.raw_unit_property_id(p_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$ SELECT u.property_id FROM public.units u WHERE u.id = p_unit_id; $$;

CREATE OR REPLACE FUNCTION private.raw_lease_property_id(p_lease_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.property_id
    FROM public.leases l
    JOIN public.units u
      ON u.id = l.unit_id AND u.organization_id = l.organization_id
   WHERE l.id = p_lease_id;
$$;

CREATE OR REPLACE FUNCTION private.raw_tenant_property_ids(p_tenant_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM (
      SELECT DISTINCT u.property_id
        FROM public.leases l
        JOIN public.units u
          ON u.id = l.unit_id AND u.organization_id = l.organization_id
       WHERE l.tenant_id = p_tenant_id
      UNION
      SELECT link.property_id
        FROM public.tenant_property_links link
       WHERE link.tenant_id = p_tenant_id
    ) candidate;
$$;

CREATE OR REPLACE FUNCTION private.raw_conversation_property_id(p_conversation_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
           c.property_id,
           CASE WHEN count(tp.property_id) = 1
                THEN (array_agg(tp.property_id))[1] END
         )
    FROM public.conversations c
    LEFT JOIN LATERAL private.raw_tenant_property_ids(c.tenant_id) tp(property_id)
      ON c.property_id IS NULL
   WHERE c.id = p_conversation_id
   GROUP BY c.id, c.property_id;
$$;

CREATE OR REPLACE FUNCTION private.raw_document_property_id(p_document_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
           d.property_id,
           private.raw_unit_property_id(d.unit_id),
           private.raw_lease_property_id(d.lease_id),
           CASE WHEN count(tp.property_id) = 1
                THEN (array_agg(tp.property_id))[1] END
         )
    FROM public.documents d
    LEFT JOIN LATERAL private.raw_tenant_property_ids(d.tenant_id) tp(property_id)
      ON d.property_id IS NULL AND d.unit_id IS NULL AND d.lease_id IS NULL
   WHERE d.id = p_document_id
   GROUP BY d.id, d.property_id, d.unit_id, d.lease_id;
$$;

CREATE OR REPLACE FUNCTION private.raw_voice_call_property_id(p_voice_call_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
           v.property_id,
           private.raw_unit_property_id(v.unit_id),
           private.raw_conversation_property_id(v.conversation_id),
           CASE WHEN count(tp.property_id) = 1
                THEN (array_agg(tp.property_id))[1] END
         )
    FROM public.voice_calls v
    LEFT JOIN LATERAL private.raw_tenant_property_ids(v.tenant_id) tp(property_id)
      ON v.property_id IS NULL
     AND v.unit_id IS NULL
     AND v.conversation_id IS NULL
   WHERE v.id = p_voice_call_id
   GROUP BY v.id, v.property_id, v.unit_id, v.conversation_id;
$$;

REVOKE ALL ON FUNCTION private.raw_unit_property_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.raw_lease_property_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.raw_tenant_property_ids(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.raw_conversation_property_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.raw_document_property_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.raw_voice_call_property_id(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unit_property_id(p_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM (SELECT private.raw_unit_property_id(p_unit_id) AS property_id) candidate
   WHERE auth.role() = 'service_role'
      OR (
        public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
        AND public.can_see_property(candidate.property_id)
      );
$$;

CREATE OR REPLACE FUNCTION public.lease_property_id(p_lease_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM (SELECT private.raw_lease_property_id(p_lease_id) AS property_id) candidate
   WHERE auth.role() = 'service_role'
      OR (
        public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
        AND public.can_see_property(candidate.property_id)
      );
$$;

CREATE OR REPLACE FUNCTION public.tenant_property_ids(p_tenant_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM private.raw_tenant_property_ids(p_tenant_id) candidate(property_id)
   WHERE auth.role() = 'service_role'
      OR (
        public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
        AND public.can_see_property(candidate.property_id)
      );
$$;

CREATE OR REPLACE FUNCTION public.conversation_property_id(p_conversation_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM (
      SELECT private.raw_conversation_property_id(p_conversation_id) AS property_id
    ) candidate
   WHERE auth.role() = 'service_role'
      OR (
        public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
        AND public.can_see_property(candidate.property_id)
      );
$$;

CREATE OR REPLACE FUNCTION public.document_property_id(p_document_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM (
      SELECT private.raw_document_property_id(p_document_id) AS property_id
    ) candidate
   WHERE auth.role() = 'service_role'
      OR (
        public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
        AND public.can_see_property(candidate.property_id)
      );
$$;

CREATE OR REPLACE FUNCTION public.voice_call_property_id(p_voice_call_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT candidate.property_id
    FROM (
      SELECT private.raw_voice_call_property_id(p_voice_call_id) AS property_id
    ) candidate
   WHERE auth.role() = 'service_role'
      OR (
        public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
        AND public.can_see_property(candidate.property_id)
      );
$$;

CREATE OR REPLACE FUNCTION public.work_order_property_id(p_work_order_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.property_id
    FROM public.work_orders wo
    JOIN public.units u
      ON u.id = wo.unit_id AND u.organization_id = wo.organization_id
   WHERE wo.id = p_work_order_id
     AND (
       auth.role() = 'service_role'
       OR (
         public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
         AND public.can_see_property(u.property_id)
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.can_see_vendor(p_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_vendor_id IS NOT NULL
     AND (
       auth.role() = 'service_role'
       OR (
         public.current_user_role()::text = ANY (ARRAY['owner','manager','va'])
         AND (
           public.current_user_role() = 'owner'::public.user_role
           OR EXISTS (
             SELECT 1
               FROM public.property_vendors pv
              WHERE pv.vendor_id = p_vendor_id
                AND pv.organization_id = public.current_user_org_id()
                AND public.can_see_property(pv.property_id)
           )
           OR EXISTS (
             SELECT 1
               FROM public.work_orders wo
               JOIN public.units u
                 ON u.id = wo.unit_id
                AND u.organization_id = wo.organization_id
              WHERE wo.vendor_id = p_vendor_id
                AND wo.organization_id = public.current_user_org_id()
                AND public.can_see_property(u.property_id)
           )
         )
       )
     );
$$;

REVOKE ALL ON FUNCTION public.visible_property_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_property(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unit_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lease_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_property_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversation_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.document_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.voice_call_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.work_order_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_vendor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.visible_property_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_property(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unit_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lease_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_property_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.voice_call_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_vendor(uuid) TO authenticated, service_role;

-- Explicit Owner-authored Accountant classification. NULL means withheld.
ALTER TABLE public.documents
  ADD COLUMN accountant_evidence_class text;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_accountant_evidence_class_check
  CHECK (
    accountant_evidence_class IS NULL
    OR (
      accountant_evidence_class = 'lease_evidence'
      AND lease_id IS NOT NULL
      AND property_id IS NULL
      AND unit_id IS NULL
      AND tenant_id IS NULL
      AND vendor_id IS NULL
    )
    OR (
      accountant_evidence_class = 'property_accounting_evidence'
      AND property_id IS NOT NULL
      AND lease_id IS NULL
      AND unit_id IS NULL
      AND tenant_id IS NULL
      AND vendor_id IS NULL
    )
  );

-- The existing composite lease FK uses ON DELETE SET NULL (lease_id). Clear
-- the Owner-authored classification in the same row update so deleting a
-- lease keeps its shipped semantics instead of being blocked by the evidence
-- check. A document with no lease is withheld, never reclassified implicitly.
CREATE FUNCTION public.clear_accountant_lease_evidence_on_scope_loss()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.accountant_evidence_class = 'lease_evidence'
     AND NEW.lease_id IS NULL THEN
    NEW.accountant_evidence_class := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_accountant_lease_evidence_on_scope_loss()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER documents_clear_accountant_lease_evidence
  BEFORE UPDATE OF lease_id ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_accountant_lease_evidence_on_scope_loss();

CREATE INDEX documents_accountant_evidence_idx
  ON public.documents(organization_id, accountant_evidence_class)
  WHERE accountant_evidence_class IS NOT NULL;

-- Restrictive policies AND with every permissive legacy/shared policy. Thus
-- a future permissive policy cannot accidentally expose a canonical row to
-- Accountant, unknown, null, suspended, deleted, or ambiguous membership.
DO $$
DECLARE
  table_name text;
  guarded_tables text[] := ARRAY[
    'profiles','organizations','properties','units','tenants','leases','vendors',
    'documents','rent_events','rent_payments','conversations','messages',
    'work_orders','voice_calls','voice_settings','action_proposals',
    'weekly_reports','daily_digests','meta_insights','memory_facts',
    'scheduled_actions','appliances','maintenance_tickets','property_vendors',
    'operator_chats','operator_chat_turns','mcp_api_keys','oauth_tokens',
    'sendblue_number_pool','import_requests','import_entities','agent_runs',
    'phone_verifications','retell_tool_invocations',
    'work_order_mutation_requests','outbound_message_dispatches',
    'outbound_message_attempts','message_delivery_events',
    'message_lifecycle_events','messaging_recipient_consents',
    'messaging_consent_command_events','messaging_consent_transitions',
    'message_delivery_callback_inbox'
  ];
BEGIN
  FOREACH table_name IN ARRAY guarded_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS accountant_no_direct_access ON public.%I',
        table_name
      );
      EXECUTE format(
        'CREATE POLICY accountant_no_direct_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_role()::text = ANY (ARRAY[''owner'',''manager'',''va''])) WITH CHECK (public.current_user_role()::text = ANY (ARRAY[''owner'',''manager'',''va'']))',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

-- The shared scope migration removed broad document-object policies. Restore
-- only shipped Owner CRUD, bound to the current org folder. Accountants and
-- adjacent staff have no raw object access.
DROP POLICY IF EXISTS documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS documents_storage_update ON storage.objects;
DROP POLICY IF EXISTS documents_storage_delete ON storage.objects;

CREATE POLICY documents_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.current_user_role() = 'owner'::public.user_role
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );
CREATE POLICY documents_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND public.current_user_role() = 'owner'::public.user_role
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );
CREATE POLICY documents_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.current_user_role() = 'owner'::public.user_role
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND public.current_user_role() = 'owner'::public.user_role
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );
CREATE POLICY documents_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.current_user_role() = 'owner'::public.user_role
    AND (storage.foldername(name))[1] = public.current_user_org_id()::text
  );

CREATE OR REPLACE FUNCTION public.accountant_identity_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'accountant'::public.user_role
     OR NOT (
       public.current_user_has_capability('view_dashboard')
       OR public.current_user_has_capability('view_rent')
       OR public.current_user_has_capability('view_financials')
       OR public.current_user_has_capability('view_documents')
     ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
           'full_name',
             coalesce(nullif(btrim(p.full_name), ''),
                      nullif(btrim(p.display_name), ''), 'Accountant'),
           'organization_name', o.name,
           'property_count', (
             SELECT count(*)::integer
               FROM public.properties scoped_property
              WHERE scoped_property.organization_id = m.organization_id
                AND private.accountant_can_see_property(scoped_property.id)
           )
         )
    INTO result
    FROM public.organization_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN public.organizations o ON o.id = m.organization_id
   WHERE m.id = public.current_membership_id()
     AND m.role = 'accountant'::public.user_role
     AND m.status = 'active'::public.membership_status;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accountant_property_lease_context(
  p_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'accountant'::public.user_role
     OR p_capability NOT IN (
       'view_dashboard', 'view_rent', 'view_financials', 'view_documents'
     )
     OR NOT public.current_user_has_capability(p_capability) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH scoped_properties AS (
    SELECT p.id, p.name, p.archived_at, p.organization_id
      FROM public.properties p
     WHERE p.organization_id = public.current_user_org_id()
       AND private.accountant_can_see_property(p.id)
  ),
  lease_rows AS (
    SELECT p.id AS property_id,
           p.name AS property_name,
           p.archived_at AS property_archived_at,
           u.id AS unit_id,
           u.label AS unit_label,
           t.id AS tenant_id,
           t.full_name AS tenant_name,
           l.id AS lease_id,
           l.status::text AS lease_status,
           l.start_date AS lease_start_date,
           l.end_date AS lease_end_date
      FROM scoped_properties p
      JOIN public.units u
        ON u.organization_id = p.organization_id
       AND u.property_id = p.id
      JOIN public.leases l
        ON l.organization_id = u.organization_id
       AND l.unit_id = u.id
      JOIN public.tenants t
        ON t.organization_id = l.organization_id
       AND t.id = l.tenant_id
  ),
  property_only_rows AS (
    SELECT p.id AS property_id,
           p.name AS property_name,
           p.archived_at AS property_archived_at,
           NULL::uuid AS unit_id,
           NULL::text AS unit_label,
           NULL::uuid AS tenant_id,
           NULL::text AS tenant_name,
           NULL::uuid AS lease_id,
           NULL::text AS lease_status,
           NULL::date AS lease_start_date,
           NULL::date AS lease_end_date
      FROM scoped_properties p
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.units u
         JOIN public.leases l
           ON l.organization_id = u.organization_id
          AND l.unit_id = u.id
        WHERE u.organization_id = p.organization_id
          AND u.property_id = p.id
     )
  ),
  bounded AS (
    SELECT * FROM lease_rows
    UNION ALL
    SELECT * FROM property_only_rows
    ORDER BY property_name, property_id, unit_label NULLS FIRST,
             unit_id NULLS FIRST, lease_start_date NULLS FIRST,
             lease_id NULLS FIRST
    LIMIT 10001
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'property_id', property_id,
               'property_name', property_name,
               'property_archived_at', property_archived_at,
               'unit_id', unit_id,
               'unit_label', unit_label,
               'tenant_id', tenant_id,
               'tenant_name', tenant_name,
               'lease_id', lease_id,
               'lease_status', lease_status,
               'lease_start_date', lease_start_date,
               'lease_end_date', lease_end_date
             )
             ORDER BY property_name, property_id, unit_label NULLS FIRST,
                      unit_id NULLS FIRST, lease_start_date NULLS FIRST,
                      lease_id NULLS FIRST
           ),
           '[]'::jsonb
         )
    INTO result
    FROM bounded;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accountant_rent_events(
  p_cycle_start date,
  p_cycle_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'accountant'::public.user_role
     OR NOT public.current_user_has_capability('view_rent') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_cycle_start IS NULL
     OR p_cycle_end IS NULL
     OR date_trunc('month', p_cycle_start)::date <> p_cycle_start
     OR date_trunc('month', p_cycle_end)::date <> p_cycle_end
     OR p_cycle_end < p_cycle_start
     OR p_cycle_end >= (p_cycle_start + interval '12 months')::date THEN
    RAISE EXCEPTION 'Invalid rent period' USING ERRCODE = '22023';
  END IF;

  WITH bounded AS (
    SELECT re.id AS rent_event_id,
           p.id AS property_id,
           p.name AS property_name,
           p.archived_at AS property_archived_at,
           u.id AS unit_id,
           u.label AS unit_label,
           t.id AS tenant_id,
           t.full_name AS tenant_name,
           l.id AS lease_id,
           re.cycle_month,
           re.due_date,
           round(re.amount_due * 100)::bigint AS amount_due_cents,
           round(re.amount_paid * 100)::bigint AS amount_paid_cents,
           re.status::text AS status,
           CASE WHEN re.waived_amount IS NULL THEN NULL
                ELSE round(re.waived_amount * 100)::bigint END
             AS waived_amount_cents,
           re.waived_at
      FROM public.rent_events re
      JOIN public.leases l
        ON l.organization_id = re.organization_id
       AND l.id = re.lease_id
      JOIN public.units u
        ON u.organization_id = l.organization_id
       AND u.id = l.unit_id
      JOIN public.properties p
        ON p.organization_id = u.organization_id
       AND p.id = u.property_id
      JOIN public.tenants t
        ON t.organization_id = l.organization_id
       AND t.id = l.tenant_id
     WHERE re.organization_id = public.current_user_org_id()
       AND private.accountant_can_see_property(p.id)
       AND re.cycle_month >= p_cycle_start
       AND re.cycle_month <= p_cycle_end
     ORDER BY re.cycle_month, p.name, p.id, u.label, u.id, re.id
     LIMIT 10001
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'rent_event_id', rent_event_id,
               'property_id', property_id,
               'property_name', property_name,
               'property_archived_at', property_archived_at,
               'unit_id', unit_id,
               'unit_label', unit_label,
               'tenant_id', tenant_id,
               'tenant_name', tenant_name,
               'lease_id', lease_id,
               'cycle_month', cycle_month,
               'due_date', due_date,
               'amount_due_cents', amount_due_cents,
               'amount_paid_cents', amount_paid_cents,
               'status', status,
               'waived_amount_cents', waived_amount_cents,
               'waived_at', waived_at
             )
             ORDER BY cycle_month, property_name, property_id,
                      unit_label, unit_id, rent_event_id
           ),
           '[]'::jsonb
         )
    INTO result
    FROM bounded;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accountant_payment_history(
  p_from timestamptz,
  p_before timestamptz,
  p_include_recorded_exceptions boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'accountant'::public.user_role
     OR NOT public.current_user_has_capability('view_financials') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL
     OR p_before IS NULL
     OR p_before <= p_from
     OR p_before > p_from + interval '366 days' THEN
    RAISE EXCEPTION 'Invalid payment period' USING ERRCODE = '22023';
  END IF;

  WITH bounded AS (
    SELECT rp.id AS payment_id,
           p.id AS property_id,
           p.name AS property_name,
           p.archived_at AS property_archived_at,
           u.id AS unit_id,
           u.label AS unit_label,
           t.id AS tenant_id,
           t.full_name AS tenant_name,
           l.id AS lease_id,
           rp.amount_cents,
           upper(rp.currency) AS currency,
           rp.status,
           rp.paid_at,
           CASE WHEN rp.paid_at IS NULL
                THEN 'record_created_exception'
                ELSE 'payment_time' END AS period_basis,
           rp.rent_event_id,
           rp.rent_event_id IS NOT NULL AS matched,
           coalesce(nullif(btrim(rp.receipt_url), '') IS NOT NULL, false)
             AS receipt_present,
           rp.created_at AS exception_sort_at
      FROM public.rent_payments rp
      JOIN public.leases l
        ON l.organization_id = rp.organization_id
       AND l.id = rp.lease_id
      JOIN public.units u
        ON u.organization_id = l.organization_id
       AND u.id = l.unit_id
      JOIN public.properties p
        ON p.organization_id = u.organization_id
       AND p.id = u.property_id
      JOIN public.tenants t
        ON t.organization_id = rp.organization_id
       AND t.id = rp.tenant_id
     WHERE rp.organization_id = public.current_user_org_id()
       AND private.accountant_can_see_property(p.id)
       AND lower(rp.currency) = 'usd'
       AND (
         (rp.paid_at >= p_from AND rp.paid_at < p_before)
         OR (
           coalesce(p_include_recorded_exceptions, false)
           AND rp.paid_at IS NULL
           AND rp.created_at >= p_from
           AND rp.created_at < p_before
         )
       )
     ORDER BY rp.paid_at DESC NULLS LAST, rp.created_at DESC, rp.id
     LIMIT 10001
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'payment_id', payment_id,
               'property_id', property_id,
               'property_name', property_name,
               'property_archived_at', property_archived_at,
               'unit_id', unit_id,
               'unit_label', unit_label,
               'tenant_id', tenant_id,
               'tenant_name', tenant_name,
               'lease_id', lease_id,
               'amount_cents', amount_cents,
               'currency', currency,
               'status', status,
               'paid_at', paid_at,
               'period_basis', period_basis,
               'rent_event_id', rent_event_id,
               'matched', matched,
               'receipt_present', receipt_present
             )
             ORDER BY paid_at DESC NULLS LAST,
                      exception_sort_at DESC, payment_id
           ),
           '[]'::jsonb
         )
    INTO result
    FROM bounded;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.accountant_document_index()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  result jsonb;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'accountant'::public.user_role
     OR NOT public.current_user_has_capability('view_documents') THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  WITH classified AS (
    SELECT d.id AS document_id,
           p.id AS property_id,
           p.name AS property_name,
           p.archived_at AS property_archived_at,
           u.id AS unit_id,
           u.label AS unit_label,
           t.id AS tenant_id,
           t.full_name AS tenant_name,
           l.id AS lease_id,
           l.status::text AS lease_status,
           d.accountant_evidence_class AS evidence_class,
           d.title,
           d.type,
           d.expiry_date,
           d.created_at
      FROM public.documents d
      JOIN public.leases l
        ON d.accountant_evidence_class = 'lease_evidence'
       AND l.organization_id = d.organization_id
       AND l.id = d.lease_id
      JOIN public.units u
        ON u.organization_id = l.organization_id
       AND u.id = l.unit_id
      JOIN public.properties p
        ON p.organization_id = u.organization_id
       AND p.id = u.property_id
      JOIN public.tenants t
        ON t.organization_id = l.organization_id
       AND t.id = l.tenant_id
     WHERE d.organization_id = public.current_user_org_id()
       AND private.accountant_can_see_property(p.id)
    UNION ALL
    SELECT d.id,
           p.id,
           p.name,
           p.archived_at,
           NULL::uuid,
           NULL::text,
           NULL::uuid,
           NULL::text,
           NULL::uuid,
           NULL::text,
           d.accountant_evidence_class,
           d.title,
           d.type,
           d.expiry_date,
           d.created_at
      FROM public.documents d
      JOIN public.properties p
        ON d.accountant_evidence_class = 'property_accounting_evidence'
       AND p.organization_id = d.organization_id
       AND p.id = d.property_id
     WHERE d.organization_id = public.current_user_org_id()
       AND private.accountant_can_see_property(p.id)
  ),
  bounded AS (
    SELECT *
      FROM classified
     ORDER BY property_name, property_id, unit_label NULLS FIRST,
              title, document_id
     LIMIT 10001
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'document_id', document_id,
               'property_id', property_id,
               'property_name', property_name,
               'property_archived_at', property_archived_at,
               'unit_id', unit_id,
               'unit_label', unit_label,
               'tenant_id', tenant_id,
               'tenant_name', tenant_name,
               'lease_id', lease_id,
               'lease_status', lease_status,
               'evidence_class', evidence_class,
               'title', title,
               'type', type,
               'expiry_date', expiry_date,
               'created_at', created_at
             )
             ORDER BY property_name, property_id, unit_label NULLS FIRST,
                      title, document_id
           ),
           '[]'::jsonb
         )
    INTO result
    FROM bounded;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.accountant_identity_context()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accountant_property_lease_context(text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accountant_rent_events(date, date)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accountant_payment_history(
  timestamptz, timestamptz, boolean
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accountant_document_index()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.accountant_identity_context()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accountant_property_lease_context(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accountant_rent_events(date, date)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accountant_payment_history(
  timestamptz, timestamptz, boolean
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accountant_document_index()
  TO authenticated, service_role;

COMMIT;
