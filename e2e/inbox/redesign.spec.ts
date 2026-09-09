/**
 * Inbox — wave-4 functional E2E.
 *
 * The wave-3 surface was an approval queue. The wave-4 surface is a
 * conversation evidence viewer + manual outlet; AI tenant drafts remain
 * review-first and commitments live in Owner Queue. The redesign spec covers:
 *
 *   - The conversation list shows seeded threads.
 *   - Clicking a conversation opens an iMessage-style thread.
 *   - The pending-review draft renders as an inline "AI suggested"
 *     card; "Review & send" opens the send-confirm dialog, and only
 *     the dialog confirm fires the approve action and posts to the
 *     mock Sendblue server (zero sends before confirm).
 *   - Owner-side compose: typing + Send fires the new
 *     `sendOwnerMessageAction` and posts to the mock Sendblue server.
 *   - Realtime: a row inserted directly via the admin client appears
 *     in the open thread within ~5 s.
 *
 * Skipped when the local Supabase stack is unavailable, mirroring the
 * gating pattern used by the onboarding + today suites.
 */
import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  cleanupTestRows,
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

test.describe('inbox — wave 4 functional', () => {
  test.setTimeout(90_000);
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;
  let tenantId: string;
  let conversationId: string;
  let mock: MessagingMockHarness;

  test.beforeEach(async ({ request }) => {
    owner = await provisionInboxOwner();
    const admin = createAdmin();
    const propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
      name: 'The Maplewoods',
    });
    const ctx = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Marcus Lee',
      phoneE164: '+15715559001',
      rentAmount: 3000,
    });
    tenantId = ctx.tenantId;

    // Seed a "sent" outbound to anchor the conversation so the list
    // row has a real preview when we open the page.
    const seeded = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      body: 'Hi Marcus — initial outbound to anchor the conversation.',
    });
    conversationId = seeded.conversationId;
    await admin
      .from('messages')
      .update({
        draft_status: 'sent_by_human',
        sent_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq('id', seeded.messageId);

    // Install the in-process messaging mock on the Next server so
    // LinqProvider.send() short-circuits and records into the test
    // hook instead of touching the real Sendblue API. The dev server
    // owns its own env; this is the only reliable way to intercept.
    mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async () => {
    if (mock) await mock.uninstall().catch(() => {});
    if (owner) await owner.teardown();
  });

  // ---------------------------------------------------------------------------
  // Conversation list + thread visibility
  // ---------------------------------------------------------------------------

  test('Conversation list shows the tenant; clicking opens the thread', async ({
    page,
  }) => {
    await signInOwner(page, owner);
    await page.goto('/inbox');
    await expect(page.getByTestId('inbox-page')).toBeVisible();

    const row = page.getByTestId(`conversation-row-${conversationId}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Marcus Lee');

    await row.click();
    await expect(page.getByTestId(`inbox-thread-${conversationId}`)).toBeVisible();
    // Anchor message is rendered as a bubble.
    await expect(
      page.getByText('Hi Marcus — initial outbound to anchor the conversation.'),
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Pending-review draft renders as evidence; Owner Queue owns decisions
  // ---------------------------------------------------------------------------

  test('Pending draft renders as evidence with an Owner Queue boundary', async ({
    page,
  }) => {
    const admin = createAdmin();
    const draftBody = 'Approving this exact text — one and only.';
    const { messageId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      conversationId,
      body: draftBody,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');

    const row = page.getByTestId(`conversation-row-${conversationId}`);
    await expect(row).toBeVisible();
    // Pending dot is visible on the row.
    await expect(
      row.getByTestId('conversation-pending-dot'),
    ).toBeVisible();

    await row.click();

    const card = page.getByTestId(`pending-draft-${messageId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(draftBody);

    await expect(card.getByTestId('pending-draft-owner-boundary')).toContainText(
      'Owner Queue review required',
    );
    await expect(card.getByTestId('pending-draft-approve')).toHaveCount(0);
    expect(await mock.getRecorded()).toHaveLength(0);

    // Inbox did not mutate or send the draft.
    const { data: msg } = await admin
      .from('messages')
      .select('draft_status, sent_at, provider_message_id')
      .eq('id', messageId)
      .single();
    expect(msg?.draft_status).toBe('pending_review');
    expect(msg?.sent_at).toBeNull();
    expect(msg?.provider_message_id).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Reject stays in Owner Queue
  // ---------------------------------------------------------------------------

  test('Inbox exposes no local reject for a pending draft', async ({
    page,
  }) => {
    const admin = createAdmin();
    const { messageId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      conversationId,
      body: 'This draft will be rejected.',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const card = page.getByTestId(`pending-draft-${messageId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('pending-draft-reject')).toHaveCount(0);
    await expect(card).toBeVisible();
    const { data: msg } = await admin
      .from('messages')
      .select('draft_status, sent_at')
      .eq('id', messageId)
      .single();
    expect(msg?.draft_status).toBe('pending_review');
    expect(msg?.sent_at).toBeNull();

    // Mock Sendblue must NOT have been called.
    expect(await mock.getRecorded()).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Edit stays in Owner Queue
  // ---------------------------------------------------------------------------

  test('Inbox exposes no local edit for a pending draft', async ({
    page,
  }) => {
    const admin = createAdmin();
    const original = 'Original body before edit.';
    const { messageId } = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId,
      conversationId,
      body: original,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const card = page.getByTestId(`pending-draft-${messageId}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId('pending-draft-edit')).toHaveCount(0);
    const { data: msg } = await admin
      .from('messages')
      .select('body, draft_status')
      .eq('id', messageId)
      .single();
    expect(msg?.body).toBe(original);
    expect(msg?.draft_status).toBe('pending_review');
  });

  // ---------------------------------------------------------------------------
  // Owner-side compose: type + Send → Sendblue + DB row
  // ---------------------------------------------------------------------------

  test('Compose box sends an owner-authored outbound via Sendblue', async ({
    page,
  }) => {
    const admin = createAdmin();
    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const composeBody = 'Owner-authored manual message — wave 4 e2e.';
    await page.getByTestId('inbox-compose-textarea').fill(composeBody);
    await page.getByTestId('inbox-compose-send').click();

    await expect
      .poll(async () => (await mock.getRecorded()).length)
      .toBe(1);
    const recorded = await mock.getRecorded();
    expect(recorded[0]?.body).toBe(composeBody);
    expect(recorded[0]?.to).toBe('+15715559001');

    // The thread should now contain the owner's bubble.
    await expect(page.getByText(composeBody)).toBeVisible();

    // DB has a sent_by_human message with the body.
    const { data: messages } = await admin
      .from('messages')
      .select('body, draft_status, sent_at, provider_message_id')
      .eq('organization_id', owner.organizationId)
      .eq('body', composeBody);
    expect(messages?.length).toBe(1);
    expect(messages?.[0]?.draft_status).toBe('sent_by_human');
    expect(messages?.[0]?.sent_at).toBeTruthy();
    expect(messages?.[0]?.provider_message_id).toMatch(/^linq-mock-/);
  });

  // ---------------------------------------------------------------------------
  // Realtime: a row inserted while the page is open lands in the thread.
  // ---------------------------------------------------------------------------

  test('Realtime inbound appears in the open thread within ~5s', async ({
    page,
  }) => {
    const admin = createAdmin();

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${conversationId}`).click();

    const realtimeBody = 'Realtime push test inbound — 1234567';
    // Insert a fresh inbound directly via the admin client to mimic
    // a webhook from Sendblue.
    await admin.from('messages').insert({
      organization_id: owner.organizationId,
      conversation_id: conversationId,
      direction: 'inbound',
      provider: 'linq',
      body: realtimeBody,
      draft_status: 'auto_sent',
      sent_at: new Date().toISOString(),
    });

    await expect(page.getByText(realtimeBody)).toBeVisible({
      timeout: 6_000,
    });

    await cleanupTestRows(admin, {
      organizationId: owner.organizationId,
      prefix: realtimeBody.slice(0, 12),
    });
  });
});
