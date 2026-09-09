-- Odesa V1 personas — explicit staff property scope and referential integrity.
--
-- Existing memberships are widened explicitly once to preserve the verified
-- owner/manager/VA baseline. Every membership created after this migration is
-- deny-all by default unless it is an owner, carries all_properties=true, or
-- receives owner-authored property grants.

-- -------------------------------------------------------------------------
-- Membership scope and archived properties
-- -------------------------------------------------------------------------

ALTER TABLE public.organization_memberships
  ADD COLUMN all_properties boolean;

UPDATE public.organization_memberships
   SET all_properties = true
 WHERE all_properties IS NULL;

ALTER TABLE public.organization_memberships
  ALTER COLUMN all_properties SET DEFAULT false,
  ALTER COLUMN all_properties SET NOT NULL,
  ADD CONSTRAINT organization_memberships_owner_scope_check
    CHECK (role <> 'owner'::public.user_role OR all_properties = true);

ALTER TABLE public.properties
  ADD COLUMN archived_at timestamptz;

CREATE INDEX idx_properties_archived
  ON public.properties(organization_id, archived_at)
  WHERE archived_at IS NOT NULL;

-- Scope is a privileged membership field. This trigger complements the
-- existing role/status guard and also makes the owner invariant structural.
CREATE OR REPLACE FUNCTION public.guard_membership_property_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  jwt_role text;
  caller uuid := auth.uid();
