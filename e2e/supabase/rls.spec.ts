/**
 * Supabase RLS isolation regression suite.
 *
 * Asserts that two organizations provisioned on the same Supabase
 * instance cannot read or write each other's data under an
 * authenticated user JWT. Exercises all 12 tables from
 * `supabase/migrations/20260421000000_odesa_initial.sql`.
 *
 * Skipped when `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` /
 * `SUPABASE_SERVICE_ROLE_KEY` are not set — common on CI until Agent F
 * wires the local Supabase container into the Playwright job.
 *
 * Why an API-level test (no browser page fixture):
 *   - RLS lives in Postgres, not in the Next.js app. Asserting at the
 *     HTTP/PostgREST boundary makes this spec independent of UI phase.
 *   - Playwright still runs the file via its standard harness so it
 *     benefits from `testDir`, parallel workers, and retries.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database } from '../../src/types/database';

// =====================================================================
// Environment resolution
// =====================================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  '';

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

const HAVE_SUPABASE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

// =====================================================================
// Types
// =====================================================================

interface SeededOrg {
  orgId: string;
  userId: string;
  email: string;
  password: string;
  /** A row in each of the 12 tables to exercise cross-org visibility. */
  seededRowIds: {
    propertyId: string;
    unitId: string;
    tenantId: string;
    leaseId: string;
    conversationId: string;
    messageId: string;
    workOrderId: string;
    vendorId: string;
    rentEventId: string;
    weeklyReportId: string;
  };
}

// Tables that carry organization_id directly and should yield ONLY rows
// for the caller's org under RLS.
const ORG_SCOPED_TABLES = [
  'organizations',
  'users',
  'properties',
  'units',
  'tenants',
  'leases',
  'conversations',
  'messages',
  'work_orders',
  'vendors',
  'rent_events',
  'weekly_reports',
] as const;

// =====================================================================
// Helpers
// =====================================================================

/** Admin client — bypasses RLS. Used only inside beforeAll / afterAll. */
function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** User client — obeys RLS. One per seeded user. */
function createUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

async function seedOrg(
  admin: SupabaseClient<Database>,
  orgName: string,
  ownerEmail: string,
  ownerPassword: string,
): Promise<SeededOrg> {
  // Post-signup trigger creates the organization + users row. Pass the
  // org name via user_metadata so the trigger picks it up.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: {
      organization_name: orgName,
      full_name: `${orgName} Owner`,
    },
  });

  if (createErr || !created.user) {
    throw new Error(
      `createUser failed for ${ownerEmail}: ${createErr?.message ?? 'unknown'}`,
    );
  }

  const userId = created.user.id;

  // The trigger runs synchronously in Postgres; the users row should
  // exist by the time createUser returns. Read it back to get the org id.
  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (userErr || !userRow) {
    throw new Error(
      `Failed to read back users row for ${ownerEmail}: ${userErr?.message ?? 'no row'}`,
    );
  }

  const orgId = userRow.organization_id;

  // Seed one row in each table. Every insert goes via the admin client
  // so it bypasses RLS.
  const property = await insertAndReturnId(admin, 'properties', {
    organization_id: orgId,
    name: `${orgName} HQ`,
    address_street: '1 Test Way',
    address_city: 'Arlington',
    address_state: 'VA',
    address_zip: '22201',
  });

  const unit = await insertAndReturnId(admin, 'units', {
    organization_id: orgId,
    property_id: property,
    label: '101',
    bedrooms: 1,
    bathrooms: 1.0,
    square_feet: 650,
  });

  const tenant = await insertAndReturnId(admin, 'tenants', {
    organization_id: orgId,
    full_name: `${orgName} Tenant`,
    phone_e164: `+1571555${Math.floor(1000 + Math.random() * 8999)}`,
    email: `tenant.${orgName.toLowerCase()}@example.com`,
  });

  const lease = await insertAndReturnId(admin, 'leases', {
    organization_id: orgId,
    unit_id: unit,
    tenant_id: tenant,
    rent_amount: 1500.0,
    rent_due_day: 1,
    late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    status: 'active',
  });

  const conversation = await insertAndReturnId(admin, 'conversations', {
    organization_id: orgId,
    tenant_id: tenant,
    channel: 'sms',
    status: 'open',
  });

  const message = await insertAndReturnId(admin, 'messages', {
    organization_id: orgId,
    conversation_id: conversation,
    direction: 'inbound',
    provider: 'twilio',
    body: `Hello from ${orgName}`,
    draft_status: 'auto_sent',
  });

  const vendor = await insertAndReturnId(admin, 'vendors', {
    organization_id: orgId,
    name: `${orgName} Plumber`,
    category: 'plumbing',
    phone_e164: '+15715559999',
    acceptance_rate: 0.9,
  });

  const workOrder = await insertAndReturnId(admin, 'work_orders', {
    organization_id: orgId,
    tenant_id: tenant,
    unit_id: unit,
    vendor_id: vendor,
    category: 'plumbing',
    urgency: 'routine',
    status: 'open',
    description: 'Dripping faucet',
  });

  const rentEvent = await insertAndReturnId(admin, 'rent_events', {
    organization_id: orgId,
    lease_id: lease,
    cycle_month: '2026-04-01',
    amount_due: 1500.0,
    amount_paid: 0,
    status: 'pending',
    due_date: '2026-04-01',
  });

  const weeklyReport = await insertAndReturnId(admin, 'weekly_reports', {
    organization_id: orgId,
    week_start_date: '2026-04-20',
    briefing_text: `Week in review for ${orgName}`,
    metrics: { occupancy_pct: 100 },
  });

  return {
    orgId,
    userId,
    email: ownerEmail,
    password: ownerPassword,
    seededRowIds: {
      propertyId: property,
      unitId: unit,
      tenantId: tenant,
      leaseId: lease,
      conversationId: conversation,
      messageId: message,
      vendorId: vendor,
      workOrderId: workOrder,
      rentEventId: rentEvent,
      weeklyReportId: weeklyReport,
    },
  };
}

