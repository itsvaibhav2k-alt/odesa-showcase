-- Odesa v1.8 — Sendblue shared-pool number assignment
-- Authored 2026-05-06 (foundation-eng)
--
-- Backs the onboarding step that hands each new org one Sendblue number from
-- the pool Odesa pre-provisions under its account. Path was the locked
-- decision in the v1.8 cohesion plan (BYO deferred).
--
-- Assignment is atomic via FOR UPDATE SKIP LOCKED in the action layer
-- (src/app/(dashboard)/onboarding/messaging/actions.ts:assignNumberAction).
-- The seed script (scripts/seed-sendblue-number-pool.ts) populates rows
-- after Odesa buys numbers in the Sendblue dashboard.
--
-- RLS:
--   - service_role bypasses RLS, so the action layer (server-side) writes
--     freely.
--   - authenticated members read only the row assigned to their org. We do
--     this through `organizations.odesa_phone_number` mostly; the table-level
--     SELECT policy lets the Settings page render the assigned status without
--     a separate org join.

CREATE TABLE public.sendblue_number_pool (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  e164                            text NOT NULL UNIQUE,
  status                          text NOT NULL DEFAULT 'available'
                                  CHECK (status IN ('available', 'assigned', 'retired')),
  assigned_to_organization_id     uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  assigned_at                     timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sendblue_number_pool_status
  ON public.sendblue_number_pool(status)
  WHERE status = 'available';

CREATE INDEX idx_sendblue_number_pool_assigned_org
  ON public.sendblue_number_pool(assigned_to_organization_id)
  WHERE assigned_to_organization_id IS NOT NULL;

ALTER TABLE public.sendblue_number_pool ENABLE ROW LEVEL SECURITY;

-- SELECT: members of the assigned org can read their row (so the UI can show
-- "you have number XXX"). Other rows are invisible to authenticated users;
-- the assignment action uses service_role to bypass RLS for cross-org pool
-- access.
CREATE POLICY sendblue_number_pool_select_assigned_org
  ON public.sendblue_number_pool FOR SELECT
  TO authenticated
  USING (assigned_to_organization_id = public.current_user_org_id());

-- INSERT/UPDATE/DELETE: no policy = denied for authenticated. Only
-- service_role (server-side actions, seed script) writes here.

GRANT SELECT ON public.sendblue_number_pool TO authenticated;
