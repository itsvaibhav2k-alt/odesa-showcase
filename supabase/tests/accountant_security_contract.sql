-- Catalog proof for the projection-only Accountant security boundary.
-- Run only through `supabase test db` after the caller has proven a loopback DB.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.plan(1);

DO $$
DECLARE
  enum_labels text[];
  guarded_table text;
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
  function_name text;
  function_oid oid;
  function_names text[];
  function_row record;
  policy_row record;
  constraint_definition text;
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
    INTO enum_labels
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public'
     AND t.typname = 'user_role';

  IF enum_labels IS DISTINCT FROM ARRAY['owner','manager','va','accountant'] THEN
    RAISE EXCEPTION 'user_role is not the exact staff enum: %', enum_labels;
  END IF;

  FOREACH guarded_table IN ARRAY guarded_tables LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = guarded_table
         AND c.relkind = 'r'
         AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'guarded table missing or RLS disabled: %', guarded_table;
    END IF;

    SELECT p.permissive, p.roles, p.cmd, p.qual, p.with_check
      INTO policy_row
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename = guarded_table
       AND p.policyname = 'accountant_no_direct_access';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Accountant restrictive policy missing: %', guarded_table;
    END IF;
    IF (
      SELECT count(*)
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename = guarded_table
         AND p.policyname = 'accountant_no_direct_access'
    ) <> 1 THEN
      RAISE EXCEPTION 'Accountant restrictive policy is not unique: %', guarded_table;
    END IF;
    IF policy_row.permissive <> 'RESTRICTIVE'
       OR policy_row.cmd <> 'ALL'
       OR policy_row.roles::text <> '{authenticated}' THEN
      RAISE EXCEPTION 'Accountant policy shape is wrong for %: %', guarded_table, policy_row;
    END IF;
    IF policy_row.qual IS NULL OR policy_row.with_check IS NULL
       OR position('current_user_role' in policy_row.qual) = 0
       OR position('current_user_role' in policy_row.with_check) = 0
       OR position('owner' in policy_row.qual) = 0
       OR position('manager' in policy_row.qual) = 0
       OR position('va' in policy_row.qual) = 0
       OR position('accountant' in policy_row.qual) > 0
       OR position('accountant' in policy_row.with_check) > 0 THEN
      RAISE EXCEPTION 'Accountant policy expression is not deny-by-role for %', guarded_table;
    END IF;
  END LOOP;

  function_names := ARRAY[
    'public.accountant_identity_context()',
    'public.accountant_property_lease_context(text)',
    'public.accountant_rent_events(date,date)',
    'public.accountant_payment_history(timestamp with time zone,timestamp with time zone,boolean)',
    'public.accountant_document_index()'
  ];
  FOREACH function_name IN ARRAY function_names LOOP
    function_oid := to_regprocedure(function_name);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'projection missing: %', function_name;
    END IF;
    SELECT p.prosecdef, p.provolatile, p.proconfig
      INTO function_row
      FROM pg_proc p
     WHERE p.oid = function_oid;
    IF NOT function_row.prosecdef OR function_row.provolatile <> 's'
       OR function_row.proconfig IS NULL
       OR NOT ('search_path=public, extensions' = ANY (function_row.proconfig)) THEN
      RAISE EXCEPTION 'projection is not stable SECDEF with fixed path: %', function_name;
    END IF;
    IF NOT has_function_privilege('authenticated', function_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', function_oid, 'EXECUTE')
       OR has_function_privilege('anon', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'projection grants are not authenticated/service only: %', function_name;
    END IF;
  END LOOP;

  function_names := ARRAY[
    'private.accountant_can_see_property(uuid)',
    'private.raw_unit_property_id(uuid)',
    'private.raw_lease_property_id(uuid)',
    'private.raw_tenant_property_ids(uuid)',
    'private.raw_conversation_property_id(uuid)',
    'private.raw_document_property_id(uuid)',
    'private.raw_voice_call_property_id(uuid)'
  ];
  FOREACH function_name IN ARRAY function_names LOOP
    function_oid := to_regprocedure(function_name);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'private helper missing: %', function_name; END IF;
    SELECT p.prosecdef, p.proconfig INTO function_row FROM pg_proc p WHERE p.oid = function_oid;
    IF NOT function_row.prosecdef OR function_row.proconfig IS NULL
       OR NOT ('search_path=public, extensions' = ANY (function_row.proconfig)) THEN
      RAISE EXCEPTION 'private helper is not SECDEF with fixed path: %', function_name;
    END IF;
    IF has_function_privilege('anon', function_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', function_oid, 'EXECUTE')
       OR has_function_privilege('service_role', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'private helper is directly executable: %', function_name;
    END IF;
  END LOOP;
  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'private schema is exposed';
  END IF;

  function_names := ARRAY[
    'public.visible_property_ids()', 'public.can_see_property(uuid)',
    'public.unit_property_id(uuid)', 'public.lease_property_id(uuid)',
    'public.tenant_property_ids(uuid)', 'public.conversation_property_id(uuid)',
    'public.document_property_id(uuid)', 'public.voice_call_property_id(uuid)',
    'public.work_order_property_id(uuid)', 'public.can_see_vendor(uuid)'
  ];
  FOREACH function_name IN ARRAY function_names LOOP
    function_oid := to_regprocedure(function_name);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'public resolver missing: %', function_name; END IF;
    SELECT p.prosecdef, p.proconfig INTO function_row FROM pg_proc p WHERE p.oid = function_oid;
    IF NOT function_row.prosecdef OR function_row.proconfig IS NULL
       OR NOT ('search_path=public, extensions' = ANY (function_row.proconfig))
       OR has_function_privilege('anon', function_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'public resolver path/grants are unsafe: %', function_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'documents'
       AND a.attname = 'accountant_evidence_class'
       AND NOT a.attnotnull
       AND NOT a.atthasdef
       AND a.atttypid = 'text'::regtype
       AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'document evidence classification is not explicit nullable text';
  END IF;

  SELECT pg_get_constraintdef(c.oid)
    INTO constraint_definition
    FROM pg_constraint c
   WHERE c.conrelid = 'public.documents'::regclass
     AND c.conname = 'documents_accountant_evidence_class_check'
     AND c.contype = 'c'
     AND c.convalidated;
  IF constraint_definition IS NULL
     OR position('lease_evidence' in constraint_definition) = 0
     OR position('property_accounting_evidence' in constraint_definition) = 0
     OR position('lease_id IS NOT NULL' in constraint_definition) = 0
     OR position('property_id IS NOT NULL' in constraint_definition) = 0 THEN
    RAISE EXCEPTION 'document evidence classification check is incomplete: %', constraint_definition;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.documents'::regclass
       AND tgname = 'documents_clear_accountant_lease_evidence'
       AND tgenabled <> 'D'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'lease evidence scope-loss trigger missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'documents' AND public = false) THEN
    RAISE EXCEPTION 'documents bucket is missing or public';
  END IF;
  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname IN (
         'documents_storage_select','documents_storage_insert',
         'documents_storage_update','documents_storage_delete'
       )
  ) <> 4 THEN
    RAISE EXCEPTION 'Owner-only document storage CRUD policy set is incomplete';
  END IF;
  FOR policy_row IN
    SELECT policyname, roles, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname LIKE 'documents_storage_%'
  LOOP
    IF policy_row.roles::text <> '{authenticated}'
       OR position('documents' in coalesce(policy_row.qual, '') || coalesce(policy_row.with_check, '')) = 0
       OR position('current_user_role' in coalesce(policy_row.qual, '') || coalesce(policy_row.with_check, '')) = 0
       OR position('owner' in coalesce(policy_row.qual, '') || coalesce(policy_row.with_check, '')) = 0
       OR position('current_user_org_id' in coalesce(policy_row.qual, '') || coalesce(policy_row.with_check, '')) = 0 THEN
      RAISE EXCEPTION 'document storage policy is not exact Owner/org-folder access: %', policy_row.policyname;
    END IF;
    IF policy_row.cmd = 'UPDATE' AND (policy_row.qual IS NULL OR policy_row.with_check IS NULL) THEN
      RAISE EXCEPTION 'document storage UPDATE lacks USING/WITH CHECK';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.membership_capability_overrides'::regclass
       AND tgname = 'accountant_capability_override_guard'
       AND tgenabled <> 'D'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'immutable Accountant capability ceiling trigger missing';
  END IF;
  function_oid := to_regprocedure('public.guard_accountant_capability_override()');
  IF function_oid IS NULL
     OR has_function_privilege('anon', function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Accountant capability guard function is exposed';
  END IF;

  FOR policy_row IN
    SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'organization_memberships'
       AND policyname IN (
         'accountant_membership_bootstrap_read',
         'accountant_membership_no_update',
         'accountant_membership_no_delete'
       )
  LOOP
    IF policy_row.permissive <> 'RESTRICTIVE'
       OR policy_row.roles::text <> '{authenticated}'
       OR position('current_user_role' in coalesce(policy_row.qual, '')) = 0 THEN
      RAISE EXCEPTION 'Accountant membership policy is not restrictive/fail-closed: %', policy_row.policyname;
    END IF;
    IF policy_row.cmd = 'UPDATE'
       AND (
         policy_row.with_check IS NULL
         OR position('current_user_role' in policy_row.with_check) = 0
       ) THEN
      RAISE EXCEPTION 'Accountant membership UPDATE lacks a restrictive WITH CHECK';
    END IF;
  END LOOP;
  IF (
    SELECT count(*)
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'organization_memberships'
       AND policyname IN (
         'accountant_membership_bootstrap_read',
         'accountant_membership_no_update',
         'accountant_membership_no_delete'
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'Accountant membership policy set is incomplete';
  END IF;

  function_oid := to_regprocedure('public.guard_membership_privilege_columns()');
  IF function_oid IS NULL
     OR position('NEW.id' in pg_get_functiondef(function_oid)) = 0
     OR position('OLD.id' in pg_get_functiondef(function_oid)) = 0 THEN
    RAISE EXCEPTION 'membership privilege guard does not make the primary key immutable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'users'
       AND c.relkind = 'v'
       AND 'security_invoker=true' = ANY (c.reloptions)
  ) THEN
    RAISE EXCEPTION 'legacy users adapter is not a security-invoker view';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.users', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.users', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.users', 'INSERT')
     OR has_table_privilege('authenticated', 'public.users', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.users', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'legacy users adapter grants are broader/narrower than intended';
  END IF;
  function_oid := to_regprocedure('public.write_legacy_users_view()');
  SELECT p.prosecdef, p.proconfig INTO function_row FROM pg_proc p WHERE p.oid = function_oid;
  IF function_oid IS NULL OR NOT function_row.prosecdef
     OR function_row.proconfig IS NULL
     OR NOT ('search_path=public, extensions' = ANY (function_row.proconfig))
     OR has_function_privilege('anon', function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', function_oid, 'EXECUTE')
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.users'::regclass
          AND tgname = 'users_compat_write'
          AND tgenabled <> 'D'
          AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'legacy users write adapter is unsafe';
  END IF;

  RAISE NOTICE 'Accountant catalog security contract passed (43 guarded tables, 5 projections)';
END $$;

SELECT extensions.pass('Accountant catalog security contract');
SELECT * FROM extensions.finish();
ROLLBACK;
