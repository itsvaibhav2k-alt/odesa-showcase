/**
 * Supabase role-matrix regression suite.
 *
 * Companion to `rls.spec.ts` (org isolation). This file asserts the
 * ROLE layer added by
 * `supabase/migrations/20260710012858_role_guard_sensitive_writes.sql`:
 *
 *   - UPDATE rent_events / leases and INSERT rent_payments are
 *     owner-only (manager/va are read + drafts).
 *   - The users escalation guard: nobody self-escalates role, nobody
 *     moves themselves to another org; owners may change a member's
 *     role but never anyone's organization_id (service-only).
 *
 * PostgREST behavior notes baked into the assertions:
 *   - RLS UPDATE violations usually return 0 rows silently (the USING
 *     clause filters the row out), so denial tests assert on the
 *     post-state read via the admin client, not only on `error`.
 *   - The users trigger RAISES (42501), so those tests DO get an error
 *     object; the message shape is asserted loosely.
 *
 * Pure supabase-js — no browser fixture. Skipped when the Supabase env
 * vars are missing (same contract as rls.spec.ts).
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import type { Database } from '../../src/types/database';

// =====================================================================
// Environment resolution (mirrors rls.spec.ts)
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

const PASSWORD = 'role-matrix-password-1';

// =====================================================================
// Helpers
// =====================================================================

function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Right after `supabase db reset` the local auth service can take up to
 * ~60s to accept admin createUser calls — retry with backoff instead of
 * failing the whole suite fast.
 */
async function createUserWithRetry(
  admin: SupabaseClient<Database>,
  opts: Parameters<typeof admin.auth.admin.createUser>[0],
): Promise<User> {
  let lastMessage = 'unknown';
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { data, error } = await admin.auth.admin.createUser(opts);
    if (!error && data.user) return data.user;
    lastMessage = error?.message ?? 'no user returned';
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`createUser failed after retries (${opts.email}): ${lastMessage}`);
}

async function orgIdOf(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  if (error || !data) {
    throw new Error(`users row missing for ${userId}: ${error?.message ?? 'no row'}`);
  }
  return data.organization_id;
}

