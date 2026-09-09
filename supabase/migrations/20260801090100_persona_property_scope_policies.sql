-- Odesa V1 personas — property-aware RLS and conservative staff boundaries.

CREATE OR REPLACE FUNCTION public.work_order_property_id(p_work_order_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.property_id
    FROM public.work_orders wo
    JOIN public.units u
      ON u.id = wo.unit_id
     AND u.organization_id = wo.organization_id
   WHERE wo.id = p_work_order_id;
$$;

CREATE OR REPLACE FUNCTION public.can_see_vendor(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p_vendor_id IS NOT NULL AND (
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
  );
$$;

REVOKE ALL ON FUNCTION public.work_order_property_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_vendor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_property_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_vendor(uuid) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- Identity and organization metadata
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS organizations_select_own ON public.organizations;
DROP POLICY IF EXISTS organizations_update_own ON public.organizations;

CREATE POLICY organizations_select_owner
  ON public.organizations FOR SELECT TO authenticated
  USING (
    id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );
CREATE POLICY organizations_update_owner
  ON public.organizations FOR UPDATE TO authenticated
  USING (
    id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  )
  WITH CHECK (
    id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'::public.user_role
  );

DROP POLICY IF EXISTS profiles_select_self_or_org ON public.profiles;
CREATE POLICY profiles_select_self_or_owner_org
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (
      public.current_user_role() = 'owner'::public.user_role
      AND public.profile_shares_current_org(id)
    )
  );

DROP POLICY IF EXISTS memberships_select_own_org ON public.organization_memberships;
CREATE POLICY memberships_select_self_or_owner_org
  ON public.organization_memberships FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      organization_id = public.current_user_org_id()
      AND public.current_user_role() = 'owner'::public.user_role
    )
  );

DROP POLICY IF EXISTS membership_capability_overrides_select_own_org
  ON public.membership_capability_overrides;
CREATE POLICY membership_capability_overrides_select_self_or_owner
  ON public.membership_capability_overrides FOR SELECT TO authenticated
  USING (
    membership_id = public.current_membership_id()
    OR (
      public.current_user_role() = 'owner'::public.user_role
      AND public.membership_in_current_org(membership_id)
    )
  );

-- -------------------------------------------------------------------------
-- Direct and derived property rows
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS properties_select_own_org ON public.properties;
DROP POLICY IF EXISTS properties_insert_own_org ON public.properties;
DROP POLICY IF EXISTS properties_update_own_org ON public.properties;
DROP POLICY IF EXISTS properties_delete_own_org ON public.properties;
CREATE POLICY properties_select_scope ON public.properties FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND public.can_see_property(id)
  );
CREATE POLICY properties_insert_owner ON public.properties FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY properties_update_owner ON public.properties FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY properties_delete_owner ON public.properties FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS units_select_own_org ON public.units;
DROP POLICY IF EXISTS units_insert_own_org ON public.units;
DROP POLICY IF EXISTS units_update_own_org ON public.units;
DROP POLICY IF EXISTS units_delete_own_org ON public.units;
CREATE POLICY units_select_scope ON public.units FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND public.can_see_property(property_id)
  );
CREATE POLICY units_insert_owner ON public.units FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY units_update_owner ON public.units FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY units_delete_owner ON public.units FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS tenants_select_own_org ON public.tenants;
DROP POLICY IF EXISTS tenants_insert_own_org ON public.tenants;
DROP POLICY IF EXISTS tenants_update_own_org ON public.tenants;
DROP POLICY IF EXISTS tenants_delete_own_org ON public.tenants;
CREATE POLICY tenants_select_scope ON public.tenants FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR EXISTS (
        SELECT 1 FROM public.tenant_property_ids(id) scoped(property_id)
         WHERE public.can_see_property(scoped.property_id)
      )
    )
  );
CREATE POLICY tenants_insert_owner ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY tenants_update_owner ON public.tenants FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY tenants_delete_owner ON public.tenants FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS leases_select_own_org ON public.leases;
DROP POLICY IF EXISTS leases_insert_own_org ON public.leases;
DROP POLICY IF EXISTS leases_update_owner_only ON public.leases;
DROP POLICY IF EXISTS leases_delete_own_org ON public.leases;
CREATE POLICY leases_select_scope ON public.leases FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND public.can_see_property(public.lease_property_id(id))
  );
