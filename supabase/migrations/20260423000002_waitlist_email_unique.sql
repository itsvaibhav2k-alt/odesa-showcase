-- Replace the LOWER(email) functional unique index with a plain one on
-- email. supabase-js's upsert({onConflict}) can only match indexes whose
-- column list aligns 1:1 with the conflict target — functional indexes
-- (expression indexes) don't count. The app layer always lowercases
-- before insert so case sensitivity here is fine.

DROP INDEX IF EXISTS public.uq_waitlist_email_ci;

CREATE UNIQUE INDEX IF NOT EXISTS uq_waitlist_email
  ON public.waitlist(email);
