/**
 * Edit → approve flow — Phase 4.
 *
 * Creates a pending_review draft with original body, edits the body
 * via PATCH, then approves. The mock recorded send must carry the
 * EDITED body (not the original).
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  HAVE_SUPABASE,
  createAdmin,
  insertDraftForTenant,
  provisionMessagingFixture,
  signIn,
  type MessagingFixture,
} from './helpers';

test.describe('messaging: edit then send', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: MessagingFixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture({ messagingPrimary: 'linq' });
    const mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test('edited body overrides original at send time', async ({
    page,
    request,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      'Original draft body',
    );

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const editedBody = 'Edited human-refined text for sending';
    const editResp = await page.request.patch(
      `/api/messaging/drafts/${draftId}/edit`,
      { data: { body: editedBody } },
    );
    expect(editResp.status()).toBe(200);

    // Draft row still pending_review, body updated.
    const admin = createAdmin();
    const { data: preApprove } = await admin
      .from('messages')
      .select('body, draft_status')
      .eq('id', draftId)
      .single();
    expect(preApprove?.draft_status).toBe('pending_review');
    expect(preApprove?.body).toBe(editedBody);

    // Approve and assert mock recorded the edited body.
    const approveResp = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(approveResp.status()).toBe(200);

    const mock = createMessagingMockHarness(request);
    const recorded = await mock.getRecorded();
    const sent = recorded[recorded.length - 1]!;
    expect(sent.body).toBe(editedBody);
  });

  test('edit rejects empty body', async ({ page }) => {
    const { draftId } = await insertDraftForTenant(fixture, 'Some body');
    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });
    const resp = await page.request.patch(
      `/api/messaging/drafts/${draftId}/edit`,
      { data: { body: '' } },
    );
    expect(resp.status()).toBe(400);
  });
});
