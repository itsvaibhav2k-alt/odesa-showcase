-- Durable web submissions are idempotent across completed runs and across a
-- first-thread creation race. The web client supplies one stable turn_id per
-- submit attempt; organization/user scope stays stable even if two concurrent
-- requests both miss the open-chat lookup and create different chat rows.

CREATE UNIQUE INDEX uq_agent_runs_web_submission
  ON public.agent_runs(organization_id, user_id, turn_id)
  WHERE surface = 'web';
