-- Odesa v1.8 — realtime publication for operator_chat_turns
-- Authored 2026-05-06 (foundation-eng)
--
-- Lets the org-level /inbox web client subscribe to live chat turns via
-- Supabase realtime, so iMessage inbound (handle-operator-inbound) and web
-- SSE writes show up in both surfaces without polling.
--
-- Wrapped in DO so the migration is idempotent — supabase_realtime publication
-- is created during local init but ALTER ... ADD TABLE errors if the table is
-- already a member.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'operator_chat_turns'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.operator_chat_turns';
  END IF;
END
$$;
