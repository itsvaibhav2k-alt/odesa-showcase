/**
 * Shared DB fixture for the Wave 5 work-order lifecycle Supabase specs.
 *
 * Both `work-order-lifecycle-rpc.spec.ts` (concurrency + idempotency) and
 * `work-order-audited-compat.spec.ts` (Wave 2 regression) need the same
 * ingredients: one org with an owner + manager + va (mirroring the role-matrix
 * provisioning), a unit, two org vendors, and a way to mint work orders in a
 * known starting state. This module factors that out so the two specs don't
 * duplicate ~120 lines of auth-user plumbing.
 *
 * Pure `@supabase/supabase-js` — no browser fixture, same skip contract as
 * `rls.spec.ts` / `role-matrix.spec.ts` (skipped when the Supabase env vars
 * are absent). Every write is org-scoped, and teardown deletes the org (ON
 * DELETE CASCADE wipes the fixture rows) plus the auth users.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

import {
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  ANON_KEY,
  HAVE_SUPABASE,
} from '../fixtures/manifest';

export { HAVE_SUPABASE };

const PASSWORD = 'lifecycle-fixture-password-1';

type WorkOrderInsert = Database['public']['Tables']['work_orders']['Insert'];

export interface LifecycleOrg {
  admin: SupabaseClient<Database>;
  /** Anon client (no auth) — for grant/denial assertions. */
  anon: SupabaseClient<Database>;
  owner: SupabaseClient<Database>;
  manager: SupabaseClient<Database>;
  va: SupabaseClient<Database>;
  ownerId: string;
  managerId: string;
  vaId: string;
  orgId: string;
  unitId: string;
  vendorId: string;
  vendorId2: string;
  /**
   * Insert a work order via the admin client and return its id. Defaults to an
   * open, unassigned, routine plumbing ticket at lifecycle_version 0; pass
   * overrides to seed any other starting state (e.g. an already-assigned WO for
   * the concurrency test).
   */
  seedWorkOrder: (overrides?: Partial<WorkOrderInsert>) => Promise<string>;
  teardown: () => Promise<void>;
  verifyClean: () => Promise<void>;
}

function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createAnon(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function createUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Retry admin createUser — local auth can lag ~60s after `supabase db reset`. */
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
  const authClient = createAnon();
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`signInWithPassword failed for ${email}: ${error?.message ?? 'no session'}`);
  }
  return createUserClient(data.session.access_token);
}

async function insertReturningId(
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
    throw new Error(`insert into ${table} failed: ${error?.message ?? 'no row'}`);
  }
  return data.id as string;
}

/**
 * Provision a fresh org (owner + manager + va rehomed in), one unit, and two
 * org vendors. Mirrors `role-matrix.spec.ts` provisioning so the skip/retry
 * behavior matches the rest of the Supabase suite.
 */