async function signInAndGetClient(email: string): Promise<SupabaseClient<Database>> {
  const authClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed for ${email}: ${error?.message ?? 'no session'}`);
  }
  return createUserClient(data.session.access_token);
}

/** Insert one row via admin and return its id (same shape as rls.spec.ts). */
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
    throw new Error(`insert into ${table} failed: ${error?.message ?? 'no row returned'}`);
  }
  return data.id as string;
}

// =====================================================================
// Tests
// =====================================================================

test.describe('supabase role matrix (owner-only sensitive writes)', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let admin: SupabaseClient<Database>;

  // Org A members
  let ownerAId: string;
  let managerId: string;
  let vaId: string;
  let orgAId: string;
  // Junk orgs minted by the signup trigger for manager/va (cleaned up).
  const junkOrgIds: string[] = [];

  // Org B
  let ownerBId: string;
  let orgBId: string;

  let ownerA: SupabaseClient<Database>;
  let manager: SupabaseClient<Database>;
  let va: SupabaseClient<Database>;
  let ownerB: SupabaseClient<Database>;

  // Org A fixture rows
  let leaseId: string;
  let tenantId: string;
  let rentEventId: string;
  let workOrderId: string;

  const stamp = Date.now();
  const emails = {
    ownerA: `role.owner.a.${stamp}@odesa.test`,
    manager: `role.manager.${stamp}@odesa.test`,
    va: `role.va.${stamp}@odesa.test`,
    ownerB: `role.owner.b.${stamp}@odesa.test`,
  };

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    admin = createAdmin();

    // Org A owner — the signup trigger mints the org + role='owner'.
    const userOwnerA = await createUserWithRetry(admin, {
      email: emails.ownerA,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { organization_name: `Role Org A ${stamp}` },
    });
    ownerAId = userOwnerA.id;
    orgAId = await orgIdOf(admin, ownerAId);

    // Manager + VA: signup gives each a disposable sole-owner org. Delete
    // that org first so the last-owner invariant is honored, then mint the
    // intended membership through the local service fixture.
    for (const [email, role] of [
      [emails.manager, 'manager'],
      [emails.va, 'va'],
    ] as const) {
      const user = await createUserWithRetry(admin, {
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { organization_name: `Junk ${role} ${stamp}` },
      });
      const junkOrgId = await orgIdOf(admin, user.id);
      junkOrgIds.push(junkOrgId);
      const removed = await admin
        .from('organizations')
        .delete()
        .eq('id', junkOrgId);
      if (removed.error) {
        throw new Error(`remove junk ${role} org failed: ${removed.error.message}`);
      }
      const membership = await admin.from('organization_memberships').insert({
        user_id: user.id,
        organization_id: orgAId,
        role,
        status: 'active',
        all_properties: false,
      });
      if (membership.error) {
        throw new Error(`create ${role} membership failed: ${membership.error.message}`);
      }
      if (role === 'manager') managerId = user.id;
      else vaId = user.id;
    }

    // Org B owner.
    const userOwnerB = await createUserWithRetry(admin, {
      email: emails.ownerB,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { organization_name: `Role Org B ${stamp}` },
    });
    ownerBId = userOwnerB.id;
    orgBId = await orgIdOf(admin, ownerBId);

    // Minimal org-A rent fixture (service client, bypasses RLS).
    const propertyId = await insertAndReturnId(admin, 'properties', {
      organization_id: orgAId,
      name: `Role Org A HQ ${stamp}`,
      address_street: '1 Role Way',
      address_city: 'Arlington',
      address_state: 'VA',
      address_zip: '22201',
    });
    const unitId = await insertAndReturnId(admin, 'units', {
      organization_id: orgAId,
      property_id: propertyId,
      label: '101',
      bedrooms: 1,
      bathrooms: 1.0,
      square_feet: 650,
    });
    workOrderId = await insertAndReturnId(admin, 'work_orders', {
      organization_id: orgAId,
      unit_id: unitId,
      category: 'plumbing',
      urgency: 'routine',
      status: 'open',
      description: `Role matrix work order ${stamp}`,
      status_timeline: [],
    });
    tenantId = await insertAndReturnId(admin, 'tenants', {
      organization_id: orgAId,
      full_name: 'Role Matrix Tenant',
      phone_e164: `+1571777${Math.floor(1000 + Math.random() * 8999)}`,
      email: `role.tenant.${stamp}@example.com`,
    });
    leaseId = await insertAndReturnId(admin, 'leases', {
      organization_id: orgAId,
      unit_id: unitId,
      tenant_id: tenantId,
      rent_amount: 1500.0,
      rent_due_day: 1,
      late_fee_policy: { grace_days: 3, fixed_fee_cents: 5000 },
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      status: 'active',
    });
    rentEventId = await insertAndReturnId(admin, 'rent_events', {
      organization_id: orgAId,
      lease_id: leaseId,
      cycle_month: '2026-06-01',
      amount_due: 1500.0,
      amount_paid: 0,
      status: 'pending',
      due_date: '2026-06-01',
    });

    ownerA = await signInAndGetClient(emails.ownerA);
    manager = await signInAndGetClient(emails.manager);
    va = await signInAndGetClient(emails.va);
    ownerB = await signInAndGetClient(emails.ownerB);
  });

  test.afterAll(async () => {
    if (!admin) return;
    // ON DELETE CASCADE on organizations wipes fixture rows.
    for (const orgId of [orgAId, orgBId, ...junkOrgIds].filter(Boolean)) {
      await admin.from('organizations').delete().eq('id', orgId);
    }
    for (const userId of [ownerAId, managerId, vaId, ownerBId].filter(Boolean)) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  // ===================================================================
  // Owner CAN perform sensitive writes in own org
  // ===================================================================

  test('owner can update rent_events.amount_paid', async () => {
    const { data, error } = await ownerA
      .from('rent_events')
      .update({ amount_paid: 250 })
      .eq('id', rentEventId)
      .select('amount_paid');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await admin
      .from('rent_events')
      .select('amount_paid')
      .eq('id', rentEventId)
      .single();
    expect(Number(after?.amount_paid)).toBe(250);

    // Reset for the denial tests below.
    await admin.from('rent_events').update({ amount_paid: 0 }).eq('id', rentEventId);
  });

  test('owner can update leases.rent_amount', async () => {
    const { data, error } = await ownerA
      .from('leases')
      .update({ rent_amount: 1600 })
      .eq('id', leaseId)
      .select('rent_amount');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await admin
      .from('leases')
      .select('rent_amount')
      .eq('id', leaseId)
      .single();
    expect(Number(after?.rent_amount)).toBe(1600);

    await admin.from('leases').update({ rent_amount: 1500 }).eq('id', leaseId);
  });

  test('owner cannot bypass or fabricate work-order audit with direct UPDATE', async () => {
    const { data, error } = await ownerA
      .from('work_orders')
      .update({
        status: 'assigned',
        urgency: 'urgent',
        status_timeline: [{ source: 'owner_edit', note: 'fabricated' }],
      })
      .eq('id', workOrderId)
      .select();
    if (error === null) expect(data ?? []).toEqual([]);
    const { data: after } = await admin.from('work_orders')
      .select('status, urgency, status_timeline').eq('id', workOrderId).single();
    expect(after).toEqual({ status: 'open', urgency: 'routine', status_timeline: [] });
  });

  test('legacy audited RPC cannot bypass the lifecycle state machine', async () => {
    const { data, error } = await ownerA.rpc('mutate_work_order_audited', {
      p_work_order_id: workOrderId,
      p_status: 'assigned',
      p_urgency: 'urgent',
      p_vendor_id: null,
      p_set_vendor: false,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe('22000');
    expect(error?.message).toContain('lifecycle_mutation_requires_mutate_work_order_lifecycle');
    const { data: after } = await admin.from('work_orders')
      .select('status, urgency, status_timeline').eq('id', workOrderId).single();
    expect(after).toEqual({ status: 'open', urgency: 'routine', status_timeline: [] });
  });

  test('concurrent legacy lifecycle attempts are both rejected without mutation', async () => {
    const results = await Promise.all([
      ownerA.rpc('mutate_work_order_audited', {
        p_work_order_id: workOrderId, p_status: 'assigned', p_set_vendor: false,
      }),
      ownerA.rpc('mutate_work_order_audited', {
        p_work_order_id: workOrderId, p_status: 'in_progress', p_set_vendor: false,
      }),
    ]);
    expect(results.map((result) => result.error?.code)).toEqual(['22000', '22000']);
    const { data: after } = await admin.from('work_orders')
      .select('status, status_timeline').eq('id', workOrderId).single();
    expect(after).toEqual({ status: 'open', status_timeline: [] });
  });

  test('owner can insert rent_payments', async () => {
    const intentId = `pi_role_matrix_owner_${stamp}`;
    const { data, error } = await ownerA
      .from('rent_payments')
      .insert({
        organization_id: orgAId,
        lease_id: leaseId,
        tenant_id: tenantId,
        stripe_payment_intent_id: intentId,
        amount_cents: 150_000,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  test('owner can update rent_payments', async () => {
    const paymentId = await insertAndReturnId(admin, 'rent_payments', {
      organization_id: orgAId,
      lease_id: leaseId,
      tenant_id: tenantId,
      stripe_payment_intent_id: `pi_role_matrix_owner_upd_${stamp}`,
      amount_cents: 100_000,
    });

    const { data, error } = await ownerA
      .from('rent_payments')
      .update({ amount_cents: 175_000 })
      .eq('id', paymentId)
      .select('amount_cents');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await admin
      .from('rent_payments')
      .select('amount_cents')
      .eq('id', paymentId)
      .single();
    expect(Number(after?.amount_cents)).toBe(175_000);
  });

  test('owner can delete rent_payments', async () => {
    const paymentId = await insertAndReturnId(admin, 'rent_payments', {
      organization_id: orgAId,
      lease_id: leaseId,
      tenant_id: tenantId,
      stripe_payment_intent_id: `pi_role_matrix_owner_del_${stamp}`,
      amount_cents: 100_000,
    });

    const { data, error } = await ownerA
      .from('rent_payments')
      .delete()
      .eq('id', paymentId)
      .select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await admin
      .from('rent_payments')
      .select('id')
      .eq('id', paymentId);
    expect(after ?? []).toEqual([]);
  });

  // ===================================================================
  // manager / va CANNOT perform sensitive writes
  // ===================================================================

  for (const who of ['manager', 'va'] as const) {
    test(`${who} cannot update work-order status, urgency, or vendor`, async () => {
      const client = who === 'manager' ? manager : va;
      const { data, error } = await client
        .from('work_orders')
        .update({ status: 'completed', urgency: 'emergency', vendor_id: null })
        .eq('id', workOrderId)
        .select();
      if (error === null) expect(data ?? []).toEqual([]);

      const { data: after } = await admin
        .from('work_orders')
        .select('status, urgency, vendor_id')
        .eq('id', workOrderId)
        .single();
      expect(after).toEqual({ status: 'open', urgency: 'routine', vendor_id: null });
    });

    test(`${who} cannot invoke the audited work-order RPC`, async () => {
      const client = who === 'manager' ? manager : va;
      const { error } = await client.rpc('mutate_work_order_audited', {
        p_work_order_id: workOrderId,
        p_status: 'completed',
        p_urgency: 'emergency',
        p_set_vendor: false,
      });
      expect(error?.code).toBe('42501');
      const { data: after } = await admin.from('work_orders')
        .select('status, urgency, status_timeline').eq('id', workOrderId).single();
      expect(after).toEqual({ status: 'open', urgency: 'routine', status_timeline: [] });
    });

    test(`${who} cannot update rent_events`, async () => {
      const client = who === 'manager' ? manager : va;
      const { data, error } = await client
        .from('rent_events')
        .update({ amount_paid: 999 })
        .eq('id', rentEventId)
        .select();
      // RLS USING filters the row: 0 rows silently, or an error. Either
      // way the row must be unchanged.
      if (error === null) expect(data ?? []).toEqual([]);

      const { data: after } = await admin
        .from('rent_events')
        .select('amount_paid')
        .eq('id', rentEventId)
        .single();
      expect(Number(after?.amount_paid)).toBe(0);
    });

    test(`${who} cannot update leases`, async () => {
      const client = who === 'manager' ? manager : va;
      const { data, error } = await client
        .from('leases')
        .update({ rent_amount: 1 })
        .eq('id', leaseId)
        .select();
      if (error === null) expect(data ?? []).toEqual([]);

      const { data: after } = await admin
        .from('leases')
        .select('rent_amount')
        .eq('id', leaseId)
        .single();
      expect(Number(after?.rent_amount)).toBe(1500);
    });

    test(`${who} cannot insert rent_payments`, async () => {
      const client = who === 'manager' ? manager : va;
      const intentId = `pi_role_matrix_${who}_${stamp}`;
      const { error } = await client.from('rent_payments').insert({
        organization_id: orgAId,
        lease_id: leaseId,
        tenant_id: tenantId,
        stripe_payment_intent_id: intentId,
        amount_cents: 100,
      });
      // INSERT WITH CHECK violations DO surface as errors (42501).
      expect(error, `${who} rent_payments insert must be rejected`).not.toBeNull();

      const { data: rows } = await admin
        .from('rent_payments')
        .select('id')
        .eq('stripe_payment_intent_id', intentId);
      expect(rows ?? []).toEqual([]);
    });

    test(`${who} cannot update rent_payments`, async () => {
      const client = who === 'manager' ? manager : va;
      const paymentId = await insertAndReturnId(admin, 'rent_payments', {
        organization_id: orgAId,
        lease_id: leaseId,
        tenant_id: tenantId,
        stripe_payment_intent_id: `pi_role_matrix_${who}_upd_${stamp}`,
        amount_cents: 100_000,
      });

      const { data, error } = await client
        .from('rent_payments')
        .update({ amount_cents: 1 })
        .eq('id', paymentId)
        .select();
      // RLS USING filters the row: 0 rows silently, or an error. Either
      // way the row must be unchanged.
      if (error === null) expect(data ?? []).toEqual([]);

      const { data: after } = await admin
        .from('rent_payments')
        .select('amount_cents')
        .eq('id', paymentId)
        .single();
      expect(Number(after?.amount_cents)).toBe(100_000);
    });

    test(`${who} cannot delete rent_payments`, async () => {
      const client = who === 'manager' ? manager : va;
      const paymentId = await insertAndReturnId(admin, 'rent_payments', {
        organization_id: orgAId,
        lease_id: leaseId,
        tenant_id: tenantId,
        stripe_payment_intent_id: `pi_role_matrix_${who}_del_${stamp}`,
        amount_cents: 100_000,
      });

      const { data, error } = await client
        .from('rent_payments')
        .delete()
        .eq('id', paymentId)
        .select();
      if (error === null) expect(data ?? []).toEqual([]);

      const { data: after } = await admin
        .from('rent_payments')
        .select('id')
        .eq('id', paymentId);
      expect(after).toHaveLength(1);
    });
  }

  // ===================================================================
  // users escalation guard
  // ===================================================================

  test('manager cannot self-escalate role (trigger raises)', async () => {
    const legacyAttempt = await manager
      .from('users')
      .update({ role: 'owner' })
      .eq('id', managerId);
    expect(legacyAttempt.error).not.toBeNull();
    expect(legacyAttempt.error?.message).toBe('Forbidden');

    const directAttempt = await manager
      .from('organization_memberships')
      .update({ role: 'owner' })
      .eq('user_id', managerId);
    expect(directAttempt.error).not.toBeNull();
    expect(directAttempt.error?.message ?? '').toMatch(
      /privilege_guard|not allowed/i,
    );

    const { data: after } = await admin
      .from('users')
      .select('role')
      .eq('id', managerId)
      .single();
    expect(after?.role).toBe('manager');
  });

  test("va cannot change another member's role", async () => {
    const attempt = await va
      .from('users')
      .update({ role: 'owner' })
      .eq('id', managerId)
      .select('id');
    expect(attempt).toMatchObject({ error: null, data: [] });

    const { data: after } = await admin
      .from('users')
      .select('role')
      .eq('id', managerId)
      .single();
    expect(after?.role).toBe('manager');
  });

  test('manager cannot move themselves to org B (cross-org escalation is dead)', async () => {
    const { error } = await manager
      .from('users')
      .update({ organization_id: orgBId })
      .eq('id', managerId);
    expect(error).not.toBeNull();

    const { data: after } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', managerId)
      .single();
    expect(after?.organization_id).toBe(orgAId);
  });

  test("owner CAN change a member's role (role-only change)", async () => {
    const { data, error } = await ownerA
      .from('users')
      .update({ role: 'manager' })
      .eq('id', vaId)
      .select('role');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    const { data: after } = await admin
      .from('users')
      .select('role')
      .eq('id', vaId)
      .single();
    expect(after?.role).toBe('manager');

    // Restore for any later assertions.
    await admin.from('users').update({ role: 'va' }).eq('id', vaId);
  });

  test("owner CANNOT change a member's organization_id (service-only)", async () => {
    const legacyAttempt = await ownerA
      .from('users')
      .update({ organization_id: orgBId })
      .eq('id', vaId);
    expect(legacyAttempt.error).not.toBeNull();

    const directAttempt = await ownerA
      .from('organization_memberships')
      .update({ organization_id: orgBId })
      .eq('user_id', vaId);
    expect(directAttempt.error).not.toBeNull();
    expect(directAttempt.error?.message ?? '').toMatch(
      /privilege_guard|not allowed/i,
    );

    const { data: after } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', vaId)
      .single();
    expect(after?.organization_id).toBe(orgAId);
  });

  // ===================================================================
  // Org isolation spot check (full coverage lives in rls.spec.ts)
  // ===================================================================

  test('org B owner sees nothing of org A rent_events', async () => {
    const { data, error } = await ownerB
      .from('rent_events')
      .select('id, organization_id');
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.organization_id).toBe(orgBId);
    }
    const { data: direct } = await ownerB
      .from('rent_events')
      .select('id')
      .eq('id', rentEventId)
      .maybeSingle();
    expect(direct).toBeNull();
  });
});
