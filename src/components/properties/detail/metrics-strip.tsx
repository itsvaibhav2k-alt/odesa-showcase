/**
 * MetricsStrip — auto-fit grid of metric cells.
 *
 * Mirrors the mockup's `.metrics` / `.metric-cell` / `.mk` / `.mv` pattern.
 * tone 'warn' => clay color; tone 'good' => green-ink color.
 * When `prio` is set on a cell, renders a priority indicator instead of a
 * plain mono value (work-order ticket page pattern).
 */

import type { CSSProperties } from 'react';
import type { MetricCell, Urgency } from '@/lib/properties/mock-detail';

export interface MetricsStripProps {
  cells: MetricCell[];
}

const PRIO_DOT: Record<Urgency, string> = {
  urgent: 'var(--clay)',
  high: 'var(--amber)',
  normal: 'var(--gold)',
  low: 'var(--ink-4)',
};

const stripStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(130px, 100%), 1fr))',
  border: '1px solid var(--hairline)',
  borderRadius: '12px',
  background: 'var(--panel-lift)',
  overflow: 'hidden',
};

const cellStyle: CSSProperties = {
  padding: '15px 18px',
  borderRight: '1px solid var(--hairline-faint)',
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  minWidth: 0,
};

const cellLastStyle: CSSProperties = {
  ...cellStyle,
  borderRight: 'none',
};

const mkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const mvBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '18px',
  color: 'var(--ink)',
  fontWeight: 450,
  letterSpacing: '-0.01em',
};

const TONE_COLOR: Record<string, string> = {
  warn: 'var(--clay)',
  good: 'var(--green-ink)',
};

function PrioIndicator({ prio }: { prio: Urgency }) {
  const dotStyle: CSSProperties = {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: PRIO_DOT[prio],
    flexShrink: 0,
  };
  const wrapStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontFamily: 'var(--font-mono-operator)',
    fontSize: '13px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--ink-2)',
  };
  const label = prio.charAt(0).toUpperCase() + prio.slice(1);
  return (
    <span style={wrapStyle}>
      <span style={dotStyle} aria-hidden="true" />
      {label}
    </span>
  );
}

export function MetricsStrip({ cells }: MetricsStripProps) {
  return (
    <div style={stripStyle}>
      {cells.map((cell, i) => {
        const isLast = i === cells.length - 1;
        const mvStyle: CSSProperties = {
          ...mvBaseStyle,
          color: cell.tone ? TONE_COLOR[cell.tone] : 'var(--ink)',
        };
        return (
          <div key={cell.label} style={isLast ? cellLastStyle : cellStyle}>
            <span style={mkStyle}>{cell.label}</span>
            <span style={mvStyle}>
              {cell.prio ? <PrioIndicator prio={cell.prio} /> : cell.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
