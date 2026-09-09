-- Inbound routing resolves the org by odesa_phone_number (route-inbound.ts
-- looks it up with .limit(1).maybeSingle()), so a shared number silently
-- routes all traffic to an arbitrary winner. Detach the fictional demo
-- organization explicitly, then make the invariant structural.
-- Publication copy: the sender and organization below are fixture values.

UPDATE public.organizations
SET odesa_phone_number = NULL
WHERE id = '00000000-0000-4000-8000-000000000103' -- fictional demo organization
  AND odesa_phone_number = '+12025550100';

-- One org per agent number. Partial: orgs without a provisioned number
-- (NULL) stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_odesa_phone_number
  ON public.organizations (odesa_phone_number)
  WHERE odesa_phone_number IS NOT NULL;
