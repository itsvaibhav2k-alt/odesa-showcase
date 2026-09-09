-- Waive audit trail on rent_events.
--
-- Waiving forgives the REMAINING balance of one cycle: amount_due is
-- lowered to amount_paid (collected stays honest — no fabricated payment)
-- and these columns record who/when/why plus the forgiven amount so the
-- original obligation is never lost. A row with waived_at IS NOT NULL
-- renders as "Waived" in the ledger; the derived status is balance-first
-- so no rent_event_status enum change is needed.
ALTER TABLE public.rent_events
  ADD COLUMN IF NOT EXISTS waived_at timestamptz,
  ADD COLUMN IF NOT EXISTS waived_by uuid,
  ADD COLUMN IF NOT EXISTS waived_reason text,
  ADD COLUMN IF NOT EXISTS waived_amount numeric(10,2);
