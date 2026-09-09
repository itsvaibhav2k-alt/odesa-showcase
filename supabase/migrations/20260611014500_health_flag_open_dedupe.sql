-- Feature 5 — proactive health-check proposals (action_type 'health_flag').
--
-- `action_proposals.action_type` is plain text with NO CHECK constraint
-- (20260428000000_property_workers.sql), so the new verb itself needs
-- zero column changes. This migration adds ONLY the dedupe backstop:
--
--   At most one OPEN (status='proposed') health flag per
--   (organization, payload kind, payload subject).
--
-- The producer (src/lib/health/generate.ts) pre-reads open flags before
-- inserting; this partial unique index is the race-proof backstop — a
-- concurrent duplicate insert fails with 23505, which the producer
-- treats as a skip.
--
-- NOTE: plain INSERT + 23505-as-skip on purpose. NEVER `ON CONFLICT`
-- against a partial unique index (lesson recorded in
-- 20260423000000_source_aero_indexes_nonpartial.sql — Postgres cannot
-- match the partial predicate from a bare conflict-target column list,
-- so every upsert errors with "no unique or exclusion constraint").
--
-- The predicate keys on status='proposed' so the dedupe slot frees as
-- soon as the owner acts: approve moves the row 'proposed' →
-- 'committing' → 'committed' (acknowledge), decline moves it to
-- 'rejected' (dismiss). Either way the same (kind, subject) may be
-- legitimately re-flagged by a later sweep while it is still unhealthy.

CREATE UNIQUE INDEX uq_action_proposals_open_health_flag
  ON public.action_proposals (
    organization_id,
    (payload->>'kind'),
    (payload->>'subject')
  )
  WHERE action_type = 'health_flag' AND status = 'proposed';
