-- Fix v_org_pulse_kpis to honor caller RLS (security_invoker = true).
--
-- In Postgres 15+, views default to security-definer semantics: the
-- view body runs with the privileges of the view OWNER, which bypasses
-- the caller's RLS context. For the Pulse KPI rollup we want the
-- underlying table reads (units, leases, rent_events, work_orders,
-- organizations) to respect the caller's org scope so that two
-- authenticated users from different orgs see strictly disjoint rows.
--
-- See:
--   https://www.postgresql.org/docs/15/sql-createview.html#id-1.9.3.93.9
--
-- This migration is the fix for the e2e/supabase/rls.spec.ts
-- `v_org_pulse_kpis respects RLS (A sees only A, B sees only B)`
-- regression — without it the view returns rows for every org and the
-- Pulse page's `.maybeSingle()` read errors, collapsing to all zeros.

ALTER VIEW public.v_org_pulse_kpis SET (security_invoker = true);
