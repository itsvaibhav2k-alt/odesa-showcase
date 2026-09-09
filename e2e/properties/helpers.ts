/**
 * Local helpers for the Properties Playwright suite.
 *
 * Provisions a Galaxy-owner auth user pointing at Agent B's seeded
 * Galaxy org and signs them in. Matches the gating pattern used by
 * `e2e/today/helpers.ts` and `e2e/supabase/rls.spec.ts` so the suite
 * skips cleanly when the local Supabase stack isn't running.
 *
 * Also exposes a small `seedConversation()` helper used by the
 * unit-detail spec, which needs at least one conversation against the
 * Galaxy tenant under unit 101 (Marcus Alvarez) to exercise the
 * right-rail card rendering.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

import type { Database } from '../../src/types/database';

// ---------------------------------------------------------------------------
// Environment resolution + seeded Galaxy IDs
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
  OAKWOOD_PROPERTY_ID,
  SEVENTEENTH_PROPERTY_ID,
  UNIT_101_ID,
  UNIT_204_ID,
  UNIT_C_ID,
  MARCUS_TENANT_ID,
  JESSICA_TENANT_ID,
} from '../fixtures/manifest';

import {
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
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

export interface SeededOwner {
  userId: string;
  email: string;
  password: string;
  organizationId: string;
  teardown: () => Promise<void>;
}

/**
 * Provisions an auth user wired to the seeded Galaxy org. Matches the
 * implementation in `e2e/today/helpers.ts` so the suite shares its
 * behavior: the signup trigger creates a stub org, we repoint the
 * users row at Galaxy, and teardown deletes both.
 */
export async function provisionGalaxyOwner(): Promise<SeededOwner> {
  const admin = createAdmin();
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `owner.${stamp}.${rand}@galaxy-properties.test`;
  const password = `galaxy-${rand}-secret`;

  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_name: `Auto Org Properties ${stamp}-${rand}`,
        full_name: 'Galaxy Test Owner',
      },
    });

  if (createErr || !created.user) {
    throw new Error(
      `Failed to provision Galaxy owner: ${createErr?.message ?? 'no user'}`,
    );
  }

  const userId = created.user.id;

  const { data: userRowBefore } = await admin
    .from('users')
    .select('organization_id')
    .eq('id', userId)
    .single();
  const stubOrgId = userRowBefore?.organization_id ?? null;

  const { error: updateErr } = await admin
    .from('users')
    .update({
      organization_id: GALAXY_ORG_ID,
      role: 'owner',
      display_name: 'Galaxy Test Owner',
      full_name: 'Galaxy Test Owner',
      email,
    })
    .eq('id', userId);

  if (updateErr) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to repoint users row to Galaxy: ${updateErr.message}`,
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
    teardown,
  };
}

/**
 * Signs an owner in via the `/login` form and waits for `/today`.
 */
export async function signIn(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(credentials.email);
  await page.getByTestId('login-password').fill(credentials.password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/today/, { timeout: 15_000 });
}

/**
 * Seeds one conversation for the given tenant. Returns the conversation
 * id and a teardown that removes it. Used by the unit-detail spec to
 * assert the right-rail renders a card.
 */
export async function seedConversation(
  tenantId: string,
  opts?: { summary?: string; channel?: 'voice' | 'sms' | 'imessage' },
): Promise<{ id: string; teardown: () => Promise<void> }> {
  const admin = createAdmin();
  const summary = opts?.summary
    ?? 'Tenant asked about rent timing and pickup window for parcels.';
  const channel = opts?.channel ?? 'sms';
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from('conversations')
    .insert({
      organization_id: GALAXY_ORG_ID,
      tenant_id: tenantId,
      channel,
      status: 'open',
      summary,
      last_message_at: now,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to seed conversation for tenant ${tenantId}: ${error?.message}`,
    );
  }

  const teardown = async () => {
    await admin.from('conversations').delete().eq('id', data.id);
  };

  return { id: data.id, teardown };
}