CREATE POLICY leases_insert_owner ON public.leases FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY leases_update_owner ON public.leases FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY leases_delete_owner ON public.leases FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS conversations_select_own_org ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_own_org ON public.conversations;
DROP POLICY IF EXISTS conversations_update_own_org ON public.conversations;
DROP POLICY IF EXISTS conversations_delete_own_org ON public.conversations;
CREATE POLICY conversations_select_scope ON public.conversations FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR public.can_see_property(public.conversation_property_id(id))
    )
  );
CREATE POLICY conversations_insert_owner ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY conversations_update_owner ON public.conversations FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY conversations_delete_owner ON public.conversations FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS messages_select_own_org ON public.messages;
DROP POLICY IF EXISTS messages_insert_own_org ON public.messages;
DROP POLICY IF EXISTS messages_update_own_org ON public.messages;
DROP POLICY IF EXISTS messages_delete_own_org ON public.messages;
CREATE POLICY messages_select_scope ON public.messages FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR public.can_see_property(public.conversation_property_id(conversation_id))
    )
  );
CREATE POLICY messages_insert_owner ON public.messages FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY messages_update_owner ON public.messages FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY messages_delete_owner ON public.messages FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS work_orders_select_own_org ON public.work_orders;
DROP POLICY IF EXISTS work_orders_update_owner_only ON public.work_orders;
CREATE POLICY work_orders_select_scope ON public.work_orders FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND public.can_see_property(public.work_order_property_id(id))
  );
CREATE POLICY work_orders_update_owner ON public.work_orders FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS vendors_select_own_org ON public.vendors;
DROP POLICY IF EXISTS vendors_insert_own_org ON public.vendors;
DROP POLICY IF EXISTS vendors_update_own_org ON public.vendors;
DROP POLICY IF EXISTS vendors_delete_own_org ON public.vendors;
CREATE POLICY vendors_select_scope ON public.vendors FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND public.can_see_vendor(id)
  );
CREATE POLICY vendors_insert_owner ON public.vendors FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY vendors_update_owner ON public.vendors FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY vendors_delete_owner ON public.vendors FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

-- -------------------------------------------------------------------------
-- Operational money, documents, calls, and aggregate denials
-- -------------------------------------------------------------------------

DROP POLICY IF EXISTS rent_events_select_own_org ON public.rent_events;
DROP POLICY IF EXISTS rent_events_insert_own_org ON public.rent_events;
DROP POLICY IF EXISTS rent_events_update_owner_only ON public.rent_events;
DROP POLICY IF EXISTS rent_events_delete_own_org ON public.rent_events;
CREATE POLICY rent_events_select_scope ON public.rent_events FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager')
    AND public.can_see_property(public.lease_property_id(lease_id))
  );
CREATE POLICY rent_events_insert_owner ON public.rent_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY rent_events_update_owner ON public.rent_events FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY rent_events_delete_owner ON public.rent_events FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS rent_payments_select_own_org ON public.rent_payments;
DROP POLICY IF EXISTS rent_payments_insert_owner_only ON public.rent_payments;
DROP POLICY IF EXISTS rent_payments_update_owner_only ON public.rent_payments;
DROP POLICY IF EXISTS rent_payments_delete_owner_only ON public.rent_payments;
CREATE POLICY rent_payments_select_owner ON public.rent_payments FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY rent_payments_insert_owner ON public.rent_payments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY rent_payments_update_owner ON public.rent_payments FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY rent_payments_delete_owner ON public.rent_payments FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS documents_select ON public.documents;
DROP POLICY IF EXISTS documents_insert ON public.documents;
DROP POLICY IF EXISTS documents_update ON public.documents;
DROP POLICY IF EXISTS documents_delete ON public.documents;
CREATE POLICY documents_select_scope ON public.documents FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR public.can_see_property(public.document_property_id(id))
    )
  );
CREATE POLICY documents_insert_owner ON public.documents FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY documents_update_owner ON public.documents FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY documents_delete_owner ON public.documents FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS voice_calls_select_own_org ON public.voice_calls;
DROP POLICY IF EXISTS voice_calls_insert_own_org ON public.voice_calls;
DROP POLICY IF EXISTS voice_calls_update_own_org ON public.voice_calls;
DROP POLICY IF EXISTS voice_calls_delete_own_org ON public.voice_calls;
CREATE POLICY voice_calls_select_scope ON public.voice_calls FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR (
        caller_kind <> 'verified_owner'
        AND public.can_see_property(public.voice_call_property_id(id))
      )
    )
  );
