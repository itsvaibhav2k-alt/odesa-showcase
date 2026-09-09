import type { CSSProperties } from 'react';
import Link from 'next/link';

/**
 * Today's stored voice-call activity on the Today console.
 *
 * Server-compatible presentational component (counts arrive as props from
 * `getVoiceCallActivity`). Same quiet chrome as OvernightCard: hairline
 * panel, mono eyebrow, serif number. The only color is a clay note when
 * calls need the owner's review.
 *
 * Renders nothing when no calls happened today — an empty brag is noise.
 */

interface VoiceCallsCardProps {
  callsToday: number;
  resolvedAutomatically: number;
  needsReview: number;
}

const cardStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '16px 18px 14px',
  fontFamily: 'var(--font-sans-operator)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  paddingBottom: 12,
  borderBottom: '1px solid var(--hairline-faint)',
  marginBottom: 12,
};

const eyebrowStyle: CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const linkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.02em',
  textDecoration: 'none',
};

const headlineRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
};

const headlineValueStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display)',
  fontSize: '24px',
  lineHeight: 1.1,
  color: 'var(--ink-1)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const headlineLabelStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  letterSpacing: '0.01em',
};

const metaStyle: CSSProperties = {
  marginTop: 6,
  fontSize: '11px',
  lineHeight: 1.4,
  color: 'var(--ink-3)',
};

export function VoiceCallsCard({
  callsToday,
  resolvedAutomatically,
  needsReview,
}: VoiceCallsCardProps) {
  if (callsToday === 0) return null;

  return (
    <section data-testid="voice-calls-card" style={cardStyle}>
      <div style={headStyle}>
        <span style={eyebrowStyle}>Call records today</span>
        <Link href="/calls" style={linkStyle}>
          View calls →
        </Link>
      </div>

      <div style={headlineRowStyle}>
        <span className="num" style={headlineValueStyle}>
          {callsToday}
        </span>
        <span style={headlineLabelStyle}>
          {callsToday === 1 ? 'call recorded' : 'calls recorded'}
        </span>
      </div>
      <p style={metaStyle}>
        {resolvedAutomatically} with completed outcome evidence
        {' · '}
        <span style={needsReview > 0 ? { color: 'var(--clay-ink)' } : undefined}>
          {needsReview} {needsReview === 1 ? 'needs review' : 'need review'}
        </span>
      </p>
    </section>
  );
}
