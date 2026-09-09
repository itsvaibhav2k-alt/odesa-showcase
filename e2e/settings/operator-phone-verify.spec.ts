/**
 * Settings → Integrations — operator phone verify flow (Phase 5).
 *
 * Covers the OTP code path that unlocks iMessage routing:
 *   1. Open /settings/integrations, assert the verify card is in entry
 *      state (no `users.phone_e164` yet).
 *   2. Enter a phone, click Send code, assert the form transitions to
 *      the confirm state and the messaging mock recorded a send to that
 *      phone with body containing "Your Odesa verification code: NNNNNN".
 *   3. Read the 6-digit code from the recorded send body, type it into
 *      the confirm form, click Verify.
 *   4. Assert `users.phone_e164` + `users.phone_verified_at` are
 *      populated and the page now shows the verified card state.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyOwner,
  type SeededOwner,
} from './helpers';

const TEST_PHONE = '+15555550100';

test.describe('settings → integrations: operator phone verify', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;

  test.beforeEach(async ({ request }) => {
    owner = await provisionGalaxyOwner();
    const mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (owner) {
      const admin = createAdmin();
      await admin
        .from('phone_verifications')
        .delete()
        .eq('user_id', owner.userId);
      await owner.teardown();
    }
  });

  test('send code → confirm code → users row updated', async ({
    page,
    request,
  }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(owner.email);
    await page.getByTestId('login-password').fill(owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto('/settings/integrations');
    await expect(page.getByTestId('integrations-page')).toBeVisible();

    // Entry state: phone input + Send code button.
    const entry = page.getByTestId('phone-verify-entry');
    await expect(entry).toBeVisible();
    await page.getByTestId('phone-verify-input').fill(TEST_PHONE);
    await page.getByTestId('phone-verify-send').click();

    // The form transitions to confirm state.
    const confirm = page.getByTestId('phone-verify-confirm');
    await expect(confirm).toBeVisible({ timeout: 10_000 });

    // The messaging mock recorded the OTP send to TEST_PHONE.
    const mock = createMessagingMockHarness(request);
    const recorded = await mock.getRecorded();
    expect(recorded.length).toBeGreaterThan(0);
    const last = recorded[recorded.length - 1]!;
    expect(last.to).toBe(TEST_PHONE);
    expect(last.body).toMatch(/Your Odesa verification code: \d{6}/);
    const codeMatch = last.body.match(/(\d{6})/);
    const code = codeMatch?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);

    // Type the code, click Verify.
    await page.getByTestId('phone-verify-code-input').fill(code);
    await page.getByTestId('phone-verify-confirm-btn').click();

    // The page revalidates → verified card replaces the form.
    await expect(page.getByTestId('personal-phone-number')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('personal-phone-number')).toContainText(
      '555',
    );

    // DB has the right state.
    const admin = createAdmin();
    const { data: userRow } = await admin
      .from('users')
      .select('phone_e164, phone_verified_at')
      .eq('id', owner.userId)
      .single();
    expect(userRow?.phone_e164).toBe(TEST_PHONE);
    expect(userRow?.phone_verified_at).toBeTruthy();

    // The verification row was marked consumed.
    const { data: verRow } = await admin
      .from('phone_verifications')
      .select('consumed_at')
      .eq('user_id', owner.userId)
      .eq('phone_e164', TEST_PHONE)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(verRow?.consumed_at).toBeTruthy();
  });

  test('rejects an invalid code', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(owner.email);
    await page.getByTestId('login-password').fill(owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto('/settings/integrations');
    await page.getByTestId('phone-verify-input').fill(TEST_PHONE);
    await page.getByTestId('phone-verify-send').click();
    await expect(page.getByTestId('phone-verify-confirm')).toBeVisible({
      timeout: 10_000,
    });

    // Type a wrong code and submit.
    await page.getByTestId('phone-verify-code-input').fill('000000');
    await page.getByTestId('phone-verify-confirm-btn').click();

    await expect(page.getByTestId('phone-verify-error')).toBeVisible();
    await expect(page.getByTestId('phone-verify-error')).toContainText(
      /invalid|expired/i,
    );
  });
});