CREATE POLICY voice_calls_insert_owner ON public.voice_calls FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY voice_calls_update_owner ON public.voice_calls FOR UPDATE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');
CREATE POLICY voice_calls_delete_owner ON public.voice_calls FOR DELETE TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS action_proposals_select_own_org ON public.action_proposals;
DROP POLICY IF EXISTS action_proposals_insert_own_org ON public.action_proposals;
DROP POLICY IF EXISTS action_proposals_update_own_org ON public.action_proposals;
DROP POLICY IF EXISTS action_proposals_delete_own_org ON public.action_proposals;
CREATE POLICY action_proposals_owner_all ON public.action_proposals TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS weekly_reports_select_own_org ON public.weekly_reports;
DROP POLICY IF EXISTS weekly_reports_insert_own_org ON public.weekly_reports;
DROP POLICY IF EXISTS weekly_reports_update_own_org ON public.weekly_reports;
DROP POLICY IF EXISTS weekly_reports_delete_own_org ON public.weekly_reports;
CREATE POLICY weekly_reports_owner_all ON public.weekly_reports TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS daily_digests_select_own_org ON public.daily_digests;
CREATE POLICY daily_digests_select_owner ON public.daily_digests FOR SELECT TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS meta_insights_select_own_org ON public.meta_insights;
DROP POLICY IF EXISTS meta_insights_insert_own_org ON public.meta_insights;
DROP POLICY IF EXISTS meta_insights_update_own_org ON public.meta_insights;
DROP POLICY IF EXISTS meta_insights_delete_own_org ON public.meta_insights;
CREATE POLICY meta_insights_owner_all ON public.meta_insights TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS memory_facts_select_own_org ON public.memory_facts;
DROP POLICY IF EXISTS memory_facts_insert_own_org ON public.memory_facts;
DROP POLICY IF EXISTS memory_facts_update_own_org ON public.memory_facts;
DROP POLICY IF EXISTS memory_facts_delete_own_org ON public.memory_facts;
CREATE POLICY memory_facts_select_scope ON public.memory_facts FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND public.can_see_property(property_id)
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR fact_type::text <> 'owner_rule'
    )
  );
CREATE POLICY memory_facts_owner_write ON public.memory_facts TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS scheduled_actions_select_own_org ON public.scheduled_actions;
DROP POLICY IF EXISTS scheduled_actions_insert_own_org ON public.scheduled_actions;
DROP POLICY IF EXISTS scheduled_actions_update_own_org ON public.scheduled_actions;
DROP POLICY IF EXISTS scheduled_actions_delete_own_org ON public.scheduled_actions;
CREATE POLICY scheduled_actions_select_scope ON public.scheduled_actions FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_role()::text IN ('owner', 'manager', 'va')
    AND (
      public.current_user_role() = 'owner'::public.user_role
      OR (property_id IS NOT NULL AND public.can_see_property(property_id))
      OR (property_id IS NULL AND user_id = (SELECT auth.uid()))
    )
  );
CREATE POLICY scheduled_actions_owner_write ON public.scheduled_actions TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

-- Property-aware operational support tables.
DROP POLICY IF EXISTS appliances_select_own_org ON public.appliances;
DROP POLICY IF EXISTS appliances_insert_own_org ON public.appliances;
DROP POLICY IF EXISTS appliances_update_own_org ON public.appliances;
DROP POLICY IF EXISTS appliances_delete_own_org ON public.appliances;
CREATE POLICY appliances_select_scope ON public.appliances FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('view_work_orders')
    AND public.can_see_property(property_id)
  );
CREATE POLICY appliances_write_scope ON public.appliances TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('manage_work_orders')
    AND public.can_see_property(property_id)
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('manage_work_orders')
    AND public.can_see_property(property_id)
  );

DROP POLICY IF EXISTS maintenance_tickets_select_own_org ON public.maintenance_tickets;
DROP POLICY IF EXISTS maintenance_tickets_insert_own_org ON public.maintenance_tickets;
DROP POLICY IF EXISTS maintenance_tickets_update_own_org ON public.maintenance_tickets;
DROP POLICY IF EXISTS maintenance_tickets_delete_own_org ON public.maintenance_tickets;
CREATE POLICY maintenance_tickets_select_scope ON public.maintenance_tickets FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('view_work_orders')
    AND public.can_see_property(property_id)
  );
CREATE POLICY maintenance_tickets_write_scope ON public.maintenance_tickets TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('manage_work_orders')
    AND public.can_see_property(property_id)
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('manage_work_orders')
    AND public.can_see_property(property_id)
  );

