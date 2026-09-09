/**
 * Signature fuzzing — Phase 4.
 *
 * Post a range of garbage signatures and payloads to the Twilio webhook
 * and assert every one returns 401. No DB state should be touched.
 *
 * Cases:
 *   - Missing X-Twilio-Signature header.
 *   - Empty X-Twilio-Signature header.
 *   - Random base64 garbage.
 *   - Valid-looking signature computed with the wrong token.
 *   - Valid-looking signature for a different URL (URL tamper).
 *   - Valid signature but the form body has been altered post-sign.
 *
 * Linq uses a fixed-secret scheme so a parallel Linq-side fuzz batch
 * is included for completeness.
 */

import { createHmac } from 'crypto';

import { expect, test } from '@playwright/test';

import {
  HAVE_SUPABASE,
  buildTwilioForm,
  provisionMessagingFixture,
  twilioSignature,
  type MessagingFixture,
} from './helpers';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

test.describe('messaging: signature fuzzing returns 401', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  let fixture: MessagingFixture;

  test.beforeEach(async () => {
    fixture = await provisionMessagingFixture();
  });

  test.afterEach(async () => {
    if (fixture) await fixture.teardown();
  });

  test('twilio: missing / empty / garbage / wrong-token all 401', async ({
    request,
  }) => {
    const params: Record<string, string> = {
      MessageSid: 'SMfuzz',
      From: fixture.tenant.phoneE164,
      To: fixture.odesaPhoneE164,
      Body: 'fuzz',
      AccountSid: 'ACfuzz',
    };
    const form = buildTwilioForm(params);
    const url = `${BASE}/api/messaging/inbound/twilio`;
    const goodSig = twilioSignature(url, params);

    // 1. No signature at all.
    const r1 = await request.post('/api/messaging/inbound/twilio', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: form,
    });
    expect(r1.status()).toBe(401);

    // 2. Empty signature.
    const r2 = await request.post('/api/messaging/inbound/twilio', {
      headers: {
        'X-Twilio-Signature': '',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form,
    });
    expect(r2.status()).toBe(401);

    // 3. Random base64.
    const r3 = await request.post('/api/messaging/inbound/twilio', {
      headers: {
        'X-Twilio-Signature': 'dGhpcy1pcy1nYXJiYWdl',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form,
    });
    expect(r3.status()).toBe(401);

    // 4. Wrong token.
    const wrongToken = createHmac('sha1', 'not-the-real-token')
      .update(url + 'BodyfuzzFromACfuzzMessageSidSMfuzzTo' + fixture.odesaPhoneE164)
      .digest('base64');
    const r4 = await request.post('/api/messaging/inbound/twilio', {
      headers: {
        'X-Twilio-Signature': wrongToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form,
    });
    expect(r4.status()).toBe(401);

    // 5. Good signature for a different URL.
    const otherSig = twilioSignature(
      'http://evil.example.com/api/messaging/inbound/twilio',
      params,
    );
    const r5 = await request.post('/api/messaging/inbound/twilio', {
      headers: {
        'X-Twilio-Signature': otherSig,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: form,
    });
    expect(r5.status()).toBe(401);

    // 6. Good signature but body altered after signing.
    const alteredForm = buildTwilioForm({ ...params, Body: 'tampered' });
    const r6 = await request.post('/api/messaging/inbound/twilio', {
      headers: {
        'X-Twilio-Signature': goodSig,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: alteredForm,
    });
    expect(r6.status()).toBe(401);
  });

  test('linq: wrong shared secret returns 401', async ({ request }) => {
    const r = await request.post('/api/messaging/inbound/linq', {
      headers: { 'sb-signing-secret': 'not-the-secret' },
      data: {
        message_handle: 'l1',
        number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: 'hi',
      },
    });
    expect(r.status()).toBe(401);
  });

  test('linq: missing signature header returns 401', async ({ request }) => {
    const r = await request.post('/api/messaging/inbound/linq', {
      data: {
        message_handle: 'l2',
        number: fixture.tenant.phoneE164,
        to_number: fixture.odesaPhoneE164,
        content: 'hi',
      },
    });
    expect(r.status()).toBe(401);
  });
});
