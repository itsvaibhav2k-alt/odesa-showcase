-- Odesa agent reliability — 'committing' claim state on action_proposals
-- Authored 2026-06-10 (agent-backend reliability plan, Phase A2)
--
-- commitProposal moves to a CAS claim: UPDATE … SET status='committing'
-- WHERE status='proposed' RETURNING, then dispatch, then markCommitted
-- with .eq('status','committing'). A dispatch-throw leaves the row in
-- 'committing' — fail closed, flagged by the watchdog as a
-- needs-reconciliation state rather than blind-retried.
--
-- status is an inline CHECK (not an enum) per the property_workers
-- migration convention, so this is a drop + re-add with the original
-- value list from 20260428000000_property_workers.sql plus 'committing'.

ALTER TABLE public.action_proposals
  DROP CONSTRAINT action_proposals_status_check;

ALTER TABLE public.action_proposals
  ADD CONSTRAINT action_proposals_status_check CHECK (status IN (
    'proposed', 'committing', 'committed', 'rejected', 'edited', 'expired'
  ));
