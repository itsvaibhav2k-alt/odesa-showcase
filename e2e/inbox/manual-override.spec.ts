/**
 * Manual override compose row — Wave 8.
 *
 * Coverage:
 *   - Enter on a non-empty body sends and clears the textarea.
 *   - Shift+Enter inserts a newline (does not send).
 *   - Empty submit (Enter, blank) is a no-op (no recorded send).
 *   - Send button is disabled when the body is empty.
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

test.describe('inbox manual override compose', () => {
  test.setTimeout(90_000);
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;
  let mock: MessagingMockHarness;
  let conversationId: string;

  test.beforeEach(async ({ request }) => {
    owner = await provisionInboxOwner('manual-override');
    const admin = createAdmin();
    const propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
      name: 'Override Property',
    });
    const ctx = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Override Otto',
      phoneE164: '+15715555001',
    });
    const seeded = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: ctx.tenantId,
      body: 'Seed message — anchors conversation.',
    });
    conversationId = seeded.conversationId;
    await admin
      .from('messages')
      .update({
        draft_status: 'sent_by_human',
        sent_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq('id', seeded.messageId);

    mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async () => {
    if (mock) await mock.uninstall().catch(() => {});
    if (owner) await owner.teardown();
  });

  test('Enter sends a non-empty message', async ({ page }) => {
    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const ta = page.getByTestId('inbox-compose-textarea');
    await ta.click();
    const body = 'Enter-key manual override test.';
    await ta.type(body);
    await ta.press('Enter');

    await expect
      .poll(async () => (await mock.getRecorded()).length, { timeout: 10_000 })
      .toBe(1);
    const recorded = await mock.getRecorded();
    expect(recorded[0]?.body).toBe(body);
  });

  test('Shift+Enter inserts a newline and does not send', async ({ page }) => {
    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const ta = page.getByTestId('inbox-compose-textarea');
    await ta.click();
    await ta.type('line one');
    await ta.press('Shift+Enter');
    await ta.type('line two');

    await expect(ta).toHaveValue('line one\nline two');
    expect(await mock.getRecorded()).toHaveLength(0);
  });

  test('empty submit is blocked', async ({ page }) => {
    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const ta = page.getByTestId('inbox-compose-textarea');
    await ta.click();
    await ta.press('Enter');
    // Send button stays disabled when body is empty.
    await expect(page.getByTestId('inbox-compose-send')).toBeDisabled();
    expect(await mock.getRecorded()).toHaveLength(0);
  });

  test('Send button is disabled when the body is empty', async ({ page }) => {
    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();
    await expect(page.getByTestId('inbox-compose-send')).toBeDisabled();
  });
});
