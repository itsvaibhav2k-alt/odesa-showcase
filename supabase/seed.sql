-- Odesa v1 — seed fixture (Galaxy Estates shape)
-- Authored 2026-04-21 (Phase 1.2, Agent B)
--
-- Shape:
--   1 org       (Galaxy Estates)
--   1 user      (owner, Vaibhav)
--   2 props     (Oakwood Commons, 17th Street Row)
--  10 units     (7 in Oakwood, 3 in 17th)
--  10 tenants
--  10 leases    (all active)
--   5 work_orders in various states
--   3 vendors
--  last 3 rent_events per lease (= 30 rent_event rows)
--
-- All IDs are deterministic uuids so tests can reference them without
-- round-tripping through returning-id queries. Pattern:
--   org:      11111111-1111-1111-1111-1111111111NN
--   user:     22222222-2222-2222-2222-2222222222NN
--   property: 33333333-3333-3333-3333-3333333333NN
--   unit:     44444444-4444-4444-4444-4444444444NN
--   tenant:   55555555-5555-5555-5555-5555555555NN
--   lease:    66666666-6666-6666-6666-6666666666NN
--   wo:       77777777-7777-7777-7777-7777777777NN
--   vendor:   88888888-8888-8888-8888-8888888888NN
--   rent:     99999999-9999-9999-9999-9999999999NN
--   payment:  aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaNN
--
-- IMPORTANT: this seed writes via service_role (no RLS filtering).
-- It does NOT create the auth.users row; that lives in Playwright
-- fixtures (see e2e/supabase/rls.spec.ts) because supabase/seed.sql
-- runs before auth exists in a fresh local stack.

-- =========================================================================
-- Organization
-- =========================================================================

INSERT INTO public.organizations (
  id, name, slug, odesa_phone_number,
  messaging_primary, plan, timezone
)
VALUES (
  '11111111-1111-1111-1111-111111111101',
  'Galaxy Estates',
  'galaxy-estates',
  '+15715550101',
  'linq',
  'managed',
  'America/New_York'
)
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Properties (2)
-- =========================================================================

INSERT INTO public.properties (
  id, organization_id, name,
  address_street, address_city, address_state, address_zip,
  timezone
)
VALUES
  (
    '33333333-3333-3333-3333-333333333301',
    '11111111-1111-1111-1111-111111111101',
    'Oakwood Commons',
    '1400 Oakwood Dr', 'Arlington', 'VA', '22201',
    'America/New_York'
  ),
  (
    '33333333-3333-3333-3333-333333333302',
    '11111111-1111-1111-1111-111111111101',
    '17th Street Row',
    '1701 17th St NW', 'Washington', 'DC', '20009',
    'America/New_York'
  )
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Units (10 = 7 + 3)
-- =========================================================================

