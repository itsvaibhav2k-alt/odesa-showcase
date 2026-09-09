/**
 * GET /api/oauth/google/start
 *
 * Wave 7 — Stream G. Initiates the Google OAuth 2.0 authorization-code
 * flow for Calendar access. Auth-gated (operator-side flow only).
 *
 * Flow:
 *   1. Resolve the caller's Supabase session.
 *   2. Mint a CSRF state token (UUID), store it in a HTTP-only cookie
 *      so the callback can verify the round-trip wasn't crafted.
 *   3. Build the Google OAuth URL with calendar.events scope, offline
 *      access, and prompt=consent so we always get a refresh_token.
 *   4. 302 → Google.
 *
 * Required env (validated at start of the handler so misconfig is
 * loud, not silent):
 *   - GOOGLE_OAUTH_CLIENT_ID
 *   - GOOGLE_OAUTH_REDIRECT_URI (defaults to APP_URL/oauth/callback URL)
 */

import { randomUUID } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { FORBIDDEN_MESSAGE } from '@/lib/authz/policy';
import { createServerClient } from '@/lib/supabase/server';

const STATE_COOKIE = 'odesa_google_oauth_state';
const STATE_TTL_S = 600; // 10 min — plenty for a round-trip

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function resolveRedirectUri(): string {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit && explicit.length > 0) return explicit;
  // Fall back to the externally-reachable app URL. MCP_PUBLIC_URL is
  // generally the prod-reachable host; NEXT_PUBLIC_APP_URL is the dev
  // alternative. Pick whichever is set first.
  const base =
    process.env.MCP_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (!base) return '';
  return `${base.replace(/\/$/, '')}/api/oauth/google/callback`;
}

export async function GET(): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const loginBase =
      process.env.NEXT_PUBLIC_APP_URL ?? resolveRedirectUri() ?? 'http://localhost:3000';
    return NextResponse.redirect(new URL('/login', loginBase));
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!userRow || userRow.role === 'va') {
    return NextResponse.json(
      { success: false, error: FORBIDDEN_MESSAGE },
      { status: 403 },
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      {
        success: false,
        error:
          'GOOGLE_OAUTH_CLIENT_ID is not configured. Set it in .env.local before starting the OAuth flow.',
      },
      { status: 500 },
    );
  }
  const redirectUri = resolveRedirectUri();
  if (!redirectUri) {
    return NextResponse.json(
      {
        success: false,
        error:
          'GOOGLE_OAUTH_REDIRECT_URI (or MCP_PUBLIC_URL / NEXT_PUBLIC_APP_URL) is not set. Cannot build the OAuth callback URL.',
      },
      { status: 500 },
    );
  }

  const state = randomUUID();
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_S,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
