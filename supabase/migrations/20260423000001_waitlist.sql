-- Odesa v5 — public waitlist table.
--
-- Landing page collects email + optional metadata (name, unit count,
-- current stack). Table is writeable by anon (via RLS INSERT policy)
-- but not readable. Only service-role dashboards can list entries.

CREATE TABLE public.waitlist (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL,
  full_name      text,
  unit_count     integer,
  current_stack  text,
  source         text,              -- e.g. 'landing', 'demo', 'referral'
  referer        text,
  ip_hash        text,              -- SHA-256 of the client IP for soft rate-limit
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_waitlist_email_ci
  ON public.waitlist(LOWER(email));

CREATE INDEX idx_waitlist_created_at
  ON public.waitlist(created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Anyone can insert (no JWT required), but nobody can read through the
-- anon key. Admin surfaces use the service role.
CREATE POLICY waitlist_public_insert
  ON public.waitlist
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
