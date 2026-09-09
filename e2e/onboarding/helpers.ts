/**
 * Local helpers for the onboarding Playwright suite.
 *
 * Kept free of the Galaxy seed fixture so these specs can exercise a
 * truly fresh landlord flow without tripping over pre-existing rows.
 * Every helper is gated on `HAVE_SUPABASE` — a spec that imports this
 * module can still be parsed and collected when the local Supabase
 * stack is offline; it just ends up skipped at runtime.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/types/database';

// ---------------------------------------------------------------------------
// Environment resolution (mirror e2e/supabase/rls.spec.ts exactly)
// ---------------------------------------------------------------------------

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  '';

export const HAVE_SUPABASE = Boolean(
  SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY,
);

// ---------------------------------------------------------------------------
// Admin client + fresh-landlord provisioning
// ---------------------------------------------------------------------------

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface FreshLandlord {
  userId: string;
  organizationId: string;
  email: string;
  password: string;
  orgName: string;
  /** Clean up all rows owned by this landlord. Safe to call multiple times. */
  teardown: () => Promise<void>;
}

/**
 * Provisions a new landlord + organization via the post-signup trigger,
 * then returns the credentials for the test to drive the UI. The
 * teardown closure deletes the auth user (cascades the org row via FK)
 * and re-deletes the organization for belt-and-suspenders cleanup.
 */
export async function provisionFreshLandlord(
  prefix = 'fresh',
): Promise<FreshLandlord> {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `${prefix}.${stamp}.${rand}@odesa.test`;
  const password = `onboarding-test-${rand}`;
  const orgName = `Onboarding Org ${stamp}-${rand}`;

  const admin = createAdmin();

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_name: orgName,
        full_name: `${orgName} Owner`,
      },
    });

  if (createErr || !created.user) {
    throw new Error(
      `Failed to provision landlord: ${createErr?.message ?? 'no user'}`,
    );
  }

  const userId = created.user.id;

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (userErr || !userRow) {
    // Try to leave nothing behind even on the failure path.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Signup trigger did not provision users row: ${userErr?.message ?? 'no row'}`,
    );
  }

  const organizationId = userRow.organization_id;

  const teardown = async () => {
    // Delete rows the user created; CASCADE on organizations handles
    // the rest, but order explicitly to surface any accidental FK gaps.
    await admin.from('leases').delete().eq('organization_id', organizationId);
    await admin.from('tenants').delete().eq('organization_id', organizationId);
    await admin.from('units').delete().eq('organization_id', organizationId);
    await admin
      .from('properties')
      .delete()
      .eq('organization_id', organizationId);
    await admin.from('organizations').delete().eq('id', organizationId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  };

  return {
    userId,
    organizationId,
    email,
    password,
    orgName,
    teardown,
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export interface OnboardingRows {
  propertyCount: number;
  unitCount: number;
  tenantCount: number;
  leaseCount: number;
}

export async function readOnboardingRowCounts(
  organizationId: string,
): Promise<OnboardingRows> {
  const admin = createAdmin();
  const [properties, units, tenants, leases] = await Promise.all([
    admin
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
    admin
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
    admin
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
    admin
      .from('leases')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
  ]);

  return {
    propertyCount: properties.count ?? 0,
    unitCount: units.count ?? 0,
    tenantCount: tenants.count ?? 0,
    leaseCount: leases.count ?? 0,
  };
}
