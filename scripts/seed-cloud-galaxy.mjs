#!/usr/bin/env node
/**
 * Seeds Galaxy Estates fixture data into the LINKED cloud Supabase
 * project so the Playwright e2e suite can resolve its deterministic
 * UUIDs (org 11111111-...-101, properties 33333333-...-301/302, etc).
 *
 * Mirrors supabase/seed.sql but uses the service-role REST API so no
 * direct Postgres connection is required (avoiding the keychain'd
 * pooler password). Every write uses upsert + ignoreDuplicates so the
 * script is idempotent: safe to re-run, never overwrites existing rows.
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage:
 *   node scripts/seed-cloud-galaxy.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadDotEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnvLocal();

// Required before creating the client: never provision a fictional sender.
const GALAXY_SENDBLUE_E164 = process.env.GALAXY_SENDBLUE_E164;
if (!/^\+1[2-9]\d{9}$/.test(GALAXY_SENDBLUE_E164 ?? '') || /^\+1\d{3}55501\d{2}$/.test(GALAXY_SENDBLUE_E164)) {
  throw new Error('Set GALAXY_SENDBLUE_E164 to your provisioned US sender; fictional examples are not allowed.');
}

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const GALAXY = '11111111-1111-1111-1111-111111111101';

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function upsertMany(table, rows) {
  if (rows.length === 0) return { inserted: 0 };
  const { error, count } = await admin
    .from(table)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });
  if (error) {
    throw new Error(`upsert ${table}: ${error.message}`);
  }
  return { inserted: count ?? rows.length };
}

async function seedOrganization() {
  return upsertMany('organizations', [
    {
      id: GALAXY,
      name: 'Galaxy Estates',
      slug: 'galaxy-estates',
      // Explicit deployment configuration; never seed a publication example.
      odesa_phone_number: GALAXY_SENDBLUE_E164,
      messaging_primary: 'linq',
      plan: 'managed',
      timezone: 'America/New_York',
    },
  ]);
}

async function seedProperties() {
  return upsertMany('properties', [
    {
      id: '33333333-3333-3333-3333-333333333301',
      organization_id: GALAXY,
      name: 'Oakwood Commons',
      address_street: '1400 Oakwood Dr',
      address_city: 'Arlington',
      address_state: 'VA',
      address_zip: '22201',
      timezone: 'America/New_York',
    },
    {
      id: '33333333-3333-3333-3333-333333333302',
      organization_id: GALAXY,
      name: '17th Street Row',
      address_street: '1701 17th St NW',
      address_city: 'Washington',
      address_state: 'DC',
      address_zip: '20009',
      timezone: 'America/New_York',
    },
  ]);
}

async function seedUnits() {
  const oakwood = '33333333-3333-3333-3333-333333333301';
  const seventeenth = '33333333-3333-3333-3333-333333333302';
  return upsertMany(
    'units',
    [
      ['44444444-4444-4444-4444-444444444401', oakwood, '101', 1, 1.0, 650],
      ['44444444-4444-4444-4444-444444444402', oakwood, '102', 2, 1.5, 900],
      ['44444444-4444-4444-4444-444444444403', oakwood, '103', 1, 1.0, 680],
      ['44444444-4444-4444-4444-444444444404', oakwood, '201', 2, 2.0, 950],
      ['44444444-4444-4444-4444-444444444405', oakwood, '202', 3, 2.0, 1180],
      ['44444444-4444-4444-4444-444444444406', oakwood, '203', 2, 1.5, 910],
      ['44444444-4444-4444-4444-444444444407', oakwood, '204', 1, 1.0, 700],
      ['44444444-4444-4444-4444-444444444408', seventeenth, 'A', 2, 1.5, 880],
      ['44444444-4444-4444-4444-444444444409', seventeenth, 'B', 2, 1.5, 890],
      ['44444444-4444-4444-4444-444444444410', seventeenth, 'C', 3, 2.0, 1220],
    ].map(([id, property_id, label, beds, baths, sqft]) => ({
      id,
      organization_id: GALAXY,
      property_id,
      label,
      bedrooms: beds,
      bathrooms: baths,
      square_feet: sqft,
    })),
  );
}

async function seedTenants() {
  // Suffix matches seed.sql: '55555555-5555-5555-5555-5555555555NN'
  // where NN is the two-digit tenant index (01..10).
  const rows = [
    ['01', 'Marcus Alvarez', '+15715550201', 'marcus.alvarez@example.com'],
    ['02', 'Priya Banerjee', '+15715550202', 'priya.b@example.com'],
    ['03', 'Jordan Chen', '+15715550203', 'jchen@example.com'],
    ['04', 'Linda Diallo', '+15715550204', 'linda.d@example.com'],
    ['05', 'Ethan Ellis', '+15715550205', 'ethan.ellis@example.com'],
    ['06', 'Fatima Farid', '+15715550206', 'fatima.f@example.com'],
    ['07', 'Gavin Huang', '+15715550207', 'gavin.h@example.com'],
    ['08', 'Hannah Ito', '+15715550208', 'hannah.ito@example.com'],
    ['09', 'Ivan Jankowski', '+15715550209', 'ivan.j@example.com'],
    ['10', 'Jessica Kim', '+15715550210', 'jessica.kim@example.com'],
  ];
  return upsertMany(
    'tenants',
    rows.map(([nn, full_name, phone_e164, email]) => ({
      id: `55555555-5555-5555-5555-5555555555${nn}`,
      organization_id: GALAXY,
      full_name,
      phone_e164,
      email,
    })),
  );
}

async function seedLeases() {
  // tuple: [nn, unitNn, tenantNn, rent, dueDay, graceDays, lateFeeCents, start, end]
  const rows = [
    ['01', '01', '01', 1450.0, 1, 3, 5000, '2025-10-01', '2026-09-30'],
    ['02', '02', '02', 1950.0, 1, 3, 5000, '2025-08-15', '2026-08-14'],
    ['03', '03', '03', 1475.0, 1, 3, 5000, '2025-11-01', '2026-10-31'],
    ['04', '04', '04', 2150.0, 1, 3, 7500, '2025-07-01', '2026-06-30'],
    ['05', '05', '05', 2600.0, 1, 3, 7500, '2025-09-01', '2026-08-31'],
    ['06', '06', '06', 1975.0, 1, 3, 5000, '2026-01-01', '2026-12-31'],
    ['07', '07', '07', 1425.0, 1, 5, 5000, '2025-12-01', '2026-11-30'],
    ['08', '08', '08', 2250.0, 1, 3, 7500, '2025-06-15', '2026-06-14'],
    ['09', '09', '09', 2300.0, 1, 3, 7500, '2025-10-15', '2026-10-14'],
    ['10', '10', '10', 2950.0, 1, 3, 10000, '2025-05-01', '2026-04-30'],
  ];
  return upsertMany(
    'leases',
    rows.map(
      ([
        nn,
        unitNn,
        tenantNn,
        rent,
        rent_due_day,
        grace_days,
        fixed_fee_cents,
        start_date,
        end_date,
      ]) => ({
        id: `66666666-6666-6666-6666-6666666666${nn}`,
        organization_id: GALAXY,
        unit_id: `44444444-4444-4444-4444-4444444444${unitNn}`,
        tenant_id: `55555555-5555-5555-5555-5555555555${tenantNn}`,
        rent_amount: rent,
        rent_due_day,
        late_fee_policy: { grace_days, fixed_fee_cents },
        start_date,
        end_date,
        status: 'active',
      }),
    ),
  );
}

async function seedVendors() {
  return upsertMany('vendors', [
    {
      id: '88888888-8888-8888-8888-888888888801',
      organization_id: GALAXY,
      name: 'Beltway Plumbing Co',
      category: 'plumbing',
      phone_e164: '+15715550301',
      acceptance_rate: 0.92,
    },
    {
      id: '88888888-8888-8888-8888-888888888802',
      organization_id: GALAXY,
      name: 'Capital HVAC Services',
      category: 'hvac',
      phone_e164: '+15715550302',
      acceptance_rate: 0.87,
    },
    {
      id: '88888888-8888-8888-8888-888888888803',
      organization_id: GALAXY,
      name: 'Handyman Hank LLC',
      category: 'general',
      phone_e164: '+15715550303',
      acceptance_rate: 0.96,
    },
  ]);
}

async function seedWorkOrders() {
  return upsertMany('work_orders', [
    {
      id: '77777777-7777-7777-7777-777777777701',
      organization_id: GALAXY,
      tenant_id: '55555555-5555-5555-5555-555555555501',
      unit_id: '44444444-4444-4444-4444-444444444401',
      vendor_id: null,
      category: 'plumbing',
      urgency: 'emergency',
      status: 'open',
      description:
        'Water heater burst in utility closet — standing water on floor.',
      status_timeline: [
        { at: '2026-04-20T14:05:00Z', event: 'created', by: 'retell:alex' },
      ],
    },
    {
      id: '77777777-7777-7777-7777-777777777702',
      organization_id: GALAXY,
      tenant_id: '55555555-5555-5555-5555-555555555504',
      unit_id: '44444444-4444-4444-4444-444444444404',
      vendor_id: '88888888-8888-8888-8888-888888888802',
      category: 'hvac',
      urgency: 'urgent',
      status: 'assigned',
      description:
        'AC blowing warm air; outdoor unit running but no cold output.',
      status_timeline: [
        { at: '2026-04-19T10:12:00Z', event: 'created' },
        {
          at: '2026-04-19T10:45:00Z',
          event: 'assigned',
          vendor: 'Capital HVAC Services',
        },
      ],
    },
    {
      id: '77777777-7777-7777-7777-777777777703',
      organization_id: GALAXY,
      tenant_id: '55555555-5555-5555-5555-555555555506',
      unit_id: '44444444-4444-4444-4444-444444444406',
      vendor_id: '88888888-8888-8888-8888-888888888803',
      category: 'appliances',
      urgency: 'routine',
      status: 'in_progress',
      description: 'Dishwasher stopped draining; part ordered.',
      status_timeline: [
        { at: '2026-04-15T09:00:00Z', event: 'created' },
        { at: '2026-04-15T11:00:00Z', event: 'assigned' },
        {
          at: '2026-04-17T14:00:00Z',
          event: 'in_progress',
          note: 'part on order',
        },
      ],
    },
    {
      id: '77777777-7777-7777-7777-777777777704',
      organization_id: GALAXY,
      tenant_id: '55555555-5555-5555-5555-555555555502',
      unit_id: '44444444-4444-4444-4444-444444444402',
      vendor_id: '88888888-8888-8888-8888-888888888801',
      category: 'plumbing',
      urgency: 'routine',
      status: 'completed',
      description: 'Kitchen faucet drip. Cartridge replaced.',
      status_timeline: [
        { at: '2026-04-10T08:30:00Z', event: 'created' },
        { at: '2026-04-10T09:15:00Z', event: 'assigned' },
        {
          at: '2026-04-11T16:00:00Z',
          event: 'completed',
          cost_cents: 14500,
        },
      ],
    },
    {
      id: '77777777-7777-7777-7777-777777777705',
      organization_id: GALAXY,
      tenant_id: '55555555-5555-5555-5555-555555555508',
      unit_id: '44444444-4444-4444-4444-444444444408',
      vendor_id: null,
      category: 'general',
      urgency: 'routine',
      status: 'cancelled',
      description: 'Hallway light out — duplicate of WO #702 at same unit.',
      status_timeline: [
        { at: '2026-04-12T12:00:00Z', event: 'created' },
        {
          at: '2026-04-12T13:30:00Z',
          event: 'cancelled',
          reason: 'duplicate',
        },
      ],
    },
  ]);
}

async function seedRentEvents() {
  // Mirrors the PL/pgSQL DO block in seed.sql: 3 cycles per lease, the
  // current cycle is `paid` for 8 leases, `late_3` for lease #8, and
  // `escalated` for lease #10. Cycle months are derived from CURRENT_DATE
  // so the fixture stays evergreen.
  const now = new Date();
  const cycleNow = new Date(now.getFullYear(), now.getMonth(), 1);
  const cycleP1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const cycleP2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const rents = [
    1450.0, 1950.0, 1475.0, 2150.0, 2600.0, 1975.0, 1425.0, 2250.0, 2300.0,
    2950.0,
  ];

  // Pull existing (lease_id, cycle_month) pairs to skip duplicates client-side.
  // We can't use ON CONFLICT (lease_id, cycle_month) via upsert because the
  // composite key isn't the PK. Soft idempotency: query existing pairs first.
  const leaseIds = rents.map(
    (_, i) =>
      `66666666-6666-6666-6666-6666666666${String(i + 1).padStart(2, '0')}`,
  );

  // Reset: the Galaxy org's rent ledger IS the fixture. Drop every org
  // rent_event that isn't fixture-lease × fixture-cycle — stale cycles
  // stranded by month rollovers AND cron-generated rows for non-fixture
  // leases (e.g. the owner-queue demo leases) otherwise accumulate as
  // phantom unpaid debt and drift the KPI fixtures (mirrors seed.sql).
  const fixtureCycles = [cycleP2, cycleP1, cycleNow].map(fmt);
  const { error: purgeCycleErr } = await admin
    .from('rent_events')
    .delete()
    .eq('organization_id', GALAXY)
    .not('cycle_month', 'in', `(${fixtureCycles.join(',')})`);
  if (purgeCycleErr) {
    throw new Error(`rent_events cycle purge: ${purgeCycleErr.message}`);
  }
  const { error: purgeLeaseErr } = await admin
    .from('rent_events')
    .delete()
    .eq('organization_id', GALAXY)
    .not('lease_id', 'in', `(${leaseIds.join(',')})`);
  if (purgeLeaseErr) {
    throw new Error(`rent_events lease purge: ${purgeLeaseErr.message}`);
  }

  const { data: existing, error: existingErr } = await admin
    .from('rent_events')
    .select('lease_id, cycle_month')
    .in('lease_id', leaseIds);
  if (existingErr) {
    throw new Error(`rent_events lookup: ${existingErr.message}`);
  }
  const existingPairs = new Set(
    (existing ?? []).map((r) => `${r.lease_id}|${r.cycle_month}`),
  );

  const inserts = [];
  const repairs = [];
  rents.forEach((rent, i) => {
    const leaseId = leaseIds[i];
    const idx = i + 1;
    let currStatus = 'paid';
    let currPaid = rent;
    if (idx === 8) {
      currStatus = 'late_3';
      currPaid = 0;
    } else if (idx === 10) {
      currStatus = 'escalated';
      currPaid = 0;
    }

    const cycles = [
      { cycle: cycleP2, status: 'paid', paid: rent },
      { cycle: cycleP1, status: 'paid', paid: rent },
      { cycle: cycleNow, status: currStatus, paid: currPaid },
    ];

    for (const c of cycles) {
      const cm = fmt(c.cycle);
      const row = {
        organization_id: GALAXY,
        lease_id: leaseId,
        cycle_month: cm,
        amount_due: rent,
        amount_paid: c.paid,
        status: c.status,
        due_date: cm,
      };
      if (existingPairs.has(`${leaseId}|${cm}`)) {
        // A cron/sweeper may have inserted a `due_sent` placeholder with
        // the wrong org_id or zeroed amount_paid for the same
        // (lease_id, cycle_month). Repair it so KPI fixtures stay
        // deterministic — only touching rows for Galaxy lease ids.
        repairs.push(row);
      } else {
        inserts.push(row);
      }
    }
  });

  if (inserts.length > 0) {
    const { error } = await admin.from('rent_events').insert(inserts);
    if (error) throw new Error(`rent_events insert: ${error.message}`);
  }

  for (const row of repairs) {
    const { error } = await admin
      .from('rent_events')
      .update({
        organization_id: row.organization_id,
        amount_due: row.amount_due,
        amount_paid: row.amount_paid,
        status: row.status,
        due_date: row.due_date,
      })
      .eq('lease_id', row.lease_id)
      .eq('cycle_month', row.cycle_month);
    if (error) {
      throw new Error(`rent_events repair: ${error.message}`);
    }
  }

  return { inserted: inserts.length, repaired: repairs.length };
}

async function seedRentPayments() {
  // Mirrors seed.sql: one completed Stripe card payment for Marcus
  // Alvarez's current (paid) cycle so the portal payments page has a
  // receipt-bearing row. rent_event ids are generated, so look the link
  // up by (lease_id, cycle_month).
  const now = new Date();
  const cycleNow = fmt(new Date(now.getFullYear(), now.getMonth(), 1));
  const leaseId = '66666666-6666-6666-6666-666666666601';

  const { data: event, error: eventErr } = await admin
    .from('rent_events')
    .select('id')
    .eq('lease_id', leaseId)
    .eq('cycle_month', cycleNow)
    .maybeSingle();
  if (eventErr) {
    throw new Error(`rent_payments event lookup: ${eventErr.message}`);
  }

  // Plain upsert (no ignoreDuplicates): month rollovers regenerate the
  // current-cycle rent_event, so re-running must re-point
  // rent_event_id/paid_at rather than skip the existing row.
  const { error } = await admin.from('rent_payments').upsert(
    [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
        organization_id: GALAXY,
        lease_id: leaseId,
        tenant_id: '55555555-5555-5555-5555-555555555501',
        rent_event_id: event?.id ?? null,
        stripe_payment_intent_id: 'pi_seed_marcus_alvarez_0001',
        amount_cents: 145000,
        currency: 'usd',
        status: 'succeeded',
        paid_at: `${cycleNow}T09:14:00Z`,
        payment_method_type: 'card',
        receipt_url: 'https://pay.stripe.com/receipts/seed-marcus-alvarez',
      },
    ],
    { onConflict: 'id' },
  );
  if (error) throw new Error(`upsert rent_payments: ${error.message}`);
  return { inserted: 1 };
}

async function main() {
  console.log(`Seeding Galaxy fixtures into ${SUPABASE_URL}`);
  const steps = [
    ['organizations', seedOrganization],
    ['properties', seedProperties],
    ['units', seedUnits],
    ['tenants', seedTenants],
    ['leases', seedLeases],
    ['vendors', seedVendors],
    ['work_orders', seedWorkOrders],
    ['rent_events', seedRentEvents],
    ['rent_payments', seedRentPayments],
  ];
  for (const [name, fn] of steps) {
    try {
      const res = await fn();
      const suffix =
        typeof res.repaired === 'number' && res.repaired > 0
          ? ` (repaired: ${res.repaired})`
          : '';
      console.log(`  ${name}: +${res.inserted}${suffix}`);
    } catch (e) {
      console.error(`  ${name}: FAIL ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log('Done.');
}

main();
