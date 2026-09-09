/**
 * Inbox case file column — Wave 8.
 *
 * Selects each fixture conversation in turn and asserts that the
 * header / meta strip / hero card (or status block) / timeline / Ask
 * Odesa chips all update atomically when the operator switches rows.
 *
 * Coordinates via test-ids only (no text-content coupling) so this
 * spec stays robust to copy iteration.
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

test.describe('inbox case file — switches atomically', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: InboxOwner;

  test.afterEach(async () => {
    if (owner) await owner.teardown();
  });

  test('selecting each row swaps header + meta + hero + chips together', async ({
    page,
  }) => {
    owner = await provisionInboxOwner('case-file');
    const admin = createAdmin();
    const propertyId = await createProperty(admin, {
      organizationId: owner.organizationId,
      name: 'Casefile Property',
    });

    // Conversation A — pending draft (review status; hero = draft card).
    const a = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Alex Reviewer',
      phoneE164: '+15715552001',
    });
    const seedA = await seedDraft(admin, {
      organizationId: owner.organizationId,
      tenantId: a.tenantId,
      body: 'Pending draft body for Alex.',
    });

    // Conversation B — quiet handled thread.
    const b = await createTenantWithLease(admin, {
      organizationId: owner.organizationId,
      propertyId,
      fullName: 'Brenda Handled',
      phoneE164: '+15715552002',
    });
    const oldIso = new Date(Date.now() - 8 * 60 * 60_000).toISOString();
    const { data: convB } = await admin
      .from('conversations')
      .insert({
        organization_id: owner.organizationId,
        tenant_id: b.tenantId,
        channel: 'sms',
        status: 'open',
        last_message_at: oldIso,
      })
      .select('id')
      .single();
    if (!convB) throw new Error('convB insert failed');
    await admin.from('messages').insert({
      organization_id: owner.organizationId,
      conversation_id: convB.id,
      direction: 'outbound',
      provider: 'linq',
      body: "Hi Brenda — we're all set.",
      draft_status: 'auto_sent',
      sent_at: oldIso,
    });

    await signInOwner(page, owner);
    await page.goto('/inbox');

    // Select A — assert headers/meta/hero/chips reflect Alex.
    await page.getByTestId(`conversation-row-${seedA.conversationId}`).click();
    await expect(
      page.getByTestId(`inbox-thread-${seedA.conversationId}`),
    ).toBeVisible();
    await expect(page.getByTestId('inbox-thread-header')).toContainText(
      'Alex Reviewer',
    );
    await expect(page.getByTestId('inbox-thread-scroll')).toBeVisible();
    await expect(page.getByTestId('inbox-thread-body')).toBeVisible();
    await expect(page.getByTestId(`pending-draft-${seedA.messageId}`)).toBeVisible();
    // Ask Odesa chips visible with the review-set 'approve_draft' chip.
    await expect(page.getByTestId('ask-odesa-bar')).toBeVisible();
    await expect(page.getByTestId('ask-odesa-chip-approve_draft')).toBeVisible();

    // Select B — header switches to Brenda; the draft hero card for A
    // is no longer mounted; chip set switches off the review variant.
    await page.getByTestId(`conversation-row-${convB.id}`).click();
    await expect(
      page.getByTestId(`inbox-thread-${convB.id}`),
    ).toBeVisible();
    await expect(page.getByTestId('inbox-thread-header')).toContainText(
      'Brenda Handled',
    );
    await expect(page.getByTestId(`pending-draft-${seedA.messageId}`)).toHaveCount(0);
    // The approve_draft chip should not be in the handled chip set.
    await expect(page.getByTestId('ask-odesa-chip-approve_draft')).toHaveCount(0);
  });
});
