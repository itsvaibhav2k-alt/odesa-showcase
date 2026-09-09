/**
 * Failover spec — Phase 4.
 *
 * Force the primary provider (Linq) to fail on send and assert that
 * `sendWithFailover()` correctly flipped over to Twilio AND the final
 * `messages` row records `provider='twilio'`. The outbound call is
 * triggered via the draft-approve route so the end-to-end path is
 * exercised (approve → send-with-failover → DB update).
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

test.describe('messaging: failover', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: MessagingFixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture({ messagingPrimary: 'linq' });
    const mock = createMessagingMockHarness(request);
    await mock.install({ shouldFail: { linq: true } });
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test('linq failure falls back to twilio and records provider', async ({
    page,
    request,
  }) => {
    // Seed a pending_review draft directly, then approve it.
    const { draftId } = await insertDraftForTenant(fixture, 'Failover test');

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
      data: { provider: string; failedOver: boolean; attempted: string[] };
    };
    expect(json.success).toBe(true);
    expect(json.data.provider).toBe('twilio');
    expect(json.data.failedOver).toBe(true);
    expect(json.data.attempted).toEqual(['linq', 'twilio']);

    // Recorded sends include exactly one twilio entry.
    const mock = createMessagingMockHarness(request);
    const recorded = await mock.getRecorded();
    const twilioSends = recorded.filter((r) => r.provider === 'twilio');
    expect(twilioSends.length).toBe(1);
    expect(twilioSends[0]?.to).toBe(fixture.tenant.phoneE164);

    // DB row now marks the message as sent_by_human + provider=twilio.
    const admin = createAdmin();
    const { data: row } = await admin
      .from('messages')
      .select('provider, draft_status, sent_at')
      .eq('id', draftId)
      .single();
    expect(row?.provider).toBe('twilio');
    expect(row?.draft_status).toBe('sent_by_human');
    expect(row?.sent_at).toBeTruthy();
  });

  test('both providers failing returns 502', async ({ page, request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.shouldFail('twilio', true);

    const { draftId } = await insertDraftForTenant(fixture, 'Double failure');

    await signIn(page, {
      email: fixture.owner.email,
      password: fixture.owner.password,
    });

    const resp = await page.request.post(
      `/api/messaging/drafts/${draftId}/approve`,
    );
    expect(resp.status()).toBe(502);

    // Draft row stays at pending_review.
    const admin = createAdmin();
    const { data: row } = await admin
      .from('messages')
      .select('draft_status, sent_at')
      .eq('id', draftId)
      .single();
    expect(row?.draft_status).toBe('pending_review');
    expect(row?.sent_at).toBeNull();
  });
});
