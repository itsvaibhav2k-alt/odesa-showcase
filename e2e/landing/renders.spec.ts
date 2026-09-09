/**
 * Landing page spec.
 *
 * Verifies:
 *   - Anonymous `/` renders the React MarketingPage (no redirect)
 *   - Static `/landing.html` still serves as fallback
 *   - Form submission POSTs to `/api/waitlist` and switches CTA copy
 */

import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, createAdmin } from '../today/helpers';

test.describe('landing page', () => {
  test('anonymous root renders the React marketing hero', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('text=Request access').first()).toBeVisible();
  });

  test.describe('waitlist submit', () => {
    test.skip(
      !HAVE_SUPABASE,
      'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
    );

    let capturedEmail: string | null = null;

    test.afterEach(async () => {
      if (!capturedEmail) return;
      const admin = createAdmin();
      await admin
        .from('waitlist')
        .delete()
        .eq('email', capturedEmail.toLowerCase());
      capturedEmail = null;
    });

    test('submitting the inline form hits /api/waitlist', async ({ page }) => {
      const email = `landing.${Date.now()}.${Math.random()
        .toString(36)
        .slice(2, 8)}@odesa.test`;
      capturedEmail = email;

      await page.goto('/landing.html');
      await page.fill('#waitlist-form input[name="email"]', email);
      await page.click('#waitlist-form button[type="submit"]');

      const btn = page.locator('#waitlist-form button[type="submit"]');
      await expect(btn).toContainText('Thank you', { timeout: 10_000 });

      // Verify the row actually landed server-side.
      const admin = createAdmin();
      const { data } = await admin
        .from('waitlist')
        .select('id, source')
        .eq('email', email.toLowerCase())
        .single();
      expect(data?.source).toBe('landing');
    });
  });
});
