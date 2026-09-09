/**
 * FinancialReadout — renders the deterministic plain-English readout
 * lines produced by `buildFinancialReadout(summary)`.
 *
 * Server component. Echoes the warm "Odesa is reading the portfolio"
 * voice: a small mono eyebrow, then 3–5 quiet sentences. Never an LLM —
 * the lines are passed in already computed and identical input yields
 * identical output.
 */

import type { CSSProperties } from 'react';

export interface FinancialReadoutProps {
  lines: string[];
}

const panelStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const lineStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: '15px',
  lineHeight: 1.5,
  color: 'var(--ink)',
};

export function FinancialReadout({ lines }: FinancialReadoutProps) {
  return (
    <div style={panelStyle} data-testid="financial-readout">
      <span style={eyebrowStyle}>Odesa financial readout</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((line, idx) => (
          <p key={idx} style={lineStyle}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
