-- Odesa Voice Operator V1 — voice_calls call-session + outcome artifact
-- Authored 2026-07-05
--
-- One row per Retell call. Tool routes and the webhook accumulate the
-- live session (intents, facts, action log) in `session` jsonb keyed by
-- retell_call_id; the outcome compiler writes the immutable `outcome`
-- jsonb once at call_ended and links the inbox artifact via
-- `conversation_id`. Scalar columns exist only where a query or FK
-- drill-in needs them; everything structured lives in jsonb validated
-- by zod in src/lib/voice/types.ts. Service-role writes bypass RLS
-- (same as all Retell tool routes); RLS below covers dashboard reads.

CREATE TABLE public.voice_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  retell_call_id    text NOT NULL UNIQUE,
  direction         text NOT NULL DEFAULT 'inbound'
                    CHECK (direction IN ('inbound', 'outbound')),
  from_number       text NOT NULL,
  to_number         text NOT NULL,
  caller_kind       text NOT NULL DEFAULT 'unknown_caller'
                    CHECK (caller_kind IN (
                      'verified_owner', 'verified_tenant', 'likely_tenant',
                      'known_vendor', 'unknown_caller', 'ambiguous')),
  tenant_id         uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  vendor_id         uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  property_id       uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id           uuid REFERENCES public.units(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'completed', 'failed')),
  started_at        timestamptz NOT NULL DEFAULT NOW(),
  ended_at          timestamptz,
  transcript        text,
  summary           text,
  session           jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome           jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voice_calls_org_started
  ON public.voice_calls(organization_id, started_at DESC);
CREATE INDEX idx_voice_calls_conversation_id
  ON public.voice_calls(conversation_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.voice_calls
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;

-- Org-scoped CRUD policies. Pattern matches the DO loop in
-- 20260507150000_maintenance_tickets.sql.
DO $$
DECLARE
  t text := 'voice_calls';
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_calls TO authenticated;
