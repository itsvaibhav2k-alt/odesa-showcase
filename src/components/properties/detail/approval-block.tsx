/**
 * ApprovalBlock — green-tinted owner-approval grid.
 *
 * Mirrors the mockup's `.approval` / `.ac` / `.ac.wide` / `.ak` / `.av` pattern:
 * 2-col grid with --green-border gap lines and --green-bg cell backgrounds.
 * Cells with `wide: true` span both columns (`.ac.wide` => grid-column: 1 / -1).
 * Mono values use --font-mono-operator at 12.5px.
 */

import type { CSSProperties } from 'react';
import type { ApprovalCell } from '@/lib/properties/mock-detail';

export interface ApprovalBlockProps {
  cells: ApprovalCell[];
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
  gap: '1px',
  background: 'var(--green-border)',
  border: '1px solid var(--green-border)',
  borderRadius: '10px',
  overflow: 'hidden',
};

const cellStyle: CSSProperties = {
  background: 'var(--green-bg)',
  padding: '11px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  minWidth: 0,
};

const wideCellStyle: CSSProperties = {
  ...cellStyle,
  gridColumn: '1 / -1',
};

const akStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--green-ink)',
  opacity: 0.75,
};

const avStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--green-ink)',
  overflowWrap: 'anywhere',
};

const avMonoStyle: CSSProperties = {
  ...avStyle,
  fontFamily: 'var(--font-mono-operator)',
};

export function ApprovalBlock({ cells }: ApprovalBlockProps) {
  return (
    <div style={gridStyle}>
      {cells.map((cell) => (
        <div
          key={cell.k}
          style={cell.wide ? wideCellStyle : cellStyle}
        >
          <span style={akStyle}>{cell.k}</span>
          <span style={cell.mono ? avMonoStyle : avStyle}>{cell.v}</span>
        </div>
      ))}
    </div>
  );
}
