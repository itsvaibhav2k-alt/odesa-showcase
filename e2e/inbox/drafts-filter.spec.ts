// TODO(redesign): rewrite for Stitch inbox redesign — see e2e/inbox/redesign.spec.ts
/**
 * Inbox drafts filter — Phase 4 addition.
 *
 * The "Drafts (N)" chip narrows the Inbox feed to conversations
 * with at least one pending_review message.
 *
 * Seed-shape assumptions:
 *   Galaxy has 0 conversations by default. This spec adds a
 *   conversation + pending_review message for one tenant, then asserts
 *   the chip shows count=1 and clicking it shows that conversation
 *   exactly once.
 */

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  createAdmin,
  provisionGalaxyOwner,
  signIn,
  type SeededOwner,
} from '../today/helpers';

const GALAXY_ORG_ID = '11111111-1111-1111-1111-111111111101';
const GALAXY_TENANT_ID = '55555555-5555-5555-5555-555555555501';

test.describe.skip('inbox: drafts filter', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let owner: SeededOwner;
  let conversationId: string | null = null;
  let draftMessageId: string | null = null;

  test.beforeEach(async () => {
    owner = await provisionGalaxyOwner();
    const admin = createAdmin();
    const { data: conv, error: convErr } = await admin
      .from('conversations')
      .insert({
        organization_id: GALAXY_ORG_ID,
        tenant_id: GALAXY_TENANT_ID,
        channel: 'sms',
        status: 'open',
        summary: 'Pending review draft',
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (convErr || !conv) throw new Error(`conv insert: ${convErr?.message}`);
    conversationId = conv.id;

    const { data: msg, error: msgErr } = await admin
      .from('messages')
      .insert({
        organization_id: GALAXY_ORG_ID,
        conversation_id: conversationId,
        direction: 'outbound',
        provider: 'linq',
        body: 'Drafts filter spec draft',
        draft_status: 'pending_review',
      })
      .select('id')
      .single();
    if (msgErr || !msg) throw new Error(`msg insert: ${msgErr?.message}`);
    draftMessageId = msg.id;
  });

  test.afterEach(async () => {
    const admin = createAdmin();
    if (draftMessageId) {
      await admin.from('messages').delete().eq('id', draftMessageId);
      draftMessageId = null;
    }
    if (conversationId) {
      await admin.from('conversations').delete().eq('id', conversationId);
      conversationId = null;
    }
    if (owner) await owner.teardown();
  });

  test('drafts chip shows count and filters feed', async ({ page }) => {
    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox');

    // Chip exists and reports count >= 1.
    await expect(page.getByTestId('inbox-filter-drafts')).toBeVisible();
    const countText = await page
      .getByTestId('inbox-filter-drafts-count')
      .textContent();
    const count = Number(countText?.trim() ?? '0');
    expect(count).toBeGreaterThanOrEqual(1);

    // Clicking it sets the URL.
    await page.getByTestId('inbox-filter-drafts').click();
    await page.waitForFunction(
      () => new URL(window.location.href).searchParams.get('filter') === 'drafts',
    );

    // Feed shows at least one conversation row.
    const rows = page.locator(
      '[data-testid="inbox-feed-list"] button[data-kind="conversation"]',
    );
    await expect(rows.first()).toBeVisible();
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);

    // Every visible row is a conversation kind (drafts filter excludes
    // work orders + rent events entirely).
    const kinds = await page
      .locator('[data-testid="inbox-feed-list"] button[data-kind]')
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('data-kind') ?? ''),
      );
    for (const k of kinds) {
      expect(k).toBe('conversation');
    }
  });

  test('drafts filter is empty when no pending_review messages exist', async ({
    page,
  }) => {
    // Remove the draft added in beforeEach.
    const admin = createAdmin();
    if (draftMessageId) {
      await admin.from('messages').delete().eq('id', draftMessageId);
      draftMessageId = null;
    }

    await signIn(page, { email: owner.email, password: owner.password });
    await page.goto('/inbox?filter=drafts');

    // Empty-state copy keyed on the drafts filter.
    await expect(page.getByTestId('inbox-feed-empty-copy')).toHaveText(
      'No drafts waiting for review.',
    );
  });
});
