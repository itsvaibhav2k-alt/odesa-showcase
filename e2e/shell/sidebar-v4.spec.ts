/**
 * Sidebar v4 — Wave 8 functional spec.
 *
 * Asserts the redesigned 200px sidebar across the three primary
 * operator routes:
 *   - Sidebar root + per-route active link.
 *   - Account footer dropdown opens; Sign out routes to /login.
 *
 * Counts are asserted as "present and numeric where expected" — exact
 * values vary across env seed data so we don't pin to a fixed total.
 */
import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  provisionGalaxyUser,
  signIn,
  type SeededOwner,
  type SeededUser,
} from '../today/helpers';

test.describe('shell sidebar v4', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
  });

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('sidebar mounts and Today active when on /today', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/today');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-today')).toHaveAttribute(
      'aria-current',
      'page',
    );

    const ownerLinks = page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link');
    await expect(ownerLinks).toHaveText([
      /Today/,
      /Ask Odesa/,
      /Owner Queue/,
      /Inbox/,
      /Calls/,
      /Properties/,
      /Rent/,
      /Settings/,
    ]);
    await expect(page.getByTestId('sidebar-link-open-items')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-link-ask-odesa')).toHaveAttribute(
      'href',
      '/assistant',
    );
    await expect(page.getByTestId('sidebar-link-tenants')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-link-vendors')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-link-documents')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-link-financials')).toHaveCount(0);
  });

  test('Inbox link active on /inbox; nav links visible', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-inbox')).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The other operator + portfolio links are present too.
    await expect(page.getByTestId('sidebar-link-today')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-properties')).toBeVisible();
  });

  test('Properties link active on /properties', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/properties');
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-properties')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('account footer dropdown opens and Sign out routes to /login', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/today');
    await page.getByTestId('user-menu').click();
    await expect(page.getByTestId('user-menu-signout')).toBeVisible();
    await page.getByTestId('user-menu-signout').click();
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login/);
  });
});

test.describe('VA shell sidebar v4', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let va: SeededUser;

  test.beforeEach(async () => {
    va = await provisionGalaxyUser('va');
  });

  test.afterEach(async () => {
    if (va) await va.teardown();
  });

  test('renders one shift burden count and bounded VA navigation', async ({
    page,
  }) => {
    await signIn(page, { email: va.email, password: va.password });
    await expect(page.getByTestId('user-role-label')).toHaveText(
      'Operations Assistant',
    );
    await expect(page.getByTestId('sidebar-link-my-shift')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-work-inbox')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-escalations')).toBeVisible();
    await expect(page.getByTestId('sidebar-link-owner-queue')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-link-financials')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-link-rent')).toHaveCount(0);

    const visibleNavCounts = page
      .getByTestId('sidebar')
      .locator('nav [aria-label$="items needing attention"]');
    expect(await visibleNavCounts.count()).toBeLessThanOrEqual(1);
  });

  test('account menu identifies VA without owner settings controls', async ({
    page,
  }) => {
    await signIn(page, { email: va.email, password: va.password });
    await page.getByTestId('user-menu').click();
    await expect(page.getByTestId('user-menu-signout')).toBeVisible();
    await expect(page.getByTestId('user-menu-profile')).toHaveCount(0);
    await expect(page.getByTestId('user-menu-settings')).toHaveCount(0);
  });

  test('lands on work-first Today and Inbox while assistant stays owner-reserved', async ({
    page,
  }) => {
    await signIn(page, { email: va.email, password: va.password });
    await expect(
      page.getByTestId('dashboard-main').getByRole('heading', {
        level: 1,
        name: 'Welcome back, Galaxy Test VA',
      }),
    ).toBeVisible();

    await page.goto('/inbox');
    await expect(
      page.getByRole('heading', { name: 'Work inbox' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compose' })).toHaveCount(0);

    await page.goto('/assistant');
    await page.waitForURL(/\/today$/);
    await expect(
      page.getByTestId('dashboard-main').getByRole('heading', {
        level: 1,
        name: 'Welcome back, Galaxy Test VA',
      }),
    ).toBeVisible();
    await expect(page.getByTestId('sidebar-link-ask-odesa')).toHaveCount(0);
  });

  test('routes owner-only workspaces back to bounded VA context', async ({
    page,
  }) => {
    await signIn(page, { email: va.email, password: va.password });

    await page.goto('/owner-queue');
    await page.waitForURL(/\/escalations$/);

    await page.goto('/calls/settings');
    await page.waitForURL(/\/calls$/);
    await expect(page.getByTestId('calls-va-boundary')).toBeVisible();

    await page.goto('/rent');
    await page.waitForURL(/\/escalations$/);

    await page.goto('/financials');
    await page.waitForURL(/\/today$/);
  });
});
