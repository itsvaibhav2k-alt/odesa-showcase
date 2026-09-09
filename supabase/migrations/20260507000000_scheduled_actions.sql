-- Odesa v1.9 — scheduled_actions table for autonomous timer-driven actions
-- Authored 2026-05-07 (foundation-eng)
--
-- Backs the schedule_action / list_scheduled / cancel_scheduled MCP tools the
-- dispatcher uses for "if X by Friday, send Y" requests. The Inngest function
-- (src/lib/inngest/functions/fire-scheduled-action.ts) wakes at trigger_at
-- via step.sleepUntil, evaluates the structured condition against live DB,
-- and either fires (spawn fresh worker → gate-decide → maybe commit) or
-- marks the row condition_failed.
--
-- Lifecycle: scheduled → (fired | condition_failed | cancelled | expired)
--
-- Cancellation is DB-status-based: cancel_scheduled flips status='cancelled';
-- the sleeping Inngest job rechecks status after wake and no-ops if it isn't
-- still 'scheduled'. We don't try to cancel the Inngest event itself —
-- letting it wake and exit early is cheaper than the cancellation API.
--
-- The condition column is structured JSONB carrying one of three discriminated
-- shapes (null = unconditional fire — synonymous with {type: 'always'}):
--   { type: 'rent_unpaid', tenantId: uuid, asOf: 'trigger_at' }
--   { type: 'tenant_no_response', tenantId: uuid, sinceProposalId: uuid }
--   { type: 'always' }
-- The structured DSL is intentionally narrow — auto-evicting a tenant who
-- paid yesterday is catastrophic, so freeform NL conditions are out of scope
-- this wave. Anything outside these three is the dispatcher's job to refuse
-- at schedule time.
--
-- routing.scheduledActionId is added on action_proposals.routing (no schema
-- change needed; routing is JSONB). The fired_proposal_id FK back-references
-- the proposal that resulted from a fire, so audit links flow both ways.

CREATE TABLE public.scheduled_actions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id                 uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id                     uuid NOT NULL REFERENCES public.users(id),

  trigger_at                  timestamptz NOT NULL,

  -- Structured condition; null = unconditional fire (synonym for {type:'always'})
  condition                   jsonb,
  condition_text              text NOT NULL,

  -- The action to fire if the condition holds
  action_type                 text NOT NULL,
  action_payload              jsonb NOT NULL,
  action_text                 text NOT NULL,

  status                      text NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled', 'fired', 'condition_failed', 'cancelled', 'expired')),
  fired_at                    timestamptz,
  fired_proposal_id           uuid REFERENCES public.action_proposals(id),
  cancelled_at                timestamptz,
  cancelled_by                uuid REFERENCES public.users(id),
  cancellation_reason         text,
  condition_failure_reason    text,

  inngest_event_id            text,

  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_actions_org      ON public.scheduled_actions(organization_id);
CREATE INDEX idx_scheduled_actions_user     ON public.scheduled_actions(user_id);
CREATE INDEX idx_scheduled_actions_property ON public.scheduled_actions(property_id) WHERE property_id IS NOT NULL;

-- Hot-path index used by the Inngest pre-fire scan + by list_scheduled.
-- Partial keeps it lean — fired/cancelled rows accumulate over time.
CREATE INDEX idx_scheduled_actions_pending
  ON public.scheduled_actions(trigger_at)
  WHERE status = 'scheduled';

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.scheduled_actions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.scheduled_actions ENABLE ROW LEVEL SECURITY;

-- Org-scoped CRUD policies. Pattern matches the DO loop in
-- 20260428000001_property_workers_rls.sql.
DO $$
DECLARE
  t text := 'scheduled_actions';
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_actions TO authenticated;
