#!/usr/bin/env node
/**
 * Manual/backfill entrypoint for the monthly rent-cycle generator.
 *
 * Generates one month's `rent_events` for every ACTIVE lease whose term
 * overlaps the period — full rent_amount, status 'pending', due on
 * rent_due_day clamped to the month's length. Structurally idempotent:
 * the uq_rent_events_lease_cycle unique index on (lease_id, cycle_month)
 * means re-runs only ever skip.
 *
 * This is a standalone port of src/lib/rent/generate-cycle.ts (the
 * repo's .mjs scripts don't import from src/). Keep the two in sync —
 * the unit tests in src/lib/rent/__tests__/generate-cycle.test.ts pin
 * the row shape.
 *
 * Reads .env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (or pass --env-file).
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-rent-cycle.mjs [YYYY-MM]
 *
 *   YYYY-MM defaults to the current month, e.g.:
 *   node --env-file=.env.local scripts/generate-rent-cycle.mjs 2026-06
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
// Period handling
// ---------------------------------------------------------------------------

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Core — mirrors generateRentCycle in src/lib/rent/generate-cycle.ts
// ---------------------------------------------------------------------------

async function generateRentCycle(period) {
  const match = PERIOD_PATTERN.exec(period);
  if (!match) {
    throw new Error(`invalid period "${period}" — expected YYYY-MM`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const cycleMonth = `${period}-01`;
  const periodEnd = `${period}-${pad2(daysInMonth(year, month))}`;

  const { data: activeLeases, error: leaseError } = await admin
    .from('leases')
    .select('id, organization_id, rent_amount, rent_due_day, start_date, end_date')
    .eq('status', 'active');
  if (leaseError) throw new Error(`lease query failed: ${leaseError.message}`);

  const all = activeLeases ?? [];
  const inTerm = all.filter(
    (l) =>
      (l.start_date == null || l.start_date <= periodEnd) &&
      (l.end_date == null || l.end_date >= cycleMonth),
  );
  const skippedOutOfTerm = all.length - inTerm.length;

  const billable = inTerm.filter((l) => l.rent_amount != null);
  const skippedNoAmount = inTerm.length - billable.length;

  let existingIds = new Set();
  if (billable.length > 0) {
    const { data: existing, error: existingError } = await admin
      .from('rent_events')
      .select('lease_id')
      .eq('cycle_month', cycleMonth)
      .in(
        'lease_id',
        billable.map((l) => l.id),
      );
    if (existingError) {
      throw new Error(`existing-cycle lookup failed: ${existingError.message}`);
    }
    existingIds = new Set((existing ?? []).map((r) => r.lease_id));
  }

  let created = 0;
  let skipped = 0;
  for (const lease of billable) {
    if (existingIds.has(lease.id)) {
      skipped += 1;
      continue;
    }
    const dueDay = Math.min(Math.max(lease.rent_due_day || 1, 1), daysInMonth(year, month));
    const { error: insertError } = await admin.from('rent_events').insert({
      organization_id: lease.organization_id,
      lease_id: lease.id,
      cycle_month: cycleMonth,
      amount_due: lease.rent_amount,
      amount_paid: 0,
      status: 'pending',
      due_date: `${year}-${pad2(month)}-${pad2(dueDay)}`,
    });
    if (insertError) {
      if (insertError.code === '23505') {
        skipped += 1; // concurrent generator won the race — already done
        continue;
      }
      throw new Error(`insert failed for lease ${lease.id}: ${insertError.message}`);
    }
    created += 1;
  }

  return { period, cycleMonth, leases: inTerm.length, created, skipped, skippedNoAmount, skippedOutOfTerm };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const arg = process.argv[2];
  const period = arg ?? currentPeriod();
  if (!PERIOD_PATTERN.test(period)) {
    console.error(`Invalid period "${period}" — expected YYYY-MM (e.g. 2026-06)`);
    process.exit(1);
  }

  console.log(`Generating rent cycle for ${period} (cycle_month ${period}-01)…`);
  const result = await generateRentCycle(period);

  console.log('');
  console.log(`  active leases in term : ${result.leases}`);
  console.log(`  created               : ${result.created}`);
  console.log(`  skipped (existing)    : ${result.skipped}`);
  console.log(`  skipped (no amount)   : ${result.skippedNoAmount}`);
  console.log(`  skipped (out of term) : ${result.skippedOutOfTerm}`);
  console.log('');
  console.log(
    result.created > 0
      ? `Done — ${result.created} rent_event(s) created for ${result.period}.`
      : `Done — nothing to create for ${result.period} (idempotent re-run or no eligible leases).`,
  );
}

main().catch((err) => {
  console.error(`generate-rent-cycle failed: ${err.message}`);
  process.exit(1);
});