DROP POLICY IF EXISTS property_vendors_select_own_org ON public.property_vendors;
DROP POLICY IF EXISTS property_vendors_insert_own_org ON public.property_vendors;
DROP POLICY IF EXISTS property_vendors_update_own_org ON public.property_vendors;
DROP POLICY IF EXISTS property_vendors_delete_own_org ON public.property_vendors;
CREATE POLICY property_vendors_select_scope ON public.property_vendors FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('view_vendors')
    AND public.can_see_property(property_id)
  );
CREATE POLICY property_vendors_write_scope ON public.property_vendors TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('manage_vendors')
    AND public.can_see_property(property_id)
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND public.current_user_has_capability('manage_vendors')
    AND public.can_see_property(property_id)
  );

-- Owner/service-only provider and organization-wide infrastructure.
DROP POLICY IF EXISTS operator_chats_select_own_org ON public.operator_chats;
DROP POLICY IF EXISTS operator_chats_insert_own_org ON public.operator_chats;
DROP POLICY IF EXISTS operator_chats_update_own_org ON public.operator_chats;
DROP POLICY IF EXISTS operator_chats_delete_own_org ON public.operator_chats;
CREATE POLICY operator_chats_owner_all ON public.operator_chats TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS operator_chat_turns_select_own_org ON public.operator_chat_turns;
DROP POLICY IF EXISTS operator_chat_turns_insert_own_org ON public.operator_chat_turns;
DROP POLICY IF EXISTS operator_chat_turns_update_own_org ON public.operator_chat_turns;
DROP POLICY IF EXISTS operator_chat_turns_delete_own_org ON public.operator_chat_turns;
CREATE POLICY operator_chat_turns_owner_all ON public.operator_chat_turns TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS mcp_api_keys_select_own_org ON public.mcp_api_keys;
DROP POLICY IF EXISTS mcp_api_keys_insert_own_org ON public.mcp_api_keys;
DROP POLICY IF EXISTS mcp_api_keys_update_own_org ON public.mcp_api_keys;
DROP POLICY IF EXISTS mcp_api_keys_delete_own_org ON public.mcp_api_keys;
CREATE POLICY mcp_api_keys_owner_all ON public.mcp_api_keys TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS oauth_tokens_select_own ON public.oauth_tokens;
DROP POLICY IF EXISTS oauth_tokens_insert_own ON public.oauth_tokens;
DROP POLICY IF EXISTS oauth_tokens_update_own ON public.oauth_tokens;
DROP POLICY IF EXISTS oauth_tokens_delete_own ON public.oauth_tokens;
CREATE POLICY oauth_tokens_owner_self_all ON public.oauth_tokens TO authenticated
  USING (
    organization_id = public.current_user_org_id()
    AND user_id = (SELECT auth.uid())
    AND public.current_user_role() = 'owner'
  )
  WITH CHECK (
    organization_id = public.current_user_org_id()
    AND user_id = (SELECT auth.uid())
    AND public.current_user_role() = 'owner'
  );

DROP POLICY IF EXISTS voice_settings_select_own_org ON public.voice_settings;
DROP POLICY IF EXISTS voice_settings_insert_own_org ON public.voice_settings;
DROP POLICY IF EXISTS voice_settings_update_own_org ON public.voice_settings;
DROP POLICY IF EXISTS voice_settings_delete_own_org ON public.voice_settings;
CREATE POLICY voice_settings_owner_all ON public.voice_settings TO authenticated
  USING (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner')
  WITH CHECK (organization_id = public.current_user_org_id() AND public.current_user_role() = 'owner');

DROP POLICY IF EXISTS sendblue_number_pool_select_assigned_org ON public.sendblue_number_pool;
CREATE POLICY sendblue_number_pool_select_owner ON public.sendblue_number_pool FOR SELECT TO authenticated
  USING (
    assigned_to_organization_id = public.current_user_org_id()
    AND public.current_user_role() = 'owner'
  );

-- The KPI view is security-invoker. Its organizations row now has an
-- owner-only policy, so non-owners receive zero aggregate rows.
ALTER VIEW public.v_org_pulse_kpis SET (security_invoker = true);

-- Decision M: authenticated clients never list/read/write document bytes
-- directly. Server actions re-authorize metadata and mint short-lived URLs.
DROP POLICY IF EXISTS documents_storage_select ON storage.objects;
DROP POLICY IF EXISTS documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS documents_storage_update ON storage.objects;
DROP POLICY IF EXISTS documents_storage_delete ON storage.objects;
