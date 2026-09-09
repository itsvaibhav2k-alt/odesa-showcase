import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database } from '../../src/types/database';
import {
  ANON_KEY,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  createAdmin,
  provisionFreshLandlord,
  type FreshLandlord,
} from '../onboarding/helpers';
import { signIn } from './helpers';

const PASSWORD = 'wave1-integrity-password';

function assertLocalTarget(): void {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    throw new Error('Wave 1 integration gate requires local Supabase credentials');
  }
  const target = new URL(SUPABASE_URL);
  expect(['localhost', '127.0.0.1', '::1']).toContain(target.hostname);
  // 56321 = this repo's dedicated local port (moved off the shared 54321
  // default so sibling worktree stacks can't clobber each other).
  expect(target.port).toBe('56321');
  expect(process.env.SUPABASE_PROJECT_REF ?? '').toBe('');
}

function userClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function signedInClient(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message ?? 'no auth session');
  return userClient(data.session.access_token);
}

async function insertRows(
  admin: SupabaseClient<Database>,
  table: keyof Database['public']['Tables'],
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const inserted: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < rows.length; offset += 200) {
    // Test fixture spans several tables; the database remains the source of truth.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin.from(table) as any)
      .insert(rows.slice(offset, offset + 200))
      .select('*');
    if (error || !data) throw new Error(`insert ${table}: ${error?.message ?? 'no rows'}`);
    inserted.push(...(data as Array<Record<string, unknown>>));
  }
  return inserted;
}

