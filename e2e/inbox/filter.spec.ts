// TODO(redesign): rewrite for Stitch inbox redesign — see e2e/inbox/redesign.spec.ts
/**
 * Inbox filter bar — Phase 2.
 *
 * Asserts the filter segments drive the feed correctly when the page
 * is backed by real Supabase data:
 *
 *  1. Count badges on every segment match the real totals from the seed
 *     (Galaxy has 0 conversations, 5 work orders, 30 rent events, and
 *     3 escalation-candidate rows: 1 emergency WO + 1 late_3 + 1
 *     escalated rent_event).
 *  2. Clicking each segment rewrites the URL + filters the feed so only
 *     rows of the matching kind remain.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

test.describe.skip('inbox: filter bar drives feed', () => {
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

  test('count badges match Galaxy seed totals', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    const readCount = async (key: string): Promise<number> => {
      const raw = await page
        .getByTestId(`inbox-filter-${key}-count`)
        .textContent();
      return Number(raw?.trim() ?? '0');
    };

    // Seed: 0 conversations, 5 work orders, 30 rent events.
    expect(await readCount('conversations')).toBe(0);
    expect(await readCount('work_orders')).toBe(5);
    expect(await readCount('rent')).toBe(30);

    // All = 0 + 5 + 30 = 35.
    expect(await readCount('all')).toBe(35);

    // Escalations = 1 emergency WO + 1 late_3 rent + 1 escalated rent = 3.
    expect(await readCount('escalations')).toBe(3);
  });

  test('clicking conversations shows an empty feed (seed has 0)', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    await page.getByTestId('inbox-filter-conversations').click();
    await page.waitForFunction(() => {
      return new URL(window.location.href).searchParams.get('filter') ===
        'conversations';
    });

    // Empty-state copy is the conversations variant.
    await expect(page.getByTestId('inbox-feed-empty-copy')).toHaveText(
      'No conversations yet.',
    );
  });

  test('clicking work_orders narrows the feed to WO rows only', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    await page.getByTestId('inbox-filter-work_orders').click();
    await page.waitForFunction(() => {
      return new URL(window.location.href).searchParams.get('filter') ===
        'work_orders';
    });

    const kinds = await page
      .locator('[data-testid="inbox-feed-list"] button[data-kind]')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-kind') ?? ''),
      );

    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) {
      expect(k).toBe('work_order');
    }
  });

  test('clicking rent narrows the feed to rent_event rows only', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    await page.getByTestId('inbox-filter-rent').click();
    await page.waitForFunction(() => {
      return new URL(window.location.href).searchParams.get('filter') ===
        'rent';
    });

    const kinds = await page
      .locator('[data-testid="inbox-feed-list"] button[data-kind]')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-kind') ?? ''),
      );

    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) {
      expect(k).toBe('rent_event');
    }
  });

  test('clicking escalations narrows the feed to the 3 escalation-candidate rows', async ({
    page,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    await page.getByTestId('inbox-filter-escalations').click();
    await page.waitForFunction(() => {
      return new URL(window.location.href).searchParams.get('filter') ===
        'escalations';
    });

    const rows = page.locator(
      '[data-testid="inbox-feed-list"] button[data-kind]',
    );
    // Seed produces exactly 3 escalation rows (see filter-count test).
    await expect(rows).toHaveCount(3);
  });
});
