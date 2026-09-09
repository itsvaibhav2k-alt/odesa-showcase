/**
 * OAuth / email-confirmation callback — completes Supabase's PKCE flow.
 *
 * `signInWithOAuth` (Google) and confirmation-email links redirect here
 * with a one-time `?code=`. Exchanging it is what actually mints the
 * session cookie; without this route the code lands on a page, nothing
 * exchanges it, and the user bounces back to /login logged out (the
 * pre-fix production symptom).
 *
 * `?next=` chooses the post-auth destination and is constrained to
 * same-origin relative paths so the redirect can't be aimed off-site.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

const DEFAULT_NEXT = '/';

function safeNextPath(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  // Relative path only: must start with a single '/' ('//' is a
  // scheme-relative external URL) and carry no protocol.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    return DEFAULT_NEXT;
  }
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  if (!code) {
    console.error('[auth-callback] missing code param');
    return NextResponse.redirect(`${origin}/login?error=auth_callback`);
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(`[auth-callback] code exchange failed: ${error.message}`);
    return NextResponse.redirect(`${origin}/login?error=auth_callback`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