export async function provisionLifecycleOrg(): Promise<LifecycleOrg> {
  if (!HAVE_SUPABASE) {
    throw new Error('provisionLifecycleOrg requires the Supabase env vars');
  }

  const admin = createAdmin();
  const anon = createAnon();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const authUserIds: string[] = [];
  const orgIds: string[] = [];
  const workOrderIds: string[] = [];

  const emails = {
    owner: `lc.owner.${stamp}@odesa.test`,
    manager: `lc.manager.${stamp}@odesa.test`,
    va: `lc.va.${stamp}@odesa.test`,
  };

  try {
  // Owner: the signup trigger mints the org + role='owner'.
  const ownerUser = await createUserWithRetry(admin, {
    email: emails.owner,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { organization_name: `Lifecycle Org ${stamp}` },
  });
  const ownerId = ownerUser.id;
  authUserIds.push(ownerId);
  const orgId = await orgIdOf(admin, ownerId);
  orgIds.push(orgId);

  // Manager + VA: each gets a disposable sole-owner org from signup. Delete
  // it first so the last-owner invariant remains real, then create the exact
  // local-fixture membership in the owner's org.
  const junkOrgIds: string[] = [];
  let managerId = '';
  let vaId = '';
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
    authUserIds.push(user.id);
    const junkOrgId = await orgIdOf(admin, user.id);
    junkOrgIds.push(junkOrgId);
    orgIds.push(junkOrgId);
    const removed = await admin
      .from('organizations')
      .delete()
      .eq('id', junkOrgId);
    if (removed.error) {
      throw new Error(`remove junk ${role} org failed: ${removed.error.message}`);
    }
    const membership = await admin.from('organization_memberships').insert({
      user_id: user.id,
      organization_id: orgId,
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

  // One property + unit + two vendors, all org-scoped (service client bypasses RLS).
  const propertyId = await insertReturningId(admin, 'properties', {
    organization_id: orgId,
    name: `Lifecycle HQ ${stamp}`,
    address_street: '1 Lifecycle Way',
    address_city: 'Arlington',
    address_state: 'VA',
    address_zip: '22201',
  });
  const unitId = await insertReturningId(admin, 'units', {
    organization_id: orgId,
    property_id: propertyId,
    label: '101',
    bedrooms: 1,
    bathrooms: 1.0,
    square_feet: 650,
  });
  const vendorId = await insertReturningId(admin, 'vendors', {
    organization_id: orgId,
    name: `Lifecycle Plumbing ${stamp}`,
    category: 'plumbing',
    phone_e164: `+1571888${Math.floor(1000 + Math.random() * 8999)}`,
    acceptance_rate: 0.9,
  });
  const vendorId2 = await insertReturningId(admin, 'vendors', {
    organization_id: orgId,
    name: `Lifecycle HVAC ${stamp}`,
    category: 'hvac',
    phone_e164: `+1571889${Math.floor(1000 + Math.random() * 8999)}`,
    acceptance_rate: 0.85,
  });

  const owner = await signInAndGetClient(emails.owner);
  const manager = await signInAndGetClient(emails.manager);
  const va = await signInAndGetClient(emails.va);

  const seedWorkOrder = async (
    overrides: Partial<WorkOrderInsert> = {},
  ): Promise<string> => {
    const id = await insertReturningId(admin, 'work_orders', {
      organization_id: orgId,
      unit_id: unitId,
      category: 'plumbing',
      urgency: 'routine',
      status: 'open',
      description: `Lifecycle WO ${stamp}`,
      status_timeline: [],
      lifecycle_version: 0,
      ...overrides,
    });
    workOrderIds.push(id);
    return id;
  };

  const teardown = async (): Promise<void> => {
    await cleanupLifecycleFixture(admin, authUserIds, orgIds);
  };

  const verifyClean = async (): Promise<void> => {
    const checks = await Promise.all([
      exactCount(admin.from('organizations').select('*', { count: 'exact', head: true }).in('id', orgIds), 'organizations'),
      exactCount(admin.from('users').select('*', { count: 'exact', head: true }).in('id', authUserIds), 'users'),
      exactCount(admin.from('work_orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId), 'work_orders/history'),
      exactCount(admin.from('vendors').select('*', { count: 'exact', head: true }).eq('organization_id', orgId), 'vendors'),
      workOrderIds.length > 0
        ? exactCount(admin.from('work_order_mutation_requests').select('*', { count: 'exact', head: true }).in('work_order_id', workOrderIds), 'request-ledger')
        : Promise.resolve(0),
    ]);
    if (checks.some((count) => count !== 0)) {
      throw new Error(`Lifecycle cleanup left rows: organizations=${checks[0]}, users=${checks[1]}, work_orders/history=${checks[2]}, vendors=${checks[3]}, request-ledger=${checks[4]}`);
    }
  };

  return {
    admin,
    anon,
    owner,
    manager,
    va,
    ownerId,
    managerId,
    vaId,
    orgId,
    unitId,
    vendorId,
    vendorId2,
    seedWorkOrder,
    teardown,
    verifyClean,
  };
  } catch (provisionError) {
    try {
      await cleanupLifecycleFixture(admin, authUserIds, orgIds);
    } catch (cleanupError) {
      throw new AggregateError(
        [provisionError, cleanupError],
        'Lifecycle provisioning failed and rollback was incomplete',
      );
    }
    throw provisionError;
  }
}

async function cleanupLifecycleFixture(
  admin: SupabaseClient<Database>,
  authUserIds: readonly string[],
  orgIds: readonly string[],
): Promise<void> {
  const failures: Error[] = [];
  for (const id of [...new Set(orgIds)]) {
    const { error } = await admin.from('organizations').delete().eq('id', id);
    if (error) failures.push(new Error(`[delete:organizations:${id}] ${error.message}`));
  }
  for (const id of [...new Set(authUserIds)]) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) failures.push(new Error(`[auth:deleteUser:${id}] ${error.message}`));
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Lifecycle fixture cleanup failed');
  }
}

async function exactCount(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`[count:${label}] ${error.message}`);
  if (count === null) throw new Error(`[count:${label}] exact count was null`);
  return count;
}
