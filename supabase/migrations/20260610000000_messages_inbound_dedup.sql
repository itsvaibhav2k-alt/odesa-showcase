-- Odesa agent reliability — inbound message dedup
-- Authored 2026-06-10 (agent-backend reliability plan, Phase A1)
--
-- Provider webhooks (Linq/Twilio) retry on timeout; with no uniqueness on
-- (provider, provider_message_id) each retry created a duplicate inbound
-- message row, and each duplicate triggered a duplicate draft.
--
-- 1. Backfill-DELETE duplicate inbound rows, keeping the oldest row per
--    (provider, provider_message_id). messages has no child FKs, so the
--    delete is safe. (SELECT version was run against prod 2026-06-10:
--    zero duplicate groups existed, so this is a no-op safety net.)
-- 2. Partial unique index — scoped to inbound because outbound rows reuse
--    provider handles, and partial so NULL provider_message_id stays legal.
-- 3. inbound_webhook_dedup — claim table for the operator path, which
--    writes no message row at all (a retried webhook would otherwise
--    re-run the entire dispatcher and double-reply). RLS deny-all: only
--    the service role (which bypasses RLS) ever touches it.

-- 1. Backfill: keep the oldest row per (provider, provider_message_id).
DELETE FROM public.messages
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY provider, provider_message_id
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.messages
    WHERE direction = 'inbound'
      AND provider_message_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- 2. Uniqueness for inbound provider message ids.
CREATE UNIQUE INDEX uq_messages_inbound_provider_msg
  ON public.messages (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND direction = 'inbound';

-- 3. Claim table for webhook paths that write no message row.
CREATE TABLE public.inbound_webhook_dedup (
  provider             text NOT NULL,
  provider_message_id  text NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, provider_message_id)
);

-- Deny-all RLS: enabled with no policies. The service role bypasses RLS;
-- authenticated/anon get nothing (no grants either).
ALTER TABLE public.inbound_webhook_dedup ENABLE ROW LEVEL SECURITY;
