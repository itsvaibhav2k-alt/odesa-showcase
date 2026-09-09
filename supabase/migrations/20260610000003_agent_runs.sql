-- Odesa agent reliability — agent_runs (durable run intent)
-- Authored 2026-06-10 (agent-backend reliability plan, Phase B schema)
--
-- A run row is the durable intent for one dispatcher execution: surfaces
-- enqueue (queued), the Inngest executor claims atomically (queued →
-- running) and heartbeats, the watchdog fails stale rows, and the client
-- follows status over realtime with DB polling as fallback. DB state is
-- canonical; realtime is only delivery.
--
-- turn_id is text (not uuid) to match operator_chat_turns.turn_id — the
-- dispatcher mints it as a logical group key, not a row id.

CREATE TABLE public.agent_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES public.users(id)          ON DELETE CASCADE,
  chat_id            uuid NOT NULL REFERENCES public.operator_chats(id) ON DELETE CASCADE,
  turn_id            text NOT NULL,
  surface            text NOT NULL CHECK (surface IN ('web', 'imessage')),
  channel            text NOT NULL,
  message            text NOT NULL,
  property_hint      jsonb,
  reply_to_e164      text,
  status             text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'done', 'failed'
  )),
  started_at         timestamptz,
  finished_at        timestamptz,
  heartbeat_at       timestamptz,
  error              text,
  error_notified_at  timestamptz,
  reply_text         text,
  created_at         timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_organization_id ON public.agent_runs(organization_id);

-- Watchdog scan path: running rows with a stale heartbeat.
CREATE INDEX idx_agent_runs_heartbeat
  ON public.agent_runs(heartbeat_at)
  WHERE status = 'running';

-- DB-level one-active-run-per-chat — Inngest concurrency must not be
-- the only boundary.
CREATE UNIQUE INDEX uq_agent_runs_active_chat
  ON public.agent_runs(chat_id)
  WHERE status IN ('queued', 'running');

-- =========================================================================
-- RLS — org-scoped SELECT only
-- =========================================================================
--
-- Clients only ever read run status (realtime + polling fallback). All
-- writes (enqueue, claim, heartbeat, finalize, watchdog) go through the
-- service role, which bypasses RLS.

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_runs_select_own_org
  ON public.agent_runs FOR SELECT
  TO authenticated
  USING (organization_id = public.current_user_org_id());

GRANT SELECT ON public.agent_runs TO authenticated;

-- =========================================================================
-- Realtime — status updates (failed → error surface, done → clear)
-- =========================================================================
--
-- DO-wrapped for idempotency, mirroring
-- 20260506000003_realtime_operator_chat_turns.sql.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_runs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs';
  END IF;
END
$$;
