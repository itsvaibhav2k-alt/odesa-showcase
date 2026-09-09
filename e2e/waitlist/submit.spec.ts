/**
 * Waitlist endpoint spec — Phase 8.
 *
 * Covers: happy-path insert, validation failure, duplicate email is
 * idempotent. Cleanup deletes every row we created.
 */

import { expect, test } from '@playwright/test';

import { HAVE_SUPABASE, createAdmin } from '../today/helpers';

test.describe('waitlist submit', () => {
  test.skip(
    !HAVE_SUPABASE,
    'Skipped: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and anon key to run',
  );

  const createdEmails: string[] = [];

  test.afterEach(async () => {
    if (createdEmails.length === 0) return;
    const admin = createAdmin();
    await admin
      .from('waitlist')
      .delete()
      .in('email', createdEmails.map((e) => e.toLowerCase()));
    createdEmails.length = 0;
  });

  test('accepts a minimal submission', async ({ request }) => {
    const email = `waitlist.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@odesa.test`;
    createdEmails.push(email);

    const res = await request.post('/api/waitlist', {
      data: { email },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('accepts a full submission', async ({ request }) => {
    const email = `full.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@odesa.test`;
    createdEmails.push(email);

    const res = await request.post('/api/waitlist', {
      data: {
        email,
        fullName: 'Test Landlord',
        unitCount: 12,
        currentStack: 'Stessa + spreadsheets',
        source: 'landing',
      },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('rejects invalid emails', async ({ request }) => {
    const res = await request.post('/api/waitlist', {
      data: { email: 'not-an-email' },
    });
    expect(res.status()).toBe(400);
  });

  test('duplicate submission returns ok without exploding', async ({
    request,
  }) => {
    const email = `dup.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@odesa.test`;
    createdEmails.push(email);

    const first = await request.post('/api/waitlist', { data: { email } });
    expect(first.status()).toBe(200);

    const second = await request.post('/api/waitlist', { data: { email } });
    expect(second.status()).toBe(200);
    const body = await second.json();
    expect(body.ok).toBe(true);
  });
});
