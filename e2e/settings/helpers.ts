/**
 * Shared helpers for the Settings Playwright suite.
 *
 * The pattern mirrors `e2e/today/helpers.ts` — every spec gates on
 * `HAVE_SUPABASE` so the collection phase succeeds even when the
 * local Supabase stack is unavailable. Individual tests skip at
 * runtime in that case.
 *
 * Galaxy fixture details:
 *  - Org: Galaxy Estates (plan='managed'; specs pin odesa_phone_number
 *    to '+15715550101' themselves — the shared DB drifts)
 *  - 3 seeded vendors: Beltway Plumbing, Capital HVAC, Handyman Hank
 *  - 1 owner user (seeded by the auth provisioning helper)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

import type { Database } from "../../src/types/database";

// ---------------------------------------------------------------------------
// Environment resolution (mirrors e2e/today/helpers.ts)
// ---------------------------------------------------------------------------

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

export const HAVE_SUPABASE = Boolean(
  SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY,
);

function isLoopbackSupabase(raw: string): boolean {
  try {
    const hostname = new URL(raw).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** Mutation specs must never provision identities against hosted Supabase. */
export const HAVE_LOCAL_SUPABASE =
  HAVE_SUPABASE && isLoopbackSupabase(SUPABASE_URL);

// ---------------------------------------------------------------------------
// Seeded Galaxy handles
// ---------------------------------------------------------------------------

export const GALAXY_ORG_ID = "11111111-1111-1111-1111-111111111101";

/** The Odesa phone number seeded for Galaxy in `supabase/seed.sql`. */
export const GALAXY_PHONE_E164 = "+15715550101";

/** The landlord-facing formatted version of the seeded phone number. */
export const GALAXY_PHONE_DISPLAY = "(571) 555-0101";

/**
 * Seeded vendor IDs — kept in sync with the INSERT in `supabase/seed.sql`.
 * Tests use these to assert DB reads + to target specific rows by id.
 */
export const SEEDED_VENDOR_IDS = {
  plumbing: "88888888-8888-8888-8888-888888888801",
  hvac: "88888888-8888-8888-8888-888888888802",
  general: "88888888-8888-8888-8888-888888888803",
} as const;

// ---------------------------------------------------------------------------
// Admin client + Galaxy owner provisioning
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
 * Provisions a Galaxy owner through the current membership model. The signup
 * trigger first creates a disposable owner organization; deleting that parent
 * is the last-owner-safe escape before the Galaxy membership is inserted.
 */
export async function provisionGalaxyOwner(): Promise<SeededOwner> {
  const admin = createAdmin();
  const { data: keeperOwner, error: keeperError } = await admin
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", GALAXY_ORG_ID)
    .eq("role", "owner")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (keeperError || !keeperOwner) {
    throw new Error(
      `Galaxy fixture requires an active keeper owner: ${keeperError?.message ?? "none found"}`,
    );
  }

  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const email = `settings-owner.${stamp}.${rand}@galaxy.test`;
  const password = `galaxy-settings-${rand}-secret`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        organization_name: `Auto Org ${stamp}-${rand}`,
        full_name: "Galaxy Settings Owner",
      },
    },
  );

  if (createErr || !created.user) {
    throw new Error(
      `Failed to provision Galaxy settings owner: ${createErr?.message ?? "no user"}`,
    );
  }

  const userId = created.user.id;
  const { data: userRowBefore, error: userRowError } = await admin
    .from("users")
    .select("organization_id")
    .eq("id", userId)
    .single();
  const stubOrgId = userRowBefore?.organization_id ?? null;
  if (userRowError || !stubOrgId || stubOrgId === GALAXY_ORG_ID) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Signup trigger did not create a disposable origin org: ${userRowError?.message ?? "missing org"}`,
    );
  }

  const { error: removeStubError } = await admin
    .from("organizations")
    .delete()
    .eq("id", stubOrgId);
  if (removeStubError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to remove settings-owner origin org: ${removeStubError.message}`,
    );
  }

  const { error: membershipError } = await admin
    .from("organization_memberships")
    .insert({
      user_id: userId,
      organization_id: GALAXY_ORG_ID,
      role: "owner",
      status: "active",
      all_properties: true,
    });
  if (membershipError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to create Galaxy settings owner membership: ${membershipError.message}`,
    );
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      display_name: "Galaxy Settings Owner",
      full_name: "Galaxy Settings Owner",
      email,
    })
    .eq("id", userId);
  if (profileError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(
      `Failed to update Galaxy settings owner profile: ${profileError.message}`,
    );
  }

  const teardown = async () => {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
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
 * Signs a seeded owner into the dashboard via the `/login` form. Waits
 * for `/today` before returning, then navigates to `/settings`.
 */
export async function signInAndOpenSettings(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(credentials.email);
  await page.getByTestId("login-password").fill(credentials.password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/today/, { timeout: 15_000 });
  await page.goto("/settings");
}
