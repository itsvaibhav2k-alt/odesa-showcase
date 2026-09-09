-- Restore deterministic table grants for service_role + authenticated.
--
-- WHY: newer Supabase CLI/postgres images harden schema-public DEFAULT
-- PRIVILEGES to TRUNCATE/REFERENCES/TRIGGER/MAINTAIN only (no CRUD) for
-- anon/authenticated/service_role. Older local volumes and the existing
-- cloud project were provisioned with full CRUD defaults, so every
-- migration in this repo was written assuming them: service_role
-- (webhooks, Retell tools, cron, e2e admin helpers) got table access
-- implicitly, and only `authenticated` received explicit per-table
-- GRANTs. On a freshly provisioned local stack, `supabase db reset` now
-- yields "permission denied for table …" (42501) for every service-role
-- read/write — all Retell/voice routes 404 and the Playwright admin
-- client cannot provision fixtures.
--
-- This migration pins the intended grants explicitly so any stack —
-- old volume, fresh volume, cloud — resets to the same state. Row
-- security is unchanged: RLS policies (TO authenticated, org-scoped)
-- remain the row gate; service_role is Supabase's RLS-bypassing server
-- key by design. `anon` is deliberately NOT granted CRUD.

GRANT USAGE ON SCHEMA public TO service_role, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  TO service_role, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO service_role, authenticated;

-- Future tables created by migrations (which run as postgres) inherit
-- the same grants, so per-table GRANT boilerplate can never be silently
-- missing again.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES TO service_role, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role, authenticated;
