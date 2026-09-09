'use client';

/**
 * Odesa Phone Number card — Settings section 1.
 *
 * Renders the organization's assigned 10DLC number in big JetBrains
 * Mono (data-xl) with the landlord-facing caption. When the number
 * hasn't been provisioned yet (onboarding not finished or 10DLC
 * approval pending) we show the ink-500 placeholder instead.
 *
 * The "Call handling configured" toggle reflects `organizations.voice_enabled`.
 * It is rendered disabled (read-only display) — the operator sets their
 * voice preference via Settings → Phone card CTA or /onboarding/voice.
 * Null / undefined (column absent pre-migration) renders as off.
 */

import { phoneLineCaption, type ReadinessState } from '@/lib/voice/readiness';
import Link from 'next/link';

interface PhoneCardProps {
  /** E.164 number from `organizations.odesa_phone_number`, nullable. */
  odesaPhoneNumber: string | null;
  /**
   * Voice/Retell opt-in flag from `organizations.voice_enabled`.
   * Pass `null` when the column hasn't landed yet (pre-T2b migration) —
   * the toggle renders in its off state and the footer CTA links to
   * /onboarding/voice so the operator can opt in when the column is live.
   */
  voiceEnabled: boolean | null;
  /**
   * Voice readiness state (src/lib/voice/readiness.ts). The "Odesa answers 24/7"
   * claim is gated on this: ONLY state 4 (production-live, external evidence)
   * shows it. Optional so the server component can thread the real signal when
   * it is wired; absent → the honest floor (state 1, local simulation), never a
   * false 24/7 claim from the mere presence of a number.
   */
  voiceReadinessState?: ReadinessState;
}

/** Format a stored E.164 number for display. Falls through on non-US. */
function formatPhoneForDisplay(raw: string): string {
  // Only format well-formed US numbers (+1 + 10 digits). Everything
  // else renders as-is so international numbers don't get mangled.
  const match = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (!match) return raw;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

export function PhoneCard({
  odesaPhoneNumber,
  voiceEnabled,
  voiceReadinessState,
}: PhoneCardProps) {
  // `voiceEnabled` is driven by `organizations.voice_enabled` (T2b column).
  // Null means the column hasn't landed yet; treat as false (off state).
  const isVoiceOn = voiceEnabled === true;

  const hasNumber = !!odesaPhoneNumber && odesaPhoneNumber.trim() !== '';
  const display = hasNumber ? formatPhoneForDisplay(odesaPhoneNumber!) : null;

  return (
    <section
      data-testid="settings-phone-card"
      aria-labelledby="settings-phone-heading"
      className="flex flex-col gap-5"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
      }}
    >
      <div>
        <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
          Assigned number
        </p>
        {hasNumber ? (
          <p
            data-testid="settings-phone-number"
            className="tabular-nums mt-3"
            style={{
              fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontWeight: 600,
              fontSize: '32px',
              lineHeight: 1.1,
              letterSpacing: '-0.01em',
              color: 'var(--ink-900)',
            }}
          >
            {display}
          </p>
        ) : (
          <p
            data-testid="settings-phone-placeholder"
            className="mt-3"
            style={{
              fontSize: '15px',
              lineHeight: 1.5,
              color: 'var(--ink-500)',
              maxWidth: '52ch',
            }}
          >
            Assigned once onboarding completes and 10DLC approval lands.
          </p>
        )}
      </div>

      {hasNumber ? (
        <p
          data-testid="settings-phone-caption"
          style={{
            fontSize: '13px',
            lineHeight: 1.55,
            color: 'var(--ink-600)',
            maxWidth: '52ch',
          }}
        >
          {phoneLineCaption(voiceReadinessState ?? 1)}
        </p>
      ) : null}

      {hasNumber ? (
        <div
          data-testid="settings-phone-outbound"
          className="flex flex-col gap-1"
          style={{
            fontSize: '13px',
            lineHeight: 1.55,
            color: 'var(--ink-600)',
            maxWidth: '52ch',
          }}
        >
          <p>
            Odesa drafts replies, rent reminders, and maintenance updates.
          </p>
          <p>
            Nothing sends to a tenant until you approve it — outbound stays
            under your review.
          </p>
        </div>
      ) : null}

      <div
        className="flex items-center justify-between"
        style={{
          paddingTop: '16px',
          borderTop: '1px solid var(--ink-200)',
        }}
      >
        <div className="flex flex-col gap-1">
          <p
            className="meta-label"
            style={{ color: 'var(--ink-500)' }}
          >
            Call handling
          </p>
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.4,
              color: 'var(--ink-800)',
            }}
          >
            Call handling configured
          </p>
          {voiceEnabled === null && (
            <a
              href="/onboarding/voice"
              className="text-xs underline underline-offset-4"
              style={{ color: 'var(--ink-500)' }}
              data-testid="settings-phone-voice-setup-link"
            >
              Set up voice calling
            </a>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isVoiceOn}
          aria-disabled
          disabled
          data-testid="settings-phone-voice-toggle"
          data-state={isVoiceOn ? 'on' : 'off'}
          className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed items-center rounded-full"
          style={{
            background: isVoiceOn ? 'var(--navy-700)' : 'var(--paper-300)',
            opacity: 0.6,
            transition: 'background-color 180ms var(--ease-smooth)',
          }}
        >
          <span className="sr-only">Call handling configured</span>
          <span
            aria-hidden
            className="inline-block size-5 rounded-full bg-white shadow-sm"
            style={{
              transform: isVoiceOn ? 'translateX(22px)' : 'translateX(2px)',
              transition: 'transform 180ms var(--ease-out)',
            }}
          />
        </button>
      </div>

      <nav
        aria-label="Call setup tools"
        className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-4 text-sm"
        style={{ borderColor: 'var(--ink-200)', color: 'var(--ink-600)' }}
      >
        <Link href="/calls/settings">Line setup</Link>
        <Link href="/calls/scripts">Scripts</Link>
        <Link href="/calls/test">Local simulation</Link>
      </nav>
    </section>
  );
}

export { formatPhoneForDisplay };
