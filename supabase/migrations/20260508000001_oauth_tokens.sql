-- Odesa Wave 7 — oauth_tokens (Stream A.1, Stage 4 prep)
-- Authored 2026-05-08 (foundation-agent / Stream A)
--
-- Stores per-user OAuth tokens for third-party integrations. Today's
-- only consumer is Google Calendar (Stream G); the schema is pre-shaped
-- for Gmail + Drive so future waves don't need a new migration.
--
-- Encryption: access_token + refresh_token are stored encrypted at the
-- application layer using OAUTH_TOKEN_ENCRYPTION_KEY (Stream G owns
-- the encryption helper). The DB does not enforce encryption — the
-- columns are plain `text` because pgsodium is not enabled on the
-- cloud project. Treat the columns as opaque ciphertext from this
-- table's perspective.
--
-- RLS: each row scopes to a single user_id. Only that user can read or
-- write their own tokens. The service-role admin client bypasses RLS
-- as usual for the worker-side calendar clients.

CREATE TABLE public.oauth_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider          text NOT NULL
                      CHECK (provider IN (
                        'google_calendar', 'google_gmail', 'google_drive'
                      )),
  access_token      text NOT NULL,
  refresh_token     text NOT NULL,
  expires_at        timestamptz NOT NULL,
  scope             text,
  account_email     text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, provider)
);

CREATE INDEX idx_oauth_tokens_user_provider
  ON public.oauth_tokens(user_id, provider);
CREATE INDEX idx_oauth_tokens_organization_id
  ON public.oauth_tokens(organization_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Owner-only RLS — distinct from the org-wide pattern used for
-- everything else. OAuth tokens are personal credentials, NEVER shared
-- between users in the same org.
CREATE POLICY oauth_tokens_select_own
  ON public.oauth_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY oauth_tokens_insert_own
  ON public.oauth_tokens FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY oauth_tokens_update_own
  ON public.oauth_tokens FOR UPDATE
  TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY oauth_tokens_delete_own
  ON public.oauth_tokens FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_tokens TO authenticated;
