-- Add public.messages and public.action_proposals to the supabase_realtime
-- publication so the /inbox UI can subscribe to live INSERT/UPDATE events.
-- Idempotent: only adds tables that aren't already members.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'action_proposals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.action_proposals;
  END IF;
END$$;
