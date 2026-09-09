// TODO(redesign): rewrite for Stitch inbox redesign — see e2e/inbox/redesign.spec.ts
/**
 * Inbox feed keyboard navigation (spec §11.2).
 *
 *   j — next row
 *   k — previous row
 *   Enter — (re)open the detail pane for the current selection
 *   Escape — clear the selection
 *
 * Verified against a seeded Galaxy feed so j/k has > 1 row to move
 * between. Modifier-key chording (Cmd+J, Cmd+K) intentionally does NOT
 * hijack the browser and is covered indirectly by the handler guarding
 * against `e.metaKey || e.ctrlKey || e.altKey`.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

test.describe.skip('inbox: keyboard navigation', () => {
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

  test('j moves to the first row, then to the second', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    // Focus the page body so j is not swallowed by the search input.
    await page.locator('body').click();

    const rows = page.locator('[data-testid="inbox-feed-list"] > li');
    await expect(rows.first()).toBeVisible();

    await page.keyboard.press('j');
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.has('id'),
    );
    const firstId = new URL(page.url()).searchParams.get('id');
    expect(firstId).toBeTruthy();

    await page.keyboard.press('j');
    await page.waitForFunction((prev) => {
      const cur = new URL(window.location.href).searchParams.get('id');
      return cur !== null && cur !== prev;
    }, firstId);
    const secondId = new URL(page.url()).searchParams.get('id');
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  test('k moves selection back up', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');
    await page.locator('body').click();

    await page.keyboard.press('j');
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.has('id'),
    );
    await page.keyboard.press('j');
    await page.waitForTimeout(200);

    const beforeK = new URL(page.url()).searchParams.get('id');

    await page.keyboard.press('k');
    await page.waitForFunction((prev) => {
      const cur = new URL(window.location.href).searchParams.get('id');
      return cur !== null && cur !== prev;
    }, beforeK);

    const afterK = new URL(page.url()).searchParams.get('id');
    expect(afterK).not.toBe(beforeK);
  });

  test('Escape clears the selection', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');
    await page.locator('body').click();

    await page.keyboard.press('j');
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.has('id'),
    );

    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => !new URL(window.location.href).searchParams.has('id'),
    );

    expect(new URL(page.url()).searchParams.has('id')).toBe(false);
    expect(new URL(page.url()).searchParams.has('kind')).toBe(false);
  });

  test('keyboard shortcuts are ignored while typing in the search input', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    await page.getByTestId('inbox-search-input').focus();
    await page.keyboard.press('j');
    await page.waitForTimeout(250);

    // No selection should have been applied while the search input owned focus.
    expect(new URL(page.url()).searchParams.has('id')).toBe(false);
  });
});
