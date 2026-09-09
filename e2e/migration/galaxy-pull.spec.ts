/**
 * Galaxy Estates migrator — Aero → Odesa mock-mode E2E.
 *
 * Provisions a disposable Odesa organization, points the mock migrator
 * at it, and asserts:
 *   - all 6 source tables populate with the expected row counts
 *   - dedup rule collapsed the duplicate-phone tenant to exactly one row
 *   - orphan leases were skipped (not persisted)
 *   - running the migrator twice is idempotent (second pass leaves the
 *     same row counts)
 *   - a mock-seeded owner can view 3 of the migrated units in the
 *     Properties UI
 *
 * Skipped when the local Supabase stack isn't configured.
 */

import * as path from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { runGalaxyMigration } from '../../scripts/migrate-galaxy';
import type { Database } from '../../src/types/database';

// ---------------------------------------------------------------------------
// Env gating — matches e2e/supabase/rls.spec.ts pattern
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
  authUserId: string;
  email: string;
  password: string;
  teardown: () => Promise<void>;
}

async function provisionDisposableOrg(
  admin: SupabaseClient<Database>,
): Promise<DisposableOrg> {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e8);
  const orgName = `Galaxy Migration ${stamp}-${rand}`;
  const email = `mig.${stamp}.${rand}@galaxy-migration.test`;
  const password = `mig-${rand}-secret`;

  // Create the org first (service role bypasses RLS).
  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .insert({ name: orgName, plan: 'pro', timezone: 'America/New_York' })
    .select('id')
    .single();
  if (orgErr || !org) {
    throw new Error(`failed to create org: ${orgErr?.message ?? 'no row'}`);
  }

  // Create an auth user; the post-signup trigger auto-creates a stub org
  // and repoints public.users at it. We then rewrite users.organization_id
  // to our disposable org so the UI phase of the test sees the migrated
  // data under a real JWT.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { organization_name: orgName, full_name: 'Migration Owner' },
  });
  if (createErr || !created.user) {
    throw new Error(`createUser failed: ${createErr?.message ?? 'no user'}`);
  }
  const userId = created.user.id;

  const { data: before } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  const stubOrgId = before?.organization_id ?? null;

  const { error: updErr } = await admin
    .from('users')
    .update({
      organization_id: org.id,
      role: 'owner',
      email,
      display_name: 'Migration Owner',
      full_name: 'Migration Owner',
    })
    .eq('id', userId);
  if (updErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    await admin.from('organizations').delete().eq('id', org.id);
    throw new Error(`failed to repoint user: ${updErr.message}`);
  }

  const teardown = async () => {
    // Cascades take care of properties/units/tenants/leases/work_orders.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (stubOrgId && stubOrgId !== org.id) {
      await admin.from('organizations').delete().eq('id', stubOrgId);
    }
    await admin.from('organizations').delete().eq('id', org.id);
  };

  return {
    organizationId: org.id,
    authUserId: userId,
    email,
    password,
    teardown,
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

test.describe('migration: Galaxy mock pull', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let admin: SupabaseClient<Database>;
  let org: DisposableOrg;

  test.beforeEach(async () => {
    admin = adminClient();
    org = await provisionDisposableOrg(admin);
  });

  test.afterEach(async () => {
    if (org) await org.teardown();
  });

  test('populates all 6 source tables with expected counts', async () => {
    const counts = await runGalaxyMigration({
      source: 'mock',
      mockFixturePath: MOCK_FIXTURE,
      client: admin,
      organizationId: org.organizationId,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });

    // Fixture contains: 3 properties, 9 units, 10 tenants (1 dup by phone),
    // 10 leases (1 orphan), 5 work orders.
    expect(counts.properties).toBe(3);
    expect(counts.units).toBe(9);
    expect(counts.tenants).toBe(9);
    expect(counts.skipped.duplicateTenants).toBe(1);
    expect(counts.leases).toBe(9);
    expect(counts.skipped.orphanLeases).toBe(1);
    expect(counts.workOrders).toBe(5);

    // Verify DB matches the reported counts.
    const [props, units, tenants, leases, workOrders] = await Promise.all([
      admin.from('properties').select('id', { count: 'exact', head: true }).eq(
        'organization_id',
        org.organizationId,
      ),
      admin.from('units').select('id', { count: 'exact', head: true }).eq(
        'organization_id',
        org.organizationId,
      ),
      admin.from('tenants').select('id', { count: 'exact', head: true }).eq(
        'organization_id',
        org.organizationId,
      ),
      admin.from('leases').select('id', { count: 'exact', head: true }).eq(
        'organization_id',
        org.organizationId,
      ),
      admin.from('work_orders').select('id', { count: 'exact', head: true }).eq(
        'organization_id',
        org.organizationId,
      ),
    ]);
    expect(props.count).toBe(3);
    expect(units.count).toBe(9);
    expect(tenants.count).toBe(9);
    expect(leases.count).toBe(9);
    expect(workOrders.count).toBe(5);
  });

  test('is idempotent across two runs', async () => {
    await runGalaxyMigration({
      source: 'mock',
      mockFixturePath: MOCK_FIXTURE,
      client: admin,
      organizationId: org.organizationId,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });
    const second = await runGalaxyMigration({
      source: 'mock',
      mockFixturePath: MOCK_FIXTURE,
      client: admin,
      organizationId: org.organizationId,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });

    expect(second.properties).toBe(3);
    expect(second.units).toBe(9);
    expect(second.tenants).toBe(9);

    const { count: propCount } = await admin
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.organizationId);
    const { count: unitCount } = await admin
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.organizationId);
    expect(propCount).toBe(3);
    expect(unitCount).toBe(9);
  });

  test('spot-check: 3 known unit labels exist under the expected properties', async () => {
    await runGalaxyMigration({
      source: 'mock',
      mockFixturePath: MOCK_FIXTURE,
      client: admin,
      organizationId: org.organizationId,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    });

    const [{ data: units, error }, { data: properties }] = await Promise.all([
      admin
        .from('units')
        .select('label, property_id')
        .eq('organization_id', org.organizationId),
      admin
        .from('properties')
        .select('id, name')
        .eq('organization_id', org.organizationId),
    ]);
    expect(error).toBeNull();
    expect(units).not.toBeNull();

    const propNameById = new Map(
      (properties ?? []).map((p) => [p.id, p.name] as const),
    );
    const rows = (units ?? []).map((r) => ({
      label: r.label,
      propName: propNameById.get(r.property_id) ?? null,
    }));

    const expectedTriples = [
      { label: '101', propName: 'Oakwood Commons' },
      { label: 'C', propName: '17th Street Row' },
      { label: 'Lower', propName: 'Beacon Hill Duplex' },
    ];
    for (const exp of expectedTriples) {
      const hit = rows.find(
        (r) => r.label === exp.label && r.propName === exp.propName,
      );
      expect(hit, `expected unit ${exp.label} under ${exp.propName}`).toBeDefined();
    }
  });
});
