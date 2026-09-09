/**
 * Isolated-org fixture for mutation specs (Add-Tenant persistence, C11
 * cleanup proof).
 *
 * The shared Galaxy seed is useless for proving Add-Tenant persistence:
 * every seeded unit already has an active lease, so there is no vacant
 * unit to attach a new tenant to, and mutating Galaxy would corrupt the
 * fixture every other spec depends on.
 *
 * `provisionIsolatedOwnerWithVacantUnit()` mints a brand-new org (via the
 * signup trigger's stub org — NOT repointed to Galaxy) containing exactly
 * one property and one VACANT unit (no lease). A mutation spec can add a
 * tenant + lease to that unit, assert persistence, and tear the whole org
 * down without ever touching shared data.
 *
 * KEY ENV FACT: when these specs run, the orchestrator exports the LOCAL
 * stack's LEGACY JWT service-role key (as CI does), so GoTrue's admin
 * endpoints accept it. Both `auth.admin.createUser` and
 * `auth.admin.deleteUser` WORK here — unlike `seed-org.ts`, which assumes
 * the newer `sb_secret_*` key and therefore skips `deleteUser`. If
 * `createUser` errors, we THROW so the orchestrator sees a clear failure
 * rather than a silent fallback.
 *
 * Every insert + delete is scoped by `organization_id` (or row `id`), so a
 * teardown can NEVER touch another org.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

import { SUPABASE_URL, SERVICE_ROLE_KEY, HAVE_SUPABASE } from './manifest';

// ---------------------------------------------------------------------------
// Admin client (mirrors seed-org.ts createAdmin)
// ---------------------------------------------------------------------------

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface IsolatedOrg {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  propertyId: string;
  unitId: string;
  unitLabel: string;
  admin: SupabaseClient<Database>;
  /**
   * Seed an org-scoped vendor (so it appears in the WO assign `<select>`) and
   * return its id. Wave 5 work-order-lifecycle spec helper.
   */
  seedVendor: (opts?: {
    name?: string;
    category?: string;
  }) => Promise<string>;
  /**
   * Seed a work order on this org's unit and return its id. Defaults to an
   * open, unassigned, routine plumbing ticket; pass overrides for other states.
   */
  seedWorkOrder: (
    overrides?: Partial<WorkOrderInsert>,
  ) => Promise<string>;
  /** Child-first, org-scoped, best-effort teardown (incl. auth user). */
  teardown: () => Promise<void>;
  /** C11 cleanup proof: counts of leftover rows scoped to this org. */
  verifyClean: () => Promise<{
    ok: boolean;
    leftovers: Record<string, number>;
  }>;
}

type WorkOrderInsert = Database['public']['Tables']['work_orders']['Insert'];
type VendorInsert = Database['public']['Tables']['vendors']['Insert'];

export interface ProvisionIsolatedOptions {
  /** Label for the single vacant unit. Defaults to '101'. */
  unitLabel?: string;
}

export interface CleanupTask {
  target: string;
  run: () => PromiseLike<{ error?: unknown } | void>;
}

// ---------------------------------------------------------------------------
// Uniqueness helper (mirrors seed-org.ts uniqDigits)
//
// The module-scope counter is deterministic (safe at module scope); the
// non-deterministic parts (Date.now) are read inside the function, per the
// task's constraint against Date.now/Math.random at module scope.
// ---------------------------------------------------------------------------

let counter = 0;

