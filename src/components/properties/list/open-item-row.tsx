/**
 * OpenItemRow — a single open-item row for /open-items.
 *
 * The mockup's open-items page uses the `.brief-row` pattern (rank dot + kind +
 * loc + detail + action buttons), not the `.dir-row` grid. Each row is an
 * <article> with a descriptive aria-label. The primary action is rendered as a
 * plain <a> link (not a button) so it is reachable via keyboard; the whole-row
 * overlay link pattern is NOT used here because the row contains a live action
 * link per the mockup's `.bactions` slot.
 *
 * Dot tones:
 *   maintenance (clay)  — urgent / active issues
 *   rent        (amber) — payment issues
 *   owner       (neutral/gold) — owner decisions
 *   leasing     (neutral/gold) — vacancy / leasing
 *
 * @param row - OpenItemRow from mock-portfolio-views
 */

import type { CSSProperties } from 'react';
import type { OpenItemRow, OpenItemKind } from '@/lib/properties/mock-portfolio-views';

export interface OpenItemRowProps {
  row: OpenItemRow;
  /** Whether to show a bottom border (false for the last row). */
  hasBorder?: boolean;
}

/* ------------------------------------------------------------------ */
/* Tone map                                                            */
/* ------------------------------------------------------------------ */

const DOT_COLOR: Record<OpenItemKind, string> = {
  maintenance: 'var(--clay)',
  rent: 'var(--amber)',
  owner: 'var(--gold)',
  leasing: 'var(--gold)',
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '13px 0',
};

const rankStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
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
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const detailStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 7,
  flexShrink: 0,
  paddingTop: 1,
};

/** Primary action button — styled as .btn.sm.primary from the mockup. */
const actionLinkStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '11px',
  fontWeight: 450,
  padding: '5px 10px',
  borderRadius: 5,
  border: '1px solid var(--ink)',
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  letterSpacing: '-0.003em',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function OpenItemRow({ row, hasBorder = true }: OpenItemRowProps) {
  const dotColor = DOT_COLOR[row.kind];
  const ariaLabel =
    `Open item ${row.index}: ${row.title} — ${row.loc}. ${row.detail}`;

  return (
    <>
      <article
        aria-label={ariaLabel}
        style={{
          ...rowStyle,
          borderBottom: hasBorder ? '1px solid var(--hairline-faint)' : 'none',
        }}
      >
        {/* Rank — decorative ordinal */}
        <span aria-hidden="true" style={rankStyle}>
          {row.index}
        </span>

        {/* Dot — decorative tone indicator (color-only, so meaning is in aria-label) */}
        <span aria-hidden="true" style={{ ...dotStyle, background: dotColor }} />

        {/* Body — kind + loc + detail */}
        <div style={bodyStyle}>
          <div style={line1Style}>
            <span style={kindStyle}>{row.title}</span>
            <span style={locStyle}>{row.loc}</span>
          </div>
          <div style={detailStyle}>{row.detail}</div>
        </div>

        {/* Action link — navigates to the relevant detail page */}
        <div style={actionsStyle}>
          <a
            href={row.href}
            style={actionLinkStyle}
            className="open-item-action"
          >
            {row.action}
          </a>
        </div>
      </article>
      <OpenItemRowStyles />
    </>
  );
}

function OpenItemRowStyles() {
  return (
    <style precedence="open-item-row">{`
      .open-item-action:hover {
        background: #000;
        border-color: #000;
      }
      .open-item-action:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
        border-radius: 5px;
      }
    `}</style>
  );
}
