/**
 * TEMP — opens a headed, authenticated browser on the running dev server so
 * the polished pages can be explored by hand. Signs in as a seeded Galaxy
 * owner and lands on /today, then stays open until this process is killed.
 *
 * Run: BASE_URL=http://localhost:3013 npx playwright test \
 *   e2e/route-sweep/open-dev.spec.ts --project=chromium --headed --workers=1 --timeout=0
 * Delete after use.
 */
import { test } from '@playwright/test';

import { HAVE_SUPABASE, provisionGalaxyOwner, signIn } from '../properties/helpers';

test('open dev server (headed, authenticated)', async ({ browser }) => {
  test.skip(!HAVE_SUPABASE, 'needs Supabase env');
  test.setTimeout(0);
  const owner = await provisionGalaxyOwner();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page, { email: owner.email, password: owner.password });
  await page.goto('/today');
  // eslint-disable-next-line no-console
  console.log('OPEN_DEV_READY — authenticated browser is live at /today. Explore freely; kill this process to close.');
  await new Promise(() => {}); // keep the browser open
});
