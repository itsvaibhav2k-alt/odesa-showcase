import type { CSSProperties } from 'react';
import type { PropertyIssue } from '@/lib/properties/mock-portfolio';

/**
 * Single issue/flag line inside a property card.
 *
 * Presentational only — mirrors the mockup `.prop-flag` (odesa-properties4.html
 * lines 1410-1441): an aria-hidden leading glyph + the issue text, with an
 * optional muted " · {meta}" tail (--ink-3). Glyph color tracks tone:
 * amber → --amber, clay → --clay, neutral → --ink-3.
 *
 * The `allclear` variant is a distinct mono green row (text --green-ink, glyph
 * --green) that reads the text only — no meta tail.
 */

export interface PropertyIssueRowProps {
  issue: PropertyIssue;
}

const glyphColor: Record<PropertyIssue['tone'], string> = {
  amber: 'var(--amber)',
  clay: 'var(--clay)',
  neutral: 'var(--ink-3)',
  allclear: 'var(--green)',
};

const rowBase: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: '12.5px',
  color: 'var(--ink)',
  lineHeight: 1.4,
  letterSpacing: '-0.003em',
};

const allClearRow: CSSProperties = {
  color: 'var(--green-ink)',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.06em',
};

const glyphBase: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  flexShrink: 0,
  paddingTop: 1,
};

const metaStyle: CSSProperties = {
  color: 'var(--ink-3)',
};

export function PropertyIssueRow({ issue }: PropertyIssueRowProps) {
  const glyphStyle: CSSProperties = { ...glyphBase, color: glyphColor[issue.tone] };

  if (issue.tone === 'allclear') {
    return (
      <div style={{ ...rowBase, ...allClearRow }}>
        <span aria-hidden="true" style={glyphStyle}>
          {issue.glyph}
        </span>
        {issue.text}
      </div>
    );
  }

  return (
    <div style={rowBase}>
      <span aria-hidden="true" style={glyphStyle}>
        {issue.glyph}
      </span>
      <div>
        {issue.text}
        {issue.meta ? <span style={metaStyle}> · {issue.meta}</span> : null}
      </div>
    </div>
  );
}
