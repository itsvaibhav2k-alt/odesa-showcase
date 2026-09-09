#!/usr/bin/env node
/**
 * Seeds realistic, schema-valid PENDING owner-queue decisions
 * (`action_proposals`, status 'proposed') for Galaxy Estates so the
 * `/owner-queue` "Decisions Desk" renders real cards instead of the mock.
 *
 * Mirrors the service-role pattern in `scripts/seed-cloud-galaxy.mjs`:
 *   - env loaded by Node via `--env-file=.env.local` (run instructions below)
 *   - createClient(SUPABASE_URL, SERVICE_ROLE) with autoRefresh/persist off
 *   - portfolio rows (units/tenants/leases/memory_facts) are keyed on a
 *     deterministic UUID + upsert ignoreDuplicates, so re-runs never
 *     duplicate or overwrite them.
 *   - the 5 demo proposals RESET on every run: their deterministic-UUID rows
 *     are upserted with merge-on-conflict so a prior commit/decline can never
 *     leave the desk empty. Each re-run returns them to a clean pending state
 *     (status 'proposed'; committed_at/rejected_at/edit_diff/outcome cleared;
 *     created_at refreshed so they sort newest-first).
 *
 * SAFETY (this is a property-management product; an accidental send is
 * worse than an empty desk):
 *   - Sendable proposals (send_tenant_message / request_rent_payment) are
 *     attached ONLY to dedicated demo tenants created here with
 *     NON-DELIVERABLE +1555 test phone numbers. We never attach a sendable
 *     proposal to an existing Galaxy contact.
 *   - Before inserting any sendable proposal, we re-read the demo tenant's
 *     phone from the DB and ABORT with a clear error if it is not in the
 *     reserved +1555 test range. Fail closed.
 *   - `dispatch_vendor` is a commit-time no-op (records the decision; the
 *     vendor is never contacted from the action) — it references the real
 *     emergency work order + a real vendor.
 *
 * Schema-validity: every `payload` is shaped to pass the matching Zod
 * schema in `src/lib/agent/worker/types.ts` (WORKER_PAYLOAD_SCHEMAS) so
 * Pass-2 commit re-validation succeeds. Per the privacy-mode invariant,
 * tenant/vendor/work-order ids live in `routing`, NEVER in `payload`;
 * payload refs use the human-name branch of each ref union.
 *
 * Source chips: 3 `memory_facts` rows are seeded and referenced via each
 * proposal's `context_fact_ids` so the desk's provenance chips are real.
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage (from repo root, so Node loads the env file):
 *   node --env-file=.env.local scripts/seed-owner-queue-proposals.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Fallback .env.local loader so the script also works without --env-file
// (mirrors seed-cloud-galaxy.mjs). --env-file wins because it populates
// process.env before this runs; this only fills gaps.
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

if (process.env.ODESA_SKIP_DOTENV_LOCAL !== '1') loadDotEnvLocal();

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

// ---------------------------------------------------------------------------
// Real Galaxy ids (from supabase/seed.sql) — never invented.
// ---------------------------------------------------------------------------

const GALAXY = '11111111-1111-1111-1111-111111111101';
const OAKWOOD = '33333333-3333-3333-3333-333333333301'; // Oakwood Commons
const SEVENTEENTH = '33333333-3333-3333-3333-333333333302'; // 17th Street Row

// Real emergency work order (water heater burst, Unit 101, unassigned) +
// a real plumbing vendor — used by the dispatch_vendor proposal's routing.
const WO_WATER_HEATER = '77777777-7777-7777-7777-777777777701';
const VENDOR_BELTWAY_PLUMBING = '88888888-8888-8888-8888-888888888801';

// ---------------------------------------------------------------------------
// Demo-safe ids (created by this script; all valid hex UUIDs). Sendable
// proposals route ONLY to these tenants, which carry +1555 non-deliverable
// numbers. Deterministic so the seed stays idempotent.
// ---------------------------------------------------------------------------

const DEMO_UNIT_1 = 'aaaa1111-0000-4000-8000-000000000001';
const DEMO_UNIT_2 = 'aaaa1111-0000-4000-8000-000000000002';

const DEMO_TENANT_REMINDER = 'aaaa2222-0000-4000-8000-000000000001';
const DEMO_TENANT_PAYMENT = 'aaaa2222-0000-4000-8000-000000000002';

const DEMO_LEASE_REMINDER = 'aaaa3333-0000-4000-8000-000000000001';
const DEMO_LEASE_PAYMENT = 'aaaa3333-0000-4000-8000-000000000002';

// Non-deliverable +1555 test numbers (555-0100 block, classic reserved range).
const DEMO_PHONE_REMINDER = '+15550100001';
const DEMO_PHONE_PAYMENT = '+15550100002';

// Credible names with NO "(demo)" suffix so re-seeds emit client-safe data
// that matches the display mappings in src/lib/demo-safe/normalize.ts. These
// stay attached ONLY to the +1555 non-deliverable test tenants below.
const DEMO_TENANT_REMINDER_NAME = 'Nora Alvarez';
const DEMO_TENANT_PAYMENT_NAME = 'Grace Okafor';

// memory_facts ids — referenced by proposals via context_fact_ids.
const FACT_RENT_PATTERN = 'aaaa8888-0000-4000-8000-000000000001';
const FACT_WATER_HEATER_QUIRK = 'aaaa8888-0000-4000-8000-000000000002';
const FACT_MARKET_COMP = 'aaaa8888-0000-4000-8000-000000000003';

// Proposal ids — deterministic so re-running is a no-op.
const PROP_RENT_REMINDER = 'aaaa9999-0000-4000-8000-00000000000a';
const PROP_EMERGENCY_VENDOR = 'aaaa9999-0000-4000-8000-00000000000b';
const PROP_LEASE_RENEWAL = 'aaaa9999-0000-4000-8000-00000000000c';
const PROP_COLLECTIONS = 'aaaa9999-0000-4000-8000-00000000000d';
const PROP_RENT_PAYMENT = 'aaaa9999-0000-4000-8000-00000000000e';

const WORKER_MODEL = 'claude-haiku-4-5';

/** Reserved non-deliverable test ranges. We only ever send-able-attach to
 *  +1555 numbers; this guards against a typo silently routing to a real
 *  contact. The 555-01xx exchange is the canonical fictitious-number block. */
