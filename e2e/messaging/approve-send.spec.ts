/**
 * Approve → send flow — Phase 4.
 *
 * Creates a pending_review draft, POSTs approve, asserts:
 *   1. Response 200.
 *   2. Mock recorded outbound send has the draft body.
 *   3. Message row is marked `sent_by_human` with a non-null sent_at.
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

test.describe('messaging: approve sends', () => {
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

  test('approve sends via primary and flips status', async ({
    page,
    request,
  }) => {
    const draftBody = 'I will swing by tomorrow morning to check the leak.';
    const { draftId } = await insertDraftForTenant(fixture, draftBody);

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const resp = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as {
      success: boolean;
      data: { provider: string; failedOver: boolean };
    };
    expect(json.success).toBe(true);
    expect(json.data.provider).toBe('linq');
    expect(json.data.failedOver).toBe(false);

    // Mock recorded outbound with the exact body.
    const mock = createMessagingMockHarness(request);
    const recorded = await mock.getRecorded();
    expect(recorded.length).toBeGreaterThan(0);
    const sent = recorded[recorded.length - 1]!;
    expect(sent.provider).toBe('linq');
    expect(sent.body).toBe(draftBody);
    expect(sent.to).toBe(fixture.tenant.phoneE164);
    expect(sent.from).toBe(fixture.odesaPhoneE164);

    // DB row updated.
    const admin = createAdmin();
    const { data: row } = await admin
      .from('messages')
      .select('draft_status, sent_at, provider, provider_message_id')
      .eq('id', draftId)
      .single();
    expect(row?.draft_status).toBe('sent_by_human');
    expect(row?.sent_at).toBeTruthy();
    expect(row?.provider).toBe('linq');
    expect(row?.provider_message_id).toBeTruthy();
  });

  test('approving an already-sent draft returns 409', async ({
    page,
  }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      'Already sent text',
    );

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    // First approval succeeds.
    const first = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(first.status()).toBe(200);

    // Second approval is rejected with 409 because status != pending_review.
    const second = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(second.status()).toBe(409);
  });

  test('unauthenticated approve returns 401', async ({ request }) => {
    const { draftId } = await insertDraftForTenant(
      fixture,
      'auth required text',
    );
    // Disable redirect-following so we catch the middleware's 307 -> /login
    // separately from a "real" 401 emitted by the API route. Either outcome
    // proves the request was rejected for unauthenticated callers; we accept
    // both so this test is robust to middleware redesigns.
    const resp = await request.post(
      `/api/messaging/drafts/${draftId}/approve`,
      { maxRedirects: 0 },
    );
    expect([301, 302, 307, 308, 401]).toContain(resp.status());
  });
});
