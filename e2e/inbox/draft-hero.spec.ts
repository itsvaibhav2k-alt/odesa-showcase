/**
 * DraftHeroCard — Wave 8 functional spec.
 *
 * Coverage:
 *   - Pending drafts remain evidence-only in Inbox and hand off decisions to
 *     Owner Queue; no inline approve/edit/reject path is exposed.
 *   - "Why this draft?" popover renders the honest known-context
 *     fallback (the data layer does not persist a reasoning trace).
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
import {
  createMessagingMockHarness,
  type MessagingMockHarness,
} from '../mocks/messaging-mock';

test.describe('inbox draft hero card', () => {
  test.setTimeout(90_000);
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;
  let tenantId: string;
  let propertyId: string;
  let mock: MessagingMockHarness;

  test.beforeEach(async ({ request }) => {
    owner = await provisionInboxOwner('draft-hero');
    const admin = createAdmin();
    propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
      name: 'Hero Property',
    });
    const ctx = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Henry Hero',
      phoneE164: '+15715553001',
    });
    tenantId = ctx.tenantId;
    mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async () => {
    if (mock) await mock.uninstall().catch(() => {});
    if (owner) await owner.teardown();
  });

  test('pending draft shows the Owner Queue boundary and cannot send inline', async ({ page }) => {
    const admin = createAdmin();
    const { conversationId, messageId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: 'Approve me cleanly.',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const card = page.getByTestId(`pending-draft-${messageId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('pending-draft-owner-boundary')).toContainText(
      'Owner Queue review required',
    );
    await expect(card.getByTestId('pending-draft-approve')).toHaveCount(0);
    await expect(card.getByTestId('pending-draft-edit')).toHaveCount(0);
    await expect(card.getByTestId('pending-draft-reject')).toHaveCount(0);
    expect(await mock.getRecorded()).toHaveLength(0);
  });

  test('Inbox cannot edit a pending commitment', async ({
    page,
  }) => {
    const admin = createAdmin();
    const originalBody = 'Original — before edit.';
    const { conversationId, messageId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: originalBody,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const card = page.getByTestId(`pending-draft-${messageId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('pending-draft-edit')).toHaveCount(0);
    await expect(card.getByTestId('pending-draft-edit-textarea')).toHaveCount(0);
    const { data: afterCancel } = await admin
      .from('messages')
      .select('body')
      .eq('id', messageId)
      .single();
    expect(afterCancel?.body).toBe(originalBody);
  });

  test('Inbox cannot reject a pending commitment', async ({ page }) => {
    const admin = createAdmin();
    const { conversationId, messageId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: 'Reject me.',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const card = page.getByTestId(`pending-draft-${messageId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('pending-draft-reject')).toHaveCount(0);
    await expect(card).toBeVisible();
    expect(await mock.getRecorded()).toHaveLength(0);
  });

  test('"Why this draft?" popover surfaces the honest known-context fallback', async ({
    page,
  }) => {
    const admin = createAdmin();
    // Seed a normal pending draft. The data layer does not persist/read
    // a reasoning trace for message drafts (`reasoning` is hardcoded null
    // in conversation-queries.ts), so the UI must render the structured
    // "No stored reasoning trace" fallback — never invented reasoning.
    const seeded = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: 'Draft body for reasoning test.',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${seeded.conversationId}`).click();

    const card = page.getByTestId(`pending-draft-${seeded.messageId}`);
    await expect(card).toBeVisible();
    await card.getByTestId('pending-draft-why').click();
    const content = page.getByTestId('pending-draft-why-content');
    await expect(content).toContainText('No stored reasoning trace');
    await expect(content).toContainText(
      'No message sends until owner review is complete.',
    );
    // There is no stored DB reasoning for this message draft, so the UI
    // must not invent one.
  });
});
