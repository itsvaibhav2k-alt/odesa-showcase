/**
 * DocumentRow — a single accession entry in the Property Archive (`/documents`).
 *
 * Art direction: a museum archive finding aid / library accession register.
 * Each row is a retrievable archive entry: a mono type code (the "accession
 * stamp"), the document title, its provenance (property / party), the dates
 * known, and an honest status badge. Consumed only by `/documents`, so this
 * styling is route-scoped.
 *
 * Grid columns (mirror the archive index): minmax(0,1fr) 150px 132px 16px
 *   [code + title + provenance] [dates] [status] [arrow]
 *
 * Single overlay <a> (zIndex 1) over position:relative content. No nested
 * interactive elements. Status never color-only (dot + label). Type stamp
 * aria-hidden. Terracotta focus ring. The `.document-row` / `.document-row-link`
 * class contract is preserved for the E2E suite.
 *
 * Provenance and dates are shown only from real fields — the archive never
 * implies OCR, expiry extraction, insurance coverage, or citation readiness.
 *
 * @param row - DocumentRow from mock-portfolio-views
 */

import type { CSSProperties } from 'react';
import { IdentityMark } from '@/components/properties/list/office-primitives';
import type { DocumentRow, DocumentType } from '@/lib/properties/mock-portfolio-views';

export interface DocumentRowProps {
  row: DocumentRow;
}

/* ------------------------------------------------------------------ */
/* Accession code by document type (the archive "reference stamp")     */
/* ------------------------------------------------------------------ */

const TYPE_CODE: Record<DocumentType, string> = {
  lease: 'LSE',
  insurance: 'INS',
  inspection: 'ISP',
  notice: 'NOT',
  tax: 'TAX',
  hoa: 'HOA',
};

/* ------------------------------------------------------------------ */
/* Status badge theme (text + dot, never color-only)                   */
/* ------------------------------------------------------------------ */

interface PillTheme {
  color: string;
  background: string;
  borderColor: string;
  dot: string;
}

/** Map badge label → pill theme (overrides type-based default). */
const BADGE_PILL_THEME: Record<string, PillTheme> = {
  Active: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
  Renewal: {
    color: 'var(--neutral-ink)',
    background: 'var(--neutral-bg)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--gold)',
  },
  Expiring: {
    color: 'var(--clay-ink)',
    background: 'var(--amber-bg-soft)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  Pending: {
    color: 'var(--neutral-ink)',
    background: 'var(--neutral-bg)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--gold)',
  },
  Missing: {
    color: 'var(--clay-ink)',
    background: 'var(--amber-bg-soft)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--clay)',
  },
  Expired: {
    color: 'var(--clay-ink)',
    background: 'var(--clay-bg)',
    borderColor: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
  'Needs review': {
    color: 'var(--clay-ink)',
    background: 'var(--amber-bg-soft)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--clay)',
  },
  Superseded: {
    color: 'var(--neutral-ink)',
    background: 'var(--neutral-bg)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--ink-4)',
  },
};

const DOC_PILL_THEME: PillTheme = {
  color: 'var(--neutral-ink)',
  background: 'var(--neutral-bg)',
  borderColor: 'var(--neutral-border)',
  dot: 'var(--gold)',
};

function pillThemeFor(_type: DocumentType, badge: string): PillTheme {
  return BADGE_PILL_THEME[badge] ?? DOC_PILL_THEME;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const GRID = 'minmax(0, 1fr) 150px 132px 16px';

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: GRID,
  alignItems: 'center',
  gap: 16,
  padding: '12px 16px',
  borderBottom: '1px solid var(--hairline-faint)',
  position: 'relative',
};

const overlayLinkStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  textDecoration: 'none',
};

const cellRelStyle: CSSProperties = { position: 'relative', minWidth: 0 };

const dnameStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const nameStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink)',
  fontWeight: 450,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const subStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  marginTop: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const spanStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const pillWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '3px 8px 3px 7px',
  borderRadius: 3,
  border: '1px solid',
  whiteSpace: 'nowrap',
};

const pillDotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
};

const arrowStyle: CSSProperties = {
  color: 'var(--ink-4)',
  fontSize: 13,
  textAlign: 'right',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function DocumentRow({ row }: DocumentRowProps) {
  const theme = pillThemeFor(row.type, row.badge);
  const ariaLabel = `Open ${row.title}, ${row.related}`;

  return (
    <>
      <div style={rowStyle} className="document-row">
        {/* Overlay link — single interactive element */}
        <a href={row.href} aria-label={ariaLabel} style={overlayLinkStyle} className="document-row-link" />

        {/* Accession stamp + title + provenance */}
        <div style={{ ...cellRelStyle, ...dnameStyle }}>
          <IdentityMark label={TYPE_CODE[row.type]} variant="code" />
          <div style={{ minWidth: 0 }}>
            <div style={nameStyle}>{row.title}</div>
            <div style={subStyle}>{row.related}</div>
          </div>
        </div>

        {/* Dates span */}
        <div style={{ ...cellRelStyle, ...spanStyle }} data-doc-col="span">
          {row.span}
        </div>

        {/* Status badge — text + dot, never color-only */}
        <div style={cellRelStyle}>
          <span
            style={{
              ...pillWrapStyle,
              color: theme.color,
              background: theme.background,
              borderColor: theme.borderColor,
            }}
          >
            <span aria-hidden="true" style={{ ...pillDotStyle, background: theme.dot }} />
            {row.badge}
          </span>
        </div>

        {/* Arrow — decorative */}
        <div aria-hidden="true" style={{ ...cellRelStyle, ...arrowStyle }}>
          →
        </div>
      </div>
      <DocumentRowStyles />
    </>
  );
}

function DocumentRowStyles() {
  return (
    <style precedence="document-row">{`
      .document-row:last-child { border-bottom: none; }
      .document-row:hover { background: var(--panel-lift); }
      .document-row:focus-within { background: var(--panel-lift); }
      .document-row-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: -2px;
        border-radius: 6px;
      }
      @media (max-width: 680px) {
        .document-row {
          grid-template-columns: minmax(0, 1fr) auto 16px !important;
        }
        .document-row [data-doc-col="span"] {
          display: none;
        }
      }
    `}</style>
  );
}
