-- Odesa tenant portal — portal_otps (Tenant Portal, Wave 0)
-- Authored 2026-08-05 (portal-eng)
--
-- Backs the phone-OTP login flow on /portal/login:
--
--   1. requestPortalOtp(phoneE164):
--        resolve tenant by phone (single-org matches only; multi-org fails
--        closed) → crypto-random 6-digit code → HMAC-SHA256(code,
--        PORTAL_SESSION_SECRET) → INSERT into portal_otps with
--        expires_at = now() + 10 min, then send the code via the org's
--        Odesa number through sendWithFailover.
--
--   2. confirmPortalOtp(phoneE164, code):
--        HMAC the submitted code → SELECT the most-recent un-consumed
--        un-expired row for the phone → constant-time compare → atomic
--        consume (UPDATE … SET consumed_at = now() WHERE consumed_at IS
--        NULL RETURNING) → mint the `odesa_portal` session cookie.
--
-- Codes are NEVER stored in cleartext, and unlike phone_verifications
-- (20260502000001) the stored hash is a keyed HMAC, not bare sha256 —
-- there are only 10^6 six-digit codes, so an unkeyed hash is offline-
-- brute-forceable from a DB snapshot; the server-side secret closes that.
--
-- attempts: incremented on every wrong confirm against this row. The
-- action layer caps at 5 attempts, then locks the row out (sets
-- consumed_at) so brute-force can't grind through the code space inside
-- the 10-minute window.
--
-- Sibling to 20260502000001_phone_verifications.sql in shape, but the
-- trust model differs: phone_verifications rows are written under an
-- authenticated staff session, while portal_otps rows are minted by
-- UNAUTHENTICATED pre-login requests. The table is therefore
-- service-role only — RLS enabled with ZERO policies plus an explicit
-- REVOKE, so anon/authenticated access fails closed.

-- =========================================================================
-- portal_otps — one row per OTP request
-- =========================================================================

CREATE TABLE public.portal_otps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id)       ON DELETE CASCADE,
  phone_e164       text NOT NULL,
  code_hash        text NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  attempts         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT NOW()
);

-- Hot path: both request (60s resend cooldown) and confirm scan by phone
-- for live, un-consumed rows, newest first. Partial keeps the index
-- small — the long tail of consumed/expired rows isn't covered.
CREATE INDEX idx_portal_otps_lookup
  ON public.portal_otps(phone_e164, expires_at DESC)
  WHERE consumed_at IS NULL;

-- =========================================================================
-- RLS — enabled with ZERO policies (service-role only, fails closed)
-- =========================================================================
--
-- No policies on purpose: with RLS enabled and no policies, the table is
-- unreadable and unwritable for anon + authenticated even if a stray
-- GRANT ever appears. The explicit REVOKE makes the service-role-only
-- contract loud and strips the schema-default privileges.

ALTER TABLE public.portal_otps ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portal_otps FROM anon, authenticated;
