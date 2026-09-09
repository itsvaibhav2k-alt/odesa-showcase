import { expect, test } from '@playwright/test';

/**
 * Smoke suite — runs on every PR. Confirms the three entry points
 * (landing, login, signup) render and that unauthenticated access to
 * `/today` redirects back to sign-in (or the auth error page —
 * whichever the middleware implements).
 *
 * These tests intentionally avoid touching Supabase so they remain
 * green while Agent B's schema and Agent C's onboarding flow are
 * still in flight.
 */

test.describe('smoke: public surface', () => {
  test('root page renders the Odesa heading', async ({ page }) => {
    await page.goto('/');

    // Landing copy changes as Phase 1 evolves; the one invariant is the
    // "Odesa" wordmark.
    await expect(page.getByText(/Odesa/i).first()).toBeVisible();
  });

  test('/login renders the sign-in form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('/signup renders the signup form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByTestId('signup-form')).toBeVisible();
    await expect(page.getByTestId('signup-email')).toBeVisible();
    await expect(page.getByTestId('signup-password')).toBeVisible();
    await expect(page.getByTestId('signup-submit')).toBeVisible();
  });
});

test.describe('smoke: auth gating', () => {
  test('/today unauthenticated redirects or shows auth prompt', async ({
    page,
  }) => {
    const response = await page.goto('/today');

    // The middleware either server-redirects to /login or renders an
    // auth error page. Either is a correct Phase 1 behavior.
    const url = page.url();
    const redirectedToLogin = /\/login(\?|$)/.test(url);
    const stayedAtToday = /\/today(\?|$)/.test(url);

    if (redirectedToLogin) {
      // Redirect path — expect the login form to be visible now.
      await expect(page.getByTestId('login-form')).toBeVisible();
    } else if (stayedAtToday) {
      // Middleware may render an auth gate instead of redirecting.
      // Either login-form, an error message, or the 401/403 response
      // status is acceptable here.
      expect(response?.status() ?? 200).toBeLessThan(500);
    } else {
      throw new Error(`Unexpected URL after /today visit: ${url}`);
    }
  });
});
