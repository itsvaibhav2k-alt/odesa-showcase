// TODO(redesign): rewrite for Stitch inbox redesign — see e2e/inbox/redesign.spec.ts
/**
 * Inbox screen shell — Phase 1 E2E.
 *
 * Covers:
 *  - Navigating to `/inbox` renders the two-column shell
 *  - Filter bar segments render (All / Conversations / Work Orders /
 *    Rent / Escalations) each with a count badge
 *  - Clicking a segment updates the URL's `filter=` param and swaps
 *    the empty-state copy accordingly
 *  - Detail pane empty state renders in the right column
 *  - No console errors during the interaction
 *  - Visual regression snapshot at desktop width
 *
 * The middleware's dev bypass (`src/lib/supabase/middleware.ts`) allows
 * us to hit `/inbox` without signed-in credentials when Supabase env
 * vars are absent — which is how this spec runs in local + CI until
 * Agent B's Supabase schema is provisioned against the test env.
 *
 * When production auth is wired in and Supabase env is set, the dev
 * bypass goes away. Until then this spec is additive and independent
 * of the auth + onboarding stream (Agent C).
 */

import { expect, test } from '@playwright/test';

// Wave 4 removed src/components/inbox/filters.ts (3-bucket queue is gone).
// The spec below is fully `.describe.skip`-gated, so we keep the type
// definition local to satisfy TS until the file itself is rewritten.
type InboxFilterKey =
  | 'all'
  | 'conversations'
  | 'work_orders'
  | 'rent'
  | 'escalations';

// All filter segments and their expected empty-state copy. Keep in sync
// with EMPTY_STATES in `src/components/inbox/feed-shell.tsx`.
const FILTER_CASES: ReadonlyArray<{
  key: InboxFilterKey;
  copy: string;
}> = [
  { key: 'all', copy: 'Your first tenant conversation will show up here.' },
  { key: 'conversations', copy: 'No conversations yet.' },
  { key: 'work_orders', copy: 'No work orders yet.' },
  { key: 'rent', copy: "Rent events appear here as they're collected." },
  {
    key: 'escalations',
    copy: 'Nothing needs your attention. Good week.',
  },
];

test.describe.skip('inbox: shell', () => {
  test('renders two-column shell with filter bar + empty feed + empty detail pane', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/inbox');

    // If middleware sent us to /login (production mode without seeded
    // credentials), skip the rest — Agent C owns that flow and this
    // spec intentionally sits downstream of their work.
    if (/\/login/.test(page.url())) {
      test.skip(true, 'Auth gate active; re-run with seeded fixture (Agent C).');
      return;
    }

    await expect(page.getByTestId('inbox-page')).toBeVisible();
    await expect(page.getByTestId('inbox-filter-bar')).toBeVisible();
    await expect(page.getByTestId('inbox-feed')).toBeVisible();
    await expect(page.getByTestId('inbox-detail-pane')).toBeVisible();

    // Every segment renders with a count badge (all zeros in Phase 1).
    for (const { key } of FILTER_CASES) {
      await expect(page.getByTestId(`inbox-filter-${key}`)).toBeVisible();
      const badge = page.getByTestId(`inbox-filter-${key}-count`);
      await expect(badge).toHaveText('0');
    }

    await expect(page.getByTestId('inbox-detail-pane-empty-copy')).toHaveText(
      'Select an item to see details',
    );

    expect(
      consoleErrors,
      `unexpected console errors: ${consoleErrors.join('\n')}`,
    ).toHaveLength(0);
  });

  test('clicking each filter segment updates the URL + swaps empty-state copy', async ({
    page,
  }) => {
    await page.goto('/inbox');
    if (/\/login/.test(page.url())) {
      test.skip(true, 'Auth gate active; re-run with seeded fixture (Agent C).');
      return;
    }

    // The landing state is `all` — no filter param in the URL because
    // the default is elided by `updateParam()`.
    await expect(page.getByTestId('inbox-feed-empty-copy')).toHaveText(
      'Your first tenant conversation will show up here.',
    );

    for (const { key, copy } of FILTER_CASES) {
      await page.getByTestId(`inbox-filter-${key}`).click();

      // URL reflects the selection. `all` is the default and is elided;
      // everything else sets `?filter=<key>`.
      await page.waitForFunction(
        ([target, defaultKey]) => {
          const url = new URL(window.location.href);
          const current = url.searchParams.get('filter');
          if (target === defaultKey) {
            return current === null;
          }
          return current === target;
        },
        [key, 'all'] as const,
      );

      // Segment is marked active.
      await expect(
        page.getByTestId(`inbox-filter-${key}`),
      ).toHaveAttribute('data-active', 'true');

      // Empty-state copy swaps.
      await expect(page.getByTestId('inbox-feed-empty-copy')).toHaveText(copy);
    }
  });

  test('visual regression — desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/inbox');
    if (/\/login/.test(page.url())) {
      test.skip(true, 'Auth gate active; re-run with seeded fixture (Agent C).');
      return;
    }

    // Wait for fonts + layout to settle so the snapshot is stable.
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('inbox-page')).toBeVisible();

    await expect(page).toHaveScreenshot('inbox-shell-desktop.png', {
      fullPage: true,
      // Mask the top bar — it renders the user menu / org name which
      // depend on auth state and so would vary between environments.
      mask: [page.getByTestId('top-bar')],
    });
  });
});
