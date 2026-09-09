-- Odesa Wave 6 — maintenance_tickets table for the agentic dispatcher
-- Authored 2026-05-07 (messaging-agent / Stream C)
--
-- Backs the `log_maintenance_ticket` worker action_type. The dispatcher
-- (handle-operator-inbound) routes operator intent like "log a leaky
-- faucet at 2B" through spawn_property_worker → commit-gate → this row
-- insert. Distinct from public.work_orders, which models the full
-- vendor-dispatch lifecycle (assignment, status timeline, urgency
-- enum). Tickets are a lightweight intake layer the operator owns:
-- one summary line, free-form severity, optional photos JSON, an
-- `open` status that flips closed by hand or by future automation.
--
-- We intentionally keep ticket → work_order one-way (no FK) so the
-- operator can decide which tickets warrant a vendor dispatch later.

CREATE TABLE public.maintenance_tickets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  summary           text NOT NULL,
  severity          text NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low', 'medium', 'high', 'urgent')),
  reported_by       text,
  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
  photos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_maintenance_tickets_organization_id
  ON public.maintenance_tickets(organization_id);
CREATE INDEX idx_maintenance_tickets_unit_id
  ON public.maintenance_tickets(unit_id);
CREATE INDEX idx_maintenance_tickets_property_id
  ON public.maintenance_tickets(property_id);
CREATE INDEX idx_maintenance_tickets_status
  ON public.maintenance_tickets(status);

-- Hot-path index for the idempotency lookup the handler runs
-- (org_id + unit_id + summary, last 5 minutes). Partial keeps it lean.
CREATE INDEX idx_maintenance_tickets_open
  ON public.maintenance_tickets(organization_id, unit_id, created_at DESC)
  WHERE status = 'open';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.maintenance_tickets
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;

-- Org-scoped CRUD policies. Pattern matches the DO loop in
-- 20260428000001_property_workers_rls.sql.
DO $$
DECLARE
  t text := 'maintenance_tickets';
BEGIN
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
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_tickets TO authenticated;
