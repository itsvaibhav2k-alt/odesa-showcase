import type { CSSProperties } from 'react';
import type { StatMetric } from '@/lib/properties/mock-portfolio';

/**
 * Single metric cell inside a property card's stats strip.
 *
 * Presentational only — mirrors the mockup `.prop-stats .cell` (odesa-
 * properties4.html lines 1373-1409): a mono uppercase key (`.k`, --ink-2)
 * stacked over a mono tabular value (`.v`, `className="num"`). Tone tints the
 * value only: `warn` → clay, `good` → green-ink, otherwise default ink.
 *
 * Layout note: the parent card lays out the row (flex, hairline dividers
 * between cells); this cell only owns its own `flex: 1` column.
 */

export interface PropertyMetricProps {
  metric: StatMetric;
}

const cellStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  paddingRight: 14,
  borderRadius: 5,
};

const keyStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const valueBase: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '15px',
  color: 'var(--ink)',
  fontWeight: 450,
  letterSpacing: '-0.01em',
};

const toneColor: Record<NonNullable<StatMetric['tone']>, string> = {
  warn: 'var(--clay)',
  good: 'var(--green-ink)',
};

export function PropertyMetric({ metric }: PropertyMetricProps) {
  const valueStyle: CSSProperties = metric.tone
    ? { ...valueBase, color: toneColor[metric.tone] }
    : valueBase;

  return (
    <div style={cellStyle}>
      <div style={keyStyle}>{metric.label}</div>
      <div className="num" style={valueStyle}>
        {metric.value}
      </div>
    </div>
  );
}