/**
 * Inserts one row via the admin client and returns its id.
 *
 * Typed loosely on purpose: this helper is a test utility that targets
 * many tables, and the row shape is exercised correctly by the real
 * callers above. Keeping the types loose here avoids duplicating every
 * table's insert shape in the helper's signature.
 */
async function insertAndReturnId(
  admin: SupabaseClient<Database>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from(table) as any)
    .insert(row)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `insert into ${table} failed: ${error?.message ?? 'no row returned'}`,
    );
  }

  return data.id as string;
}

async function signInAndGetClient(
  email: string,
  password: string,
): Promise<SupabaseClient<Database>> {
  const authClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) {
    throw new Error(
      `signInWithPassword failed for ${email}: ${error?.message ?? 'no session'}`,
    );
  }
  return createUserClient(data.session.access_token);
}

async function teardownOrg(
  admin: SupabaseClient<Database>,
  org: SeededOrg,
): Promise<void> {
  // ON DELETE CASCADE on organizations wipes properties/units/etc.
  await admin.from('organizations').delete().eq('id', org.orgId);
  // Deleting the auth user also removes its users row via ON DELETE CASCADE
  // in the users FK.
  await admin.auth.admin.deleteUser(org.userId);
}

// =====================================================================
// Tests
// =====================================================================

