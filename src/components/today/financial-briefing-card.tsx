/**
 * Today v2 — financial briefing card.
 *
 * Server component. A compact, high-signal money strip for the morning
 * console: collections status (with a tone dot), late-rent exposure, the
 * single biggest money exception, one quiet "watching" financial signal,
 * and a link to the full `/financials` page. Today is the briefing, not
 * the financial page — this stays deliberately brief.
 *
 * Money is rendered straight from the typed {@link TodayFinancialBriefing}
 * (integer cents); no figure is fabricated, and the honest expense state
 * is surfaced rather than hidden. Renders nothing when no rent has been
 * billed AND there is nothing to watch — there's no money picture to show.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

import { formatMoneyCents, formatPct } from '@/lib/financials/format';
import type {
  TodayFinancialBriefing,
  TodayFinancialTone,
} from '@/types/today';

interface FinancialBriefingCardProps {
  briefing: TodayFinancialBriefing;
}

const TONE_DOT: Record<TodayFinancialTone, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  clay: 'var(--clay)',
  muted: 'var(--ink-3)',
};

const TONE_INK: Record<TodayFinancialTone, string> = {
  green: 'var(--green-ink)',
  amber: 'var(--amber-ink)',
  clay: 'var(--clay-ink)',
  muted: 'var(--ink-3)',
};

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
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const periodLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.02em',
};

const linkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.04em',
  color: 'var(--terracotta)',
  textDecoration: 'none',
};

const headlineStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: '17px',
  lineHeight: 1.4,
  color: 'var(--ink-1)',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '1px',
  background: 'var(--hairline-faint)',
  marginTop: 12,
};

const cellStyle: CSSProperties = {
  background: 'var(--panel)',
  padding: '8px 14px 6px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const cellEyebrowStyle: CSSProperties = {
  fontSize: '9.5px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const cellValueStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display)',
  fontSize: '18px',
  lineHeight: 1.15,
  color: 'var(--ink-1)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const lineRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginTop: 12,
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
};

const lineLabelStyle: CSSProperties = {
  fontSize: '9.5px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  flexShrink: 0,
};

const footnoteStyle: CSSProperties = {
  marginTop: 12,
  paddingTop: 10,
  borderTop: '1px solid var(--hairline-faint)',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.01em',
};

function Dot({ tone }: { tone: TodayFinancialTone }) {
  return (
    <span
      aria-hidden
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: TONE_DOT[tone],
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

export function FinancialBriefingCard({ briefing }: FinancialBriefingCardProps) {
  const {
    periodLabel,
    rentBilledCents,
    rentCollectedCents,
    rentOutstandingCents,
    rentLateCents,
    collectionRatePct,
    collectionsTone,
    topException,
    watch,
    hasBilled,
  } = briefing;

  // Nothing billed and nothing to watch → no honest money picture to show.
  if (!hasBilled && watch.tone === 'muted' && topException === null) {
    return null;
  }

  const headline = hasBilled
    ? `Collected ${formatMoneyCents(rentCollectedCents)} of ${formatMoneyCents(rentBilledCents)} billed`
    : 'No rent billed this period yet';

  return (
    <section data-section="today-financials" style={cardStyle}>
      <div style={headStyle}>
        <span style={eyebrowStyle}>
          <Dot tone={collectionsTone} />
          Money this period
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 12 }}>
          <span className="num" style={periodLabelStyle}>
            {periodLabel}
          </span>
          <Link href="/financials" style={linkStyle}>
            Open financials →
          </Link>
        </span>
      </div>

      <p style={headlineStyle}>
        {headline}
        {hasBilled && collectionRatePct !== null ? (
          <span style={{ color: TONE_INK[collectionsTone] }}>
            {' '}· {formatPct(collectionRatePct)} collected
          </span>
        ) : null}
      </p>

      <div style={gridStyle}>
        <div style={cellStyle}>
          <span style={cellEyebrowStyle}>Outstanding</span>
          <span className="num" style={cellValueStyle}>
            {formatMoneyCents(rentOutstandingCents)}
          </span>
        </div>
        <div style={cellStyle}>
          <span style={cellEyebrowStyle}>Late exposure</span>
          <span
            className="num"
            style={{
              ...cellValueStyle,
              color: rentLateCents > 0 ? 'var(--clay-ink)' : 'var(--ink-1)',
            }}
          >
            {formatMoneyCents(rentLateCents)}
          </span>
        </div>
        <div style={cellStyle}>
          <span style={cellEyebrowStyle}>Collected</span>
          <span className="num" style={cellValueStyle}>
            {formatMoneyCents(rentCollectedCents)}
          </span>
        </div>
      </div>

      {topException ? (
        <div style={lineRowStyle}>
          <span style={lineLabelStyle}>Biggest exception</span>
          <span>
            <strong style={{ color: 'var(--ink-1)', fontWeight: 600 }}>
              {topException.title}
            </strong>
            {topException.amountCents !== null
              ? ` · ${formatMoneyCents(topException.amountCents)}`
              : ''}
            {' — '}
            {topException.detail}
          </span>
        </div>
      ) : null}

      <div style={lineRowStyle}>
        <span style={lineLabelStyle}>Watching</span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <Dot tone={watch.tone} />
          <span>
            <strong style={{ color: 'var(--ink-1)', fontWeight: 600 }}>
              {watch.title}
            </strong>
            {' — '}
            {watch.meta}
          </span>
        </span>
      </div>

      <p style={footnoteStyle}>
        Figures are rent-basis only. No money movement is automated.
      </p>
    </section>
  );
}
