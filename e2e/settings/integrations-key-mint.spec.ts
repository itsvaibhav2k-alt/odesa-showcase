/**
 * Settings → Integrations — Poke key mint + revoke flow (Phase 5).
 *
 * Covers the operator-onboarding surface:
 *   1. Generate a key with a custom label.
 *   2. Assert the one-time-display modal appears with the full plaintext
 *      key (`odesa_mcp_…`), warning copy, and a working Copy button.
 *   3. Dismiss the modal — key is no longer visible in plaintext but the
 *      list now contains a row showing the key prefix + label.
 *   4. Revoke that key (two-click confirm) and assert it disappears from
 *      the list.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyOwner,
  type SeededOwner,
} from './helpers';

test.describe('settings → integrations: poke key mint + revoke', () => {
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
      // Best-effort cleanup of any keys created during the test so the
      // next run starts clean.
      const admin = createAdmin();
      await admin
        .from('mcp_api_keys')
        .delete()
        .eq('user_id', owner.userId);
      await owner.teardown();
    }
  });

  test('mint, reveal, dismiss, revoke', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(owner.email);
    await page.getByTestId('login-password').fill(owner.password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/today/, { timeout: 15_000 });

    await page.goto('/settings/integrations');
    await expect(page.getByTestId('integrations-page')).toBeVisible();
    await expect(page.getByTestId('integrations-section-mcp')).toBeVisible();

    // Empty state initially.
    await expect(page.getByTestId('integrations-keys-empty')).toBeVisible();

    // Open the inline label form, fill it, submit.
    await page.getByTestId('integrations-generate-key').click();
    await expect(page.getByTestId('integrations-key-form')).toBeVisible();
    const labelInput = page.getByTestId('integrations-key-label-input');
    await labelInput.fill('Test Key');
    await page.getByTestId('integrations-key-confirm').click();

    // One-time display modal appears with the plaintext key.
    const modal = page.getByTestId('api-key-display');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('api-key-display-warning')).toContainText(
      /won't see this/i,
    );
    const keyBlock = page.getByTestId('api-key-display-key');
    await expect(keyBlock).toBeVisible();
    const fullKey = (await keyBlock.textContent())?.trim() ?? '';
    expect(fullKey).toMatch(/^odesa_mcp_[A-Za-z0-9_-]{32}$/);

    // Copy + Done.
    await page.getByTestId('api-key-display-copy').click();
    await expect(page.getByTestId('api-key-display-copy')).toContainText(
      /copied/i,
    );
    await page.getByTestId('api-key-display-done').click();
    await expect(modal).toBeHidden();

    // Plaintext key is no longer visible anywhere on the page.
    await expect(page.locator(`text=${fullKey}`)).toHaveCount(0);

    // List now shows the key with its prefix + label.
    const list = page.getByTestId('integrations-keys-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('Test Key');
    // The first 8 chars after the `odesa_mcp_` prefix should appear.
    const expectedPrefix = fullKey.slice(0, 'odesa_mcp_'.length + 8);
    await expect(list).toContainText(expectedPrefix);

    // DB row was created with the right shape.
    const admin = createAdmin();
    const { data: row } = await admin
      .from('mcp_api_keys')
      .select('id, label, key_prefix, key_hash, revoked_at')
      .eq('user_id', owner.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(row?.label).toBe('Test Key');
    expect(row?.key_prefix).toBe(expectedPrefix);
    expect(row?.key_hash).toBeTruthy();
    expect(row?.revoked_at).toBeNull();

    // Revoke: first click flips to "Confirm revoke", second click commits.
    const keyId = row?.id ?? '';
    expect(keyId).toBeTruthy();
    const revokeBtn = page.getByTestId(`integrations-key-revoke-${keyId}`);
    await revokeBtn.click();
    await expect(revokeBtn).toContainText(/confirm revoke/i);
    await revokeBtn.click();

    // Row is gone (filtered by revoked_at IS NULL on the page query).
    await expect(page.getByTestId(`integrations-key-row-${keyId}`)).toHaveCount(
      0,
      { timeout: 10_000 },
    );

    // DB tombstone is set.
    const { data: revokedRow } = await admin
      .from('mcp_api_keys')
      .select('revoked_at')
      .eq('id', keyId)
      .single();
    expect(revokedRow?.revoked_at).toBeTruthy();
  });
});
