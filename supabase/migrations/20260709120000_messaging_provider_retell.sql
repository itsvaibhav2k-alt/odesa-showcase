-- Retell SMS unification (2026-07-09): admit 'retell' as a messaging
-- provider choice. Additive only — no default change and no data flip;
-- orgs stay on 'linq' until A2P approval is real. ADD VALUE cannot run
-- in the same transaction as usage of the new value, so this lives in
-- its own migration file.
ALTER TYPE public.messaging_provider_choice ADD VALUE IF NOT EXISTS 'retell';
