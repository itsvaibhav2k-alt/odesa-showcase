-- Odesa v1.6 — phone_verifications (Operator Property Agent, Phase 5)
-- Authored 2026-05-02 (settings-eng)
--
-- Backs the operator phone-verify flow on /settings/integrations:
--
--   1. requestPhoneVerification(phoneE164):
--        generate 6-digit code → sha256 → INSERT into phone_verifications
--        with expires_at = now() + 10 min, then send the code via the
--        org's primary MessagingProvider.
--
--   2. confirmPhoneVerification(phoneE164, code):
--        sha256 the submitted code → SELECT the most-recent un-consumed
--        un-expired matching row → UPDATE consumed_at = now() → write
--        users.phone_e164 + users.phone_verified_at.
--
-- Codes are NEVER stored in cleartext, only the sha256 hash, so a DB
-- snapshot doesn't leak active OTPs. The partial index on (user_id,
-- phone_e164, expires_at) WHERE consumed_at IS NULL covers the live
-- lookup path without indexing the long tail of consumed/expired rows.
--
-- Sibling to 20260502000000_operator_chats.sql (which added users
-- phone_e164 + phone_verified_at and the operator-chat tables). Splits
-- because that migration was already committed by foundation-eng before
-- this surface was scoped; keeping the table in its own file makes the
-- ownership boundary obvious and avoids re-applying foundation-eng's
-- work.

-- =========================================================================
-- phone_verifications — one row per OTP request
-- =========================================================================
--
-- organization_id is denormalized for fast RLS (matches the convention
-- in 20260421000000_odesa_initial.sql and the operator_chats migration).
-- user_id is intentionally redundant with organization_id to support
-- per-user lookup without joining users.
--
-- code_hash:   sha256 hex of the 6-digit code (deterministic; codes never
--              stored cleartext).
-- expires_at:  set by the action layer to now() + 10 min. confirmation
--              path filters on `expires_at >= now() AND consumed_at IS NULL`.
-- consumed_at: set on successful confirmation. Once non-null the row is
--              never re-usable.
-- attempts:    incremented on every confirmPhoneVerification call against
--              this row, even when the submitted code is wrong. Lets the
--              action layer cap at N attempts before locking the row out
--              (set consumed_at) so brute-force can't grind through all
--              10^6 six-digit codes inside the 10-minute window.

CREATE TABLE public.phone_verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id)         ON DELETE CASCADE,
  phone_e164       text NOT NULL,
  code_hash        text NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_phone_verifications_organization_id
  ON public.phone_verifications(organization_id);

-- Hot-path: confirmPhoneVerification scans (user_id, phone_e164,
-- expires_at) restricted to live, un-consumed rows. Partial keeps the
-- index small — the long tail of consumed/expired rows isn't covered.
-- expires_at DESC because the action layer wants the MOST RECENT live
-- code first when multiple OTPs were minted for the same phone before
-- one was consumed (e.g. the operator typed twice before the first SMS
-- arrived).
CREATE INDEX idx_phone_verifications_lookup
  ON public.phone_verifications(user_id, phone_e164, expires_at DESC)
  WHERE consumed_at IS NULL;

-- =========================================================================
-- RLS — enable + uniform org-scoped CRUD
-- =========================================================================
--
-- Mirrors the DO loop in 20260502000000_operator_chats.sql so all v1.6
-- tables stay uniform.

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  policy_tables text[] := ARRAY[
    'phone_verifications'
  ];
BEGIN
  FOREACH t IN ARRAY policy_tables LOOP
    EXECUTE format($fmt$
      CREATE POLICY %I_select_own_org
        ON public.%I FOR SELECT
        TO authenticated
        USING (organization_id = public.current_user_org_id());

      CREATE POLICY %I_insert_own_org
        ON public.%I FOR INSERT
        TO authenticated
        WITH CHECK (organization_id = public.current_user_org_id());

      CREATE POLICY %I_update_own_org
        ON public.%I FOR UPDATE
        TO authenticated
        USING      (organization_id = public.current_user_org_id())
        WITH CHECK (organization_id = public.current_user_org_id());

      CREATE POLICY %I_delete_own_org
        ON public.%I FOR DELETE
        TO authenticated
        USING (organization_id = public.current_user_org_id());
    $fmt$, t, t, t, t, t, t, t, t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.phone_verifications
TO authenticated;
