/**
 * Inbox thread column — wave-4 functional spec.
 *
 * Replaces the wave-3 approval-detail assertions with conversation
 * thread assertions. Two scenarios:
 *
 *   - Empty state when no conversations exist: the page mounts and the
 *     thread placeholder copy is visible.
 *   - Selecting a seeded conversation surfaces the message body, tenant
 *     header, and the compose row at the bottom.
 */
import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  createProperty,
  createTenantWithLease,
  provisionInboxOwner,
  seedDraft,
  signInOwner,
  type InboxOwner,
} from './helpers';

test.describe('inbox thread column — real data', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('opens the thread for a seeded conversation with the message body', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('detail');
    const admin = createAdmin();

    const propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
      name: 'Bayview Apartments',
    });
    const { tenantId } = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Linda Diallo',
      phoneE164: '+15715559201',
      rentAmount: 2400,
    });
    const draftBody =
      'Detail-pane test: confirming next steps for Linda about the renewal.';
    const { conversationId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: draftBody,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');

    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const header = page.getByTestId('inbox-thread-header');
    await expect(header).toContainText('Linda Diallo');
    // The draft body renders both as the conversation-row preview and
    // inside the pending-draft card; assert against the card specifically
    // so we avoid strict-mode locator collisions.
    await expect(
      page.locator('[data-testid^="pending-draft-"]').getByText(draftBody),
    ).toBeVisible();
    // Compose row is visible at the bottom of the thread.
    await expect(page.getByTestId('inbox-compose-row')).toBeVisible();
  });

  test('shows the empty placeholder when no conversations exist', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('detail-empty');

    await signInOwner(page, owner);
    await page.goto('/inbox');

    await expect(page.getByTestId('inbox-page')).toBeVisible();
    // No conversation rows — the placeholder thread message renders.
    const rows = page.locator('[data-testid^="conversation-row-"]');
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('inbox-thread-empty')).toBeVisible();
  });
});
