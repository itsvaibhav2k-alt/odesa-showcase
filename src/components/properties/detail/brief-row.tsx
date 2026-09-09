/**
 * BriefRow — one operating-brief item row.
 *
 * Mirrors the mockup `.brief-row` / `.brief-head` structure. The row is an
 * <article> (never a button) carrying a descriptive aria-label. Rank and dot
 * are aria-hidden decorative. Actions are sibling DetailButton elements — no
 * nested interactive elements.
 *
 * Callers that supply action href props get <Link> anchors; non-href actions
 * need the consuming island to be 'use client' and wire onClick.
 */

import type { CSSProperties } from 'react';
import type { Tone, ActionLink } from '@/lib/properties/mock-detail';
import { DetailButton } from './detail-button';

export interface BriefRowProps {
  /** Optional ordinal, e.g. 1, 2, 3 — rendered aria-hidden. */
  rank?: number;
  /** Dot accent tone. */
  dot: Tone;
  /** Lead phrase, e.g. "Rent late". */
  kind: string;
  /** Optional location chip (mono uppercase). */
  loc?: string;
  /** Remainder of the line. */
  detail: string;
  /** Full accessible label for the article. */
  ariaLabel: string;
  actions: ActionLink[];
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
  gap: 12,
  padding: '13px 0',
  borderBottom: '1px solid var(--hairline-faint)',
};

const rankStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  width: 14,
  flexShrink: 0,
  paddingTop: 3,
};

const dotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
  marginTop: 5,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const line1Style: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  marginBottom: 3,
  flexWrap: 'wrap',
};

const kindStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 500,
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
};

const locStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const detailStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  letterSpacing: '-0.003em',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 7,
  flexShrink: 0,
  paddingTop: 1,
};

export function BriefRow({ rank, dot, kind, loc, detail, ariaLabel, actions }: BriefRowProps) {
  return (
    <article aria-label={ariaLabel} style={rowStyle} data-brief-row>
      {rank !== undefined && (
        <span aria-hidden="true" style={rankStyle}>
          {rank}
        </span>
      )}
      <span aria-hidden="true" style={{ ...dotStyle, background: DOT_COLOR[dot] }} />

      <div style={bodyStyle}>
        <div style={line1Style}>
          <span style={kindStyle}>{kind}</span>
          {loc && <span style={locStyle}>{loc}</span>}
        </div>
        <div style={detailStyle}>{detail}</div>
      </div>

      {actions.length > 0 && (
        <span style={actionsStyle}>
          {actions.map((action) => (
            <DetailButton
              key={action.label}
              variant={action.variant}
              size="sm"
              href={action.href}
              aria-label={`${action.label} — ${kind}`}
            >
              {action.label}
            </DetailButton>
          ))}
        </span>
      )}
    </article>
  );
}
