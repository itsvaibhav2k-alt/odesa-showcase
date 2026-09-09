/**
 * Unit test for refreshGoogleToken.
 *
 * Mocks:
 *   - OAuth2Client (via deps.oauthClientFactory) returning new
 *     credentials at refresh time.
 *   - The supabase admin update path via the chainable handler-helper
 *     mock — we read back the update payload to assert the new
 *     access_token + expires_at made it to the DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetCryptoCache,
  encryptToken,
} from '../crypto';
import { refreshGoogleToken, type RefreshableTokenRow } from '../refresh';
import { ORG_ID, makeAdmin } from '@/lib/agent/worker/handlers/__tests__/__helpers';

const USER_ID = '77777777-7777-4777-8777-777777777777';
const ROW_ID = '88888888-8888-4888-8888-888888888888';

// Deterministic test fixture, never a deployed encryption key.
const VALID_KEY_HEX = Array.from({ length: 64 }, (_, i) => (i % 16).toString(16)).join('');

describe('refreshGoogleToken', () => {
  beforeEach(() => {
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = VALID_KEY_HEX;
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://app/oauth/cb';
    _resetCryptoCache();
  });

  afterEach(() => {
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    _resetCryptoCache();
  });

  it('refreshes the access_token and persists encrypted patch', async () => {
    const oldRefresh = encryptToken('REFRESH-1');
    const oldAccess = encryptToken('OLD-ACCESS');
    const fixedNow = new Date('2026-05-08T12:00:00.000Z');
    const newExpiry = new Date('2026-05-08T13:00:00.000Z');

    const row: RefreshableTokenRow = {
      id: ROW_ID,
      organization_id: ORG_ID,
      user_id: USER_ID,
      provider: 'google_calendar',
      access_token: oldAccess,
      refresh_token: oldRefresh,
      expires_at: '2026-05-08T11:00:00.000Z',
      scope: null,
      account_email: 'me@example.com',
    };

    // Stub OAuth2Client.refreshAccessToken.
    const refreshAccessToken = vi.fn(async () => ({
      credentials: {
        access_token: 'NEW-ACCESS',
        refresh_token: undefined,
        expiry_date: newExpiry.getTime(),
      },
    }));
    const setCredentials = vi.fn();
    const fakeClient = {
      setCredentials,
      refreshAccessToken,
    };

    const { admin, calls } = makeAdmin({
      oauth_tokens: [
        {
          data: {
            id: ROW_ID,
            organization_id: ORG_ID,
            user_id: USER_ID,
            provider: 'google_calendar',
            // Mirror the row + the patch the handler will write.
            access_token: 'enc-new', // shape only — handler doesn't read it back
            refresh_token: oldRefresh,
            expires_at: newExpiry.toISOString(),
            scope: null,
            account_email: 'me@example.com',
            created_at: fixedNow.toISOString(),
            updated_at: fixedNow.toISOString(),
          },
          error: null,
        },
      ],
    });

    const updated = await refreshGoogleToken(admin, row, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oauthClientFactory: () => fakeClient as any,
      now: () => fixedNow,
    });

    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: 'REFRESH-1' });
    expect(updated.user_id).toBe(USER_ID);
    expect(updated.expires_at).toBe(newExpiry.toISOString());

    const updateCall = calls.find(
      (c) => c.table === 'oauth_tokens' && c.op === 'update',
    );
    expect(updateCall).toBeDefined();
    const patch = updateCall?.updateValues as Record<string, string>;
    // access_token re-encrypted, not plain.
    expect(patch.access_token).not.toBe('NEW-ACCESS');
    expect(typeof patch.access_token).toBe('string');
    expect(patch.expires_at).toBe(newExpiry.toISOString());
    // No new refresh token returned → patch should NOT include it.
    expect('refresh_token' in patch).toBe(false);
    // Org + user scoped.
    const scoped = updateCall?.eqs ?? [];
    expect(scoped).toEqual(
      expect.arrayContaining([
        ['id', ROW_ID],
        ['organization_id', ORG_ID],
        ['user_id', USER_ID],
      ]),
    );
  });

  it('persists a rotated refresh_token when Google returns one', async () => {
    const fixedNow = new Date('2026-05-08T12:00:00.000Z');
    const newExpiry = new Date('2026-05-08T13:00:00.000Z');

    const oldRefresh = encryptToken('REFRESH-1');
    const oldAccess = encryptToken('OLD-ACCESS');

    const row: RefreshableTokenRow = {
      id: ROW_ID,
      organization_id: ORG_ID,
      user_id: USER_ID,
      provider: 'google_calendar',
      access_token: oldAccess,
      refresh_token: oldRefresh,
      expires_at: '2026-05-08T11:00:00.000Z',
      scope: null,
      account_email: null,
    };

    const refreshAccessToken = vi.fn(async () => ({
      credentials: {
        access_token: 'NEW-ACCESS',
        refresh_token: 'REFRESH-2',
        expiry_date: newExpiry.getTime(),
      },
    }));
    const fakeClient = { setCredentials: vi.fn(), refreshAccessToken };

    const { admin, calls } = makeAdmin({
      oauth_tokens: [
        {
          data: {
            id: ROW_ID,
            organization_id: ORG_ID,
            user_id: USER_ID,
            provider: 'google_calendar',
            access_token: 'enc-new',
            refresh_token: 'enc-rotated',
            expires_at: newExpiry.toISOString(),
            scope: null,
            account_email: null,
            created_at: fixedNow.toISOString(),
            updated_at: fixedNow.toISOString(),
          },
          error: null,
        },
      ],
    });

    await refreshGoogleToken(admin, row, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oauthClientFactory: () => fakeClient as any,
      now: () => fixedNow,
    });

    const updateCall = calls.find(
      (c) => c.table === 'oauth_tokens' && c.op === 'update',
    );
    const patch = updateCall?.updateValues as Record<string, string>;
    expect(typeof patch.refresh_token).toBe('string');
    expect(patch.refresh_token).not.toBe('REFRESH-2');
  });

  it('throws when GOOGLE_OAUTH_CLIENT_ID is missing', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const row: RefreshableTokenRow = {
      id: ROW_ID,
      organization_id: ORG_ID,
      user_id: USER_ID,
      provider: 'google_calendar',
      access_token: encryptToken('A'),
      refresh_token: encryptToken('R'),
      expires_at: '2026-05-08T00:00:00.000Z',
      scope: null,
      account_email: null,
    };
    const { admin } = makeAdmin({});
    await expect(refreshGoogleToken(admin, row)).rejects.toThrow(
      /GOOGLE_OAUTH_CLIENT_ID/,
    );
  });
});
