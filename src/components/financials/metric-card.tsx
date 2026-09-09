/**
 * MetricCard — a single emphasis tile in the financial command center.
 *
 * Server component, warm-operator-console palette only (tokens from
 * globals.css `.today-theme`). Renders a mono eyebrow, a large serif
 * value, an optional quiet sub-line, an optional prior-period delta chip,
 * an optional sparkline slot, and an optional drilldown `href` (rendered
 * as a single overlay `<Link>` over position:relative content — the
 * RentRow idiom, no nested interactive elements).
 *
 * Honest by construction: pass the already formatted value (`—` for
 * unknown / not-connected) and an already formatted delta (`null` →
 * chip omitted, never a fabricated `+$0`) — this component never
 * fabricates a figure.
 */

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export type MetricCardTone = 'neutral' | 'good' | 'warn' | 'critical';

export interface MetricCardProps {
  label: string;
  value: string;
  /** Quiet supporting line under the value (optional). */
  context?: string;
  tone?: MetricCardTone;
  /** Pre-formatted signed delta, e.g. '+$420' / '−$180'; `null` → omitted. */
  delta?: string | null;
  deltaTone?: MetricCardTone;
  /** Tiny trend visual rendered at the bottom of the card (optional). */
  sparkline?: ReactNode;
  /** Drilldown target; renders an overlay `<Link>` (RentRow idiom). */
  href?: string;
  testId?: string;
}

const TONE_COLOR: Record<MetricCardTone, string> = {
  neutral: 'var(--ink)',
  good: 'var(--green-ink)',
  warn: 'var(--clay)',
  critical: 'var(--clay-ink)',
};

const DELTA_CHIP_STYLE: Record<MetricCardTone, CSSProperties> = {
  neutral: { background: 'var(--panel)', border: '1px solid var(--hairline)', color: 'var(--ink-2)' },
  good: { background: 'var(--green-bg)', color: 'var(--green-ink)' },
  warn: { background: 'var(--clay-bg)', color: 'var(--clay-ink)' },
  critical: { background: 'var(--clay-bg)', color: 'var(--clay-ink)' },
};

const cardStyle: CSSProperties = {
  position: 'relative',
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  minWidth: 0,
};

const overlayLinkStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  textDecoration: 'none',
  borderRadius: 12,
};

const labelRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const deltaChipBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  fontVariantNumeric: 'tabular-nums',
  padding: '1px 7px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const arrowStyle: CSSProperties = {
  color: 'var(--ink-4)',
  fontSize: 12,
  lineHeight: 1,
};

const contextStyle: CSSProperties = {
  fontSize: '11.5px',
  lineHeight: 1.35,
  color: 'var(--ink-3)',
};

export function MetricCard({
  label,
  value,
  context,
  tone = 'neutral',
  delta,
  deltaTone = 'neutral',
  sparkline,
  href,
  testId,
}: MetricCardProps) {
  const valueStyle: CSSProperties = {
    fontFamily: 'var(--font-serif-display), Georgia, serif',
    fontSize: '26px',
    lineHeight: 1.05,
    fontWeight: 400,
    letterSpacing: '-0.01em',
    color: TONE_COLOR[tone],
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
    fontVariantNumeric: 'tabular-nums lining-nums',
  };

  return (
    <div style={cardStyle} data-testid={testId} className={href ? 'metric-card-linked' : undefined}>
      {href ? (
        <Link
          href={href}
          aria-label={`${label}: ${value}${context ? ` — ${context}` : ''}`}
          style={overlayLinkStyle}
          className="metric-card-link"
        />
      ) : null}
      <div style={labelRowStyle}>
        <span style={labelStyle}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {delta ? (
            <span
              style={{ ...deltaChipBaseStyle, ...DELTA_CHIP_STYLE[deltaTone] }}
              data-testid={testId ? `${testId}-delta` : undefined}
            >
              {delta}
            </span>
          ) : null}
          {href ? (
            <span aria-hidden="true" style={arrowStyle}>
              →
            </span>
          ) : null}
        </span>
      </div>
      <span style={valueStyle}>{value}</span>
      {context ? <span style={contextStyle}>{context}</span> : null}
      {sparkline ? <div aria-hidden="true">{sparkline}</div> : null}
      {href ? <MetricCardStyles /> : null}
    </div>
  );
}

function MetricCardStyles() {
  return (
    <style precedence="default" href="financials-metric-card">{`
      .metric-card-linked:hover { border-color: var(--hairline-strong); }
      .metric-card-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: -2px;
        border-radius: 12px;
      }
    `}</style>
  );
}