async function exactCount(
  admin: SupabaseClient<Database>,
  table: keyof Database['public']['Tables'] | 'tenant_lease_requests',
  organizationId: string,
): Promise<number> {
  // tenant_lease_requests is migration-generated and intentionally not directly writable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error } = await (admin.from(table as any) as any)
    .select('organization_id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function rpc(
  client: SupabaseClient<Database>,
  args: Database['public']['Functions']['create_tenant_with_active_lease']['Args'],
) {
  return client.rpc('create_tenant_with_active_lease', args);
}

test.describe('Wave 1 portfolio completeness and lease integrity', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  let admin: SupabaseClient<Database>;
  let owner: FreshLandlord;
  let ownerClient: SupabaseClient<Database>;
  const extraUserIds: string[] = [];
  const extraOrgIds: string[] = [];

  test.beforeAll(async () => {
    assertLocalTarget();
    admin = createAdmin();
    owner = await provisionFreshLandlord('wave1');
    ownerClient = await signedInClient(owner.email, owner.password);
  });

  test.afterAll(async () => {
    if (!admin || !owner) return;
    const orgId = owner.organizationId;
    await owner.teardown();
    for (const userId of extraUserIds) await admin.auth.admin.deleteUser(userId).catch(() => {});
    for (const junkOrgId of extraOrgIds) await admin.from('organizations').delete().eq('id', junkOrgId);

    const tables = [
      'properties', 'units', 'tenants', 'leases', 'rent_events', 'work_orders',
      'tenant_lease_requests',
    ] as const;
    for (const table of tables) expect(await exactCount(admin, table, orgId)).toBe(0);
  });

  test('occupied and simultaneous submissions create no conflict or orphan, while duplicates replay', async () => {
    const [property] = await insertRows(admin, 'properties', [{
      organization_id: owner.organizationId,
      name: 'W1 Integrity House',
    }]);
    const units = await insertRows(admin, 'units', ['Occupied', 'Race', 'Replay'].map((label) => ({
      organization_id: owner.organizationId,
      property_id: property!.id,
      label,
    })));
    const propertyId = String(property!.id);
    const occupiedId = String(units[0]!.id);
    const raceId = String(units[1]!.id);
    const replayId = String(units[2]!.id);

    const occupiedTenant = await insertRows(admin, 'tenants', [{
      organization_id: owner.organizationId,
      full_name: 'Existing Resident',
      phone_e164: '+12025550001',
    }]);
    await insertRows(admin, 'leases', [{
      organization_id: owner.organizationId,
      unit_id: occupiedId,
      tenant_id: occupiedTenant[0]!.id,
      rent_amount: 1500,
      rent_due_day: 1,
      status: 'active',
    }]);

    const base = {
      p_property_id: propertyId,
      p_email: null,
      p_rent_amount: 1600,
      p_start_date: '2026-08-01',
    };
    const occupiedPhone = '+12025550002';
    const occupiedAttempt = await rpc(ownerClient, {
      ...base,
      p_unit_id: occupiedId,
      p_full_name: 'Rejected Occupant',
      p_phone_e164: occupiedPhone,
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(occupiedAttempt.error?.message).toContain('unit_not_vacant');
    expect(await exactCount(admin, 'leases', owner.organizationId)).toBe(1);
    const { count: rejectedTenantCount } = await admin
      .from('tenants').select('id', { count: 'exact', head: true })
      .eq('organization_id', owner.organizationId).eq('phone_e164', occupiedPhone);
    expect(rejectedTenantCount).toBe(0);

    const race = await Promise.all([
      rpc(ownerClient, {
        ...base, p_unit_id: raceId, p_full_name: 'Race Winner A',
        p_phone_e164: '+12025550003', p_idempotency_key: crypto.randomUUID(),
      }),
      rpc(ownerClient, {
        ...base, p_unit_id: raceId, p_full_name: 'Race Winner B',
        p_phone_e164: '+12025550004', p_idempotency_key: crypto.randomUUID(),
      }),
    ]);
    expect(race.filter((result) => !result.error)).toHaveLength(1);
    expect(race.filter((result) => result.error?.message.includes('unit_not_vacant'))).toHaveLength(1);
    const { count: raceLeaseCount } = await admin
      .from('leases').select('id', { count: 'exact', head: true })
      .eq('unit_id', raceId).eq('status', 'active');
    expect(raceLeaseCount).toBe(1);
    const { count: raceTenantCount } = await admin
      .from('tenants').select('id', { count: 'exact', head: true })
      .eq('organization_id', owner.organizationId)
      .in('phone_e164', ['+12025550003', '+12025550004']);
    expect(raceTenantCount).toBe(1);

    const replayKey = crypto.randomUUID();
    const replayArgs = {
      ...base, p_unit_id: replayId, p_full_name: 'Replay Resident',
      p_phone_e164: '+12025550005', p_idempotency_key: replayKey,
    };
    const replay = await Promise.all([rpc(ownerClient, replayArgs), rpc(ownerClient, replayArgs)]);
    expect(replay.every((result) => !result.error)).toBe(true);
    expect(replay.map((result) => result.data?.[0]?.idempotent).sort()).toEqual([false, true]);
    const { count: replayLeaseCount } = await admin
      .from('leases').select('id', { count: 'exact', head: true }).eq('unit_id', replayId);
    expect(replayLeaseCount).toBe(1);

    const duplicate = await insertRows(admin, 'tenants', [{
      organization_id: owner.organizationId,
      full_name: 'Invariant Probe',
      phone_e164: '+12025550006',
    }]);
    const { error: invariantError } = await admin.from('leases').insert({
      organization_id: owner.organizationId,
      unit_id: replayId,
      tenant_id: String(duplicate[0]!.id),
      rent_amount: 1,
      rent_due_day: 1,
      status: 'active',
    });
    expect(invariantError?.message).toContain('uq_leases_one_occupancy_per_unit');

    await admin.from('properties').delete().eq('id', propertyId);
    await admin.from('tenants').delete().eq('organization_id', owner.organizationId);
    expect(await exactCount(admin, 'leases', owner.organizationId)).toBe(0);
    expect(await exactCount(admin, 'tenants', owner.organizationId)).toBe(0);
  });

  test('database rejects every active/pending occupancy collision transition', async () => {
    const [property] = await insertRows(admin, 'properties', [{
      organization_id: owner.organizationId,
      name: 'W1 Occupancy Matrix House',
    }]);
    const transitions = [
      ['active', 'active'],
      ['active', 'pending'],
      ['pending', 'active'],
      ['pending', 'pending'],
    ] as const;
    const units = await insertRows(admin, 'units', transitions.map(([from, to]) => ({
      organization_id: owner.organizationId,
      property_id: property!.id,
      label: `${from}-to-${to}`,
    })));
    const tenants = await insertRows(admin, 'tenants', Array.from({ length: 8 }, (_, i) => ({
      organization_id: owner.organizationId,
      full_name: `Occupancy Matrix ${i}`,
      phone_e164: `+12025551${String(i).padStart(3, '0')}`,
    })));

    for (const [index, [from, to]] of transitions.entries()) {
      await insertRows(admin, 'leases', [{
        organization_id: owner.organizationId,
        unit_id: units[index]!.id,
        tenant_id: tenants[index * 2]!.id,
        rent_amount: 1000,
        rent_due_day: 1,
        status: from,
      }]);
      const { error } = await admin.from('leases').insert({
        organization_id: owner.organizationId,
        unit_id: String(units[index]!.id),
        tenant_id: String(tenants[index * 2 + 1]!.id),
        rent_amount: 1000,
        rent_due_day: 1,
        status: to,
      });
      expect(error?.message, `${from} -> ${to}`).toContain(
        'uq_leases_one_occupancy_per_unit',
      );
    }

    await admin.from('properties').delete().eq('id', String(property!.id));
    await admin.from('tenants').delete().eq('organization_id', owner.organizationId);
    expect(await exactCount(admin, 'leases', owner.organizationId)).toBe(0);
    expect(await exactCount(admin, 'tenants', owner.organizationId)).toBe(0);
  });

  test('manager authorization is denied at the RPC boundary with zero writes', async () => {
    const stamp = Date.now();
    const email = `wave1.manager.${stamp}@odesa.test`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email, password: PASSWORD, email_confirm: true,
      user_metadata: { organization_name: `Wave1 manager junk ${stamp}` },
    });
    if (error || !created.user) throw new Error(error?.message ?? 'manager create failed');
    extraUserIds.push(created.user.id);
    const { data: managerRow } = await admin.from('users')
      .select('organization_id').eq('id', created.user.id).single();
    if (managerRow) extraOrgIds.push(managerRow.organization_id);
    await admin.from('users').update({ organization_id: owner.organizationId, role: 'manager' })
      .eq('id', created.user.id);
    const manager = await signedInClient(email, PASSWORD);
    const [property] = await insertRows(admin, 'properties', [{
      organization_id: owner.organizationId, name: 'Auth House',
    }]);
    const [unit] = await insertRows(admin, 'units', [{
      organization_id: owner.organizationId, property_id: property!.id, label: 'A',
    }]);
    const denied = await rpc(manager, {
      p_property_id: String(property!.id), p_unit_id: String(unit!.id),
      p_full_name: 'Denied Resident', p_phone_e164: '+12025550007', p_email: null,
      p_rent_amount: 1000, p_start_date: null, p_idempotency_key: crypto.randomUUID(),
    });
    expect(denied.error?.message).toContain('forbidden');
    expect(await exactCount(admin, 'tenants', owner.organizationId)).toBe(0);
    expect(await exactCount(admin, 'leases', owner.organizationId)).toBe(0);
    await admin.from('properties').delete().eq('id', property!.id as string);
  });

  test('UI and DB reconcile exactly at 200 properties and 1,200 related rows', async ({ page }) => {
    const started = performance.now();
    const properties = await insertRows(admin, 'properties', Array.from({ length: 200 }, (_, i) => ({
      organization_id: owner.organizationId,
      name: i === 199 ? 'ZZZ-LAST-PROPERTY-SENTINEL' : `W1 Property ${String(i).padStart(3, '0')}`,
      address_city: 'Scale City', address_state: 'VA',
    })));
    const units = await insertRows(admin, 'units', properties.flatMap((property, propertyIndex) =>
      Array.from({ length: 6 }, (_, unitIndex) => ({
        organization_id: owner.organizationId,
        property_id: property.id,
        label: propertyIndex === 199 && unitIndex === 5
          ? 'LAST-UNIT-SENTINEL'
          : `Unit ${unitIndex + 1}`,
      })),
    ));
    const tenants = await insertRows(admin, 'tenants', units.map((_, i) => ({
      organization_id: owner.organizationId,
      full_name: i === 1199 ? 'LAST-TENANT-SENTINEL' : `W1 Tenant ${String(i).padStart(4, '0')}`,
      phone_e164: `+1202555${String(i).padStart(4, '0')}`,
    })));
    const leases = await insertRows(admin, 'leases', units.map((unit, i) => ({
      organization_id: owner.organizationId, unit_id: unit.id, tenant_id: tenants[i]!.id,
      rent_amount: 1500, rent_due_day: 1, start_date: '2026-01-01',
      end_date: '2027-12-31', status: 'active',
    })));
    const month = new Date().toISOString().slice(0, 7) + '-01';
    await insertRows(admin, 'rent_events', leases.map((lease) => ({
      organization_id: owner.organizationId, lease_id: lease.id, cycle_month: month,
      amount_due: 1500, amount_paid: 1500, status: 'paid', due_date: month,
    })));
    await insertRows(admin, 'work_orders', units.map((unit, i) => ({
      organization_id: owner.organizationId, unit_id: unit.id, tenant_id: tenants[i]!.id,
      category: 'general', urgency: 'routine', status: 'open', description: `W1 ${i}`,
    })));
    const provisionMs = Math.round(performance.now() - started);

    for (const table of ['properties', 'units', 'tenants', 'leases', 'rent_events', 'work_orders'] as const) {
      expect(await exactCount(admin, table, owner.organizationId)).toBe(table === 'properties' ? 200 : 1200);
    }

    const signInStarted = performance.now();
    await signIn(page, owner);
    const signInMs = Math.round(performance.now() - signInStarted);
    const renderStarted = performance.now();
    await page.goto('/properties');
    await expect(page.getByTestId('properties-page')).toBeVisible();
    const renderMs = Math.round(performance.now() - renderStarted);
    await expect(page.getByTestId('portfolio-property-count')).toHaveText('200');
    await expect(page.getByTestId('portfolio-unit-count')).toHaveText('1200');
    await expect(page.getByTestId('portfolio-occupancy')).toHaveText('100%');
    await expect(page.getByTestId('portfolio-mrr')).toHaveText('$1,800,000');
    await expect(page.getByRole('link', { name: /Tenants 1200/ })).toBeVisible();

    const cards = page.locator('.property-rail-row');
    await expect(cards).toHaveCount(200);
    const cardText = await cards.allTextContents();
    expect(cardText.every((text) => text.includes('6/6'))).toBe(true);

    const search = page.getByPlaceholder('Search property, unit, tenant…');
    for (const sentinel of ['ZZZ-LAST-PROPERTY-SENTINEL', 'LAST-UNIT-SENTINEL', 'LAST-TENANT-SENTINEL']) {
      await search.fill(sentinel);
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText('ZZZ-LAST-PROPERTY-SENTINEL');
    }
    console.log(JSON.stringify({ wave1TimingsMs: { provisionMs, signInMs, renderMs } }));
  });
});
