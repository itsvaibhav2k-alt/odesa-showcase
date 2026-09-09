-- Odesa v1.8 — per-org assistant identity (branding)
-- Authored 2026-05-06 (foundation-eng)
--
-- Adds organizations.assistant_name so the AI can introduce itself with the
-- name the operator chose during onboarding (default 'Odesa'). Used in:
--   - src/lib/agent/worker/system-prompt.ts          ("You are <name>...")
--   - src/lib/agent/operator/dispatcher.ts           (system prompt header)
--   - src/lib/messaging/system-prompt.ts             (tenant-facing tone)
--   - src/lib/agent/operator/imessage.ts             (sign-off line)
--
-- Required NOT NULL with a default so existing rows backfill cleanly. Length
-- bounded at 30 chars at the application layer (validation in onboarding
-- actions); not enforced as a DB CHECK because the admin tooling may need
-- longer brand names in the future.

ALTER TABLE public.organizations
  ADD COLUMN assistant_name text NOT NULL DEFAULT 'Odesa';
