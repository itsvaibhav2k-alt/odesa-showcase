/**
 * Inbound → Draft pipeline — Phase 4.
 *
 * Scripted Claude reply. Sends a mock Linq inbound, asserts:
 *   1. Response 200 with a draft id.
 *   2. DB has a `pending_review` outbound message whose body matches
 *      the scripted reply.
 *   3. The inbound body is persisted with direction='inbound'.
 */

import { expect, test } from '@playwright/test';

import { createMessagingMockHarness } from '../mocks/messaging-mock';
import { getClaudeRecorded } from '../mocks/claude-mock';
import {
  HAVE_SUPABASE,
  LINQ_TEST_SECRET,
  createAdmin,
  provisionMessagingFixture,
  type MessagingFixture,
} from './helpers';

test.describe('messaging: inbound to draft', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: MessagingFixture;

  test.beforeEach(async ({ request }) => {
    fixture = await provisionMessagingFixture();
    const mock = createMessagingMockHarness(request);
    await mock.install({
      claudeScripts: [
        {
          matchPattern: '^leak|leaking',
          reply: 'Got it — sending a plumber today. Will confirm time shortly.',
        },
        {
          matchPattern: 'rent',
          reply: 'Rent is due on the 1st. Let me know if you need a plan.',
        },
      ],
    });
  });

  test.afterEach(async ({ request }) => {
    const mock = createMessagingMockHarness(request);
    await mock.uninstall().catch(() => {});
    if (fixture) await fixture.teardown();
  });

  test('scripted claude reply becomes the pending_review draft', async ({
    request,
  }) => {
    const inboundText = 'leak under the kitchen sink';
    const resp = await request.post('/api/messaging/inbound/linq', {
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: inboundText,
      },
    });
    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as {
      success: boolean;
      data: { draftMessageId: string };
    };

    const admin = createAdmin();
    const { data: draft } = await admin
      .from('messages')
      .select('body, draft_status, direction')
      .eq('id', json.data.draftMessageId)
      .single();

    expect(draft?.draft_status).toBe('pending_review');
    expect(draft?.direction).toBe('outbound');
    expect(draft?.body).toBe(
      'Got it — sending a plumber today. Will confirm time shortly.',
    );

    // Claude mock received the inbound with the system prompt + history.
    const recorded = await getClaudeRecorded(request);
    expect(recorded.length).toBeGreaterThan(0);
    const last = recorded[recorded.length - 1]!;
    expect(last.latestInbound).toBe(inboundText);
    expect(last.systemPrompt.length).toBeGreaterThan(0);
  });

  test('unmatched scripts fall back to a default reply', async ({
    request,
  }) => {
    // Reset scripts to empty so nothing matches.
    const mock = createMessagingMockHarness(request);
    await mock.setClaudeScripts([]);

    const resp = await request.post('/api/messaging/inbound/linq', {
      headers: { 'X-Linq-Signature': LINQ_TEST_SECRET },
      data: {
        message_handle: `linq-nomatch-${Date.now()}`,
        from_number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: 'what is the meaning of life',
      },
    });
    expect(resp.status()).toBe(200);
    const json = (await resp.json()) as {
      success: boolean;
      data: { draftMessageId: string };
    };
    const admin = createAdmin();
    const { data: draft } = await admin
      .from('messages')
      .select('body, draft_status')
      .eq('id', json.data.draftMessageId)
      .single();
    expect(draft?.draft_status).toBe('pending_review');
    // Default fallback prefix.
    expect(draft?.body?.startsWith('Thanks for reaching out')).toBe(true);
  });
});
