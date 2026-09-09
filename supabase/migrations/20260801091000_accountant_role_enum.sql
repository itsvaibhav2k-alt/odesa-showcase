-- Odesa Accountant — additive STAFF membership role only.
--
-- PostgreSQL enum additions must commit before a following migration uses the
-- new label in functions, policies, fixtures, or casts. Tenant principals are
-- deliberately not staff roles and must never be added to public.user_role.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'accountant';