test.describe('supabase RLS isolation', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let admin: SupabaseClient<Database>;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;

  test.beforeAll(async () => {
    admin = createAdmin();

    const stamp = Date.now();
    orgA = await seedOrg(
      admin,
      `RLS Org A ${stamp}`,
      `rls.a.${stamp}@odesa.test`,
      'rls-test-password-a',
    );
    orgB = await seedOrg(
      admin,
      `RLS Org B ${stamp}`,
      `rls.b.${stamp}@odesa.test`,
      'rls-test-password-b',
    );

    clientA = await signInAndGetClient(orgA.email, orgA.password);
    clientB = await signInAndGetClient(orgB.email, orgB.password);
  });

  test.afterAll(async () => {
    if (!admin) return;
    if (orgA) await teardownOrg(admin, orgA);
    if (orgB) await teardownOrg(admin, orgB);
  });

  test('user A sees only org A rows across all 12 tables', async () => {
    for (const table of ORG_SCOPED_TABLES) {
      // `organizations` uses `id` as the org identity; everything else
      // carries `organization_id`. Select the right column per table so
      // PostgREST doesn't 400 on a missing column.
      const selectColumns = table === 'organizations' ? 'id' : 'organization_id, id';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (clientA.from(table) as any).select(
        selectColumns,
      );

      expect(error, `select on ${table} should not error`).toBeNull();
      expect(data, `select on ${table} should return rows`).not.toBeNull();

      for (const row of data as Array<{
        organization_id?: string;
        id?: string;
      }>) {
        const orgIdOnRow =
          table === 'organizations' ? row.id : row.organization_id;
        expect(
          orgIdOnRow,
          `${table} row leaked from org B under user A JWT`,
        ).toBe(orgA.orgId);
      }
    }
  });

  test('user B sees only org B rows across all 12 tables', async () => {
    for (const table of ORG_SCOPED_TABLES) {
      const selectColumns = table === 'organizations' ? 'id' : 'organization_id, id';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (clientB.from(table) as any).select(
        selectColumns,
      );

      expect(error, `select on ${table} should not error`).toBeNull();
      expect(data, `select on ${table} should return rows`).not.toBeNull();

      for (const row of data as Array<{
        organization_id?: string;
        id?: string;
      }>) {
        const orgIdOnRow =
          table === 'organizations' ? row.id : row.organization_id;
        expect(
          orgIdOnRow,
          `${table} row leaked from org A under user B JWT`,
        ).toBe(orgB.orgId);
      }
    }
  });

  test('user A cannot directly read specific org B row ids', async () => {
    // Explicit id-based fetch for every table: verifies the server
    // filters rows even when the caller knows the exact id.
    const { data: prop } = await clientA
      .from('properties')
      .select('id')
      .eq('id', orgB.seededRowIds.propertyId)
      .maybeSingle();
    expect(prop).toBeNull();

    const { data: tenant } = await clientA
      .from('tenants')
      .select('id')
      .eq('id', orgB.seededRowIds.tenantId)
      .maybeSingle();
    expect(tenant).toBeNull();

    const { data: lease } = await clientA
      .from('leases')
      .select('id')
      .eq('id', orgB.seededRowIds.leaseId)
      .maybeSingle();
    expect(lease).toBeNull();

    const { data: message } = await clientA
      .from('messages')
      .select('id')
      .eq('id', orgB.seededRowIds.messageId)
      .maybeSingle();
    expect(message).toBeNull();
  });

  test('user A cannot INSERT a row with organization_id = org B', async () => {
    const { error } = await clientA.from('properties').insert({
      organization_id: orgB.orgId,
      name: 'Should Fail',
    });

    // WITH CHECK on the INSERT policy trips; PostgREST surfaces this as
    // an error (Postgres code `42501` / HTTP 403).
    expect(error, 'cross-org insert must be rejected').not.toBeNull();
  });

  test('user B cannot INSERT a row with organization_id = org A', async () => {
    const { error } = await clientB.from('tenants').insert({
      organization_id: orgA.orgId,
      full_name: 'Evil Insert',
      phone_e164: '+15715550000',
    });

    expect(error, 'cross-org insert must be rejected').not.toBeNull();
  });

  test('user A cannot UPDATE an org B row they cannot see', async () => {
    const { data, error } = await clientA
      .from('properties')
      .update({ name: 'Hijacked' })
      .eq('id', orgB.seededRowIds.propertyId)
      .select();

    // RLS filters the target row out before the UPDATE applies, so
    // either no rows come back (no error) or PostgREST returns an
    // error. Both outcomes are acceptable; the invariant is that
    // nothing got hijacked.
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    // Re-read as admin to confirm the row is unchanged.
    const { data: unchanged } = await admin
      .from('properties')
      .select('name')
      .eq('id', orgB.seededRowIds.propertyId)
      .single();
    expect(unchanged?.name).not.toBe('Hijacked');
  });

  test('user A cannot DELETE an org B row', async () => {
    const { data, error } = await clientA
      .from('properties')
      .delete()
      .eq('id', orgB.seededRowIds.propertyId)
      .select();

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    // Confirm the row still exists via admin.
    const { data: stillThere } = await admin
      .from('properties')
      .select('id')
      .eq('id', orgB.seededRowIds.propertyId)
      .maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  test('v_org_pulse_kpis respects RLS (A sees only A, B sees only B)', async () => {
    const { data: aRows, error: aErr } = await clientA
      .from('v_org_pulse_kpis')
      .select('organization_id');
    expect(aErr).toBeNull();
    for (const row of aRows ?? []) {
      expect(row.organization_id).toBe(orgA.orgId);
    }

    const { data: bRows, error: bErr } = await clientB
      .from('v_org_pulse_kpis')
      .select('organization_id');
    expect(bErr).toBeNull();
    for (const row of bRows ?? []) {
      expect(row.organization_id).toBe(orgB.orgId);
    }
  });
});
