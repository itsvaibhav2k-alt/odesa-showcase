-- Odesa Wave 7 — rent_payments (Stream A.1, Stage 5 prep)
-- Authored 2026-05-08 (foundation-agent / Stream A)
--
-- Stripe-backed tenant-pays-landlord rent collection. Each row maps
-- 1:1 to a Stripe PaymentIntent (the UNIQUE constraint enforces it).
-- Created in `pending` status by the `request_rent_payment` worker
-- handler (Stream S) and updated to `succeeded` / `failed` by the
-- Stripe webhook (`/api/webhooks/stripe`).
--
-- Idempotency: the UNIQUE constraint on stripe_payment_intent_id lets
-- the webhook do `INSERT ... ON CONFLICT DO UPDATE` without double-
-- processing replayed events.
--
-- rent_event_id is nullable: a rent payment can stand alone (ad-hoc
-- request) or be linked to a generated rent_events row (recurring
-- monthly cycle). The webhook flips the linked rent_event to `paid`
-- only when this column is set.

CREATE TABLE public.rent_payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lease_id                    uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  tenant_id                   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rent_event_id               uuid NULL REFERENCES public.rent_events(id) ON DELETE SET NULL,
  stripe_payment_intent_id    text NOT NULL UNIQUE,
  stripe_customer_id          text,
  amount_cents                integer NOT NULL CHECK (amount_cents > 0),
  currency                    text NOT NULL DEFAULT 'usd',
  status                      text NOT NULL DEFAULT 'pending'
                                CHECK (status IN (
                                  'pending', 'succeeded', 'failed',
                                  'refunded', 'canceled'
                                )),
  paid_at                     timestamptz,
  payment_method_type         text,
  receipt_url                 text,
  payment_link_url            text,
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rent_payments_organization_id
  ON public.rent_payments(organization_id);
CREATE INDEX idx_rent_payments_lease_id
  ON public.rent_payments(lease_id);
CREATE INDEX idx_rent_payments_tenant_id
  ON public.rent_payments(tenant_id);
CREATE INDEX idx_rent_payments_status
  ON public.rent_payments(status);
CREATE INDEX idx_rent_payments_paid_at
  ON public.rent_payments(paid_at DESC)
  WHERE paid_at IS NOT NULL;

CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.rent_payments
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.rent_payments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text := 'rent_payments';
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rent_payments TO authenticated;
