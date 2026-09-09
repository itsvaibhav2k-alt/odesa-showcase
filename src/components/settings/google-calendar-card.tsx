'use client';

/**
 * Google Calendar integration card — Settings → Integrations.
 *
 * Wave 7 — Stream G. Two states:
 *
 *   - **Connected**: shows the Google account email + a Disconnect
 *     button that calls {@link disconnectGoogleCalendar}, then
 *     `router.refresh()`s the parent page so the row goes back to the
 *     unconnected state.
 *   - **Not connected**: a "Connect Google Calendar" button (anchor)
 *     that links to `/api/oauth/google/start`, which redirects to
 *     Google and back.
 *
 * Inline error display: when the OAuth callback hits a failure path it
 * redirects back with `?google_calendar=error&reason=<code>`. The
 * parent page passes that through; the card translates known reasons
 * into actionable copy.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { disconnectGoogleCalendar } from '@/app/(dashboard)/settings/integrations/actions';

interface GoogleCalendarCardProps {
  connectedEmail: string | null;
  errorReason?: string | null;
  justConnected?: boolean;
}

const ERROR_COPY: Record<string, string> = {
  state_mismatch:
    'The verification token didn\'t match. Please try connecting again.',
  missing_code_or_state:
    'Google didn\'t return the expected response. Please try again.',
  no_refresh_token:
    'Google didn\'t return a refresh token. Try disconnecting from Google\'s side first, then reconnect here.',
  oauth_env_missing:
    'Google OAuth isn\'t configured on this server. Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in env.',
  encryption_unavailable:
    'Token encryption is not configured. Set OAUTH_TOKEN_ENCRYPTION_KEY in env.',
  not_authenticated: 'Sign in first, then try connecting again.',
  user_not_found: 'We couldn\'t resolve your user profile. Reload and retry.',
  token_exchange_failed:
    'Google rejected the auth code. Try again — make sure your clock is synced.',
  persist_failed:
    'We exchanged tokens with Google but couldn\'t save them. Please try again.',
};

function describeError(reason: string): string {
  return (
    ERROR_COPY[reason] ??
    `Connection failed (${reason}). Please try again.`
  );
}

export function GoogleCalendarCard({
  connectedEmail,
  errorReason,
  justConnected,
}: GoogleCalendarCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDisconnect = (): void => {
    setError(null);
    startTransition(async () => {
      const result = await disconnectGoogleCalendar();
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const isConnected = Boolean(connectedEmail);

  return (
    <section
      data-testid="google-calendar-card"
      aria-labelledby="google-calendar-heading"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
      }}
    >
      <p
        id="google-calendar-heading"
        className="meta-label"
        style={{ color: 'var(--ink-500)' }}
      >
        Google Calendar
      </p>

      {isConnected ? (
        <>
          <p
            data-testid="google-calendar-email"
            className="mt-3"
            style={{
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontWeight: 600,
              fontSize: '20px',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
              color: 'var(--ink-900)',
              wordBreak: 'break-all',
            }}
          >
            {connectedEmail}
          </p>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.55,
              color: 'var(--ink-600)',
              marginTop: '8px',
              maxWidth: '52ch',
            }}
          >
            {justConnected
              ? 'Connected. Odesa can now book vendor visits, showings, and inspections.'
              : 'Connected. Odesa can book and cancel calendar events on your behalf.'}
          </p>
          <button
            type="button"
            data-testid="google-calendar-disconnect"
            onClick={handleDisconnect}
            disabled={isPending}
            style={{
              marginTop: '20px',
              padding: '10px 18px',
              border: '1px solid var(--ink-200)',
              borderRadius: 'var(--radius-md-odesa)',
              background: 'var(--paper-0)',
              color: 'var(--ink-900)',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            {isPending ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </>
      ) : (
        <div style={{ marginTop: '20px' }}>
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.55,
              color: 'var(--ink-600)',
              marginBottom: '20px',
              maxWidth: '60ch',
            }}
          >
            Connect your Google Calendar so Odesa can book vendor visits,
            showings, and inspections directly from chat.
          </p>
          <a
            data-testid="google-calendar-connect"
            href="/api/oauth/google/start"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              borderRadius: 'var(--radius-md-odesa)',
              background: 'var(--ink-900)',
              color: 'var(--paper-0)',
              fontSize: '14px',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Connect Google Calendar
          </a>
        </div>
      )}

      {errorReason ? (
        <p
          role="alert"
          data-testid="google-calendar-error"
          style={{
            marginTop: '16px',
            fontSize: '13px',
            color: 'var(--accent-red)',
            maxWidth: '60ch',
          }}
        >
          {describeError(errorReason)}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          style={{
            marginTop: '16px',
            fontSize: '13px',
            color: 'var(--accent-red)',
            maxWidth: '60ch',
          }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