BEGIN
  IF NEW.role = 'owner'::public.user_role THEN
    NEW.all_properties := true;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.all_properties IS NOT DISTINCT FROM OLD.all_properties THEN
    RETURN NEW;
  END IF;

  BEGIN
    jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  EXCEPTION WHEN others THEN
    jwt_role := NULL;
  END;

  IF jwt_role = 'service_role' OR caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND current_setting('odesa.membership_claim', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.user_id <> caller
     AND OLD.organization_id = public.current_user_org_id()
     AND public.current_user_role() = 'owner'::public.user_role THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'membership_scope_guard: changing property scope is owner-only'
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_membership_property_scope() FROM PUBLIC, anon;

CREATE TRIGGER membership_property_scope_guard
  BEFORE INSERT OR UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.guard_membership_property_scope();

-- -------------------------------------------------------------------------
-- Composite identity keys and normalized grants
-- -------------------------------------------------------------------------

CREATE UNIQUE INDEX uq_organization_memberships_id_org
  ON public.organization_memberships(id, organization_id);
CREATE UNIQUE INDEX uq_organization_invitations_id_org
  ON public.organization_invitations(id, organization_id);
CREATE UNIQUE INDEX uq_properties_org_id
  ON public.properties(organization_id, id);
CREATE UNIQUE INDEX uq_units_org_id
  ON public.units(organization_id, id);
CREATE UNIQUE INDEX uq_tenants_org_id
  ON public.tenants(organization_id, id);
CREATE UNIQUE INDEX uq_leases_org_id
  ON public.leases(organization_id, id);
CREATE UNIQUE INDEX uq_vendors_org_id
  ON public.vendors(organization_id, id);
CREATE UNIQUE INDEX uq_conversations_org_id
  ON public.conversations(organization_id, id);
CREATE UNIQUE INDEX uq_messages_org_id
  ON public.messages(organization_id, id);
CREATE UNIQUE INDEX uq_work_orders_org_id
  ON public.work_orders(organization_id, id);
CREATE UNIQUE INDEX uq_rent_events_org_id
  ON public.rent_events(organization_id, id);
CREATE UNIQUE INDEX uq_action_proposals_org_id
  ON public.action_proposals(organization_id, id);
CREATE UNIQUE INDEX uq_operator_chats_org_id
  ON public.operator_chats(organization_id, id);
CREATE UNIQUE INDEX uq_outbound_message_dispatches_org_id
  ON public.outbound_message_dispatches(organization_id, id);

ALTER TABLE public.membership_property_grants
  ADD COLUMN organization_id uuid;

UPDATE public.membership_property_grants g
   SET organization_id = m.organization_id
  FROM public.organization_memberships m
 WHERE m.id = g.membership_id
   AND g.organization_id IS NULL;

ALTER TABLE public.membership_property_grants
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT membership_property_grants_membership_org_fkey
    FOREIGN KEY (membership_id, organization_id)
    REFERENCES public.organization_memberships(id, organization_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT membership_property_grants_property_org_fkey
    FOREIGN KEY (organization_id, property_id)
    REFERENCES public.properties(organization_id, id)
    ON DELETE CASCADE;

CREATE INDEX idx_membership_property_grants_org
  ON public.membership_property_grants(organization_id, membership_id);

-- Invitation scope is durable before claim so the owner-authored scope and
-- the resulting membership cannot diverge.
ALTER TABLE public.organization_invitations
  ADD COLUMN all_properties boolean NOT NULL DEFAULT false;

CREATE TABLE public.organization_invitation_property_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invitation_property_grants_key
    UNIQUE (invitation_id, property_id),
  CONSTRAINT organization_invitation_grants_invitation_org_fkey
    FOREIGN KEY (invitation_id, organization_id)
    REFERENCES public.organization_invitations(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT organization_invitation_grants_property_org_fkey
    FOREIGN KEY (organization_id, property_id)
    REFERENCES public.properties(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX idx_organization_invitation_grants_org
  ON public.organization_invitation_property_grants(organization_id, invitation_id);

-- -------------------------------------------------------------------------
-- Explicit property relationship for contacts without leases
-- -------------------------------------------------------------------------

CREATE TABLE public.tenant_property_links (
  organization_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property_id),
  CONSTRAINT tenant_property_links_tenant_org_fkey
    FOREIGN KEY (organization_id, tenant_id)
    REFERENCES public.tenants(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT tenant_property_links_property_org_fkey
    FOREIGN KEY (organization_id, property_id)
    REFERENCES public.properties(organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX idx_tenant_property_links_org_property
  ON public.tenant_property_links(organization_id, property_id);

-- -------------------------------------------------------------------------
-- Fail-closed database scope helpers
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_membership_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT (array_agg(m.id))[1]
    FROM public.organization_memberships m
   WHERE m.user_id = auth.uid()
     AND m.status = 'active'::public.membership_status
  HAVING count(*) = 1;
$$;

CREATE OR REPLACE FUNCTION public.visible_property_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id
    FROM public.organization_memberships m
    JOIN public.properties p
      ON p.organization_id = m.organization_id
   WHERE m.id = public.current_membership_id()
     AND (m.role = 'owner'::public.user_role OR m.all_properties = true)
  UNION
  SELECT g.property_id
    FROM public.organization_memberships m
    JOIN public.membership_property_grants g
      ON g.membership_id = m.id
     AND g.organization_id = m.organization_id
   WHERE m.id = public.current_membership_id()
     AND m.role <> 'owner'::public.user_role
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
     AND EXISTS (
       SELECT 1
         FROM public.visible_property_ids() visible(property_id)
        WHERE visible.property_id = p_property_id
     );
$$;

CREATE OR REPLACE FUNCTION public.unit_property_id(p_unit_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.property_id FROM public.units u WHERE u.id = p_unit_id;
$$;

CREATE OR REPLACE FUNCTION public.lease_property_id(p_lease_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.property_id
    FROM public.leases l
    JOIN public.units u
      ON u.id = l.unit_id
     AND u.organization_id = l.organization_id
   WHERE l.id = p_lease_id;
$$;

CREATE OR REPLACE FUNCTION public.tenant_property_ids(p_tenant_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT DISTINCT u.property_id
    FROM public.leases l
    JOIN public.units u
      ON u.id = l.unit_id
     AND u.organization_id = l.organization_id
   WHERE l.tenant_id = p_tenant_id
  UNION
  SELECT link.property_id
    FROM public.tenant_property_links link
   WHERE link.tenant_id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION public.conversation_property_id(p_conversation_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    c.property_id,
    CASE WHEN count(tp.property_id) = 1 THEN (array_agg(tp.property_id))[1] END
  )
    FROM public.conversations c
    LEFT JOIN LATERAL public.tenant_property_ids(c.tenant_id) tp(property_id)
      ON c.property_id IS NULL
   WHERE c.id = p_conversation_id
   GROUP BY c.id, c.property_id;
$$;

CREATE OR REPLACE FUNCTION public.document_property_id(p_document_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    d.property_id,
    public.unit_property_id(d.unit_id),
    public.lease_property_id(d.lease_id),
    CASE WHEN count(tp.property_id) = 1 THEN (array_agg(tp.property_id))[1] END
  )
    FROM public.documents d
    LEFT JOIN LATERAL public.tenant_property_ids(d.tenant_id) tp(property_id)
      ON d.property_id IS NULL AND d.unit_id IS NULL AND d.lease_id IS NULL
   WHERE d.id = p_document_id
   GROUP BY d.id, d.property_id, d.unit_id, d.lease_id;
$$;

CREATE OR REPLACE FUNCTION public.voice_call_property_id(p_voice_call_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    v.property_id,
    public.unit_property_id(v.unit_id),
    public.conversation_property_id(v.conversation_id),
    CASE WHEN count(tp.property_id) = 1 THEN (array_agg(tp.property_id))[1] END
  )
    FROM public.voice_calls v
    LEFT JOIN LATERAL public.tenant_property_ids(v.tenant_id) tp(property_id)
      ON v.property_id IS NULL
     AND v.unit_id IS NULL
     AND v.conversation_id IS NULL
   WHERE v.id = p_voice_call_id
   GROUP BY v.id, v.property_id, v.unit_id, v.conversation_id;
$$;

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
        'view_rent','view_financials','view_documents','view_assistant',
        'view_settings','manage_tenants','manage_work_orders','manage_vendors',
        'draft_messages','record_payment','waive_balance','change_lease_terms',
        'approve_tenant_message','approve_payment_request',
        'approve_vendor_dispatch','import_portfolio','manage_team_access',
        'manage_billing','manage_integrations','change_autonomy',
        'access_all_properties'
      ]) THEN false
      WHEN m.role = 'owner'::public.user_role THEN true
      WHEN o.effect = 'deny' THEN false
      WHEN o.effect = 'allow'
       AND p_capability <> ALL (ARRAY[
         'record_payment','waive_balance','change_lease_terms',
         'approve_payment_request','import_portfolio','manage_team_access',
         'manage_billing','manage_integrations','change_autonomy',
         'access_all_properties'
       ]) THEN true
      WHEN m.role = 'manager'::public.user_role THEN p_capability = ANY (ARRAY[
        'view_dashboard','view_inbox','view_calls','view_properties',
        'view_tenants','view_vendors','view_work_orders','view_rent',
        'view_documents','view_settings','manage_work_orders','draft_messages'
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

CREATE OR REPLACE FUNCTION public.manager_has_capability(p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT public.current_user_role() = 'manager'::public.user_role
     AND public.current_user_has_capability(p_capability);
$$;

REVOKE ALL ON FUNCTION public.current_membership_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.visible_property_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_property(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unit_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lease_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_property_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversation_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.document_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.voice_call_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_has_capability(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manager_has_capability(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_membership_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.visible_property_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_property(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unit_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lease_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_property_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversation_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.document_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.voice_call_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_has_capability(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manager_has_capability(text) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- Same-organization referential integrity
-- -------------------------------------------------------------------------

ALTER TABLE public.units
  ADD CONSTRAINT units_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID;
ALTER TABLE public.leases
  ADD CONSTRAINT leases_unit_org_fkey
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES public.units(organization_id, id) NOT VALID,
  ADD CONSTRAINT leases_tenant_org_fkey
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES public.tenants(organization_id, id) NOT VALID;
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_unit_org_fkey
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES public.units(organization_id, id) NOT VALID,
  ADD CONSTRAINT work_orders_tenant_org_fkey
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES public.tenants(organization_id, id) NOT VALID,
  ADD CONSTRAINT work_orders_vendor_org_fkey
  FOREIGN KEY (organization_id, vendor_id)
  REFERENCES public.vendors(organization_id, id) NOT VALID;
ALTER TABLE public.rent_events
  ADD CONSTRAINT rent_events_lease_org_fkey
  FOREIGN KEY (organization_id, lease_id)
  REFERENCES public.leases(organization_id, id) NOT VALID;
ALTER TABLE public.rent_payments
  ADD CONSTRAINT rent_payments_lease_org_fkey
  FOREIGN KEY (organization_id, lease_id)
  REFERENCES public.leases(organization_id, id) NOT VALID,
  ADD CONSTRAINT rent_payments_tenant_org_fkey
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES public.tenants(organization_id, id) NOT VALID,
  ADD CONSTRAINT rent_payments_event_org_fkey
  FOREIGN KEY (organization_id, rent_event_id)
  REFERENCES public.rent_events(organization_id, id) NOT VALID;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT conversations_tenant_org_fkey
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES public.tenants(organization_id, id) NOT VALID;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_org_fkey
  FOREIGN KEY (organization_id, conversation_id)
  REFERENCES public.conversations(organization_id, id) NOT VALID;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT documents_unit_org_fkey
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES public.units(organization_id, id) NOT VALID,
  ADD CONSTRAINT documents_tenant_org_fkey
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES public.tenants(organization_id, id) NOT VALID,
  ADD CONSTRAINT documents_vendor_org_fkey
  FOREIGN KEY (organization_id, vendor_id)
  REFERENCES public.vendors(organization_id, id) NOT VALID;
ALTER TABLE public.voice_calls
  ADD CONSTRAINT voice_calls_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT voice_calls_unit_org_fkey
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES public.units(organization_id, id) NOT VALID,
  ADD CONSTRAINT voice_calls_tenant_org_fkey
  FOREIGN KEY (organization_id, tenant_id)
  REFERENCES public.tenants(organization_id, id) NOT VALID,
  ADD CONSTRAINT voice_calls_vendor_org_fkey
  FOREIGN KEY (organization_id, vendor_id)
  REFERENCES public.vendors(organization_id, id) NOT VALID,
  ADD CONSTRAINT voice_calls_conversation_org_fkey
  FOREIGN KEY (organization_id, conversation_id)
  REFERENCES public.conversations(organization_id, id) NOT VALID;
ALTER TABLE public.action_proposals
  ADD CONSTRAINT action_proposals_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID;
ALTER TABLE public.appliances
  ADD CONSTRAINT appliances_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT appliances_unit_org_fkey
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES public.units(organization_id, id) NOT VALID;
ALTER TABLE public.property_vendors
  ADD CONSTRAINT property_vendors_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT property_vendors_vendor_org_fkey
  FOREIGN KEY (organization_id, vendor_id)
  REFERENCES public.vendors(organization_id, id) NOT VALID;
ALTER TABLE public.maintenance_tickets
  ADD CONSTRAINT maintenance_tickets_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT maintenance_tickets_unit_org_fkey
  FOREIGN KEY (organization_id, unit_id)
  REFERENCES public.units(organization_id, id) NOT VALID;
ALTER TABLE public.memory_facts
  ADD CONSTRAINT memory_facts_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID;
ALTER TABLE public.scheduled_actions
  ADD CONSTRAINT scheduled_actions_property_org_fkey
  FOREIGN KEY (organization_id, property_id)
  REFERENCES public.properties(organization_id, id) NOT VALID,
  ADD CONSTRAINT scheduled_actions_proposal_org_fkey
  FOREIGN KEY (organization_id, fired_proposal_id)
  REFERENCES public.action_proposals(organization_id, id) NOT VALID;

ALTER TABLE public.units VALIDATE CONSTRAINT units_property_org_fkey;
ALTER TABLE public.leases VALIDATE CONSTRAINT leases_unit_org_fkey;
ALTER TABLE public.leases VALIDATE CONSTRAINT leases_tenant_org_fkey;
ALTER TABLE public.work_orders VALIDATE CONSTRAINT work_orders_unit_org_fkey;
ALTER TABLE public.work_orders VALIDATE CONSTRAINT work_orders_tenant_org_fkey;
ALTER TABLE public.work_orders VALIDATE CONSTRAINT work_orders_vendor_org_fkey;
ALTER TABLE public.rent_events VALIDATE CONSTRAINT rent_events_lease_org_fkey;
ALTER TABLE public.rent_payments VALIDATE CONSTRAINT rent_payments_lease_org_fkey;
ALTER TABLE public.rent_payments VALIDATE CONSTRAINT rent_payments_tenant_org_fkey;
ALTER TABLE public.rent_payments VALIDATE CONSTRAINT rent_payments_event_org_fkey;
ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_property_org_fkey;
ALTER TABLE public.conversations VALIDATE CONSTRAINT conversations_tenant_org_fkey;
ALTER TABLE public.messages VALIDATE CONSTRAINT messages_conversation_org_fkey;
ALTER TABLE public.documents VALIDATE CONSTRAINT documents_property_org_fkey;
ALTER TABLE public.documents VALIDATE CONSTRAINT documents_unit_org_fkey;
ALTER TABLE public.documents VALIDATE CONSTRAINT documents_tenant_org_fkey;
ALTER TABLE public.documents VALIDATE CONSTRAINT documents_vendor_org_fkey;
ALTER TABLE public.voice_calls VALIDATE CONSTRAINT voice_calls_property_org_fkey;
ALTER TABLE public.voice_calls VALIDATE CONSTRAINT voice_calls_unit_org_fkey;
ALTER TABLE public.voice_calls VALIDATE CONSTRAINT voice_calls_tenant_org_fkey;
ALTER TABLE public.voice_calls VALIDATE CONSTRAINT voice_calls_vendor_org_fkey;
ALTER TABLE public.voice_calls VALIDATE CONSTRAINT voice_calls_conversation_org_fkey;
ALTER TABLE public.action_proposals VALIDATE CONSTRAINT action_proposals_property_org_fkey;
ALTER TABLE public.appliances VALIDATE CONSTRAINT appliances_property_org_fkey;
ALTER TABLE public.appliances VALIDATE CONSTRAINT appliances_unit_org_fkey;
ALTER TABLE public.property_vendors VALIDATE CONSTRAINT property_vendors_property_org_fkey;
ALTER TABLE public.property_vendors VALIDATE CONSTRAINT property_vendors_vendor_org_fkey;
ALTER TABLE public.maintenance_tickets VALIDATE CONSTRAINT maintenance_tickets_property_org_fkey;
ALTER TABLE public.maintenance_tickets VALIDATE CONSTRAINT maintenance_tickets_unit_org_fkey;
ALTER TABLE public.memory_facts VALIDATE CONSTRAINT memory_facts_property_org_fkey;
ALTER TABLE public.scheduled_actions VALIDATE CONSTRAINT scheduled_actions_property_org_fkey;
ALTER TABLE public.scheduled_actions VALIDATE CONSTRAINT scheduled_actions_proposal_org_fkey;

-- -------------------------------------------------------------------------
-- New-table grant hygiene and owner-controlled RLS
-- -------------------------------------------------------------------------

ALTER TABLE public.organization_invitation_property_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_property_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.organization_invitation_property_grants,
  public.tenant_property_links
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.organization_invitation_property_grants,
  public.tenant_property_links
TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.organization_invitation_property_grants,
  public.tenant_property_links
TO authenticated;

CREATE POLICY organization_invitation_grants_owner_all
  ON public.organization_invitation_property_grants
  TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );

CREATE POLICY tenant_property_links_select_scoped
  ON public.tenant_property_links FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.can_see_property(property_id)
  );

CREATE POLICY tenant_property_links_write_owner
  ON public.tenant_property_links
  TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );

-- Existing grant rows are visible to their subject; only owners may mutate.
DROP POLICY IF EXISTS membership_property_grants_select_own_org
  ON public.membership_property_grants;
DROP POLICY IF EXISTS membership_property_grants_insert_owner_only
  ON public.membership_property_grants;
DROP POLICY IF EXISTS membership_property_grants_update_owner_only
  ON public.membership_property_grants;
DROP POLICY IF EXISTS membership_property_grants_delete_owner_only
  ON public.membership_property_grants;

CREATE POLICY membership_property_grants_select_scoped
  ON public.membership_property_grants FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR membership_id = public.current_membership_id()
    )
  );

CREATE POLICY membership_property_grants_insert_owner
  ON public.membership_property_grants FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );

CREATE POLICY membership_property_grants_update_owner
  ON public.membership_property_grants FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );

CREATE POLICY membership_property_grants_delete_owner
  ON public.membership_property_grants FOR DELETE
  TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );
