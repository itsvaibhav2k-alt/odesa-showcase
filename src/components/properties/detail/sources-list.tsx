/**
 * SourcesList — audit trail rows for detail pages.
 *
 * Mirrors the mockup's `.sources` / `.source-item` / `.sg` / `.sfresh` / `.sarrow` pattern.
 * Diamond glyph (&#9670;) is aria-hidden. Freshness stamp is mono micro text.
 *
 * A11y: rows without `href` render as plain text `<div>`. When `href` is
 * present the entire row is a single `<a>` — no nested interactive elements.
 */

import type { CSSProperties } from 'react';
import type { SourceItem } from '@/lib/properties/mock-detail';

export interface SourcesListProps {
  items: SourceItem[];
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const rowBaseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 0',
  borderBottom: '1px solid var(--hairline-faint)',
  fontSize: '12.5px',
  color: 'var(--ink)',
  textDecoration: 'none',
};

const glyphStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '11px',
  color: 'var(--terracotta)',
  width: '14px',
  flexShrink: 0,
};

const freshStyle: CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  color: 'var(--ink-4)',
  letterSpacing: '0.02em',
};

// Hoisted focus style for source link rows
const focusStyle = `
.sources-item-link:focus-visible {
  outline: 2px solid var(--terracotta);
  outline-offset: 2px;
  border-radius: 4px;
}
`;

export function SourcesList({ items }: SourcesListProps) {
  return (
    <>
      <style precedence="component">{focusStyle}</style>
      <div style={listStyle}>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          const style: CSSProperties = isLast
            ? { ...rowBaseStyle, borderBottom: 'none' }
            : rowBaseStyle;

          return (
            <div key={item.label} style={style}>
              <span style={glyphStyle} aria-hidden="true">&#9670;</span>
              {item.label}
              <span style={freshStyle}>{item.freshness}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
