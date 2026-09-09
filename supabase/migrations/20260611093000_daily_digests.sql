-- Odesa daily digest — immutable per-day "what changed overnight" snapshot
-- Authored 2026-06-11 (interaction pass, Feature 4)
--
-- One row per (organization, day), written exactly once by the
-- generate-daily-digest Inngest cron (service role) and read org-scoped
-- by the /today surface. `sections` is a jsonb snapshot — precedent:
-- work_orders.status_timeline and weekly_reports. Normalizing would buy
-- nothing and cost joins; the digest is never updated after insert.
--
-- `version` is the sections-shape version so the renderer can evolve
-- without guessing at old payloads. `window_start`/`window_end` record
-- the exact 24h window the generator computed — needed for debugging
-- cron drift and backfills (generated_at would be redundant with
-- created_at, so it is omitted).
--
-- The UNIQUE constraint is full (non-partial) — repo lesson
-- 20260423000000: partial unique indexes can't back upserts. Plain
-- INSERT + 23505-as-skip makes the daily sweep idempotent per
-- (org, date). The constraint's backing index also serves the
-- org-scoped "latest digest" read path (organization_id leads), so no
-- separate org index is needed.

CREATE TABLE public.daily_digests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  digest_date      date NOT NULL,
  sections         jsonb NOT NULL,
  version          int NOT NULL DEFAULT 1,
  window_start     timestamptz NOT NULL,
  window_end       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_daily_digests_org_date UNIQUE (organization_id, digest_date)
);

-- =========================================================================
-- RLS — org-scoped SELECT only (mirrors 20260610000003_agent_runs.sql)
-- =========================================================================
--
-- Clients only ever read digests. The single writer is the Inngest cron
-- through the service role, which bypasses RLS — so no INSERT/UPDATE
-- policies exist on purpose.

ALTER TABLE public.daily_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_digests_select_own_org
  ON public.daily_digests FOR SELECT
  TO authenticated
  USING (organization_id = public.current_user_org_id());

GRANT SELECT ON public.daily_digests TO authenticated;
