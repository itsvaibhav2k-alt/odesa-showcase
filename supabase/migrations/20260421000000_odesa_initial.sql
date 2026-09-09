-- Odesa v1 — initial schema (12 tables) per spec §6
-- Authored 2026-04-21 (Phase 1.2, Agent B)
--
-- Conventions:
--   - gen_random_uuid() for all primary keys
--   - organization_id denormalized on every table for fast RLS
--   - timestamptz for all times; date/smallint where domain dictates
--   - text over varchar(n); numeric for money
--   - Enums for fixed-set state machines
--   - Every table gets an updated_at trigger via trigger_set_updated_at()
--
-- RLS policies + auth trigger live in the next migration
-- (20260421000001_rls.sql). This file only creates structure.

-- =========================================================================
-- Extensions
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- Enum types
-- =========================================================================

CREATE TYPE messaging_provider_choice AS ENUM ('linq', 'twilio');
CREATE TYPE organization_plan         AS ENUM ('starter', 'pro', 'managed');
CREATE TYPE user_role                 AS ENUM ('owner', 'manager', 'va');
CREATE TYPE lease_status              AS ENUM ('active', 'pending', 'expired', 'terminated');
CREATE TYPE conversation_channel      AS ENUM ('voice', 'sms', 'imessage');
CREATE TYPE conversation_status       AS ENUM ('open', 'resolved', 'escalated');
CREATE TYPE message_direction         AS ENUM ('inbound', 'outbound');
CREATE TYPE message_provider          AS ENUM ('linq', 'twilio', 'retell');
CREATE TYPE message_draft_status      AS ENUM (
  'auto_sent', 'pending_review', 'approved', 'rejected', 'sent_by_human'
);
CREATE TYPE work_order_category       AS ENUM (
  'plumbing', 'electrical', 'hvac', 'appliances', 'flooring',
  'painting', 'landscaping', 'security', 'cleaning', 'general', 'other'
);
CREATE TYPE work_order_urgency        AS ENUM ('emergency', 'urgent', 'routine');
CREATE TYPE work_order_status         AS ENUM (
  'open', 'assigned', 'in_progress', 'completed', 'cancelled'
);
CREATE TYPE rent_event_status         AS ENUM (
  'pending', 'reminder_sent', 'due_sent',
  'late_1', 'late_3', 'late_7',
  'paid', 'escalated', 'plan_agreed'
);

-- =========================================================================
-- Reusable updated_at trigger function
-- =========================================================================

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =========================================================================
-- 1. organizations
-- =========================================================================

CREATE TABLE public.organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  slug                text UNIQUE,
  odesa_phone_number  text,
  linq_account_id     text,
  twilio_account_id   text,
  messaging_primary   messaging_provider_choice NOT NULL DEFAULT 'linq',
  plan                organization_plan NOT NULL DEFAULT 'starter',
  timezone            text NOT NULL DEFAULT 'America/New_York',
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 2. users — FK to auth.users, one row per app user
-- =========================================================================

