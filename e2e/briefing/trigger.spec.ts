/**
 * Phase 7 — weekly briefing trigger + Today card render.
 *
 * Signs in a Galaxy owner, hits `/api/briefing/trigger`, then reloads
 * Today and asserts the briefing card switched from its empty state to
 * the rendered briefing text.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

test.describe('briefing trigger + Today render', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
  });

  test.afterEach(async () => {
    if (owner) {
      // Clean up the weekly report we just triggered so subsequent runs
      // don't collide on the (org, week_start_date) unique index.
      const admin = createAdmin();
      await admin
        .from('weekly_reports')
        .delete()
        .eq('organization_id', owner.organizationId);
      await owner.teardown();
    }
  });

  test('trigger creates a weekly_reports row and Today card renders it', async ({
    page,
    request,
  }) => {
    await signIn(page, { email: owner.email, password: owner.password });

    // Re-use the authenticated browser cookies on the trigger call.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const res = await request.post('/api/briefing/trigger', {
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.briefing_text).toContain('Week of');

    // Reload Today to pick up the newly-persisted briefing.
    await page.goto('/today');
    const card = page.getByTestId('today-briefing-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Week of');
  });
});