function uniqDigits(): string {
  counter += 1;
  const workerId = process.env.TEST_PARALLEL_INDEX ?? '0';
  return (
    String(Date.now()).slice(-7) +
    workerId.padStart(2, '0') +
    String(counter).padStart(3, '0')
  );
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Mint a fresh org (its own stub org from the signup trigger) with one
 * property and one VACANT unit. Poll the signup trigger for the stub org,
 * promote the user to `owner`, then insert the property + unit scoped to
 * that org. No lease is created, so the unit is vacant.
 */
export async function provisionIsolatedOwnerWithVacantUnit(
  options: ProvisionIsolatedOptions = {},
): Promise<IsolatedOrg> {
  if (!HAVE_SUPABASE) {
    throw new Error(
      'provisionIsolatedOwnerWithVacantUnit requires SUPABASE_URL, ' +
        'SUPABASE_SERVICE_ROLE_KEY, and an anon key',
    );
  }

  const admin = createAdmin();
  const stamp = uniqDigits();

  const email = `isolated.${stamp}@isolated.test`;
  const password = `isolated-${stamp}-secret`;
  const orgName = `Isolated Org ${stamp}`;
  const propertyName = `Isolated Property ${stamp}`;
  const unitLabel = options.unitLabel ?? '101';

  // --- 1. Create the auth user (legacy JWT key → admin endpoints work) -----
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_name: orgName,
        full_name: 'Isolated Test Owner',
      },
    },
  );

  if (createErr || !created.user) {
    const provisionError = new Error(
      `Failed to provision isolated owner (createUser): ${
        createErr?.message ?? 'no user returned'
      }`,
    );
    if (created.user) {
      try {
        await cleanupProvisionedIdentity(admin, created.user.id);
      } catch (cleanupError) {
        throw new AggregateError(
          [
            taggedError('provision:createUser', provisionError),
            ...aggregateErrors(cleanupError),
          ],
          `createUser returned a user alongside an error and rollback was incomplete for ${created.user.id}`,
        );
      }
    }
    throw provisionError;
  }

  const userId = created.user.id;
  let organizationId: string | undefined;

  try {
    // --- 2. Poll the signup trigger for the stub org (mirror resolveSignupOrg)
    const resolvedOrganizationId = await resolveStubOrg(admin, userId);
    organizationId = resolvedOrganizationId;

    // --- 3. Promote to owner, keep organization_id = the stub org -----------
    const { error: roleErr } = await admin
      .from('users')
      .update({
        role: 'owner',
        display_name: 'Isolated Test Owner',
        full_name: 'Isolated Test Owner',
        email,
      })
      .eq('id', userId);

    if (roleErr) {
      throw new Error(`Failed to set isolated owner role: ${roleErr.message}`);
    }

    // --- 4. Insert one property (mirror seed.sql properties columns) --------
    const { data: property, error: propErr } = await admin
      .from('properties')
      .insert({
        organization_id: resolvedOrganizationId,
        name: propertyName,
        address_street: '1 QA Test Way',
        address_city: 'Testville',
        address_state: 'VA',
        address_zip: '22201',
        timezone: 'America/New_York',
      })
      .select('id')
      .single();

    if (propErr || !property) {
      throw new Error(
        `Failed to insert isolated property: ${propErr?.message ?? 'no row'}`,
      );
    }

    const propertyId = property.id;

    // --- 5. Insert one VACANT unit (mirror seed.sql units columns) ----------
    // No lease is created against this unit, so it is vacant — the whole
    // point of this fixture.
    const { data: unit, error: unitErr } = await admin
      .from('units')
      .insert({
        organization_id: resolvedOrganizationId,
        property_id: propertyId,
        label: unitLabel,
        bedrooms: 1,
        bathrooms: 1.0,
        square_feet: 650,
      })
      .select('id')
      .single();

    if (unitErr || !unit) {
      throw new Error(
        `Failed to insert isolated unit: ${unitErr?.message ?? 'no row'}`,
      );
    }

    const unitId = unit.id;

    // --- Wave 5 lifecycle seed helpers (vendor + work order) ----------------
    let vendorCounter = 0;
    const workOrderIds: string[] = [];
    const seedVendor = async (opts?: {
      name?: string;
      category?: string;
    }): Promise<string> => {
      vendorCounter += 1;
      const { data: vendor, error } = await admin
        .from('vendors')
        .insert({
          organization_id: resolvedOrganizationId,
          name: opts?.name ?? `Isolated Vendor ${stamp}-${vendorCounter}`,
          category: (opts?.category ?? 'plumbing') as VendorInsert['category'],
          phone_e164: `+1571${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
          acceptance_rate: 0.9,
        })
        .select('id')
        .single();
      if (error || !vendor) {
        throw new Error(
          `Failed to seed isolated vendor: ${error?.message ?? 'no row'}`,
        );
      }
      return vendor.id;
    };

    const seedWorkOrder = async (
      overrides: Partial<WorkOrderInsert> = {},
    ): Promise<string> => {
      const { data: wo, error } = await admin
        .from('work_orders')
        .insert({
          organization_id: resolvedOrganizationId,
          unit_id: unitId,
          category: 'plumbing',
          urgency: 'routine',
          status: 'open',
          description: `Isolated WO ${stamp}`,
          status_timeline: [],
          lifecycle_version: 0,
          ...overrides,
        })
        .select('id')
        .single();
      if (error || !wo) {
        throw new Error(
          `Failed to seed isolated work order: ${error?.message ?? 'no row'}`,
        );
      }
      workOrderIds.push(wo.id);
      return wo.id;
    };

    // --- Teardown: child-first, org-scoped, best-effort ---------------------
    const teardown = async (): Promise<void> => {
      await cleanupProvisionedIdentity(admin, userId, resolvedOrganizationId);
    };

    // --- verifyClean: C11 cleanup proof -------------------------------------
    const verifyClean = async (): Promise<{
      ok: boolean;
      leftovers: Record<string, number>;
    }> => {
      const entries = await Promise.allSettled([
        countByOrg(admin, 'operator_chat_turns', resolvedOrganizationId),
        countByOrg(admin, 'operator_chats', resolvedOrganizationId),
        countByOrg(admin, 'memory_facts', resolvedOrganizationId),
        countMutationRequests(admin, workOrderIds),
        countByOrg(admin, 'work_orders', resolvedOrganizationId),
        countByOrg(admin, 'vendors', resolvedOrganizationId),
        countByOrg(admin, 'properties', resolvedOrganizationId),
        countByOrg(admin, 'units', resolvedOrganizationId),
        countByOrg(admin, 'tenants', resolvedOrganizationId),
        countByOrg(admin, 'leases', resolvedOrganizationId),
        countByOrg(admin, 'users', resolvedOrganizationId),
        countById(admin, resolvedOrganizationId),
      ]);
      const names = [
        'operator_chat_turns',
        'operator_chats',
        'memory_facts',
        'work_order_mutation_requests',
        'work_orders',
        'vendors',
        'properties',
        'units',
        'tenants',
        'leases',
        'users',
        'organizations',
      ] as const;
      const failures: Error[] = [];
      const leftovers: Record<string, number> = {};
      entries.forEach((entry, index) => {
        const table = names[index];
        if (entry.status === 'fulfilled') leftovers[table] = entry.value;
        else failures.push(taggedError(`count:${table}`, entry.reason));
      });
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `verifyClean could not prove cleanup for org ${resolvedOrganizationId}: ${failures.map((failure) => failure.message).join('; ')}`,
        );
      }
      const ok = Object.values(leftovers).every((n) => n === 0);
      return { ok, leftovers };
    };

    return {
      userId,
      email,
      password,
      organizationId: resolvedOrganizationId,
      propertyId,
      unitId,
      unitLabel,
      admin,
      seedVendor,
      seedWorkOrder,
      teardown,
      verifyClean,
    };
  } catch (provisionError) {
    try {
      await cleanupProvisionedIdentity(admin, userId, organizationId);
    } catch (cleanupError) {
      throw new AggregateError(
        [
          taggedError('provision', provisionError),
          ...aggregateErrors(cleanupError),
        ],
        `Isolated-org provisioning failed and rollback was incomplete for auth user ${userId}`,
      );
    }
    throw provisionError;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Poll `public.users` by id until the signup trigger has populated
 * `organization_id`. Mirrors resolveSignupOrg's 10s grace in seed-org.ts —
 * PostgREST's snapshot can briefly lag the trigger's commit.
 */
async function resolveStubOrg(
  admin: SupabaseClient<Database>,
  userId: string,
  timeoutMs = 10_000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data: userRow, error } = await admin
      .from('users')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      throw taggedError('resolve:users', error);
    }
    if (userRow?.organization_id) {
      return userRow.organization_id;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Signup stub-org resolution timed out for user ${userId} after ${timeoutMs}ms`,
  );
}

/** Run every cleanup target, then fail once with target-specific evidence. */
export async function runCleanupTasks(
  tasks: readonly CleanupTask[],
): Promise<void> {
  const failures: Error[] = [];
  for (const task of tasks) {
    try {
      const result = await Promise.resolve(task.run());
      if (result && result.error) {
        failures.push(taggedError(task.target, result.error));
      }
    } catch (error) {
      failures.push(taggedError(task.target, error));
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Cleanup failed for ${failures.length} target(s): ${failures.map((failure) => failure.message).join('; ')}`,
    );
  }
}

async function cleanupProvisionedIdentity(
  admin: SupabaseClient<Database>,
  userId: string,
  knownOrganizationId?: string,
): Promise<void> {
  let organizationId = knownOrganizationId;
  const lookupFailures: Error[] = [];
  if (!organizationId) {
    try {
      const { data, error } = await admin
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .maybeSingle();
      if (error) lookupFailures.push(taggedError('lookup:users', error));
      else organizationId = data?.organization_id ?? undefined;
    } catch (error) {
      lookupFailures.push(taggedError('lookup:users', error));
    }
  }

  const orgTasks: CleanupTask[] = organizationId
    ? [
        // work_orders first: they FK-reference units (and cascade the
        // Wave 5 work_order_mutation_requests ledger), so they must go before
        // the units delete below. vendors are FK-referenced by work_orders.
        {
          target: 'delete:work_orders',
          run: () =>
            admin
              .from('work_orders')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:vendors',
          run: () =>
            admin
              .from('vendors')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:operator_chat_turns',
          run: () =>
            admin
              .from('operator_chat_turns')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:operator_chats',
          run: () =>
            admin
              .from('operator_chats')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:memory_facts',
          run: () =>
            admin
              .from('memory_facts')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:leases',
          run: () =>
            admin
              .from('leases')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:tenants',
          run: () =>
            admin
              .from('tenants')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:units',
          run: () =>
            admin.from('units').delete().eq('organization_id', organizationId!),
        },
        {
          target: 'delete:properties',
          run: () =>
            admin
              .from('properties')
              .delete()
              .eq('organization_id', organizationId!),
        },
        {
          target: 'delete:users',
          run: () =>
            admin.from('users').delete().eq('organization_id', organizationId!),
        },
      ]
    : [
        {
          target: 'delete:users-by-id',
          run: () => admin.from('users').delete().eq('id', userId),
        },
      ];

  if (organizationId) {
    orgTasks.push({
      target: 'delete:organizations',
      run: () => admin.from('organizations').delete().eq('id', organizationId!),
    });
  }
  orgTasks.push({
    target: 'auth:deleteUser',
    run: () => admin.auth.admin.deleteUser(userId),
  });

  try {
    await runCleanupTasks(orgTasks);
  } catch (error) {
    lookupFailures.push(...aggregateErrors(error));
  }
  if (lookupFailures.length > 0) {
    throw new AggregateError(
      lookupFailures,
      `Cleanup could not fully remove auth user ${userId}${organizationId ? ` and org ${organizationId}` : ''}: ${lookupFailures.map((failure) => failure.message).join('; ')}`,
    );
  }
}

function taggedError(target: string, error: unknown): Error {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : String(error);
  return new Error(`[${target}] ${detail}`, { cause: error });
}

function aggregateErrors(error: unknown): Error[] {
  return error instanceof AggregateError
    ? Array.from(error.errors, (entry) =>
        entry instanceof Error ? entry : taggedError('cleanup', entry),
      )
    : [error instanceof Error ? error : taggedError('cleanup', error)];
}

/** Count rows in `table` scoped to `organizationId`. */
async function countByOrg(
  admin: SupabaseClient<Database>,
  table:
    | 'operator_chat_turns'
    | 'operator_chats'
    | 'memory_facts'
    | 'work_orders'
    | 'vendors'
    | 'properties'
    | 'units'
    | 'tenants'
    | 'leases'
    | 'users',
  organizationId: string,
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId);
  if (error) throw taggedError(`count:${table}`, error);
  if (count === null) throw new Error(`[count:${table}] exact count was null`);
  return count;
}

/** Count lifecycle request-ledger rows for the fixture's work orders. */
async function countMutationRequests(
  admin: SupabaseClient<Database>,
  workOrderIds: readonly string[],
): Promise<number> {
  if (workOrderIds.length === 0) return 0;
  const { count, error } = await admin
    .from('work_order_mutation_requests')
    .select('*', { count: 'exact', head: true })
    .in('work_order_id', [...workOrderIds]);
  if (error) throw taggedError('count:work_order_mutation_requests', error);
  if (count === null) {
    throw new Error('[count:work_order_mutation_requests] exact count was null');
  }
  return count;
}

/** Count `organizations` rows with `id = organizationId` (0 or 1). */
async function countById(
  admin: SupabaseClient<Database>,
  organizationId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .eq('id', organizationId);
  if (error) throw taggedError('count:organizations', error);
  if (count === null)
    throw new Error('[count:organizations] exact count was null');
  return count;
}
