#!/usr/bin/env node
/**
 * Deterministic, idempotent, LOCAL-ONLY Galaxy Estates demo seed.
 *
 * This runner deliberately reads only `.env.production.local`, then refuses
 * to mutate unless the API is exactly the local Supabase listener at
 * http(s)://127.0.0.1:56321 or http(s)://localhost:56321. It composes the
 * mature owner-queue and inbox fixtures and adds only the route-backed depth
 * missing from the base `supabase/seed.sql` fixture.
 *
 * It never resets the database, invokes a provider, sends a message, places a
 * call, creates a payment link, or writes a storage object.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env.production.local');
const GALAXY = '11111111-1111-1111-1111-111111111101';
const OAKWOOD = '33333333-3333-3333-3333-333333333301';
const SEVENTEENTH = '33333333-3333-3333-3333-333333333302';

const UNIT = {
  oak101: '44444444-4444-4444-4444-444444444401',
  oak102: '44444444-4444-4444-4444-444444444402',
  oak103: '44444444-4444-4444-4444-444444444403',
  oak201: '44444444-4444-4444-4444-444444444404',
  oak203: '44444444-4444-4444-4444-444444444406',
  demo1: 'aaaa1111-0000-4000-8000-000000000001',
  demo2: 'aaaa1111-0000-4000-8000-000000000002',
};

const TENANT = {
  marcus: '55555555-5555-5555-5555-555555555501',
  priya: '55555555-5555-5555-5555-555555555502',
  nora: 'aaaa2222-0000-4000-8000-000000000001',
  grace: 'aaaa2222-0000-4000-8000-000000000002',
};

const LEASE = {
  marcus: '66666666-6666-6666-6666-666666666601',
  priya: '66666666-6666-6666-6666-666666666602',
};

const VENDOR = {
  plumbing: '88888888-8888-8888-8888-888888888801',
  hvac: '88888888-8888-8888-8888-888888888802',
  general: '88888888-8888-8888-8888-888888888803',
};

const CONVERSATION = {
  marcus: 'bbbb0001-0000-4000-8000-000000000001',
  review: 'bbbb0001-0000-4000-8000-000000000007',
};

const PROPOSAL = {
  reminder: 'aaaa9999-0000-4000-8000-00000000000a',
  vendor: 'aaaa9999-0000-4000-8000-00000000000b',
};

const WORK_ORDER = {
  emergency: '77777777-7777-7777-7777-777777777701',
  fixtureAssigned: 'f1dd0001-0000-4000-8000-000000000001',
  fixtureReview: 'f1dd0001-0000-4000-8000-000000000002',
};

const VOICE_CALL = {
  resolved: 'f1ee0001-0000-4000-8000-000000000001',
  review: 'f1ee0001-0000-4000-8000-000000000002',
};

const REQUIRED_BASE_IDS = {
  properties: [OAKWOOD, SEVENTEENTH],
  units: [UNIT.oak101, UNIT.oak102, UNIT.oak103, UNIT.oak201, UNIT.oak203],
  tenants: [TENANT.marcus, TENANT.priya],
  leases: [LEASE.marcus, LEASE.priya],
  vendors: Object.values(VENDOR),
  work_orders: [WORK_ORDER.emergency],
};

const TEST_PHONE = /^\+1555\d{7}$/;

function readOnlyLocalEnv() {
  const values = {};
  for (const rawLine of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const localEnv = readOnlyLocalEnv();
const supabaseUrl =
  localEnv.NEXT_PUBLIC_SUPABASE_URL ?? localEnv.SUPABASE_URL;
const serviceRole = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? localEnv.SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceRole || !anonKey) {
  throw new Error(
    'Missing local Supabase URL, anon key, or service-role key in .env.production.local',
  );
}

const parsedUrl = new URL(supabaseUrl);
if (
  !['127.0.0.1', 'localhost'].includes(parsedUrl.hostname) ||
  parsedUrl.port !== '56321'
) {
  throw new Error(
    `LOCAL-ONLY SAFETY ABORT: expected 127.0.0.1|localhost:56321, got ${parsedUrl.origin}`,
  );
}

const admin = createClient(supabaseUrl, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function utcDate(offsetDays = 0) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function isoDate(offsetDays = 0) {
  return utcDate(offsetDays).toISOString().slice(0, 10);
}

function isoAtToday(minutesAfterMidnight) {
  return new Date(utcDate().getTime() + minutesAfterMidnight * 60_000).toISOString();
}

function currentCycle() {
  const d = utcDate();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

async function requireBaseFixture() {
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', GALAXY)
    .maybeSingle();
  if (orgError || !org) {
    throw new Error(
      `Galaxy Estates base fixture is absent (${orgError?.message ?? 'not found'}). Refusing to reset Supabase.`,
    );
  }

  for (const [table, ids] of Object.entries(REQUIRED_BASE_IDS)) {
    const { data, error } = await admin.from(table).select('id').in('id', ids);
    if (error) throw new Error(`preflight ${table}: ${error.message}`);
    const found = new Set((data ?? []).map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(
        `Base fixture incomplete: ${table} missing ${missing.join(', ')}. Refusing to reset Supabase.`,
      );
    }
  }
}

function runMatureFixture(scriptName) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', scriptName)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'development',
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRole,
      ODESA_SKIP_DOTENV_LOCAL: '1',
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit ${result.status ?? 'unknown'}`);
  }
}

async function upsert(table, rows, onConflict = 'id') {
  const { error } = await admin
    .from(table)
    .upsert(rows, { onConflict, ignoreDuplicates: false });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
  console.log(`  ${table}: ${rows.length} deterministic fixture rows converged`);
}

async function assertFixtureContactsSafe() {
  const { data, error } = await admin
    .from('tenants')
    .select('id, full_name, phone_e164')
    .in('id', [TENANT.nora, TENANT.grace]);
  if (error) throw new Error(`fixture contact check: ${error.message}`);
  if ((data ?? []).length !== 2) {
    throw new Error('LOCAL-ONLY SAFETY ABORT: expected both demo-safe tenants');
  }
  for (const tenant of data ?? []) {
    if (!TEST_PHONE.test(tenant.phone_e164 ?? '')) {
      throw new Error(
        `LOCAL-ONLY SAFETY ABORT: ${tenant.full_name} is not on a +1555 fixture number`,
      );
    }
  }
}

async function seedRouteDepth() {
  console.log('Adding route-backed local fixture depth (no provider calls):');

  await upsert('appliances', [
    {
      id: 'f1aa0001-0000-4000-8000-000000000001',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: null,
      type: 'hvac',
      make: 'FixtureAir',
      model: 'LOCAL-24',
      serial_number: 'LOCAL-FIXTURE-HVAC-001',
      install_date: isoDate(-1460),
      last_service_date: isoDate(-45),
      warranty_expires_at: isoDate(365),
      notes: 'LOCAL FIXTURE — rooftop system; annual service logged for demo only.',
      confidence: 1,
      source: 'import',
    },
    {
      id: 'f1aa0001-0000-4000-8000-000000000002',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak101,
      type: 'water_heater',
      make: 'FixtureWorks',
      model: 'LOCAL-40G',
      serial_number: 'LOCAL-FIXTURE-WH-101',
      install_date: isoDate(-2555),
      last_service_date: isoDate(-8),
      warranty_expires_at: isoDate(-365),
      notes: 'LOCAL FIXTURE — replacement review tied to the Unit 101 work order.',
      confidence: 1,
      source: 'import',
    },
    {
      id: 'f1aa0001-0000-4000-8000-000000000003',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak203,
      type: 'dishwasher',
      make: 'Demo Domestic',
      model: 'LOCAL-DW203',
      serial_number: 'LOCAL-FIXTURE-DW-203',
      install_date: isoDate(-900),
      last_service_date: isoDate(-3),
      warranty_expires_at: isoDate(180),
      notes: 'LOCAL FIXTURE — drain-pump part is on order.',
      confidence: 1,
      source: 'import',
    },
    {
      id: 'f1aa0001-0000-4000-8000-000000000004',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.demo2,
      type: 'fridge',
      make: 'Sample Kitchen Co',
      model: 'LOCAL-R18',
      serial_number: 'LOCAL-FIXTURE-R-002',
      install_date: isoDate(-520),
      last_service_date: null,
      warranty_expires_at: isoDate(210),
      notes: 'LOCAL FIXTURE — no service history recorded.',
      confidence: 1,
      source: 'import',
    },
  ]);

  await upsert(
    'property_vendors',
    [
      {
        organization_id: GALAXY,
        property_id: OAKWOOD,
        category: 'plumbing',
        vendor_id: VENDOR.plumbing,
        notes: 'LOCAL FIXTURE — preferred for same-day plumbing triage; no dispatch implied.',
        confidence: 1,
        source: 'import',
      },
      {
        organization_id: GALAXY,
        property_id: OAKWOOD,
        category: 'hvac',
        vendor_id: VENDOR.hvac,
        notes: 'LOCAL FIXTURE — property roster assignment only.',
        confidence: 1,
        source: 'import',
      },
      {
        organization_id: GALAXY,
        property_id: OAKWOOD,
        category: 'general',
        vendor_id: VENDOR.general,
        notes: 'LOCAL FIXTURE — general maintenance roster assignment only.',
        confidence: 1,
        source: 'import',
      },
      {
        organization_id: GALAXY,
        property_id: OAKWOOD,
        category: 'electrical',
        vendor_id: VENDOR.general,
        notes: 'LOCAL FIXTURE — owner review required before any electrical dispatch.',
        confidence: 1,
        source: 'import',
      },
    ],
    'organization_id,property_id,category',
  );

  await upsert('maintenance_tickets', [
    {
      id: 'f1bb0001-0000-4000-8000-000000000001',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak103,
      summary: 'LOCAL FIXTURE — bathroom exhaust fan intermittently stops.',
      severity: 'medium',
      reported_by: 'Jordan Chen (fixture tenant)',
      status: 'open',
      photos: [],
      created_at: isoAtToday(35),
    },
    {
      id: 'f1bb0001-0000-4000-8000-000000000002',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak201,
      summary: 'LOCAL FIXTURE — HVAC follow-up intake linked to assigned work.',
      severity: 'high',
      reported_by: 'Linda Diallo (fixture tenant)',
      status: 'in_progress',
      photos: [],
      created_at: isoAtToday(25),
    },
    {
      id: 'f1bb0001-0000-4000-8000-000000000003',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak102,
      summary: 'LOCAL FIXTURE — kitchen faucet cartridge replacement intake.',
      severity: 'low',
      reported_by: 'Priya Banerjee (fixture tenant)',
      status: 'resolved',
      photos: [],
      created_at: isoAtToday(15),
    },
  ]);

  await upsert('work_orders', [
    {
      id: WORK_ORDER.fixtureAssigned,
      organization_id: GALAXY,
      tenant_id: TENANT.nora,
      unit_id: UNIT.demo1,
      vendor_id: VENDOR.plumbing,
      category: 'plumbing',
      urgency: 'urgent',
      status: 'assigned',
      description: 'LOCAL FIXTURE — supply-line seep isolated; vendor response accepted and visit pending.',
      status_timeline: [
        { at: isoAtToday(20), event: 'created', source: 'local_fixture' },
        { at: isoAtToday(30), event: 'assigned', source: 'local_fixture' },
        { at: isoAtToday(40), event: 'vendor_accepted', source: 'local_fixture' },
      ],
      vendor_response: 'accepted',
      vendor_assigned_at: isoAtToday(30),
      vendor_responded_at: isoAtToday(40),
      reviewed_at: null,
      lifecycle_version: 2,
      created_at: isoAtToday(20),
    },
    {
      id: WORK_ORDER.fixtureReview,
      organization_id: GALAXY,
      tenant_id: TENANT.grace,
      unit_id: UNIT.demo2,
      vendor_id: VENDOR.general,
      category: 'appliances',
      urgency: 'routine',
      status: 'completed',
      description: 'LOCAL FIXTURE — refrigerator door gasket replaced; completion awaits owner review.',
      status_timeline: [
        { at: isoAtToday(10), event: 'created', source: 'local_fixture' },
        { at: isoAtToday(45), event: 'completed', source: 'local_fixture' },
      ],
      vendor_response: 'accepted',
      vendor_assigned_at: isoAtToday(15),
      vendor_responded_at: isoAtToday(20),
      reviewed_at: null,
      lifecycle_version: 4,
      created_at: isoAtToday(10),
    },
  ]);

  await seedPayments();

  await upsert('documents', [
    {
      id: 'f1cc0001-0000-4000-8000-000000000001',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak101,
      tenant_id: TENANT.marcus,
      vendor_id: null,
      lease_id: LEASE.marcus,
      type: 'lease',
      title: 'LOCAL FIXTURE — Marcus Alvarez current lease metadata',
      file_key: null,
      expiry_date: isoDate(82),
    },
    {
      id: 'f1cc0001-0000-4000-8000-000000000002',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: UNIT.oak102,
      tenant_id: TENANT.priya,
      vendor_id: null,
      lease_id: LEASE.priya,
      type: 'lease',
      title: 'LOCAL FIXTURE — Priya Banerjee current lease metadata',
      file_key: null,
      expiry_date: isoDate(35),
    },
    {
      id: 'f1cc0001-0000-4000-8000-000000000003',
      organization_id: GALAXY,
      property_id: OAKWOOD,
      unit_id: null,
      tenant_id: null,
      vendor_id: VENDOR.plumbing,
      lease_id: null,
      type: 'tax',
      title: 'LOCAL FIXTURE — preferred vendor W-9 metadata (file unavailable)',
      file_key: null,
      expiry_date: null,
    },
  ]);

  await upsert('voice_calls', buildVoiceCalls());
}

async function seedPayments() {
  const cycle = currentCycle();
  const { data: events, error } = await admin
    .from('rent_events')
    .select('id, lease_id, amount_due, amount_paid, status')
    .eq('cycle_month', cycle)
    .in('lease_id', [LEASE.marcus, LEASE.priya]);
  if (error) throw new Error(`rent payment fixture lookup: ${error.message}`);
  const byLease = new Map((events ?? []).map((event) => [event.lease_id, event]));
  const paymentSpecs = [
    {
      id: 'f1ff0001-0000-4000-8000-000000000001',
      leaseId: LEASE.marcus,
      tenantId: TENANT.marcus,
      intent: `pi_local_fixture_marcus_${cycle}`,
      paidAt: `${cycle}T09:14:00.000Z`,
    },
    {
      id: 'f1ff0001-0000-4000-8000-000000000002',
      leaseId: LEASE.priya,
      tenantId: TENANT.priya,
      intent: `pi_local_fixture_priya_${cycle}`,
      paidAt: `${cycle}T09:05:00.000Z`,
    },
  ];
  const rows = paymentSpecs.map((spec) => {
    const event = byLease.get(spec.leaseId);
    if (!event || event.status !== 'paid') {
      throw new Error(
        `rent payment fixture requires a paid current-cycle event for lease ${spec.leaseId}`,
      );
    }
    const dueCents = Math.round(Number(event.amount_due) * 100);
    const paidCents = Math.round(Number(event.amount_paid) * 100);
    if (dueCents !== paidCents) {
      throw new Error(`paid rent event ${event.id} is internally inconsistent`);
    }
    return {
      id: spec.id,
      organization_id: GALAXY,
      lease_id: spec.leaseId,
      tenant_id: spec.tenantId,
      rent_event_id: event.id,
      stripe_payment_intent_id: spec.intent,
      amount_cents: paidCents,
      currency: 'usd',
      status: 'succeeded',
      paid_at: spec.paidAt,
      payment_method_type: 'local_fixture',
      receipt_url: null,
      payment_link_url: null,
    };
  });
  await upsert('rent_payments', rows);
}

function buildVoiceCalls() {
  return [
    {
      id: VOICE_CALL.resolved,
      organization_id: GALAXY,
      retell_call_id: 'local-fixture-call-resolved-001',
      direction: 'inbound',
      from_number: '+15550100001',
      to_number: '+15550100999',
      caller_kind: 'verified_tenant',
      tenant_id: TENANT.nora,
      vendor_id: null,
      property_id: OAKWOOD,
      unit_id: UNIT.demo1,
      conversation_id: CONVERSATION.marcus,
      status: 'completed',
      started_at: isoAtToday(60),
      ended_at: isoAtToday(64),
      transcript:
        'Odesa: Galaxy Estates local fixture line. How can I help?\n' +
        'Nora: I want to confirm the plumber has my access note.\n' +
        'Odesa: The work order records weekday access and an accepted vendor response. No new dispatch or message was sent during this fixture call.',
      summary:
        'LOCAL FIXTURE — verified tenant asked about an already-recorded work-order access note; no external action taken.',
      session: { fixture: true, externalActionsDisabled: true },
      outcome: {
        fixture: true,
        oneSentence:
          'Verified tenant confirmed an existing access note; no external action was taken.',
        callerKind: 'verified_tenant',
        callerPhone: '+15550100001',
        tenantId: TENANT.nora,
        propertyId: OAKWOOD,
        unitId: UNIT.demo1,
        intentsHandled: ['maintenance_status'],
        recordsCreated: [],
        autonomousActions: [],
        approvalsNeeded: [],
        smsSent: [],
        smsDrafted: [],
        unresolved: [],
        riskFlags: [],
        endedAt: isoAtToday(64),
      },
      finalization_richness: 2,
    },
    {
      id: VOICE_CALL.review,
      organization_id: GALAXY,
      retell_call_id: 'local-fixture-call-review-001',
      direction: 'inbound',
      from_number: '+15550100001',
      to_number: '+15550100999',
      caller_kind: 'verified_tenant',
      tenant_id: TENANT.nora,
      vendor_id: null,
      property_id: OAKWOOD,
      unit_id: UNIT.demo1,
      conversation_id: CONVERSATION.review,
      status: 'completed',
      started_at: isoAtToday(75),
      ended_at: isoAtToday(80),
      transcript:
        'Odesa: Galaxy Estates local fixture line. How can I help?\n' +
        'Nora: An unexpected bill means rent will be late. Can the fee be waived?\n' +
        'Odesa: I cannot waive a fee or promise new terms. I recorded the request and held a draft for owner review. Nothing was sent.',
      summary:
        'LOCAL FIXTURE — financial-concession request recorded and held for review; no promise, payment link, or message sent.',
      session: { fixture: true, externalActionsDisabled: true },
      outcome: {
        fixture: true,
        oneSentence:
          'Fee-waiver request was held for owner review; no promise or external action was made.',
        callerKind: 'verified_tenant',
        callerPhone: '+15550100001',
        tenantId: TENANT.nora,
        propertyId: OAKWOOD,
        unitId: UNIT.demo1,
        intentsHandled: ['rent_help'],
        recordsCreated: [],
        autonomousActions: [],
        approvalsNeeded: [PROPOSAL.reminder],
        smsSent: [],
        smsDrafted: ['bbbb0002-0000-4000-8000-00000000000e'],
        unresolved: ['owner_decision_on_fee_request'],
        riskFlags: ['financial_concession'],
        endedAt: isoAtToday(80),
      },
      finalization_richness: 3,
    },
  ];
}

const SNAPSHOT_TABLES = [
  'properties',
  'units',
  'tenants',
  'leases',
  'rent_events',
  'rent_payments',
  'vendors',
  'property_vendors',
  'appliances',
  'maintenance_tickets',
  'work_orders',
  'documents',
  'conversations',
  'messages',
  'action_proposals',
  'voice_calls',
];

async function tableSnapshot(client, table) {
  const columns =
    table === 'property_vendors' ? 'property_id,category,vendor_id' : 'id';
  const { data, error, count } = await client
    .from(table)
    .select(columns, { count: 'exact' })
    .eq('organization_id', GALAXY);
  if (error) throw new Error(`snapshot ${table}: ${error.message}`);
  const keys = (data ?? [])
    .map((row) =>
      table === 'property_vendors'
        ? `${row.property_id}:${row.category}:${row.vendor_id}`
        : row.id,
    )
    .sort();
  return {
    count: count ?? keys.length,
    idSignature: createHash('sha256')
      .update(JSON.stringify(keys))
      .digest('hex')
      .slice(0, 16),
  };
}

async function managerVisibleSnapshot() {
  const manager = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: auth, error } = await manager.auth.signInWithPassword({
    email: 'manager@galaxy-estates.test',
    password: 'galaxy-test-manager-password',
  });
  if (error || !auth.user) {
    throw new Error(`manager scope verification failed: ${error?.message ?? 'no user'}`);
  }
  const { data: appUser, error: userError } = await manager
    .from('users')
    .select('id, email, role, organization_id')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (userError || !appUser || appUser.organization_id !== GALAXY) {
    throw new Error(`manager app scope mismatch: ${userError?.message ?? 'wrong org'}`);
  }

  const visible = {};
  for (const table of SNAPSHOT_TABLES) {
    visible[table] = await tableSnapshot(manager, table);
  }
  await manager.auth.signOut({ scope: 'local' });
  return { account: appUser.email, role: appUser.role, tables: visible };
}

async function buildCoverage(managerScope) {
  const counts = Object.fromEntries(
    Object.entries(managerScope.tables).map(([table, value]) => [table, value.count]),
  );
  return [
    { route: '/today', backing: 'rent_events + work_orders + conversations + voice_calls', count: counts.rent_events + counts.work_orders + counts.conversations + counts.voice_calls, representative: `/work-orders/${WORK_ORDER.fixtureAssigned}` },
    { route: '/inbox', backing: 'conversations + messages', count: counts.conversations, representative: `/inbox?conversation=${CONVERSATION.review}` },
    { route: '/calls', backing: 'voice_calls', count: counts.voice_calls, representative: `/calls/${VOICE_CALL.review}` },
    { route: '/owner-queue', backing: 'action_proposals', count: counts.action_proposals, representative: `/owner-queue (proposal ${PROPOSAL.vendor})` },
    { route: '/properties', backing: 'properties + units + appliances + property_vendors', count: counts.properties, representative: `/properties/${OAKWOOD}` },
    { route: '/tenants', backing: 'tenants + leases + rent_events', count: counts.tenants, representative: `/tenants/${TENANT.nora}` },
    { route: '/vendors', backing: 'vendors + property_vendors + work_orders', count: counts.vendors, representative: `/vendors/${VENDOR.plumbing}` },
    { route: '/documents', backing: 'documents metadata; fixture file_key is null', count: counts.documents, representative: '/documents' },
    { route: '/rent', backing: 'leases + rent_events + rent_payments', count: counts.rent_events, representative: `/tenants/${TENANT.priya}` },
    { route: '/financials', backing: 'rent_events + work_orders', count: counts.rent_events + counts.work_orders, representative: '/financials' },
    { route: '/open-items', backing: 'work_orders + late rent + proposals + vacancies', count: counts.work_orders + counts.action_proposals, representative: `/work-orders/${WORK_ORDER.fixtureReview}` },
    { route: '/escalations', backing: 'manager-inaccessible; redirects to owner queue', count: 0, representative: '/owner-queue' },
    { route: '/settings/integrations', backing: 'intentionally unchanged/unconfigured', count: 0, representative: '/settings/integrations' },
  ];
}

async function printVerification() {
  const managerScope = await managerVisibleSnapshot();
  const coverage = await buildCoverage(managerScope);
  console.log('\nMANAGER_VISIBLE_SNAPSHOT');
  console.log(JSON.stringify(managerScope, null, 2));
  console.log('\nROUTE_COVERAGE_MATRIX');
  console.table(coverage);
  console.log('\nCONVERGENCE_SIGNATURE');
  console.log(
    createHash('sha256')
      .update(JSON.stringify(managerScope.tables))
      .digest('hex'),
  );
}

async function main() {
  console.log(`LOCAL-ONLY target validated: ${parsedUrl.origin}`);
  console.log(`Fixture org: Galaxy Estates (${GALAXY})`);
  await requireBaseFixture();
  runMatureFixture('seed-owner-queue-proposals.mjs');
  runMatureFixture('seed-inbox-conversations.mjs');
  await assertFixtureContactsSafe();
  await seedRouteDepth();
  await printVerification();
  console.log('\nODESA_FULL_SEED_DONE');
}

main().catch((error) => {
  console.error(`FULL DEMO SEED FAILED: ${error.message}`);
  process.exitCode = 1;
});
