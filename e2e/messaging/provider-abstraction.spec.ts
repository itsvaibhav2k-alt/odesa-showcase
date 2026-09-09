/**
 * Provider abstraction — Phase 4.
 *
 * Exercises the happy-path of both providers through their webhook
 * endpoints:
 *   1. Valid Linq signature → 200 + new draft landed in DB.
 *   2. Valid Twilio signature (base64 HMAC-SHA1) → 200 + new draft landed.
 *   3. Missing Linq signature → 401.
 *   4. Missing Twilio signature → 401.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import {
  API_TIMEOUT_MS,
  HAVE_SUPABASE,
  LINQ_TEST_SECRET,
  buildTwilioForm,
  createAdmin,
  provisionMessagingFixture,
  twilioSignature,
  waitForDraftForConversation,
  type MessagingFixture,
} from './helpers';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

test.describe('messaging: provider abstraction', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );
  test.setTimeout(120_000);

  let fixture: MessagingFixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture();
    const mock = createMessagingMockHarness(request);
    await mock.install({ claudeScripts: [] });
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test('linq webhook lands an inbound + pending_review draft', async ({
    request,
  }) => {
    const resp = await request.post('/api/messaging/inbound/linq', {
      timeout: API_TIMEOUT_MS,
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-msg-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: 'Hi, my sink is leaking',
        date_sent: new Date().toISOString(),
      },
    });
    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as {
      success: boolean;
      data: { draftMessageId: string; conversationId: string };
    };
    expect(json.success).toBe(true);
    expect(json.data.draftMessageId).toBeTruthy();

    // Draft exists in DB with pending_review.
    const draft = await waitForDraftForConversation(
      request,
      json.data.conversationId,
    );
    expect(draft).not.toBeNull();
  });

  test('linq webhook without signature returns 401', async ({ request }) => {
    const resp = await request.post('/api/messaging/inbound/linq', {
      timeout: API_TIMEOUT_MS,
      data: { from: fixture.tenant.phoneE164, to: fixture.odesaPhoneE164 },
    });
    expect(resp.status()).toBe(401);
  });

  test('twilio webhook lands an inbound + pending_review draft', async ({
    request,
  }) => {
    const params: Record<string, string> = {
      MessageSid: `SM${Date.now()}abc`,
      From: fixture.tenant.phoneE164,
      To: fixture.odesaPhoneE164,
      Body: 'Hello from twilio',
      AccountSid: 'ACtesttest',
    };
    const url = `${BASE}/api/messaging/inbound/twilio`;
    const signature = twilioSignature(url, params);
    const form = buildTwilioForm(params);

    const resp = await request.post('/api/messaging/inbound/twilio', {
      timeout: API_TIMEOUT_MS,
      headers: {
        'X-Twilio-Signature': signature,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form,
    });

    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as {
      success: boolean;
      data: { draftMessageId: string; conversationId: string };
    };
    expect(json.success).toBe(true);
    const draft = await waitForDraftForConversation(
      request,
      json.data.conversationId,
    );
    expect(draft).not.toBeNull();
  });

  test('twilio webhook without signature returns 401', async ({ request }) => {
    const params: Record<string, string> = {
      MessageSid: 'SMnope',
      From: fixture.tenant.phoneE164,
      To: fixture.odesaPhoneE164,
      Body: 'Hi',
      AccountSid: 'ACtesttest',
    };
    const resp = await request.post('/api/messaging/inbound/twilio', {
      timeout: API_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: buildTwilioForm(params),
    });
    expect(resp.status()).toBe(401);
  });

  test('inbound message body is persisted with direction=inbound', async ({
    request,
  }) => {
    const body = 'Original tenant text';
    const resp = await request.post('/api/messaging/inbound/linq', {
      timeout: API_TIMEOUT_MS,
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-body-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: body,
      },
    });
    void resp;
    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as {
      success: boolean;
      data: { conversationId: string };
    };

    const admin = createAdmin();
    const { data: rows } = await admin
      .from('messages')
      .select('body, direction, draft_status')
      .eq('conversation_id', json.data.conversationId)
      .order('created_at', { ascending: true });
    expect(rows).not.toBeNull();
    const inbound = (rows ?? []).find((r) => r.direction === 'inbound');
    expect(inbound).toBeDefined();
    expect(inbound?.body).toBe(body);
  });
});
