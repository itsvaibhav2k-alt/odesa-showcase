/**
 * NextActionCallout — left-border terracotta callout panel.
 *
 * Mirrors the mockup's `.next-action` / `.na-k` / `.na-b` pattern:
 * 3px left border in --terracotta, mono "Next action" key, body text
 * supporting bold segments via <b> tags in the source data.
 *
 * `body` is rendered as plain text with no inner HTML — bold patterns in
 * the mock data use ** markdown syntax. This component parses **…** segments
 * into <b> spans while keeping the rest as plain text nodes.
 */

import type { CSSProperties } from 'react';
import type { NextAction } from '@/lib/properties/mock-detail';

export type NextActionCalloutProps = NextAction;

const wrapStyle: CSSProperties = {
  display: 'flex',
  gap: '13px',
  alignItems: 'flex-start',
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderLeft: '3px solid var(--terracotta)',
  borderRadius: '9px',
  padding: '13px 16px',
  marginBottom: '24px',
};

const keyStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--terracotta)',
  paddingTop: '2px',
  flexShrink: 0,
};

const bodyStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink)',
  lineHeight: 1.5,
  letterSpacing: '-0.003em',
};

const boldStyle: CSSProperties = {
  fontWeight: 600,
};

/** Parse **bold** markdown segments into React nodes. */
function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} style={boldStyle}>
        {part}
      </b>
    ) : (
      part
    ),
  );
}

export function NextActionCallout({ body }: NextActionCalloutProps) {
  return (
    <div style={wrapStyle}>
      <span style={keyStyle}>Next action</span>
      <div style={bodyStyle}>{parseBold(body)}</div>
    </div>
  );
}
