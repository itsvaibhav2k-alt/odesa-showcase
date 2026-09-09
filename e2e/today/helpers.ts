/**
 * Local helpers for the Today Playwright suite.
 *
 * These helpers provision a Galaxy-owner auth user pointing at Agent
 * B's seeded org (`11111111-1111-1111-1111-111111111101`), sign them
 * in, and provide fresh-org + teardown helpers for the empty-state
 * spec. They mirror the gating pattern in `e2e/onboarding/helpers.ts`
 * and `e2e/supabase/rls.spec.ts` so the suite skips cleanly when the
 * local Supabase stack isn't running.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

import type { Database, UserRole } from '../../src/types/database';

// ---------------------------------------------------------------------------
// Environment resolution + seeded Galaxy org UUID
//
// The single source of truth is `../fixtures/manifest` (mirror of
// supabase/seed.sql). Re-exported here so existing importers of this module
// keep working unchanged.
// ---------------------------------------------------------------------------

export {
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  ANON_KEY,
  HAVE_SUPABASE,
  GALAXY_ORG_ID,
} from '../fixtures/manifest';

import {
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  ANON_KEY,
  GALAXY_ORG_ID,
} from '../fixtures/manifest';

// ---------------------------------------------------------------------------
// Admin client + sign-in helpers
// ---------------------------------------------------------------------------

export function createAdmin(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface SeededUser {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  role: UserRole;
  teardown: () => Promise<void>;
}

export type SeededOwner = SeededUser;

/**
 * Provisions an auth user wired to the seeded Galaxy org (not a fresh
 * org). The local signup trigger first creates a disposable owner org.
 * We remove that org through its parent cascade, then create the intended
 * Galaxy membership directly so the real last-owner guard stays enabled.
 */
export async function provisionGalaxyUser(role: UserRole): Promise<SeededUser> {
  const hostname = new URL(SUPABASE_URL).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(
      `Refusing to provision an e2e user against non-local Supabase host: ${hostname}`,
    );
  }

  const admin = createAdmin();
  const { data: keeperOwner, error: keeperErr } = await admin
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', GALAXY_ORG_ID)
    .eq('role', 'owner')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (keeperErr || !keeperOwner) {
    throw new Error(
      `Galaxy fixture requires an active keeper owner: ${keeperErr?.message ?? 'none found'}`,
    );
  }

  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `${role}.${stamp}.${rand}@galaxy.test`;
  const password = `galaxy-${rand}-secret`;
  const displayRole =
    role === 'va' ? 'VA' : role[0]!.toUpperCase() + role.slice(1);
  const displayName = `Galaxy Test ${displayRole}`;

  // Create auth user without running the signup trigger side-effect of
  // provisioning an org. We pass empty metadata so the default trigger
  // creates a stub org (we'll overwrite the users row afterwards).
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_name: `Auto Org ${stamp}-${rand}`,
        full_name: displayName,
      },
    },
  );

  if (createErr || !created.user) {
    throw new Error(
      `Failed to provision Galaxy ${role}: ${createErr?.message ?? 'no user'}`,
    );
  }

  const userId = created.user.id;

  // Capture the stub-org the trigger created so teardown can delete it.
  const { data: userRowBefore } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  const stubOrgId = userRowBefore?.organization_id ?? null;

  if (!stubOrgId || stubOrgId === GALAXY_ORG_ID) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error('Signup trigger did not create a disposable origin org');
  }

  // Deleting the disposable organization is the membership-safe escape for
  // its sole owner: the parent is gone before the membership cascade runs.
  const { error: removeStubErr } = await admin
    .from('organizations')
    .delete()
    .eq('id', stubOrgId);
  if (removeStubErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to remove ${role} origin org: ${removeStubErr.message}`,
    );
  }

  const { error: membershipErr } = await admin
    .from('organization_memberships')
    .insert({
      user_id: userId,
      organization_id: GALAXY_ORG_ID,
      role,
      status: 'active',
      // Preserve the legacy fixture's portfolio-wide scope for owner and VA.
      all_properties: true,
    });
  if (membershipErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to create Galaxy ${role} membership: ${membershipErr.message}`,
    );
  }

  const { error: profileErr } = await admin
    .from('profiles')
    .update({
      display_name: displayName,
      full_name: displayName,
      email,
    })
    .eq('id', userId);

  if (profileErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to update Galaxy ${role} profile: ${profileErr.message}`,
    );
  }

  const teardown = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (stubOrgId && stubOrgId !== GALAXY_ORG_ID) {
      await admin.from('organizations').delete().eq('id', stubOrgId);
    }
  };

  return {
    userId,
    email,
    password,
    organizationId: GALAXY_ORG_ID,
    role,
    teardown,
  };
}

/** Backward-compatible owner fixture used by the existing suites. */
export function provisionGalaxyOwner(): Promise<SeededOwner> {
  return provisionGalaxyUser('owner');
}

export interface FreshOwner {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  teardown: () => Promise<void>;
}

/**
 * Provisions an auth user + fresh empty org (no properties/units/
 * leases/tenants/work orders). Used by the empty-state Today spec.
 */
export async function provisionFreshOwner(): Promise<FreshOwner> {
  const admin = createAdmin();
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `fresh.${stamp}.${rand}@today.test`;
  const password = `fresh-${rand}-secret`;
  const orgName = `Today Empty Org ${stamp}-${rand}`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      organization_name: orgName,
      full_name: 'Today Empty Owner',
    },
  });

  if (error || !created.user) {
    throw new Error(
      `Failed to provision fresh owner: ${error?.message ?? 'no user'}`,
    );
  }

  const userId = created.user.id;

  const { data: userRow } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();

  const organizationId = userRow?.organization_id ?? '';

  // The Today page guards on "has at least one property" and redirects
  // to onboarding otherwise. Seed a single bare property (no units,
  // leases, tenants, work orders, or rent events) so the page renders
  // its genuinely-empty state instead of bouncing to /onboarding.
  if (organizationId) {
    await admin
      .from('properties')
      .insert({ organization_id: organizationId, name: 'Empty Property' });
  }

  const teardown = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    if (organizationId) {
      // Properties cascade-delete with the org; remove the org last.
      await admin
        .from('properties')
        .delete()
        .eq('organization_id', organizationId);
      await admin.from('organizations').delete().eq('id', organizationId);
    }
  };

  return { userId, email, password, organizationId, teardown };
}

/** @supabase/ssr stores the session under `sb-<project-ref>-auth-token`. */
function authCookieName(): string {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  return `sb-${ref}-auth-token`;
}

/**
 * Signs an owner in. Drives the `/login` form first, then — if the form
 * does not land on `/today` quickly (e.g. while the login/middleware
 * surface is mid-refactor on another branch) — falls back to minting a
 * session via supabase-js and injecting the `@supabase/ssr` auth cookie
 * directly. Either path leaves the page authenticated and on `/today`.
 */
export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(credentials.email);
  await page.getByTestId('login-password').fill(credentials.password);
  await page.getByTestId('login-submit').click();

  try {
    await page.waitForURL(/\/today/, { timeout: 8_000 });
    return;
  } catch {
    // Fall through to cookie injection below.
  }

  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error || !data.session) {
    throw new Error(
      `signIn fallback failed: ${error?.message ?? 'no session'}`,
    );
  }

  const value = `base64-${Buffer.from(JSON.stringify(data.session)).toString('base64')}`;
  const origin = new URL(page.url() || 'http://localhost:3000').origin;
  await page.context().addCookies([
    {
      name: authCookieName(),
      value,
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/today');
  await page.waitForURL(/\/today/, { timeout: 15_000 });
}
