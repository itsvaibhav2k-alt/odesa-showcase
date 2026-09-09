/**
 * AskOdesaBar — Wave 8 functional spec.
 *
 * Coverage:
 *   - Chip set differs between statuses (review vs handled).
 *   - Legacy prefill/approve chip shapes route to the global assistant.
 *   - ask_assistant navigates to /assistant?q=…
 *   - Typing + Enter routes to /assistant?q=<typed>
 *   - Conversation switch triggers the 140ms fade-swap.
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

test.describe('inbox ask odesa bar', () => {
  test.setTimeout(90_000);
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;
  let mock: MessagingMockHarness;
  let propertyId: string;

  test.beforeEach(async ({ request }) => {
    owner = await provisionInboxOwner('ask-odesa');
    const admin = createAdmin();
    propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
      name: 'Ask Odesa Property',
    });
    mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async () => {
    if (mock) await mock.uninstall().catch(() => {});
    if (owner) await owner.teardown();
  });

  test('review-state chip set differs from handled-state chip set', async ({
    page,
  }) => {
    const admin = createAdmin();
    const t1 = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Review Person',
      phoneE164: '+15715554001',
    });
    const review = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: t1.tenantId,
      body: 'pending draft for ask-odesa',
    });

    const t2 = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Quiet Person',
      phoneE164: '+15715554002',
    });
    const oldIso = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const { data: conv2 } = await admin
      .from('conversations')
      .insert({
        organization_id: owner.organizationId,
        tenant_id: t2.tenantId,
        channel: 'sms',
        status: 'open',
        last_message_at: oldIso,
      })
      .select('id')
      .single();
    if (!conv2) throw new Error('conv2 insert failed');
    await admin.from('messages').insert({
      organization_id: owner.organizationId,
      conversation_id: conv2.id,
      direction: 'outbound',
      provider: 'linq',
      body: 'odesa replied long ago',
      draft_status: 'auto_sent',
      sent_at: oldIso,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');

    // Select review row — assert review chips present.
    await page.getByTestId(`conversation-row-${review.conversationId}`).click();
    await expect(page.getByTestId('ask-odesa-bar')).toBeVisible();
    await expect(page.getByTestId('ask-odesa-chip-approve_draft')).toBeVisible();

    // Switch to handled row — approve_draft chip should NOT be present.
    await page.getByTestId(`conversation-row-${conv2.id}`).click();
    await expect(page.getByTestId('ask-odesa-chip-approve_draft')).toHaveCount(0);
    // The handled set has at least one ask_assistant chip.
    await expect(page.getByTestId('ask-odesa-chip-ask_assistant').first()).toBeVisible();
  });

  test('prefill_override chip hands a grounded draft request to the global assistant', async ({
    page,
  }) => {
    const admin = createAdmin();
    const t = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Prefill Patty',
      phoneE164: '+15715554003',
    });
    const seed = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: t.tenantId,
      body: 'draft for prefill spec',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${seed.conversationId}`).click();

    // Click the prefill_override chip in review chip set (Ask for a photo).
    const prefillChip = page.getByTestId('ask-odesa-chip-prefill_override');
    await expect(prefillChip).toBeVisible();
    await prefillChip.click();

    await page.waitForURL(/\/assistant\?q=.+/, { timeout: 5_000 });
    const query = new URL(page.url()).searchParams.get('q');
    expect(query).toContain('Inbox case context');
    expect(query).toContain('Hi Prefill, can you send a quick photo');
    expect(query).toContain('Do not send it');
  });

  test('approve_draft chip routes to review preparation without sending', async ({ page }) => {
    const admin = createAdmin();
    const t = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Approve Asher',
      phoneE164: '+15715554004',
    });
    const seed = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: t.tenantId,
      body: 'chip-driven approve target',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${seed.conversationId}`).click();

    await page.getByTestId('ask-odesa-chip-approve_draft').click();
    await page.waitForURL(/\/assistant\?q=.+/, { timeout: 5_000 });
    const query = new URL(page.url()).searchParams.get('q');
    expect(query).toContain('Owner Queue');
    expect(query).toContain('Do not send it');
    expect(await mock.getRecorded()).toHaveLength(0);
  });

  test('ask_assistant chip navigates to /assistant?q=...', async ({ page }) => {
    const admin = createAdmin();
    const t = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Ask Aria',
      phoneE164: '+15715554005',
    });
    const seed = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: t.tenantId,
      body: 'ask assistant target draft',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${seed.conversationId}`).click();

    // "Why this draft?" in the review set is an ask_assistant chip.
    await page.getByTestId('ask-odesa-chip-ask_assistant').click();
    await page.waitForURL(/\/assistant\?q=.+/, { timeout: 5_000 });

    const url = new URL(page.url());
    const q = url.searchParams.get('q');
    expect(q).toBeTruthy();
    // Decoded query reflects the chip's canned prompt.
    expect(q?.toLowerCase()).toContain('draft');
  });

  test('typing + Enter routes to /assistant?q=<typed>', async ({ page }) => {
    const admin = createAdmin();
    const t = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Enter Eli',
      phoneE164: '+15715554006',
    });
    const seed = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: t.tenantId,
      body: 'enter routing target',
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');
    await page.getByTestId(`conversation-row-${seed.conversationId}`).click();

    const input = page.getByTestId('ask-odesa-input');
    await input.click();
    const phrase = 'how should I respond';
    await input.type(phrase);
    await input.press('Enter');

    await page.waitForURL(/\/assistant\?q=.+/, { timeout: 5_000 });
    const q = new URL(page.url()).searchParams.get('q');
    expect(q).toContain('Inbox case context');
    expect(q).toContain(phrase);
  });

  test('conversation switch triggers a brief fade-swap', async ({ page }) => {
    const admin = createAdmin();
    const a = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Swap A',
      phoneE164: '+15715554007',
    });
    const seedA = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: a.tenantId,
      body: 'swap a body',
    });

    const b = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Swap B',
      phoneE164: '+15715554008',
    });
    const seedB = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: b.tenantId,
      body: 'swap b body',
    });

    await signInOwner(page, owner);
    await page.goto(
      `/inbox?conversation=${encodeURIComponent(seedA.conversationId)}`,
    );

    const suggestions = page.getByTestId('ask-odesa-suggestions');
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toHaveAttribute('data-swapping', 'false');

    // Begin observing before the click so the intentional 140ms pulse cannot
    // be missed, then prove the real conversation switch settles cleanly.
    const swapStarted = page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="ask-odesa-suggestions"]')
          ?.getAttribute('data-swapping') === 'true',
      undefined,
      { timeout: 2_000 },
    );
    await page.getByTestId(`conversation-row-${seedB.conversationId}`).click();
    await swapStarted;
    await expect(suggestions).toHaveAttribute('data-swapping', 'false', {
      timeout: 2_000,
    });
  });
});
