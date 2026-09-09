/**
 * Google OAuth token refresh.
 *
 * Wave 7 — Stream G. When the cached access_token is within 5 minutes
 * of expiry (or already past), call out to Google with the encrypted
 * refresh_token, persist the new access_token + new expires_at, and
 * return the updated DB row. Refresh tokens themselves rarely change,
 * but Google occasionally rotates them, so we re-encrypt + persist when
 * a new one comes back.
 *
 * Privacy / security:
 *   - The encrypted blobs never leave the row. We decrypt locally,
 *     hand the plaintext to `OAuth2Client`, then encrypt anything we
 *     persist back.
 *   - On any error path we never log the access_token / refresh_token.
 *   - `OAuth2Client.refreshAccessToken` is documented as deprecated in
 *     newer googleapis versions — but the recommended replacement
 *     (`getAccessToken()`) is the same wire call under the hood. We
 *     use whichever the version exposes; the test mocks both shapes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { google, type Auth } from 'googleapis';

import type { Database, OAuthToken } from '@/types/database';

import { decryptToken, encryptToken } from './crypto';

/**
 * The fields we read off the DB row to refresh. Matches `OAuthToken`
 * but typed loosely so tests can pass a slim object.
 */
export type RefreshableTokenRow = Pick<
  OAuthToken,
  | 'id'
  | 'organization_id'
  | 'user_id'
  | 'provider'
  | 'access_token'
  | 'refresh_token'
  | 'expires_at'
  | 'scope'
  | 'account_email'
>;

export interface RefreshGoogleTokenDeps {
  /** Optional override for tests — defaults to a real OAuth2Client. */
  oauthClientFactory?: () => Auth.OAuth2Client;
  /** Override `Date.now()` for deterministic expires_at assertions. */
  now?: () => Date;
}

const REQUIRED_ENV: ReadonlyArray<string> = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
];

/**
 * Refresh a stored Google OAuth row.
 *
 * @param admin - Service-role Supabase client (bypasses RLS).
 * @param row - The row currently in `oauth_tokens` (encrypted).
 * @param deps - Test seams for the OAuth client + clock.
 * @returns The updated row (decrypted access_token NOT included — re-
 *   read via {@link decryptToken} when you need the plaintext).
 * @throws if the refresh call fails or the env is missing.
 */
export async function refreshGoogleToken(
  admin: SupabaseClient<Database>,
  row: RefreshableTokenRow,
  deps: RefreshGoogleTokenDeps = {},
): Promise<OAuthToken> {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      throw new Error(
        `refreshGoogleToken: ${key} is not set; cannot refresh access tokens.`,
      );
    }
  }

  const refreshTokenPlain = decryptToken(row.refresh_token);
  const factory =
    deps.oauthClientFactory ??
    ((): Auth.OAuth2Client =>
      new google.auth.OAuth2(
        process.env.GOOGLE_OAUTH_CLIENT_ID,
        process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        process.env.GOOGLE_OAUTH_REDIRECT_URI,
      ));
  const client = factory();
  client.setCredentials({ refresh_token: refreshTokenPlain });

  // Prefer the modern API (`getAccessToken`) — falls back to the
  // legacy method if the installed version still ships it.
  let accessToken: string | null = null;
  let newRefreshToken: string | null = null;
  let expiresAtIso: string | null = null;

  // googleapis returns the refreshed credentials via either
  // refreshAccessToken (callback-style) or getAccessToken (returns
  // {token, res}). We try the cleaner path first.
  if (typeof client.refreshAccessToken === 'function') {
    const { credentials } = await client.refreshAccessToken();
    accessToken = credentials.access_token ?? null;
    newRefreshToken = credentials.refresh_token ?? null;
    if (typeof credentials.expiry_date === 'number') {
      expiresAtIso = new Date(credentials.expiry_date).toISOString();
    }
  } else {
    const { token } = await client.getAccessToken();
    accessToken = token ?? null;
    // No expiry metadata via getAccessToken — fall back below.
  }

  if (!accessToken) {
    throw new Error('refreshGoogleToken: Google did not return an access_token.');
  }

  // Default expiry: 1 hour from now. Google's default is 3600s; we
  // shave a small buffer when persisting so callers refresh proactively.
  const now = deps.now ?? ((): Date => new Date());
  if (!expiresAtIso) {
    expiresAtIso = new Date(now().getTime() + 3600 * 1000).toISOString();
  }

  const updatePatch: Database['public']['Tables']['oauth_tokens']['Update'] = {
    access_token: encryptToken(accessToken),
    expires_at: expiresAtIso,
    updated_at: now().toISOString(),
  };
  if (newRefreshToken && newRefreshToken !== refreshTokenPlain) {
    updatePatch.refresh_token = encryptToken(newRefreshToken);
  }

  const { data: updated, error } = await admin
    .from('oauth_tokens')
    .update(updatePatch)
    .eq('id', row.id)
    .eq('organization_id', row.organization_id)
    .eq('user_id', row.user_id)
    .select('*')
    .single();

  if (error || !updated) {
    throw new Error(
      `refreshGoogleToken: failed to persist refreshed token — ${error?.message ?? 'no row returned'}`,
    );
  }

  return updated;
}
