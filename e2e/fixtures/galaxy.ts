/**
 * Shared Playwright fixtures for the seeded "Galaxy Estates" portfolio.
 *
 * Agent B seeds the real data via `supabase/seed.sql` (10 units, 10
 * tenants, 10 leases, 5 work orders across various states). This file
 * exposes the typed handles and helpers every downstream spec uses:
 *
 *   - `seedGalaxy()` — resets the fixture to a known state (no-op until
 *     Agent B's migrations land; a TODO stub for now).
 *   - `signInAs(page, role)` — sign-in helper keyed on seeded roles.
 *   - `GALAXY` — typed test data handles (owner email, org name,
 *     tenants, units, etc.) so specs don't hard-code magic strings.
 *
 * Keep this module import-side-effect-free: specs that don't touch
 * Supabase (e.g. the smoke suite) must still be able to import types
 * without triggering DB calls.
 */

import type { Page } from '@playwright/test';

/** Seeded roles inside the Galaxy org. */
export type GalaxyRole = 'owner' | 'manager' | 'va';

/** Seeded tenant handles, keyed by unit label. */
export interface GalaxyTenant {
  unitLabel: string;
  name: string;
  phoneE164: string;
  email: string;
}

/** Seeded property/unit handles. */
export interface GalaxyUnit {
  propertyName: string;
  label: string;
  bedrooms: number;
  bathrooms: number;
}

/** Typed Galaxy test data, mirroring `supabase/seed.sql`. */
export const GALAXY = {
  organization: {
    name: 'Galaxy Estates',
    timezone: 'America/New_York',
  },
  owner: {
    email: 'owner@galaxy-estates.test',
    password: 'galaxy-test-owner-password',
    displayName: 'Galaxy Owner',
  },
  manager: {
    email: 'manager@galaxy-estates.test',
    password: 'galaxy-test-manager-password',
    displayName: 'Galaxy Manager',
  },
  va: {
    email: 'va@galaxy-estates.test',
    password: 'galaxy-test-va-password',
    displayName: 'Galaxy VA',
  },
} as const;

/**
 * Resets the seeded Galaxy fixture to the known-good state. Must be
 * idempotent.
 *
 * Implementation lands once Agent B merges the migrations + seed SQL.
 * Until then this is a no-op; specs that depend on seeded data should
 * be written but marked `.skip()` until the dependency is ready.
 *
 * @example
 * test.beforeEach(async () => {
 *   await seedGalaxy();
 * });
 */
export async function seedGalaxy(): Promise<void> {
  // TODO(agent-b): wire to Supabase once seed.sql lands.
  // For now, the smoke suite does not require seeded data and
  // downstream specs should gate on this helper.
  return;
}

/**
 * Signs a seeded Galaxy user in via the `/login` form. Uses Playwright's
 * standard form-filling rather than an API token so the flow mirrors
 * real users and exercises the auth path end-to-end.
 *
 * @param page - active Playwright Page
 * @param role - which seeded Galaxy user to sign in as
 */
export async function signInAs(page: Page, role: GalaxyRole): Promise<void> {
  const creds = GALAXY[role];
  await page.goto('/login');
  await page.getByTestId('login-email').fill(creds.email);
  await page.getByTestId('login-password').fill(creds.password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/today/);
}

/** Typed shape of tenants; real data populated by Agent B. */
export const GALAXY_TENANTS: readonly GalaxyTenant[] = [];

/** Typed shape of units; real data populated by Agent B. */
export const GALAXY_UNITS: readonly GalaxyUnit[] = [];
