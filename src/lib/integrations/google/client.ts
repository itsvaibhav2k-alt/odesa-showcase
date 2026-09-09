/**
 * Google Calendar client factory.
 *
 * Wave 7 — Stream G. `getCalendarClient` resolves a configured
 * `googleapis.calendar('v3')` instance for a given (org, user). It:
 *
 *   1. Looks up the `oauth_tokens` row for `(organization_id, user_id,
 *      provider='google_calendar')`. If no row exists, returns null —
 *      the handler narrates `calendar_not_connected`.
 *   2. If `expires_at` is within {@link REFRESH_BUFFER_MS} of now,
 *      calls {@link refreshGoogleToken} to get a fresh access_token.
 *   3. Decrypts the (possibly-refreshed) access token and configures a
 *      `google.auth.OAuth2` client + `calendar('v3')` instance.
 *
 * Why "no row → null" instead of throwing: handlers branch on this to
 * narrate something the operator can act on ("connect Google Calendar
 * in settings first"). Throwing forces every caller to wrap the call,
 * and a missing row isn't an error — it's a known operational state.
 *
 * Stream T — when integration tests stub this, return a mocked
 * calendar instance shaped like `{ events: { insert, list, delete } }`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { google, type calendar_v3 } from 'googleapis';

import type { Database, OAuthToken } from '@/types/database';

import { decryptToken } from './crypto';
import { refreshGoogleToken } from './refresh';

/** Refresh proactively when the token has under 5 minutes of life left. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const PROVIDER = 'google_calendar' as const;

export interface GetCalendarClientArgs {
  admin: SupabaseClient<Database>;
  organizationId: string;
  userId: string;
  /** Override the clock for tests. */
  now?: () => Date;
}

/**
 * Returns a `calendar('v3')` client backed by the user's stored OAuth
 * row, or `null` if no row exists.
 *
 * Token expiry is determined by `expires_at < now + 5min`; that path
 * triggers a single refresh + persist before constructing the client.
 * Refresh failures throw — they're a real error (Google revoked, env
 * misconfigured), not "not connected".
 */
export async function getCalendarClient(
  args: GetCalendarClientArgs,
): Promise<calendar_v3.Calendar | null> {
  const { admin, organizationId, userId } = args;
  const now = args.now ?? ((): Date => new Date());

  const { data: row, error } = await admin
    .from('oauth_tokens')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (error) {
    throw new Error(`getCalendarClient: token lookup failed — ${error.message}`);
  }
  if (!row) {
    return null;
  }

  let live: OAuthToken = row as OAuthToken;
  const expiresAtMs = new Date(live.expires_at).getTime();
  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs - now().getTime() < REFRESH_BUFFER_MS
  ) {
    live = await refreshGoogleToken(admin, live);
  }

  const accessToken = decryptToken(live.access_token);
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI,
  );
  oauth2.setCredentials({ access_token: accessToken });

  return google.calendar({ version: 'v3', auth: oauth2 });
}
