-- Odesa Wave 7 — property data depth (Stream A.1)
-- Authored 2026-05-08 (foundation-agent / Stream A)
--
-- Adds three pieces of property-level depth so the agentic dispatcher
-- can reason about real-world facts that wave 6 didn't model:
--
--   1. `appliances` — fridge / hvac / washer / etc. per property (and
--      optionally per unit). Backs the `add_appliance` and
--      `update_appliance` worker action_types.
--   2. `property_vendors` — (property, category) → vendor mapping with
--      org-default fallback via `vendors.org_default_categories`. Backs
--      the `set_property_vendor` action_type.
--   3. Tenant preference columns on `tenants` — preferred channel,
--      language, emergency contact, parking, pets, plus
--      stripe_customer_id for the Stage 5 Stripe rent flow.
--
-- Every new write carries a `confidence` (0..1) and a `source` enum
-- (`agent` | `owner` | `import`) so the UI can render provenance
-- badges and the gate can apply confidence floors uniformly.

-- ---------------------------------------------------------------------------
-- appliances
-- ---------------------------------------------------------------------------

CREATE TABLE public.appliances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id           uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id               uuid NULL REFERENCES public.units(id) ON DELETE CASCADE,
  type                  text NOT NULL
                          CHECK (type IN (
                            'fridge', 'hvac', 'washer', 'dryer',
                            'water_heater', 'dishwasher', 'oven',
                            'microwave', 'other'
                          )),
  make                  text,
  model                 text,
  serial_number         text,
  install_date          date,
  last_service_date     date,
  warranty_expires_at   date,
  notes                 text,
  confidence            numeric(3,2) NOT NULL DEFAULT 0.7
                          CHECK (confidence BETWEEN 0 AND 1),
  source                text NOT NULL DEFAULT 'agent'
                          CHECK (source IN ('agent', 'owner', 'import')),
  created_at            timestamptz NOT NULL DEFAULT NOW(),
  updated_at            timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appliances_org_property_unit_type
  ON public.appliances(organization_id, property_id, unit_id, type);
CREATE INDEX idx_appliances_organization_id
  ON public.appliances(organization_id);
CREATE INDEX idx_appliances_property_id
  ON public.appliances(property_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.appliances
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.appliances ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'appliances';
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appliances TO authenticated;

-- ---------------------------------------------------------------------------
-- property_vendors — (property, category) → vendor mapping
-- ---------------------------------------------------------------------------
--
-- No ranking; one vendor per (property, category). Resolution order at
-- runtime: property-specific row → org-default (vendors.org_default_categories)
-- → ask owner.

CREATE TABLE public.property_vendors (
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category          text NOT NULL
                      CHECK (category IN (
                        'plumbing', 'electrical', 'hvac', 'landscaping',
                        'general', 'pest', 'roof', 'cleaning', 'locksmith'
                      )),
  vendor_id         uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  notes             text,
  confidence        numeric(3,2) NOT NULL DEFAULT 0.7
                      CHECK (confidence BETWEEN 0 AND 1),
  source            text NOT NULL DEFAULT 'agent'
                      CHECK (source IN ('agent', 'owner', 'import')),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, property_id, category)
);

CREATE INDEX idx_property_vendors_vendor_id
  ON public.property_vendors(vendor_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_vendors
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.property_vendors ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'property_vendors';
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_vendors TO authenticated;

-- ---------------------------------------------------------------------------
-- vendors.org_default_categories — fallback when no property_vendors row
-- ---------------------------------------------------------------------------

ALTER TABLE public.vendors
  ADD COLUMN org_default_categories text[] NOT NULL DEFAULT '{}'::text[];

-- ---------------------------------------------------------------------------
-- tenants — preference columns + stripe_customer_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.tenants
  ADD COLUMN preferred_channel        text
    CHECK (preferred_channel IN ('sms', 'email', 'voice', 'none'))
    DEFAULT 'sms',
  ADD COLUMN language                 text DEFAULT 'en',
  ADD COLUMN emergency_contact_name   text,
  ADD COLUMN emergency_contact_phone  text,
  ADD COLUMN parking_space            text,
  ADD COLUMN pets_jsonb               jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN preferences_confidence   numeric(3,2) NOT NULL DEFAULT 0.7
    CHECK (preferences_confidence BETWEEN 0 AND 1),
  ADD COLUMN preferences_source       text NOT NULL DEFAULT 'agent'
    CHECK (preferences_source IN ('agent', 'owner', 'import')),
  ADD COLUMN stripe_customer_id       text;

CREATE INDEX idx_tenants_stripe_customer_id
  ON public.tenants(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
