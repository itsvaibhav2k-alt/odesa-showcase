-- Wave 3 inbox redesign: extend the supabase_realtime publication with
-- public.rent_events and public.work_orders so the case-file column on
-- /inbox can refresh live when a vendor accepts a job or a rent_event
-- flips to a new late tier. Idempotent: only adds tables that aren't
-- already members. Mirrors 20260507143200_inbox_realtime.sql exactly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'rent_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.rent_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'work_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_orders;
  END IF;
END$$;
