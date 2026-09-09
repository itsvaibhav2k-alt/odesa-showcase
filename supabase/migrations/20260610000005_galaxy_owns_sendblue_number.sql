-- Publication fixture: transfer a reserved fictional sender between fixture
-- organizations and mark a fictional fixture operator phone as verified.
-- This retains the historical migration shape, not live deployment bindings.
-- Never apply publication-edited historical migrations to an existing database.

-- Free the number first (unique index from 20260610000004).
UPDATE public.organizations
SET odesa_phone_number = NULL
WHERE id = '00000000-0000-4000-8000-000000000101' -- fictional previous organization
  AND odesa_phone_number = '+12025550100';

UPDATE public.organizations
SET odesa_phone_number = '+12025550100'
WHERE id = '11111111-1111-1111-1111-111111111101'; -- Galaxy Estates (seeded canonical org)

UPDATE public.users
SET phone_e164 = '+12025550101',
    phone_verified_at = now()
WHERE id = '00000000-0000-4000-8000-000000000102' -- owner@galaxy-estates.test
  AND phone_e164 IS NULL;
