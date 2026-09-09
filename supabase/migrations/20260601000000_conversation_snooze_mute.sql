-- Conversation snooze + mute — Inbox case-header controls.
--
-- snoozed_until: when set to a future time, the thread is suppressed from the
-- "needs you" count and Today's Owner Review queue until that moment, then
-- resurfaces on its own. muted: when true, the thread never counts toward
-- "needs you" or the urgent queue until the operator unmutes. Both are
-- owner-driven and intentionally do NOT change the conversation lifecycle
-- `status` (open/escalated/resolved).
--
-- Org scoping + RLS are unchanged — the existing conversations policies still
-- gate every read/write. No backfill needed: NULL snooze = not snoozed,
-- muted defaults to false for existing rows.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz,
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS conversations_snoozed_until_idx
  ON public.conversations(snoozed_until);
