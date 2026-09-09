-- Odesa Voice Operator Settings - org-scoped configuration
-- Authored 2026-07-07
--
-- Stores voice configuration per organization including:
-- - Retell connection details (phone number, agent ID)
-- - Enablement flags (voice, live calls, HMAC)
-- - Operator behavior configuration
-- - Call scripts and overrides
--
-- Single row per org (upsert pattern). Service-role writes for admin updates;
-- RLS for dashboard reads. JSONB fields for flexible structured config that
-- can evolve without migrations.

CREATE TABLE public.voice_settings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Retell connection
  retell_phone_number_e164  text,
  retell_agent_id          text,

  -- Feature flags
  voice_enabled            boolean NOT NULL DEFAULT false,
  live_calls_enabled       boolean NOT NULL DEFAULT false,
  hmac_verification_enabled boolean NOT NULL DEFAULT false,

  -- Operator configuration (JSONB for flexibility)
  operator_summary         jsonb NOT NULL DEFAULT '{"role": "Professional property management assistant", "tone": "helpful and efficient"}'::jsonb,
  property_context_policy  jsonb NOT NULL DEFAULT '{"includeLeaseDetails": true, "includeMaintenanceHistory": true}'::jsonb,
  information_to_collect   jsonb NOT NULL DEFAULT '["caller identity", "callback number", "property/unit", "issue details"]'::jsonb,
  topics_to_avoid         jsonb NOT NULL DEFAULT '["eviction threats", "legal advice", "fee waivers", "private data to unknown callers"]'::jsonb,
  closing_guidance        text DEFAULT 'Thank you for calling. We will follow up within 24 hours.',

  -- Script overrides keyed by call type
  script_overrides        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voice_settings_org
  ON public.voice_settings(organization_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.voice_settings
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.voice_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: org-scoped CRUD
CREATE POLICY voice_settings_select_own_org
  ON public.voice_settings FOR SELECT
  TO authenticated
  USING (organization_id = public.current_user_org_id());

CREATE POLICY voice_settings_insert_own_org
  ON public.voice_settings FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY voice_settings_update_own_org
  ON public.voice_settings FOR UPDATE
  TO authenticated
  USING      (organization_id = public.current_user_org_id())
  WITH CHECK (organization_id = public.current_user_org_id());

CREATE POLICY voice_settings_delete_own_org
  ON public.voice_settings FOR DELETE
  TO authenticated
  USING (organization_id = public.current_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_settings TO authenticated;