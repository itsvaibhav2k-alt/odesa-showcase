-- Odesa agent reliability — 'sending' state on message_draft_status
-- Authored 2026-06-10 (agent-backend reliability plan, Phase A2)
--
-- notify.ts and the human-approve paths adopt insert-before-send: the
-- message row is written with draft_status='sending' (the durable
-- outbound-send intent), then the provider send fires, then the row is
-- promoted to 'auto_sent'/'approved' or demoted to 'pending_review'.
--
-- message_draft_status is a true enum (20260421000000_odesa_initial.sql).
-- ALTER TYPE … ADD VALUE must be the only statement in this migration:
-- Postgres cannot use a new enum value inside the same transaction that
-- added it.

ALTER TYPE message_draft_status ADD VALUE IF NOT EXISTS 'sending';
