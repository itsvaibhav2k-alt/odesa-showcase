'use client';

/**
 * Personal phone card — Settings → Integrations.
 *
 * Two states:
 *
 *   - **Verified**: shows the operator's E.164 number in JetBrains
 *     Mono with a small "Verified · <date>" caption.
 *   - **Unverified**: embeds `PhoneVerificationCard` so the operator
 *     can capture + confirm a number in place.
 *
 * The page above this card revalidates after `confirmPhoneVerification`
 * succeeds (`router.refresh()` from the verification card), so this
 * server-fed component re-renders into the verified state without a
 * full reload.
 */

import { PhoneVerificationCard } from './phone-verification-card';

interface PersonalPhoneCardProps {
  phoneE164: string | null;
  verifiedAt: string | null;
}

function formatVerifiedAt(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatPhoneForDisplay(raw: string): string {
  const match = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (!match) return raw;
  return `+1 (${match[1]}) ${match[2]}-${match[3]}`;
}

export function PersonalPhoneCard({
  phoneE164,
  verifiedAt,
}: PersonalPhoneCardProps) {
  const isVerified = Boolean(phoneE164 && verifiedAt);

  return (
    <section
      data-testid="personal-phone-card"
      aria-labelledby="personal-phone-heading"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '28px 32px',
      }}
    >
      <div>
        <p
          id="personal-phone-heading"
          className="meta-label"
          style={{ color: 'var(--ink-500)' }}
        >
          Your mobile number
        </p>

        {isVerified ? (
          <>
            <p
              data-testid="personal-phone-number"
              className="tabular-nums mt-3"
              style={{
                fontFamily:
                  "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                fontWeight: 600,
                fontSize: '24px',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
                color: 'var(--ink-900)',
              }}
            >
              {formatPhoneForDisplay(phoneE164!)}
            </p>
            <p
              data-testid="personal-phone-verified-caption"
              style={{
                fontSize: '13px',
                lineHeight: 1.55,
                color: 'var(--ink-600)',
                marginTop: '8px',
                maxWidth: '52ch',
              }}
            >
              Verified {formatVerifiedAt(verifiedAt!)}. Texts from this number
              now route to your operator agent instead of the tenant flow.
            </p>
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
              Verify your personal cell so texts from your phone reach the
              operator agent. Tenants stay on the existing tenant flow.
            </p>
            <PhoneVerificationCard />
          </div>
        )}
      </div>
    </section>
  );
}
