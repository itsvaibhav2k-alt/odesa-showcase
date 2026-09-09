-- Odesa release-safety Wave 1 — atomic Stripe rent reconciliation
-- Authored 2026-07-10
--
-- The Stripe webhook used to flip rent_payments.status='succeeded' and
-- rent_events.status='paid' in two separate UPDATEs and NEVER wrote
-- rent_events.amount_paid — so the /financials read model (which derives
-- collected/outstanding from amount_paid) under-reported every Stripe
-- payment, and a replayed webhook could re-apply writes.
--
-- This RPC makes the whole reconciliation one transaction:
--   * row lock (FOR UPDATE) on the rent_payments row keyed by the UNIQUE
--     stripe_payment_intent_id — concurrent webhook deliveries serialize;
--   * replay guard — an already-succeeded row returns a stable result and
--     mutates NOTHING;
--   * provider validation — when Stripe's amount_received / currency are
--     supplied they must match the persisted row, else fail closed;
--   * amount_paid increment clamped at amount_due (same semantics as
--     recordOfflinePaymentAction), overpayment reported, not swallowed;
--   * status derived from balance: 'paid' only when fully covered,
--     partials keep their existing status.
--
-- Money: all arithmetic is integer cents. rent_events stores DOLLARS
-- numeric(10,2); conversion happens exactly once at each boundary.
--
-- Privileges: SECURITY DEFINER + service_role-only EXECUTE. The webhook
-- runs with the service-role client; browsers must never call this.

CREATE OR REPLACE FUNCTION public.reconcile_succeeded_rent_payment(
  p_stripe_payment_intent_id text,
  p_paid_at timestamptz,
  p_payment_method_type text DEFAULT NULL,
  p_receipt_url text DEFAULT NULL,
  p_provider_amount_cents integer DEFAULT NULL,
  p_provider_currency text DEFAULT NULL
)
RETURNS TABLE (
  payment_id uuid,
  rent_event_id uuid,
  applied_cents integer,
  paid_cents_after integer,
  due_cents integer,
  event_status text,
  replay boolean,
  overpayment_cents integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_payment public.rent_payments%ROWTYPE;
  v_event public.rent_events%ROWTYPE;
  v_due_cents integer;
  v_paid_before_cents integer;
  v_paid_after_cents integer;
BEGIN
  -- Serialize on the payment row. Concurrent deliveries for the same
  -- intent block here; the loser re-reads a succeeded row and replays.
  SELECT rp.* INTO v_payment
  FROM public.rent_payments rp
  WHERE rp.stripe_payment_intent_id = p_stripe_payment_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rent_payment_not_found: no rent_payments row for intent %',
      p_stripe_payment_intent_id;
  END IF;

  -- Replay guard: any terminal status => stable result, ZERO mutation.
  -- 'refunded'/'canceled' are terminal too: a dashboard-resent or late
  -- payment_intent.succeeded must never flip a refunded row back to
  -- succeeded and double-increment the cycle.
  IF v_payment.status IN ('succeeded', 'refunded', 'canceled') THEN
    IF v_payment.rent_event_id IS NOT NULL THEN
      SELECT re.* INTO v_event
      FROM public.rent_events re
      WHERE re.id = v_payment.rent_event_id;
    END IF;

    payment_id := v_payment.id;
    rent_event_id := v_payment.rent_event_id;
    applied_cents := 0;
    paid_cents_after := COALESCE(ROUND(v_event.amount_paid * 100)::integer, 0);
    due_cents := COALESCE(ROUND(v_event.amount_due * 100)::integer, 0);
    event_status := v_event.status::text;
    replay := true;
    overpayment_cents := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Provider validation (fail closed, no mutation). NULL provider values
  -- skip the corresponding check; both apply when present.
  IF p_provider_amount_cents IS NOT NULL
     AND p_provider_amount_cents <> v_payment.amount_cents THEN
    RAISE EXCEPTION 'amount_mismatch: provider % vs persisted % for intent %',
      p_provider_amount_cents, v_payment.amount_cents,
      p_stripe_payment_intent_id;
  END IF;

  IF p_provider_currency IS NOT NULL
     AND lower(p_provider_currency) <> lower(v_payment.currency) THEN
    RAISE EXCEPTION 'currency_mismatch: provider % vs persisted % for intent %',
      p_provider_currency, v_payment.currency, p_stripe_payment_intent_id;
  END IF;

  UPDATE public.rent_payments rp
  SET status = 'succeeded',
      paid_at = p_paid_at,
      payment_method_type = p_payment_method_type,
      receipt_url = p_receipt_url
  WHERE rp.id = v_payment.id;

  IF v_payment.rent_event_id IS NOT NULL THEN
    -- Lock the cycle row too: no read-modify-write without the lock.
    SELECT re.* INTO v_event
    FROM public.rent_events re
    WHERE re.id = v_payment.rent_event_id
    FOR UPDATE;

    IF FOUND THEN
      v_due_cents := ROUND(v_event.amount_due * 100)::integer;
      v_paid_before_cents := ROUND(v_event.amount_paid * 100)::integer;
      -- Clamp at amount_due (matches recordOfflinePaymentAction). The
      -- payment row keeps the full captured amount; the excess is
      -- returned explicitly as overpayment_cents, never silently lost.
      v_paid_after_cents := LEAST(
        v_due_cents,
        v_paid_before_cents + v_payment.amount_cents
      );

      UPDATE public.rent_events re
      SET amount_paid = v_paid_after_cents / 100.0,
          -- Balance-first status: 'paid' only when fully covered;
          -- partials keep whatever status the state machine set.
          status = CASE
            WHEN v_paid_after_cents >= v_due_cents THEN 'paid'::rent_event_status
            ELSE re.status
          END
      WHERE re.id = v_event.id;

      payment_id := v_payment.id;
      rent_event_id := v_event.id;
      applied_cents := v_paid_after_cents - v_paid_before_cents;
      paid_cents_after := v_paid_after_cents;
      due_cents := v_due_cents;
      event_status := CASE
        WHEN v_paid_after_cents >= v_due_cents THEN 'paid'
        ELSE v_event.status::text
      END;
      replay := false;
      overpayment_cents :=
        (v_paid_before_cents + v_payment.amount_cents) - v_paid_after_cents;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Unlinked payment (or the linked cycle row vanished under ON DELETE
  -- SET NULL semantics): only the payment row was updated.
  payment_id := v_payment.id;
  rent_event_id := NULL;
  applied_cents := 0;
  paid_cents_after := 0;
  due_cents := 0;
  event_status := NULL;
  replay := false;
  overpayment_cents := 0;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_succeeded_rent_payment(
  text, timestamptz, text, text, integer, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_succeeded_rent_payment(
  text, timestamptz, text, text, integer, text
) TO service_role;
