/**
 * Inbox conversation list — wave-4 functional spec.
 *
 * The wave-3 surface had a 3-bucket approval feed. Wave 4 replaces it
 * with an iMessage-style conversation list. This spec verifies the
 * list renders one row per seeded conversation with the tenant name
 * and a non-empty preview, and that clicking a row opens the thread.
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

test.describe('inbox conversation list — real data', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('renders one row per seeded conversation with tenant name', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('feed');
    const admin = createAdmin();

    const propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
    });
    const { tenantId } = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Priya Banerjee',
      phoneE164: '+15715559101',
    });

    const { conversationId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: 'Reply YES to confirm the rent adjustment for next month.',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');

    await expect(page.getByTestId('inbox-page')).toBeVisible();
    const row = page.getByTestId(`conversation-row-${conversationId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Priya Banerjee');
    // The seeded draft is pending_review → the gold attention dot
    // should be present on the row.
    await expect(row.getByTestId('conversation-pending-dot')).toBeVisible();
  });

  test('clicking a conversation opens the thread and shows the message body', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('feed-click');
    const admin = createAdmin();
    const propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
    });
    const { tenantId } = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Jordan Chen',
      phoneE164: '+15715559102',
    });
    const draftBody =
      'Quick maintenance follow-up — vendor confirmed for Thursday morning.';
    const { conversationId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: draftBody,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');

    await page.getByTestId(`conversation-row-${conversationId}`).click();
    await expect(page.getByTestId(`inbox-thread-${conversationId}`)).toBeVisible();
    await expect(page.getByText(draftBody)).toBeVisible();
  });
});
