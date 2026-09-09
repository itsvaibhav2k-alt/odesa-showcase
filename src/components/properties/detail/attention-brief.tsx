/**
 * AttentionBrief — operating brief panel for detail pages.
 *
 * Mirrors the mockup `.brief` container: serif-italic heading + mono count in
 * `.brief-head`, a list of BriefRow items, and an OdesaNote footer. Matches
 * the property-detail, unit-detail, tenant-detail, and maintenance-ticket
 * brief patterns verbatim.
 */

import type { CSSProperties } from 'react';
import type { AttentionItem, OdesaNote as OdesaNoteData } from '@/lib/properties/mock-detail';
import { BriefRow } from './brief-row';
import { OdesaNote } from './odesa-note';

export interface AttentionBriefProps {
  /** Section heading label, e.g. "What needs attention" or "What matters with Maya". */
  heading: string;
  /** Optional count sub-label, e.g. "2 active · 1 risk". */
  count?: string;
  rows: AttentionItem[];
  odesaNote: OdesaNoteData;
}

const briefStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '4px 20px 8px',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 11,
  padding: '14px 0 11px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const headingStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: '20px',
  color: 'var(--ink)',
  letterSpacing: '-0.01em',
  fontWeight: 400,
};

const countStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  color: 'var(--ink-3)',
};

export function AttentionBrief({ heading, count, rows, odesaNote }: AttentionBriefProps) {
  return (
    <div style={briefStyle} data-attention-brief>
      <div style={headStyle}>
        <span style={headingStyle}>{heading}</span>
        {count && <span style={countStyle}>{count}</span>}
      </div>

      <div>
        {rows.map((row, idx) => (
          <BriefRow
            key={`${row.kind}-${idx}`}
            rank={idx + 1}
            dot={row.dot}
            kind={row.kind}
            loc={row.loc}
            detail={row.detail}
            ariaLabel={row.ariaLabel}
            actions={row.actions}
          />
        ))}
      </div>

      <OdesaNote body={odesaNote.body} basedOn={odesaNote.basedOn} />

      <AttentionBriefStyles />
    </div>
  );
}

function AttentionBriefStyles() {
  return (
    <style precedence="attention-brief">{`
      [data-attention-brief] [data-brief-row]:last-of-type {
        border-bottom: none;
      }
      [data-attention-brief] [data-brief-row]:hover {
        background: var(--panel-clean);
        margin: 0 -20px;
        padding-left: 20px;
        padding-right: 20px;
      }
      [data-attention-brief] .detail-btn:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      @media (max-width: 680px) {
        [data-attention-brief] [data-brief-row] { flex-wrap: wrap; }
      }
    `}</style>
  );
}
