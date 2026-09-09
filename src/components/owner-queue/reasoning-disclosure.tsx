import type { CSSProperties } from 'react';
import type { Consideration } from '@/lib/owner-queue/mock-decisions';

/**
 * Expandable "Odesa's reasoning" panel inside a decision card
 * (mockup `.dcard-why` + `.consideration`, lines 882-908 and 1274-1298).
 *
 * Presentational only — no `'use client'`. The parent owns the open/closed
 * state and passes it via `isOpen`; this component renders the region and
 * toggles the native `hidden` attribute so collapsed content stays out of the
 * accessibility tree. Each consideration is a 2-col grid row (mono label |
 * detail), with the detail rendered via `dangerouslySetInnerHTML` because the
 * mock copy carries trusted inline <b> tags.
 */

export interface ReasoningDisclosureProps {
  /** Decision id; drives the panel id/testid so the toggle can `aria-controls` it. */
  id: string;
  considerations: Consideration[];
  isOpen: boolean;
}

const panelStyle: CSSProperties = {
  marginTop: 16,
  padding: '15px 16px 6px',
  background: 'var(--canvas)',
  border: '1px solid var(--hairline-faint)',
  borderRadius: 8,
};

const headStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 11,
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '124px 1fr',
  gap: 16,
  padding: '8px 0',
  borderBottom: '1px solid var(--hairline-faint)',
};

const lastRowStyle: CSSProperties = {
  ...rowStyle,
  borderBottom: 'none',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
  paddingTop: 1,
};

const detailStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ink)',
  lineHeight: 1.5,
  letterSpacing: '-0.003em',
};

export function ReasoningDisclosure({ id, considerations, isOpen }: ReasoningDisclosureProps) {
  return (
    <div
      id={`reasoning-${id}`}
      data-testid={`reasoning-${id}`}
      role="region"
      aria-label="Odesa's reasoning"
      hidden={!isOpen}
      style={panelStyle}
    >
      <div style={headStyle}>Odesa&apos;s reasoning</div>
      {considerations.map((consideration, idx) => (
        <div
          key={consideration.label}
          style={idx === considerations.length - 1 ? lastRowStyle : rowStyle}
        >
          <div style={labelStyle}>{consideration.label}</div>
          {/* sanitize before real data — consideration.detail is trusted mock copy with inline <b>. */}
          <div
            style={detailStyle}
            dangerouslySetInnerHTML={{ __html: consideration.detail }}
          />
        </div>
      ))}
    </div>
  );
}