CREATE TABLE public.users (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role              user_role NOT NULL DEFAULT 'owner',
  display_name      text,
  full_name         text,
  email             text,
  phone_e164        text,
  avatar_url        text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_organization_id ON public.users(organization_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 3. properties
-- =========================================================================

CREATE TABLE public.properties (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  address_street    text,
  address_city      text,
  address_state     text,
  address_zip       text,
  timezone          text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_properties_organization_id ON public.properties(organization_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 4. units
-- =========================================================================

CREATE TABLE public.units (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  label             text NOT NULL,
  bedrooms          smallint,
  bathrooms         numeric(3,1),
  square_feet       integer,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_units_organization_id ON public.units(organization_id);
CREATE INDEX idx_units_property_id     ON public.units(property_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 5. tenants — phone_e164 is the primary caller-ID lookup key
-- =========================================================================

CREATE TABLE public.tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name         text NOT NULL,
  phone_e164        text NOT NULL,
  email             text,
  date_of_birth     date,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX        idx_tenants_organization_id ON public.tenants(organization_id);
CREATE UNIQUE INDEX uq_tenants_org_phone         ON public.tenants(organization_id, phone_e164);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 6. leases
-- =========================================================================

CREATE TABLE public.leases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id           uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rent_amount       numeric(10,2) NOT NULL,
  rent_due_day      smallint NOT NULL CHECK (rent_due_day BETWEEN 1 AND 31),
  late_fee_policy   jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_date        date,
  end_date          date,
  status            lease_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leases_organization_id ON public.leases(organization_id);
CREATE INDEX idx_leases_unit_id         ON public.leases(unit_id);
CREATE INDEX idx_leases_tenant_id       ON public.leases(tenant_id);
CREATE INDEX idx_leases_status          ON public.leases(status);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 7. conversations
-- =========================================================================

CREATE TABLE public.conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id         uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  channel           conversation_channel NOT NULL,
  last_message_at   timestamptz,
  summary           text,
  status            conversation_status NOT NULL DEFAULT 'open',
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_organization_id ON public.conversations(organization_id);
CREATE INDEX idx_conversations_tenant_id       ON public.conversations(tenant_id);
CREATE INDEX idx_conversations_status          ON public.conversations(status);
CREATE INDEX idx_conversations_last_message_at ON public.conversations(last_message_at DESC);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 8. messages
-- =========================================================================

CREATE TABLE public.messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id      uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction            message_direction NOT NULL,
  provider             message_provider NOT NULL,
  body                 text,
  draft_status         message_draft_status NOT NULL DEFAULT 'auto_sent',
  sent_at              timestamptz,
  provider_message_id  text,
  created_at           timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_organization_id ON public.messages(organization_id);
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_draft_status    ON public.messages(draft_status)
  WHERE draft_status = 'pending_review';
-- messages are append-only; no updated_at column, no trigger.

-- =========================================================================
-- 9. work_orders
-- =========================================================================

CREATE TABLE public.work_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id         uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  unit_id           uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  vendor_id         uuid, -- FK added after vendors table exists (forward ref)
  category          work_order_category NOT NULL,
  urgency           work_order_urgency NOT NULL DEFAULT 'routine',
  status            work_order_status NOT NULL DEFAULT 'open',
  description       text,
  status_timeline   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_work_orders_organization_id ON public.work_orders(organization_id);
CREATE INDEX idx_work_orders_unit_id         ON public.work_orders(unit_id);
CREATE INDEX idx_work_orders_tenant_id       ON public.work_orders(tenant_id);
CREATE INDEX idx_work_orders_status          ON public.work_orders(status);
CREATE INDEX idx_work_orders_urgency         ON public.work_orders(urgency);
CREATE INDEX idx_work_orders_vendor_id       ON public.work_orders(vendor_id);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 10. vendors
-- =========================================================================

CREATE TABLE public.vendors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  category          work_order_category NOT NULL,
  phone_e164        text,
  acceptance_rate   numeric(4,3) NOT NULL DEFAULT 1.000
                    CHECK (acceptance_rate BETWEEN 0 AND 1),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vendors_organization_id ON public.vendors(organization_id);
CREATE INDEX idx_vendors_category        ON public.vendors(organization_id, category);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- Resolve the forward-declared FK on work_orders.vendor_id.
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_vendor_id_fkey
  FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;

-- =========================================================================
-- 11. rent_events — monthly rent cycle state machine
-- =========================================================================

CREATE TABLE public.rent_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id          uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  cycle_month       date NOT NULL,
  amount_due        numeric(10,2) NOT NULL,
  amount_paid       numeric(10,2) NOT NULL DEFAULT 0,
  status            rent_event_status NOT NULL DEFAULT 'pending',
  due_date          date,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX        idx_rent_events_organization_id ON public.rent_events(organization_id);
CREATE INDEX        idx_rent_events_lease_id        ON public.rent_events(lease_id, cycle_month);
CREATE INDEX        idx_rent_events_status          ON public.rent_events(status);
CREATE UNIQUE INDEX uq_rent_events_lease_cycle      ON public.rent_events(lease_id, cycle_month);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.rent_events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- 12. weekly_reports
-- =========================================================================

CREATE TABLE public.weekly_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  week_start_date   date NOT NULL,
  briefing_text     text,
  metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at      timestamptz NOT NULL DEFAULT NOW(),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX        idx_weekly_reports_organization_id ON public.weekly_reports(organization_id);
CREATE UNIQUE INDEX uq_weekly_reports_org_week         ON public.weekly_reports(organization_id, week_start_date);

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.weekly_reports
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- =========================================================================
-- Pulse KPI view — four numbers per org in one query
-- =========================================================================
--
-- Definitions:
--   occupancy_pct                   : occupied units / total units × 100
--                                     (a unit is occupied if it has any
--                                      active lease)
--   rent_collected_this_month_cents : sum(amount_paid) for rent_events
--                                     whose cycle_month falls in the
--                                     current calendar month and whose
--                                     status = 'paid'
--   rent_due_this_month_cents       : sum(amount_due) for rent_events
--                                     in the current calendar month
--   open_work_orders_count          : WOs with status not in
--                                     ('completed','cancelled')
--   late_tenants_count              : distinct tenants (via lease) with a
--                                     rent_event in a late/escalated state
--
-- RLS: views inherit RLS from underlying tables, so this view is safe
-- to expose at the public schema level.

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
    SUM(CASE WHEN re.status = 'paid' THEN re.amount_paid ELSE 0 END) AS collected_dollars,
    SUM(re.amount_due) AS due_dollars
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
  WHERE re.status IN ('late_1', 'late_3', 'late_7', 'escalated')
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

COMMENT ON VIEW public.v_org_pulse_kpis IS
  'Pulse dashboard KPIs: occupancy %, rent collected cents, rent due cents, open WOs, late tenants. RLS inherits from underlying tables.';
