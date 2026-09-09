/**
 * OperatorSummary — the three-part decision card on `/financials`.
 *
 * Server component, warm palette. Renders the deterministic operator
 * briefing from `buildOperatorSummary` (What changed / Why it matters /
 * Recommended move) — one sentence per block, no prose soup. All values
 * arrive pre-computed in the sentences; this component adds no math.
 */

import type { CSSProperties, ReactElement } from 'react';

import { buildOperatorSummary } from '@/lib/financials/readout';
import type { AgingBucket, PeriodTotals } from '@/lib/financials/trend';
import type { PortfolioFinancialSummary } from '@/lib/financials/types';

export interface OperatorSummaryProps {
  summary: PortfolioFinancialSummary;
  totals: PeriodTotals;
  aging: AgingBucket[];
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'var(--panel-lift)',
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const blockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const sentenceStyle: CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
  margin: 0,
};

const moveStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: '15.5px',
  lineHeight: 1.45,
  color: 'var(--ink)',
  margin: 0,
};

export function OperatorSummary({ summary, totals, aging }: OperatorSummaryProps): ReactElement {
  const briefing = buildOperatorSummary(summary, totals, aging);

  return (
    <div style={panelStyle} data-testid="operator-summary">
      <div style={blockStyle}>
        <span style={eyebrowStyle}>What changed</span>
        <p style={sentenceStyle}>{briefing.whatChanged}</p>
      </div>
      <div style={blockStyle}>
        <span style={eyebrowStyle}>Why it matters</span>
        <p style={sentenceStyle}>{briefing.whyItMatters}</p>
      </div>
      <div style={blockStyle}>
        <span style={eyebrowStyle}>Recommended move</span>
        <p style={moveStyle}>{briefing.recommendedMove}</p>
      </div>
    </div>
  );
}
