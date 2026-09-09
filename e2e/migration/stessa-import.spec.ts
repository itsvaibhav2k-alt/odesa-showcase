/**
 * Stessa rent-roll import — CSV → leases.rent_amount + rent_due_day.
 *
 * Flow:
 *   1. Provision a disposable org.
 *   2. Run the Galaxy mock migrator so leases exist.
 *   3. Run the Stessa importer against the sample CSV.
 *   4. Assert rent_amount + rent_due_day on matching leases match the CSV,
 *      and that the "Ghost Tenant / unit 999" row is reported as skipped.
 *
 * Skipped when the local Supabase stack isn't configured.
 */

import * as path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { runGalaxyMigration } from '../../scripts/migrate-galaxy';
import { runStessaImport } from '../../scripts/import-stessa-csv';
import type { Database } from '../../src/types/database';

// ---------------------------------------------------------------------------
// Env gating
// ---------------------------------------------------------------------------

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const HAVE_SUPABASE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

const MOCK_FIXTURE = path.resolve(
  process.cwd(),
  'e2e/fixtures/aero-mock-dump.json',
);
const STESSA_FIXTURE = path.resolve(
  process.cwd(),
  'e2e/fixtures/stessa-sample.csv',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface DisposableOrg {
  organizationId: string;
  teardown: () => Promise<void>;
}

async function provisionDisposableOrg(
  admin: SupabaseClient<Database>,
): Promise<DisposableOrg> {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e8);
  const orgName = `Stessa Import ${stamp}-${rand}`;

  const { data: org, error } = await admin
    .from('organizations')
    .insert({ name: orgName, plan: 'pro', timezone: 'America/New_York' })
    .select('id')
    .single();
  if (error || !org) {
    throw new Error(`failed to create org: ${error?.message ?? 'no row'}`);
  }

  const teardown = async () => {
    await admin.from('organizations').delete().eq('id', org.id);
  };

  return { organizationId: org.id, teardown };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

test.describe('migration: Stessa CSV import', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let admin: SupabaseClient<Database>;
  let org: DisposableOrg;

  test.beforeEach(async () => {
    admin = adminClient();
    org = await provisionDisposableOrg(admin);
    await runGalaxyMigration({
      source: 'mock',
      mockFixturePath: MOCK_FIXTURE,
      client: admin,
      organizationId: org.organizationId,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
  });

  test.afterEach(async () => {
    if (org) await org.teardown();
  });

  test('updates rent_amount and rent_due_day on matching leases', async () => {
    const result = await runStessaImport({
      csvPath: STESSA_FIXTURE,
      organizationId: org.organizationId,
      client: admin,
      logger: { info: () => {}, warn: () => {} },
    });

    // CSV has 10 rows; 9 should match (unit 999 / Ghost Tenant is a miss).
    // The expired "Upper" lease (Leon Whitaker) is excluded by the
    // status = active|pending filter, so that row is also skipped.
    expect(result.rowsParsed).toBe(10);
    expect(result.leasesUpdated).toBe(8);
    expect(result.skipped.length).toBe(2);
    expect(
      result.skipped.some((s) => s.row.tenant === 'Ghost Tenant'),
    ).toBe(true);
    expect(
      result.skipped.some((s) => s.row.tenant === 'Leon Whitaker'),
    ).toBe(true);

    // Spot-check three leases against the CSV values.
    const { data: leases, error } = await admin
      .from('leases')
      .select(
        'rent_amount, rent_due_day, unit:units(label), tenant:tenants(full_name)',
      )
      .eq('organization_id', org.organizationId);
    expect(error).toBeNull();
    expect(leases).not.toBeNull();

    const byUnitAndTenant = new Map<string, { rent: number; dueDay: number }>();
    for (const l of leases ?? []) {
      const unit = Array.isArray(l.unit) ? l.unit[0] : l.unit;
      const tenant = Array.isArray(l.tenant) ? l.tenant[0] : l.tenant;
      if (!unit?.label || !tenant?.full_name) continue;
      byUnitAndTenant.set(`${unit.label}|${tenant.full_name}`, {
        rent: Number(l.rent_amount),
        dueDay: l.rent_due_day,
      });
    }

    const gavin = byUnitAndTenant.get('204|Gavin Huang');
    expect(gavin?.rent).toBeCloseTo(2450, 2);
    expect(gavin?.dueDay).toBe(5);

    const jessica = byUnitAndTenant.get('C|Jessica Kim');
    expect(jessica?.rent).toBeCloseTo(2950, 2);
    expect(jessica?.dueDay).toBe(3);

    const marcus = byUnitAndTenant.get('101|Marcus J. Alvarez');
    expect(marcus?.rent).toBeCloseTo(2150, 2);
    expect(marcus?.dueDay).toBe(1);
  });
});
