-- =========================================================================
-- Fix Pulse KPI view — date-aware lateness + partial payments
-- =========================================================================
--
-- Trust-sprint fix for v_org_pulse_kpis. The original view derived
-- lateness from the rent_events.status enum alone, so an unpaid past-due
-- 'pending'/'reminder_sent' cycle never counted late, and collected rent
-- ignored partial payments on non-'paid' cycles.
--
-- Updated definitions (output column names and types are kept EXACTLY
-- stable, so generated Supabase types do not change):
--   occupancy_pct                   : occupied units / total units × 100.
--                                     A unit is occupied iff it has a
--                                     lease with status = 'active'
--                                     (including active past end_date —
--                                     someone is still tied to the unit);
--                                     pending/expired/terminated leases
--                                     do not count.
--   rent_collected_this_month_cents : sum(amount_paid) for rent_events in
--                                     the current calendar month
--                                     REGARDLESS of status — partial
--                                     payments count toward collected.
--   rent_due_this_month_cents       : sum(amount_due) for rent_events
--                                     in the current calendar month
--                                     (unchanged).
--   open_work_orders_count          : WOs with status not in
--                                     ('completed','cancelled')
--                                     (unchanged).
--   late_tenants_count              : distinct tenants (via lease) with a
--                                     current-month rent_event where the
--                                     balance (amount_due - amount_paid)
--                                     is > 0 AND status <> 'plan_agreed'
--                                     AND (due_date < CURRENT_DATE OR
--                                     status = 'escalated'). Explicit
--                                     decision: 'escalated' counts late
--                                     even with a NULL due_date.
--
-- Timezone note: lateness compares due_date against CURRENT_DATE, which
-- is the DATABASE timezone, not the org's local timezone. Org-timezone
-- awareness is a flagged follow-up, not part of this sprint.
--
-- RLS: views inherit RLS from underlying tables; security_invoker is
-- re-asserted below because CREATE OR REPLACE VIEW resets the option
-- (see 20260422000000_fix_view_security_invoker.sql).

CREATE OR REPLACE VIEW public.v_org_pulse_kpis AS
WITH current_month AS (
  SELECT
    date_trunc('month', CURRENT_DATE)::date AS start_of_month
),
org_units AS (
  SELECT
    u.organization_id,
    COUNT(*) AS total_units,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM public.leases l
        WHERE l.unit_id = u.id AND l.status = 'active'
      )
    ) AS occupied_units
  FROM public.units u
  GROUP BY u.organization_id
),
org_rent AS (
  SELECT
    re.organization_id,
    SUM(re.amount_paid) AS collected_dollars,
    SUM(re.amount_due)  AS due_dollars
  FROM public.rent_events re, current_month cm
  WHERE re.cycle_month >= cm.start_of_month
    AND re.cycle_month <  (cm.start_of_month + INTERVAL '1 month')
  GROUP BY re.organization_id
),
org_wos AS (
  SELECT
    wo.organization_id,
    COUNT(*)::int AS open_count
  FROM public.work_orders wo
  WHERE wo.status NOT IN ('completed', 'cancelled')
  GROUP BY wo.organization_id
),
org_late AS (
  SELECT
    re.organization_id,
    COUNT(DISTINCT l.tenant_id)::int AS late_tenant_count
  FROM public.rent_events re
  JOIN public.leases l ON l.id = re.lease_id
  CROSS JOIN current_month cm
  WHERE re.cycle_month >= cm.start_of_month
    AND re.cycle_month <  (cm.start_of_month + INTERVAL '1 month')
    AND (re.amount_due - re.amount_paid) > 0
    AND re.status <> 'plan_agreed'
    AND (re.due_date < CURRENT_DATE OR re.status = 'escalated')
  GROUP BY re.organization_id
)
SELECT
  o.id AS organization_id,
  COALESCE(
    ROUND(
      (ou.occupied_units::numeric / NULLIF(ou.total_units, 0)::numeric) * 100,
      2
    ),
    0
  ) AS occupancy_pct,
  COALESCE((orent.collected_dollars * 100)::bigint, 0) AS rent_collected_this_month_cents,
  COALESCE((orent.due_dollars * 100)::bigint, 0)       AS rent_due_this_month_cents,
  COALESCE(ow.open_count, 0)                           AS open_work_orders_count,
  COALESCE(ol.late_tenant_count, 0)                    AS late_tenants_count
FROM public.organizations o
LEFT JOIN org_units ou ON ou.organization_id = o.id
LEFT JOIN org_rent  orent ON orent.organization_id = o.id
LEFT JOIN org_wos   ow ON ow.organization_id = o.id
LEFT JOIN org_late  ol ON ol.organization_id = o.id;

-- CREATE OR REPLACE VIEW resets security_invoker — re-assert it so the
-- view honors the caller's RLS context (see
-- 20260422000000_fix_view_security_invoker.sql for the original fix and
-- the rls.spec.ts regression it guards).
ALTER VIEW public.v_org_pulse_kpis SET (security_invoker = true);

GRANT SELECT ON public.v_org_pulse_kpis TO authenticated;

COMMENT ON VIEW public.v_org_pulse_kpis IS
  'Pulse dashboard KPIs: occupancy %, rent collected cents (partial payments included), rent due cents, open WOs, late tenants (date-aware: balance > 0, not plan_agreed, past due_date or escalated). security_invoker = true; RLS inherits from underlying tables. Lateness uses CURRENT_DATE (DB timezone) — org-timezone awareness is a flagged follow-up.';
