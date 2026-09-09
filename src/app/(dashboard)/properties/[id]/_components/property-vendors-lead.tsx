/**
 * PropertyVendorsLead — the lead brief-row inside the property brief's
 * "Vendors · maintenance" panel.
 *
 * Reproduces the mockup's single in-panel `.brief-row` (dot + kind + detail,
 * no actions, no bottom border). Non-interactive text only; the tone dot is
 * aria-hidden, status meaning carried by the text. Server component.
 */

import type { CSSProperties } from 'react';
import type { Tone } from '@/lib/properties/mock-detail';

export interface PropertyVendorsLeadProps {
  dot: Tone;
  kind: string;
  detail: string;
}

const DOT_COLOR: Record<Tone, string> = {
  clay: 'var(--clay)',
  amber: 'var(--amber)',
  green: 'var(--green)',
  gold: 'var(--gold)',
  neutral: 'var(--gold)',
  ink: 'var(--ink)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  paddingTop: '4px',
  paddingBottom: '13px',
};

const dotStyle: CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  flexShrink: 0,
  marginTop: '6px',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const kindStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 500,
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
  marginBottom: '3px',
};

const detailStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  letterSpacing: '-0.003em',
};

export function PropertyVendorsLead({ dot, kind, detail }: PropertyVendorsLeadProps) {
  return (
    <div style={rowStyle}>
      <span aria-hidden="true" style={{ ...dotStyle, background: DOT_COLOR[dot] }} />
      <div style={bodyStyle}>
        <div style={kindStyle}>{kind}</div>
        <div style={detailStyle}>{detail}</div>
      </div>
    </div>
  );
}