INSERT INTO public.units (
  id, organization_id, property_id, label,
  bedrooms, bathrooms, square_feet
)
VALUES
  -- Oakwood Commons (7 units)
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '101', 1, 1.0,  650),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '102', 2, 1.5,  900),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '103', 1, 1.0,  680),
  ('44444444-4444-4444-4444-444444444404', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '201', 2, 2.0,  950),
  ('44444444-4444-4444-4444-444444444405', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '202', 3, 2.0, 1180),
  ('44444444-4444-4444-4444-444444444406', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '203', 2, 1.5,  910),
  ('44444444-4444-4444-4444-444444444407', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', '204', 1, 1.0,  700),
  -- 17th Street Row (3 units)
  ('44444444-4444-4444-4444-444444444408', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333302', 'A',   2, 1.5,  880),
  ('44444444-4444-4444-4444-444444444409', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333302', 'B',   2, 1.5,  890),
  ('44444444-4444-4444-4444-444444444410', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333302', 'C',   3, 2.0, 1220)
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Tenants (10)
-- =========================================================================

INSERT INTO public.tenants (
  id, organization_id, full_name, phone_e164, email
)
VALUES
  ('55555555-5555-5555-5555-555555555501', '11111111-1111-1111-1111-111111111101', 'Marcus Alvarez',   '+15715550201', 'marcus.alvarez@example.com'),
  ('55555555-5555-5555-5555-555555555502', '11111111-1111-1111-1111-111111111101', 'Priya Banerjee',   '+15715550202', 'priya.b@example.com'),
  ('55555555-5555-5555-5555-555555555503', '11111111-1111-1111-1111-111111111101', 'Jordan Chen',      '+15715550203', 'jchen@example.com'),
  ('55555555-5555-5555-5555-555555555504', '11111111-1111-1111-1111-111111111101', 'Linda Diallo',     '+15715550204', 'linda.d@example.com'),
  ('55555555-5555-5555-5555-555555555505', '11111111-1111-1111-1111-111111111101', 'Ethan Ellis',      '+15715550205', 'ethan.ellis@example.com'),
  ('55555555-5555-5555-5555-555555555506', '11111111-1111-1111-1111-111111111101', 'Fatima Farid',     '+15715550206', 'fatima.f@example.com'),
  ('55555555-5555-5555-5555-555555555507', '11111111-1111-1111-1111-111111111101', 'Gavin Huang',      '+15715550207', 'gavin.h@example.com'),
  ('55555555-5555-5555-5555-555555555508', '11111111-1111-1111-1111-111111111101', 'Hannah Ito',       '+15715550208', 'hannah.ito@example.com'),
  ('55555555-5555-5555-5555-555555555509', '11111111-1111-1111-1111-111111111101', 'Ivan Jankowski',   '+15715550209', 'ivan.j@example.com'),
  ('55555555-5555-5555-5555-555555555510', '11111111-1111-1111-1111-111111111101', 'Jessica Kim',      '+15715550210', 'jessica.kim@example.com')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Leases (10, all active) — one tenant per unit, 12-month terms
-- =========================================================================
--
-- Dates are CURRENT_DATE-relative (evergreen), not fixed literals. The exact
-- per-lease offsets are the C7 contract in
-- qa-output/2026-07-10-owner-scale-pressure-test/wave-0/seed-state-matrix.md —
-- keep the two in sync when editing either.

INSERT INTO public.leases (
  id, organization_id, unit_id, tenant_id,
  rent_amount, rent_due_day, late_fee_policy,
  start_date, end_date, status
)
VALUES
  -- Oakwood
  ('66666666-6666-6666-6666-666666666601', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444401', '55555555-5555-5555-5555-555555555501', 1450.00, 1, '{"grace_days":3,"fixed_fee_cents":5000}'::jsonb, CURRENT_DATE + interval '82 days' - interval '12 months', CURRENT_DATE + interval '82 days', 'active'),
  ('66666666-6666-6666-6666-666666666602', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444402', '55555555-5555-5555-5555-555555555502', 1950.00, 1, '{"grace_days":3,"fixed_fee_cents":5000}'::jsonb, CURRENT_DATE + interval '35 days' - interval '12 months', CURRENT_DATE + interval '35 days', 'active'),
  ('66666666-6666-6666-6666-666666666603', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444403', '55555555-5555-5555-5555-555555555503', 1475.00, 1, '{"grace_days":3,"fixed_fee_cents":5000}'::jsonb, CURRENT_DATE + interval '113 days' - interval '12 months', CURRENT_DATE + interval '113 days', 'active'),
  ('66666666-6666-6666-6666-666666666604', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444404', '55555555-5555-5555-5555-555555555504', 2150.00, 1, '{"grace_days":3,"fixed_fee_cents":7500}'::jsonb, CURRENT_DATE - interval '10 days' - interval '12 months', CURRENT_DATE - interval '10 days', 'active'),
  ('66666666-6666-6666-6666-666666666605', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444405', '55555555-5555-5555-5555-555555555505', 2600.00, 1, '{"grace_days":3,"fixed_fee_cents":7500}'::jsonb, CURRENT_DATE + interval '52 days' - interval '12 months', CURRENT_DATE + interval '52 days', 'active'),
  ('66666666-6666-6666-6666-666666666606', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444406', '55555555-5555-5555-5555-555555555506', 1975.00, 1, '{"grace_days":3,"fixed_fee_cents":5000}'::jsonb, CURRENT_DATE + interval '174 days' - interval '12 months', CURRENT_DATE + interval '174 days', 'active'),
  ('66666666-6666-6666-6666-666666666607', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444407', '55555555-5555-5555-5555-555555555507', 1425.00, 1, '{"grace_days":5,"fixed_fee_cents":5000}'::jsonb, CURRENT_DATE + interval '143 days' - interval '12 months', CURRENT_DATE + interval '143 days', 'active'),
  -- 17th Street Row
  ('66666666-6666-6666-6666-666666666608', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444408', '55555555-5555-5555-5555-555555555508', 2250.00, 1, '{"grace_days":3,"fixed_fee_cents":7500}'::jsonb, CURRENT_DATE - interval '26 days' - interval '12 months', CURRENT_DATE - interval '26 days', 'active'),
  ('66666666-6666-6666-6666-666666666609', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444409', '55555555-5555-5555-5555-555555555509', 2300.00, 1, '{"grace_days":3,"fixed_fee_cents":7500}'::jsonb, CURRENT_DATE + interval '96 days' - interval '12 months', CURRENT_DATE + interval '96 days', 'active'),
  ('66666666-6666-6666-6666-666666666610', '11111111-1111-1111-1111-111111111101', '44444444-4444-4444-4444-444444444410', '55555555-5555-5555-5555-555555555510', 2950.00, 1, '{"grace_days":3,"fixed_fee_cents":10000}'::jsonb, CURRENT_DATE - interval '71 days' - interval '12 months', CURRENT_DATE - interval '71 days', 'active')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Vendors (3)
-- =========================================================================

INSERT INTO public.vendors (
  id, organization_id, name, category, phone_e164, acceptance_rate
)
VALUES
  ('88888888-8888-8888-8888-888888888801', '11111111-1111-1111-1111-111111111101', 'Beltway Plumbing Co',    'plumbing',   '+15715550301', 0.920),
  ('88888888-8888-8888-8888-888888888802', '11111111-1111-1111-1111-111111111101', 'Capital HVAC Services',  'hvac',       '+15715550302', 0.870),
  ('88888888-8888-8888-8888-888888888803', '11111111-1111-1111-1111-111111111101', 'Handyman Hank LLC',      'general',    '+15715550303', 0.960)
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Work orders (5, varied states)
-- =========================================================================

INSERT INTO public.work_orders (
  id, organization_id, tenant_id, unit_id, vendor_id,
  category, urgency, status, description, status_timeline
)
VALUES
  -- 1. Open emergency: water heater burst, unassigned
  (
    '77777777-7777-7777-7777-777777777701',
    '11111111-1111-1111-1111-111111111101',
    '55555555-5555-5555-5555-555555555501',
    '44444444-4444-4444-4444-444444444401',
    NULL,
    'plumbing', 'emergency', 'open',
    'Water heater burst in utility closet — standing water on floor.',
    '[{"at":"2026-04-20T14:05:00Z","event":"created","by":"retell:alex"}]'::jsonb
  ),
  -- 2. Assigned urgent: HVAC not cooling, dispatched
  (
    '77777777-7777-7777-7777-777777777702',
    '11111111-1111-1111-1111-111111111101',
    '55555555-5555-5555-5555-555555555504',
    '44444444-4444-4444-4444-444444444404',
    '88888888-8888-8888-8888-888888888802',
    'hvac', 'urgent', 'assigned',
    'AC blowing warm air; outdoor unit running but no cold output.',
    '[{"at":"2026-04-19T10:12:00Z","event":"created"},{"at":"2026-04-19T10:45:00Z","event":"assigned","vendor":"Capital HVAC Services"}]'::jsonb
  ),
  -- 3. In-progress routine: dishwasher replacement
  (
    '77777777-7777-7777-7777-777777777703',
    '11111111-1111-1111-1111-111111111101',
    '55555555-5555-5555-5555-555555555506',
    '44444444-4444-4444-4444-444444444406',
    '88888888-8888-8888-8888-888888888803',
    'appliances', 'routine', 'in_progress',
    'Dishwasher stopped draining; part ordered.',
    '[{"at":"2026-04-15T09:00:00Z","event":"created"},{"at":"2026-04-15T11:00:00Z","event":"assigned"},{"at":"2026-04-17T14:00:00Z","event":"in_progress","note":"part on order"}]'::jsonb
  ),
  -- 4. Completed routine: leaky faucet
  (
    '77777777-7777-7777-7777-777777777704',
    '11111111-1111-1111-1111-111111111101',
    '55555555-5555-5555-5555-555555555502',
    '44444444-4444-4444-4444-444444444402',
    '88888888-8888-8888-8888-888888888801',
    'plumbing', 'routine', 'completed',
    'Kitchen faucet drip. Cartridge replaced.',
    '[{"at":"2026-04-10T08:30:00Z","event":"created"},{"at":"2026-04-10T09:15:00Z","event":"assigned"},{"at":"2026-04-11T16:00:00Z","event":"completed","cost_cents":14500}]'::jsonb
  ),
  -- 5. Cancelled: duplicate report
  (
    '77777777-7777-7777-7777-777777777705',
    '11111111-1111-1111-1111-111111111101',
    '55555555-5555-5555-5555-555555555508',
    '44444444-4444-4444-4444-444444444408',
    NULL,
    'general', 'routine', 'cancelled',
    'Hallway light out — duplicate of WO #702 at same unit.',
    '[{"at":"2026-04-12T12:00:00Z","event":"created"},{"at":"2026-04-12T13:30:00Z","event":"cancelled","reason":"duplicate"}]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Rent events — last 3 cycles per lease (= 30 rows)
-- =========================================================================
--
-- Cycle months reference:
--   cycle_now   = date_trunc('month', current_date)
--   cycle_prev1 = cycle_now  - 1 month
--   cycle_prev2 = cycle_now  - 2 months
--
-- State assignment strategy:
--   - 8 leases: all 3 cycles paid (the healthy majority)
--   - 1 lease (ix 7): prev2+prev1 paid, current late_3 (active issue)
--   - 1 lease (ix 9): prev2 paid, prev1 paid, current escalated (7+ days late)
--
-- cycle_now is a SQL expression to keep the fixture evergreen regardless
-- of calendar date at seed time.
--
-- Idempotent-RESET (like the owner-queue proposal seed): re-running this
-- block restores the exact fixture state. ON CONFLICT DO UPDATE resets
-- rows mutated by app usage or e2e runs, and the leading DELETE clears
-- rent_events outside the 3 fixture cycles — otherwise unpaid cycles
-- accumulate as phantom aged debt every month rollover.

DO $$
DECLARE
  cycle_now  date := date_trunc('month', CURRENT_DATE)::date;
  cycle_p1   date := (cycle_now - INTERVAL '1 month')::date;
  cycle_p2   date := (cycle_now - INTERVAL '2 months')::date;
  org_id     uuid := '11111111-1111-1111-1111-111111111101';
  ids        uuid[] := ARRAY[
    '66666666-6666-6666-6666-666666666601',
    '66666666-6666-6666-6666-666666666602',
    '66666666-6666-6666-6666-666666666603',
    '66666666-6666-6666-6666-666666666604',
    '66666666-6666-6666-6666-666666666605',
    '66666666-6666-6666-6666-666666666606',
    '66666666-6666-6666-6666-666666666607',
    '66666666-6666-6666-6666-666666666608',
    '66666666-6666-6666-6666-666666666609',
    '66666666-6666-6666-6666-666666666610'
  ];
  rents      numeric[] := ARRAY[
    1450.00, 1950.00, 1475.00, 2150.00, 2600.00,
    1975.00, 1425.00, 2250.00, 2300.00, 2950.00
  ];
  i          int;
  rent       numeric;
  lease      uuid;
  curr_stat  rent_event_status;
  curr_paid  numeric;
BEGIN
  -- Reset: the org's rent ledger IS the fixture — drop every rent_event
  -- that isn't fixture-lease × fixture-cycle (stale rollover cycles and
  -- cron-generated rows for non-fixture leases both drift the KPIs).
  DELETE FROM public.rent_events
  WHERE organization_id = org_id
    AND (cycle_month NOT IN (cycle_p2, cycle_p1, cycle_now)
      OR lease_id <> ALL (ids));

  FOR i IN 1..10 LOOP
    rent  := rents[i];
    lease := ids[i];

    IF i = 8 THEN           -- late_3 lease (ix 7 zero-based == i 8 one-based, tenant Hannah)
      curr_stat := 'late_3';
      curr_paid := 0;
    ELSIF i = 10 THEN       -- escalated lease (ix 9 zero-based == i 10, tenant Jessica)
      curr_stat := 'escalated';
      curr_paid := 0;
    ELSE
      curr_stat := 'paid';
      curr_paid := rent;
    END IF;

    -- cycle_p2 (always paid in this fixture)
    INSERT INTO public.rent_events (
      id, organization_id, lease_id, cycle_month,
      amount_due, amount_paid, status, due_date
    )
    VALUES (
      gen_random_uuid(),
      org_id, lease, cycle_p2,
      rent, rent, 'paid', (cycle_p2 + INTERVAL '0 days')::date
    )
    ON CONFLICT (lease_id, cycle_month) DO UPDATE SET
      amount_due  = EXCLUDED.amount_due,
      amount_paid = EXCLUDED.amount_paid,
      status      = EXCLUDED.status,
      due_date    = EXCLUDED.due_date;

    -- cycle_p1 (always paid)
    INSERT INTO public.rent_events (
      id, organization_id, lease_id, cycle_month,
      amount_due, amount_paid, status, due_date
    )
    VALUES (
      gen_random_uuid(),
      org_id, lease, cycle_p1,
      rent, rent, 'paid', (cycle_p1 + INTERVAL '0 days')::date
    )
    ON CONFLICT (lease_id, cycle_month) DO UPDATE SET
      amount_due  = EXCLUDED.amount_due,
      amount_paid = EXCLUDED.amount_paid,
      status      = EXCLUDED.status,
      due_date    = EXCLUDED.due_date;

    -- cycle_now
    INSERT INTO public.rent_events (
      id, organization_id, lease_id, cycle_month,
      amount_due, amount_paid, status, due_date
    )
    VALUES (
      gen_random_uuid(),
      org_id, lease, cycle_now,
      rent, curr_paid, curr_stat, cycle_now
    )
    ON CONFLICT (lease_id, cycle_month) DO UPDATE SET
      amount_due  = EXCLUDED.amount_due,
      amount_paid = EXCLUDED.amount_paid,
      status      = EXCLUDED.status,
      due_date    = EXCLUDED.due_date;
  END LOOP;
END
$$;

-- =========================================================================
-- Rent payments — one completed Stripe card payment for Marcus Alvarez's
-- current (paid) cycle, so the portal payments page has a receipt-bearing
-- row to show. rent_event ids are generated, so the link is looked up by
-- (lease_id, cycle_month); ON CONFLICT DO UPDATE re-points it after month
-- rollovers regenerate the current-cycle rent_event.
-- =========================================================================

INSERT INTO public.rent_payments (
  id, organization_id, lease_id, tenant_id, rent_event_id,
  stripe_payment_intent_id, amount_cents, currency, status,
  paid_at, payment_method_type, receipt_url
)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  '11111111-1111-1111-1111-111111111101',
  '66666666-6666-6666-6666-666666666601',
  '55555555-5555-5555-5555-555555555501',
  (
    SELECT id FROM public.rent_events
    WHERE lease_id = '66666666-6666-6666-6666-666666666601'
      AND cycle_month = date_trunc('month', CURRENT_DATE)::date
  ),
  'pi_seed_marcus_alvarez_0001',
  145000,
  'usd',
  'succeeded',
  date_trunc('month', CURRENT_DATE) + interval '9 hours 14 minutes',
  'card',
  'https://pay.stripe.com/receipts/seed-marcus-alvarez'
)
ON CONFLICT (id) DO UPDATE SET
  rent_event_id       = EXCLUDED.rent_event_id,
  amount_cents        = EXCLUDED.amount_cents,
  status              = EXCLUDED.status,
  paid_at             = EXCLUDED.paid_at,
  payment_method_type = EXCLUDED.payment_method_type,
  receipt_url         = EXCLUDED.receipt_url;

-- Documents (portfolio document registry) — references seeded Galaxy entities.
INSERT INTO public.documents (id, organization_id, type, title, property_id, unit_id, tenant_id, vendor_id, expiry_date)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccc01', '11111111-1111-1111-1111-111111111101', 'lease',      'Lease — Marcus Alvarez',               '33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', '55555555-5555-5555-5555-555555555501', NULL,                                   CURRENT_DATE + interval '264 days'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc02', '11111111-1111-1111-1111-111111111101', 'inspection', 'Move-in inspection — Unit 101',        '33333333-3333-3333-3333-333333333301', '44444444-4444-4444-4444-444444444401', '55555555-5555-5555-5555-555555555501', NULL,                                   NULL),
  ('cccccccc-cccc-cccc-cccc-cccccccccc03', '11111111-1111-1111-1111-111111111101', 'insurance',  'Property insurance — Oakwood Commons', '33333333-3333-3333-3333-333333333301', NULL,                                   NULL,                                   NULL,                                   CURRENT_DATE + interval '174 days'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc04', '11111111-1111-1111-1111-111111111101', 'tax',        'W-9 — preferred vendor',               NULL,                                   NULL,                                   NULL,                                   '88888888-8888-8888-8888-888888888801', NULL),
  ('cccccccc-cccc-cccc-cccc-cccccccccc05', '11111111-1111-1111-1111-111111111101', 'lease',      'Lease — Jessica Kim',                  '33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444410', '55555555-5555-5555-5555-555555555510', NULL,                                   CURRENT_DATE - interval '10 days'),
  ('cccccccc-cccc-cccc-cccc-cccccccccc06', '11111111-1111-1111-1111-111111111101', 'notice',     'Late-rent notice — Unit C',            '33333333-3333-3333-3333-333333333302', '44444444-4444-4444-4444-444444444410', '55555555-5555-5555-5555-555555555510', NULL,                                   NULL)
ON CONFLICT (id) DO NOTHING;

-- Owner-queue decisions (action_proposals, status 'proposed') for the Decisions Desk.
--
-- Every action_type below is COMMIT-CAPABLE (a member of WORKER_ACTION_TYPES)
-- and every payload passes WORKER_PAYLOAD_SCHEMAS[action_type].safeParse, so
-- approving a card re-validates and dispatches cleanly (commit.ts revalidates
-- at approval time). Payload refs use the human-name branch of each ref union;
-- no tenant/vendor/work-order UUID ever rides in `payload`.
--
-- Gate policy (trust sprint): anything that sends to a tenant or mutates a
-- lease/rent seeds as 'review' or 'block' — NEVER 'auto'. 'auto' is reserved
-- for safe internal-record actions (log_maintenance_ticket creates a work
-- order; it contacts nobody). dispatch_vendor's commit path is a recorded
-- no-op (the vendor is not contacted from this action) but it is an emergency
-- spend decision, so it stays 'review'.
--
-- Data alignment with the fixtures above: Hannah Ito (Unit A, $2,250, current
-- cycle late_3) backs the reminder + renewal rows; Jessica Kim (Unit C,
-- $2,950, escalated, unresponsive) backs the blocked collections draft; the
-- open emergency water-heater WO at Oakwood Unit 101 backs the plumbing
-- dispatch (Beltway Plumbing Co — the plumbing vendor). All seeded tenants
-- keep non-deliverable 555-exchange phone numbers.
--
-- NOTE: ON CONFLICT (id) DO NOTHING means an existing local DB that already
-- has the legacy dddddddd…01-05 rows will NOT pick these up — reset the local
-- DB (supabase db reset) to swap the proposals.
INSERT INTO public.action_proposals (id, organization_id, property_id, worker_model, action_type, gate_decision, status, confidence, reasoning, payload)
VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333302', 'claude-haiku-4-5', 'send_tenant_message', 'review', 'proposed', 0.78, 'Hannah Ito in Unit A at 17th Street Row is 3 days past due on the current $2,250 rent cycle. She paid on time both prior months, so a single warm reminder fits her history better than a late fee or formal notice. Routed for your review because it sends a tenant-facing message.', '{"tenantRef":{"tenantName":"Hannah Ito"},"body":"Hi Hannah — a quick reminder that this month''s rent of $2,250 for Unit A is still outstanding. Reply here if anything has come up and we can work out timing together."}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd02', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', 'claude-haiku-4-5', 'dispatch_vendor',     'review', 'proposed', 0.86, 'Open emergency work order: the water heater in Unit 101 burst with standing water on the utility-closet floor. Beltway Plumbing Co covers plumbing for this portfolio and has a 92% recent acceptance rate, so they are the right first call for a same-day visit at an estimated $640. Committing this records your approval — the vendor is not contacted from this action.', '{"candidateIndex":0,"smsBody":"Emergency at Oakwood Commons Unit 101: the water heater burst and there is standing water in the utility closet. Can you take a same-day call-out? Reply YES to accept and we will share access details.","estimate":640}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd03', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333301', 'claude-haiku-4-5', 'log_maintenance_ticket', 'auto', 'proposed', 0.95, 'Gavin Huang in Unit 204 reported a steady drip from the bathroom faucet that has gotten worse over the past week. Logging a low-severity work order keeps the issue tracked before it turns into water damage. This only creates an internal record — no tenant or vendor is contacted.', '{"unitRef":{"unitLabel":"204","propertyName":"Oakwood Commons"},"summary":"Bathroom faucet dripping steadily in Unit 204; tenant reports it has gotten worse over the past week.","severity":"low","reportedBy":"Gavin Huang"}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd04', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333302', 'claude-haiku-4-5', 'update_rent',         'review', 'proposed', 0.72, 'Hannah Ito''s lease for Unit A at 17th Street Row is inside its renewal window. Comparable two-bedroom renewals on this corridor cleared a 4% increase this quarter without raising turnover, so moving the rent from $2,250 to $2,340 keeps the unit at market. Nothing changes until you approve the new terms.', '{"leaseRef":{"tenantName":"Hannah Ito"},"rentAmount":2340}'),
  ('dddddddd-dddd-dddd-dddd-dddddddddd05', '11111111-1111-1111-1111-111111111101', '33333333-3333-3333-3333-333333333302', 'claude-haiku-4-5', 'send_tenant_message', 'block',  'proposed', 0.65, 'Jessica Kim in Unit C at 17th Street Row is more than 7 days past due on the current $2,950 rent cycle and has not replied to two earlier messages. A third automated message is unlikely to land and risks souring the relationship, so Odesa does not recommend sending this draft. Escalate personally before any formal notice; declining this records that choice.', '{"tenantRef":{"tenantName":"Jessica Kim"},"body":"Hi Jessica — following up on the $2,950 balance for Unit C this month. Please reply and let us know your plan so we can find a way forward together."}')
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Voice Operator — one seeded demo call (backs /calls + /calls/[id] and the
-- route-sweep manifest's fixed UUID, mirroring how other detail routes pin
-- seeded ids). Completed maintenance call from Marcus Alvarez; outcome jsonb
-- matches the CallOutcome shape compileOutcome writes. The work-order id in
-- recordsCreated deliberately references the seeded open WO so drill-ins
-- resolve. Fixed past timestamp (not "today") so the Today card's
-- calls-today count stays honest on fresh resets.
-- =========================================================================

INSERT INTO public.voice_calls (
  id, organization_id, retell_call_id, direction, from_number, to_number,
  caller_kind, tenant_id, property_id, unit_id, status,
  started_at, ended_at, transcript, summary, session, outcome
)
VALUES (
  '99999999-9999-9999-9999-999999999901',
  '11111111-1111-1111-1111-111111111101',
  'seed-demo-call-1',
  'inbound',
  '+15715550201',
  '+15715550101',
  'verified_tenant',
  '55555555-5555-5555-5555-555555555501',
  '33333333-3333-3333-3333-333333333301',
  '44444444-4444-4444-4444-444444444401',
  'completed',
  '2026-07-01T14:03:00Z',
  '2026-07-01T14:07:30Z',
  E'Odesa: Hi Marcus, this is Odesa for Galaxy Estates. How can I help?\nMarcus: The bathroom fan stopped working and it gets really humid.\nOdesa: Is there any active flooding or electrical danger right now?\nMarcus: No, nothing like that.\nOdesa: Got it. Can maintenance enter weekday mornings if you are out?\nMarcus: Yes, that works.\nOdesa: I have logged an electrical work order for the fan and texted you a confirmation. The owner has been notified.',
  'Verified tenant call — 1 topic handled: maintenance request; 2 actions taken, 0 awaiting owner review.',
  '{}'::jsonb,
  '{
    "oneSentence": "Verified tenant call — 1 topic handled: maintenance request; 2 actions taken, 0 awaiting owner review.",
    "callerKind": "verified_tenant",
    "callerPhone": "+15715550201",
    "tenantId": "55555555-5555-5555-5555-555555555501",
    "propertyId": "33333333-3333-3333-3333-333333333301",
    "unitId": "44444444-4444-4444-4444-444444444401",
    "intentsHandled": ["maintenance_request"],
    "recordsCreated": [{"kind": "work_order", "id": "77777777-7777-7777-7777-777777777701"}],
    "autonomousActions": [
      {"action": "create_work_order", "at": "2026-07-01T14:05:00Z", "tier": 2, "outcome": "executed", "ids": {"work_order": "77777777-7777-7777-7777-777777777701"}},
      {"action": "send_safe_confirmation_sms", "at": "2026-07-01T14:06:00Z", "tier": 2, "outcome": "executed"}
    ],
    "approvalsNeeded": [],
    "smsSent": ["We received your request. A work order was created and the owner has been notified."],
    "smsDrafted": [],
    "unresolved": [],
    "riskFlags": [],
    "endedAt": "2026-07-01T14:07:30Z"
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;
