/**
 * GET /api/oauth/google/callback
 *
 * Wave 7 — Stream G. Completes the Google OAuth flow:
 *   1. Validates the `state` query param against the cookie set by
 *      /api/oauth/google/start.
 *   2. Exchanges the authorization `code` for tokens via OAuth2Client.
 *   3. Probes Google's userinfo to capture `account_email` (best-effort).
 *   4. Encrypts both tokens with AES-256-GCM (`OAUTH_TOKEN_ENCRYPTION_KEY`).
 *   5. UPSERTs `oauth_tokens` keyed on
 *      `(organization_id, user_id, provider='google_calendar')`.
 *   6. 302 → /settings/integrations?google_calendar=connected.
 *
 * Errors are surfaced via redirect query params so the settings page
 * can render an inline message; we never log raw token material on
 * any path.
 */

import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { google } from 'googleapis';

import { encryptToken } from '@/lib/integrations/google/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

const STATE_COOKIE = 'odesa_google_oauth_state';
const PROVIDER = 'google_calendar';
const SETTINGS_PATH = '/settings/integrations';

function resolveRedirectUri(): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit && explicit.length > 0) return explicit;
  const base =
    process.env.MCP_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/api/oauth/google/callback`;
}

function settingsRedirect(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL(SETTINGS_PATH, req.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const errorParam = req.nextUrl.searchParams.get('error');

  if (errorParam) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: errorParam,
    });
  }

  if (!code || !state) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'missing_code_or_state',
    });
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(STATE_COOKIE);
  if (!stateCookie || stateCookie.value !== state) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'state_mismatch',
    });
  }
  // One-shot — invalidate immediately whether or not the rest succeeds.
  cookieStore.set(STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'not_authenticated',
    });
  }

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('id, organization_id, role')
    .eq('id', user.id)
    .single();
  if (userErr || !userRow) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'user_not_found',
    });
  }
  if (userRow.role === 'va') {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'forbidden',
    });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = resolveRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'oauth_env_missing',
    });
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Exchange auth code → tokens. OAuth2Client throws on transport
  // errors and returns tokens on success. We intentionally do NOT log
  // anything off `tokens` — even on error.
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let expiresAtIso: string | null = null;
  let scope: string | null = null;
  try {
    const { tokens } = await oauth2.getToken(code);
    accessToken = tokens.access_token ?? null;
    refreshToken = tokens.refresh_token ?? null;
    scope = tokens.scope ?? null;
    if (typeof tokens.expiry_date === 'number') {
      expiresAtIso = new Date(tokens.expiry_date).toISOString();
    } else {
      expiresAtIso = new Date(Date.now() + 3600 * 1000).toISOString();
    }
  } catch {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'token_exchange_failed',
    });
  }

  if (!accessToken || !refreshToken) {
    // Without a refresh_token we can't refresh later. Force consent
    // by sending the user back to /start, which already passes
    // prompt=consent.
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'no_refresh_token',
    });
  }

  // Probe userinfo for the email — best-effort. A failure here doesn't
  // block the connection.
  let accountEmail: string | null = null;
  try {
    oauth2.setCredentials({ access_token: accessToken });
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
    const me = await oauth2Api.userinfo.get();
    if (me.data?.email) {
      accountEmail = me.data.email;
    }
  } catch {
    accountEmail = null;
  }

  let encryptedAccess: string;
  let encryptedRefresh: string;
  try {
    encryptedAccess = encryptToken(accessToken);
    encryptedRefresh = encryptToken(refreshToken);
  } catch {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'encryption_unavailable',
    });
  }

  const admin = createAdminClient();
  const { error: upsertErr } = await admin
    .from('oauth_tokens')
    .upsert(
      {
        organization_id: userRow.organization_id,
        user_id: userRow.id,
        provider: PROVIDER,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        expires_at: expiresAtIso,
        scope,
        account_email: accountEmail,
      },
      { onConflict: 'organization_id,user_id,provider' },
    );

  if (upsertErr) {
    return settingsRedirect(req, {
      google_calendar: 'error',
      reason: 'persist_failed',
    });
  }

  return settingsRedirect(req, { google_calendar: 'connected' });
}