const TEST_PHONE_REGEX = /^\+1555\d{7}$/;

function assertTestPhone(label, phone) {
  if (!TEST_PHONE_REGEX.test(phone ?? '')) {
    throw new Error(
      `SAFETY ABORT: ${label} phone "${phone}" is not a non-deliverable ` +
        `+1555 test number. Refusing to attach a sendable proposal to a ` +
        `possibly-real contact.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Idempotent upsert helpers
// ---------------------------------------------------------------------------

async function upsertMany(table, rows) {
  if (rows.length === 0) return { inserted: 0 };
  const { error, count } = await admin
    .from(table)
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });
  if (error) throw new Error(`upsert ${table}: ${error.message}`);
  return { inserted: count ?? rows.length };
}

// ---------------------------------------------------------------------------
// Demo-safe portfolio rows (units + tenants + leases the sendable proposals
// reference). Units hang off the real Oakwood property.
// ---------------------------------------------------------------------------

async function seedDemoUnits() {
  return upsertMany('units', [
    {
      id: DEMO_UNIT_1,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      label: 'D1',
      bedrooms: 1,
      bathrooms: 1.0,
      square_feet: 640,
    },
    {
      id: DEMO_UNIT_2,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      label: 'D2',
      bedrooms: 2,
      bathrooms: 1.0,
      square_feet: 820,
    },
  ]);
}

async function seedDemoTenants() {
  return upsertMany('tenants', [
    {
      id: DEMO_TENANT_REMINDER,
      organization_id: GALAXY,
      full_name: DEMO_TENANT_REMINDER_NAME,
      phone_e164: DEMO_PHONE_REMINDER,
      email: 'demo.reminder@example.com',
    },
    {
      id: DEMO_TENANT_PAYMENT,
      organization_id: GALAXY,
      full_name: DEMO_TENANT_PAYMENT_NAME,
      phone_e164: DEMO_PHONE_PAYMENT,
      email: 'demo.payment@example.com',
    },
  ]);
}

async function seedDemoLeases() {
  // request_rent_payment + update_rent need an active lease on the tenant.
  return upsertMany('leases', [
    {
      id: DEMO_LEASE_REMINDER,
      organization_id: GALAXY,
      unit_id: DEMO_UNIT_1,
      tenant_id: DEMO_TENANT_REMINDER,
      rent_amount: 1450.0,
      rent_due_day: 1,
      late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
      start_date: '2025-10-01',
      end_date: '2026-09-30',
      status: 'active',
    },
    {
      id: DEMO_LEASE_PAYMENT,
      organization_id: GALAXY,
      unit_id: DEMO_UNIT_2,
      tenant_id: DEMO_TENANT_PAYMENT,
      rent_amount: 1875.0,
      rent_due_day: 1,
      late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
      start_date: '2025-08-15',
      end_date: '2026-08-14',
      status: 'active',
    },
  ]);
}

// ---------------------------------------------------------------------------
// memory_facts — real provenance for the proposals' source chips.
// content is jsonb (free-form per fact_type); confidence/source per the
// CHECK constraints in 20260428000000_property_workers.sql.
// ---------------------------------------------------------------------------

async function seedMemoryFacts() {
  return upsertMany('memory_facts', [
    {
      id: FACT_RENT_PATTERN,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      fact_type: 'tenant_pattern',
      subject_id: DEMO_TENANT_REMINDER,
      content: {
        summary:
          'Pays within the 3-day grace window most cycles; responds well ' +
          'to a single warm reminder rather than a formal notice.',
        observed_cycles: 4,
      },
      confidence: 0.82,
      source: 'observed',
    },
    {
      id: FACT_WATER_HEATER_QUIRK,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      fact_type: 'building_quirk',
      subject_id: DEMO_UNIT_1,
      content: {
        summary:
          'Utility-closet water heater in the 100-stack is original to the ' +
          'building; prior failure flooded the closet floor.',
        system: 'water_heater',
      },
      confidence: 0.9,
      source: 'observed',
    },
    {
      id: FACT_MARKET_COMP,
      organization_id: GALAXY,
      property_id: SEVENTEENTH,
      fact_type: 'derived_rule',
      subject_id: null,
      content: {
        summary:
          'Comparable 2BR renewals in the 17th Street corridor cleared a ' +
          '3-4% increase this quarter without raising turnover.',
        basis: 'market_comps',
      },
      confidence: 0.7,
      source: 'derived',
    },
  ]);
}

// ---------------------------------------------------------------------------
// action_proposals — the 5 pending owner decisions.
// Each payload is shaped to pass WORKER_PAYLOAD_SCHEMAS; ids live in routing.
// ---------------------------------------------------------------------------

function buildProposalRows() {
  return [
    // (a) Rent reminder — send_tenant_message, gate 'auto', conf ~0.9.
    //     Payload uses the tenantName branch; real tenant id in routing.
    {
      id: PROP_RENT_REMINDER,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      worker_model: WORKER_MODEL,
      action_type: 'send_tenant_message',
      payload: {
        tenantRef: { tenantName: DEMO_TENANT_REMINDER_NAME },
        body:
          'Hi! A friendly reminder that this month’s rent is now due. ' +
          'You can reply here if you have any questions — thanks!',
      },
      routing: { tenantId: DEMO_TENANT_REMINDER },
      reasoning:
        'Balance is outstanding inside the grace window. This tenant ' +
        'typically pays after a single warm reminder, so a gentle nudge ' +
        'fits their history rather than a formal late notice.',
      confidence: 0.9,
      context_fact_ids: [FACT_RENT_PATTERN],
      gate_decision: 'auto',
      status: 'proposed',
      // Reset fields: a merge-on-conflict re-run clears any prior decision
      // state so a previously committed/declined demo proposal returns to a
      // clean pending card. created_at is refreshed so the reset proposals
      // sort newest-first (above accumulated health_flag cards).
      committed_at: null,
      rejected_at: null,
      edit_diff: null,
      outcome: null,
      created_at: new Date().toISOString(),
    },

    // (b) Emergency vendor — dispatch_vendor, gate 'review', conf ~0.95.
    //     Commit is a no-op; the vendor is NOT contacted from this action.
    //     Routing carries the real work order + real vendor id.
    {
      id: PROP_EMERGENCY_VENDOR,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      worker_model: WORKER_MODEL,
      action_type: 'dispatch_vendor',
      payload: {
        candidateIndex: 0,
        smsBody:
          'Emergency at Oakwood Commons Unit 101: water heater burst with ' +
          'standing water. Can you take a same-day call-out? Reply YES to ' +
          'accept and we’ll share unit access details.',
      },
      routing: {
        workOrderId: WO_WATER_HEATER,
        vendorId: VENDOR_BELTWAY_PLUMBING,
      },
      reasoning:
        'Open emergency work order: water heater burst in Unit 101 with ' +
        'standing water on the floor. Beltway Plumbing covers this category ' +
        'and has the highest recent acceptance rate, making them the first ' +
        'call for a same-day dispatch.',
      confidence: 0.95,
      context_fact_ids: [FACT_WATER_HEATER_QUIRK],
      gate_decision: 'review',
      status: 'proposed',
      // Reset fields: a merge-on-conflict re-run clears any prior decision
      // state so a previously committed/declined demo proposal returns to a
      // clean pending card. created_at is refreshed so the reset proposals
      // sort newest-first (above accumulated health_flag cards).
      committed_at: null,
      rejected_at: null,
      edit_diff: null,
      outcome: null,
      created_at: new Date().toISOString(),
    },

    // (c) Lease renewal — update_rent, gate 'review', conf ~0.82.
    //     leaseRef uses the tenantName branch; tenant id in routing.
    {
      id: PROP_LEASE_RENEWAL,
      organization_id: GALAXY,
      property_id: SEVENTEENTH,
      worker_model: WORKER_MODEL,
      action_type: 'update_rent',
      payload: {
        leaseRef: { tenantName: DEMO_TENANT_PAYMENT_NAME },
        rentAmount: 1930,
      },
      routing: { tenantId: DEMO_TENANT_PAYMENT },
      reasoning:
        'Lease is inside the renewal window. Comparable 2BR renewals in ' +
        'this corridor cleared a 3% increase this quarter without raising ' +
        'turnover, so a modest bump to $1,930 keeps the unit competitive.',
      confidence: 0.82,
      context_fact_ids: [FACT_MARKET_COMP],
      gate_decision: 'review',
      status: 'proposed',
      // Reset fields: a merge-on-conflict re-run clears any prior decision
      // state so a previously committed/declined demo proposal returns to a
      // clean pending card. created_at is refreshed so the reset proposals
      // sort newest-first (above accumulated health_flag cards).
      committed_at: null,
      rejected_at: null,
      edit_diff: null,
      outcome: null,
      created_at: new Date().toISOString(),
    },

    // (d) Collections — send_tenant_message, gate 'review', conf ~0.7.
    {
      id: PROP_COLLECTIONS,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      worker_model: WORKER_MODEL,
      action_type: 'send_tenant_message',
      payload: {
        tenantRef: { tenantName: DEMO_TENANT_REMINDER_NAME },
        body:
          'Following up on the outstanding balance for this month. Please ' +
          'reply to let us know your plan, or reach out if something has ' +
          'come up — we’d like to work it out with you.',
      },
      routing: { tenantId: DEMO_TENANT_REMINDER },
      reasoning:
        'Earlier reminder went unanswered and the balance is still open. ' +
        'A firmer but still cooperative follow-up is warranted before any ' +
        'escalation — routed for your review given it is tenant-facing.',
      confidence: 0.7,
      context_fact_ids: [FACT_RENT_PATTERN],
      gate_decision: 'review',
      status: 'proposed',
      // Reset fields: a merge-on-conflict re-run clears any prior decision
      // state so a previously committed/declined demo proposal returns to a
      // clean pending card. created_at is refreshed so the reset proposals
      // sort newest-first (above accumulated health_flag cards).
      committed_at: null,
      rejected_at: null,
      edit_diff: null,
      outcome: null,
      created_at: new Date().toISOString(),
    },

    // (e) Rent payment — request_rent_payment, gate 'review', conf ~0.78.
    //     amountCents is a real money field on this schema. tenant id in routing.
    {
      id: PROP_RENT_PAYMENT,
      organization_id: GALAXY,
      property_id: OAKWOOD,
      worker_model: WORKER_MODEL,
      action_type: 'request_rent_payment',
      payload: {
        tenantRef: { tenantName: DEMO_TENANT_PAYMENT_NAME },
        amountCents: 187500,
      },
      routing: { tenantId: DEMO_TENANT_PAYMENT },
      reasoning:
        'Tenant asked for a card-payment option this cycle. Sending a ' +
        'one-time Stripe checkout link for the current rent lets them pay ' +
        'online — routed for your review because it is tenant-facing.',
      confidence: 0.78,
      context_fact_ids: [],
      gate_decision: 'review',
      status: 'proposed',
      // Reset fields: a merge-on-conflict re-run clears any prior decision
      // state so a previously committed/declined demo proposal returns to a
      // clean pending card. created_at is refreshed so the reset proposals
      // sort newest-first (above accumulated health_flag cards).
      committed_at: null,
      rejected_at: null,
      edit_diff: null,
      outcome: null,
      created_at: new Date().toISOString(),
    },
  ];
}

async function seedProposals() {
  // Idempotent-RESET: rather than skipping when the seed marker already
  // exists, every run merge-upserts the 5 demo proposals back to a clean
  // pending state. This guarantees a prior commit/decline can never leave the
  // owner-queue desk empty.

  // SAFETY GATE: re-read both sendable demo tenants from the DB and assert
  // their phone numbers are non-deliverable +1555 test numbers BEFORE we
  // insert any send_tenant_message / request_rent_payment proposal.
  const { data: demoTenants, error: tErr } = await admin
    .from('tenants')
    .select('id, full_name, phone_e164')
    .eq('organization_id', GALAXY)
    .in('id', [DEMO_TENANT_REMINDER, DEMO_TENANT_PAYMENT]);
  if (tErr) throw new Error(`demo tenant verify: ${tErr.message}`);
  const byId = new Map((demoTenants ?? []).map((t) => [t.id, t]));
  const reminder = byId.get(DEMO_TENANT_REMINDER);
  const payment = byId.get(DEMO_TENANT_PAYMENT);
  if (!reminder || !payment) {
    throw new Error(
      'SAFETY ABORT: demo tenants for sendable proposals were not found ' +
        'after seeding; refusing to attach sends to unknown contacts.',
    );
  }
  assertTestPhone(`reminder tenant (${reminder.full_name})`, reminder.phone_e164);
  assertTestPhone(`payment tenant (${payment.full_name})`, payment.phone_e164);

  const rows = buildProposalRows();
  // Merge-on-conflict (ignoreDuplicates defaults false) so existing demo
  // proposal rows are UPDATED — resetting committed_at/rejected_at/edit_diff/
  // outcome and refreshing created_at — rather than left in their mutated
  // state. Scoped to action_proposals only; portfolio rows keep ignoreDuplicates.
  const { error, count } = await admin
    .from('action_proposals')
    .upsert(rows, { onConflict: 'id', count: 'exact' });
  if (error) throw new Error(`upsert action_proposals: ${error.message}`);
  return {
    inserted: count ?? rows.length,
    ids: rows.map((r) => ({ id: r.id, action_type: r.action_type, gate: r.gate_decision })),
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding owner-queue proposals into ${SUPABASE_URL}`);
  try {
    const u = await seedDemoUnits();
    console.log(`  demo units:   +${u.inserted}`);
    const t = await seedDemoTenants();
    console.log(`  demo tenants: +${t.inserted}`);
    const l = await seedDemoLeases();
    console.log(`  demo leases:  +${l.inserted}`);
    const f = await seedMemoryFacts();
    console.log(`  memory_facts: +${f.inserted}`);
    console.log(
      `    fact ids: ${FACT_RENT_PATTERN}, ${FACT_WATER_HEATER_QUIRK}, ${FACT_MARKET_COMP}`,
    );

    const p = await seedProposals();
    if (p.skipped) {
      console.log('  action_proposals: already seeded (idempotent skip).');
    } else {
      console.log(`  action_proposals: +${p.inserted}`);
      for (const row of p.ids) {
        console.log(`    ${row.id}  ${row.action_type}  [${row.gate}]`);
      }
    }
    console.log('Done.');
  } catch (e) {
    console.error(`FAIL: ${e.message}`);
    process.exitCode = 1;
  }
}

main();
