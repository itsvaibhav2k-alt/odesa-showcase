/**
 * KvGrid — 2-column key/value grid.
 *
 * Mirrors the mockup's `.kv` / `.cell` / `.k` / `.v` pattern.
 * Gap-1px grid lines via background on the wrapper; each cell has a
 * --panel-lift background. Mono label on top, value below.
 * Pass `columns` to override the default 2-col layout (e.g. 1 for mobile).
 */

import type { CSSProperties } from 'react';
import type { KvCell } from '@/lib/properties/mock-detail';

export interface KvGridProps {
  cells: KvCell[];
  /** Number of columns. Defaults to 2. */
  columns?: 1 | 2;
}

const kStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const vStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
  overflowWrap: 'anywhere',
};

const vMonoStyle: CSSProperties = {
  ...vStyle,
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '13px',
};

const cellInnerStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  padding: '12px 15px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  minWidth: 0,
};

export function KvGrid({ cells, columns = 2 }: KvGridProps) {
  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: '1px',
    background: 'var(--hairline-faint)',
    border: '1px solid var(--hairline-faint)',
    borderRadius: '10px',
    overflow: 'hidden',
  };

  return (
    <div style={gridStyle}>
      {cells.map((cell) => (
        <div key={cell.k} style={cellInnerStyle}>
          <span style={kStyle}>{cell.k}</span>
          <span style={cell.mono ? vMonoStyle : vStyle}>{cell.v}</span>
        </div>
      ))}
    </div>
  );
}
