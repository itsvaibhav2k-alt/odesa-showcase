/**
 * Reject draft flow — Phase 4.
 *
 * Create a pending_review draft, call reject, assert:
 *   1. Response 200.
 *   2. No outbound send recorded on the mock.
 *   3. DB row has draft_status='rejected', sent_at is null.
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

test.describe('messaging: reject draft', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: MessagingFixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture();
    const mock = createMessagingMockHarness(request);
    await mock.install();
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test('reject marks status without sending', async ({ page, request }) => {
    const { draftId } = await insertDraftForTenant(fixture, 'Not to send');

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const resp = await page.request.post(
      `/api/messaging/drafts/${draftId}/reject`,
    );
    expect(resp.status()).toBe(200);

    // No mock recorded send.
    const mock = createMessagingMockHarness(request);
    const recorded = await mock.getRecorded();
    expect(recorded.length).toBe(0);

    // DB row reflects rejection.
    const admin = createAdmin();
    const { data: row } = await admin
      .from('messages')
      .select('draft_status, sent_at')
      .eq('id', draftId)
      .single();
    expect(row?.draft_status).toBe('rejected');
    expect(row?.sent_at).toBeNull();
  });

  test('rejecting twice returns 409', async ({ page }) => {
    const { draftId } = await insertDraftForTenant(fixture, 'Will reject');
    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const first = await page.request.post(
      `/api/messaging/drafts/${draftId}/reject`,
    );
    expect(first.status()).toBe(200);

    const second = await page.request.post(
      `/api/messaging/drafts/${draftId}/reject`,
    );
    expect(second.status()).toBe(409);
  });
});
