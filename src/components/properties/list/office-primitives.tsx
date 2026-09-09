/**
 * office-primitives — the shared vocabulary for the "Property Office Collection".
 *
 * Four portfolio list pages (Tenants, Vendors, Rent, Documents) are art-directed
 * as four working instruments from one well-run property office: a resident
 * register, a trades index, a collection ledger, and a property archive. They
 * must read as recognizably different structures while still feeling like one
 * cohesive system. These primitives carry that cohesion — the same square
 * identity marks, ruled column heads, summary margins, and workspace grid — so
 * each page composes its own instrument without four disconnected themes.
 *
 * All are pure render (no hooks, no server-only APIs) so they are safe to render
 * inside both server pages and client islands. Styling follows the house idiom:
 * inline CSSProperties objects plus a `<style precedence>` block for the handful
 * of pseudo/responsive rules React inline styles can't express.
 *
 * Not exported anywhere else — scoped to the four list routes on purpose.
 */

import type { CSSProperties, ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/* Workspace grid — dominant surface + summary margin                  */
/* ------------------------------------------------------------------ */

export interface WorkspaceGridProps {
  /** Dominant working surface (register / index / archive). */
  main: ReactNode;
  /** Summary margin explaining the current population / coverage / scope. */
  rail: ReactNode;
}

const workspaceStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 250px',
  gap: 30,
  alignItems: 'start',
};

/**
 * Two-column reading surface: the instrument on the left, a quiet summary
 * margin on the right that sticks while the operator scans. Collapses to a
 * single column below 900px with the dominant surface first, so the margin
 * never pushes the working list below the fold on mobile.
 */
export function WorkspaceGrid({ main, rail }: WorkspaceGridProps) {
  return (
    <>
      <div className="office-workspace" style={workspaceStyle}>
        <div className="office-main-slot" style={{ minWidth: 0 }}>
          {main}
        </div>
        <aside className="office-rail-slot">{rail}</aside>
      </div>
      <WorkspaceGridStyles />
    </>
  );
}

function WorkspaceGridStyles() {
  return (
    <style precedence="office-workspace">{`
      .office-rail-slot > * { position: sticky; top: 16px; }
      @media (max-width: 900px) {
        .office-workspace { grid-template-columns: 1fr !important; gap: 20px !important; }
        .office-rail-slot { order: 2; }
        .office-rail-slot > * { position: static; }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Summary margin — the office "margin note"                           */
/* ------------------------------------------------------------------ */

export interface OfficeRailProps {
  /** Mono eyebrow, e.g. "The register" / "Coverage" / "Archive scope". */
  title: string;
  /** Optional one-line narrative under the title (serif, kept short). */
  note?: string;
  children: ReactNode;
}

const railFrameStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '15px 16px 16px',
};

const railTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  paddingBottom: 11,
  borderBottom: '1px solid var(--hairline-faint)',
};

// Subordinate operator caption — deliberately NOT serif-italic. A live-reference
// review (Disegno / Apartamento) flagged the rail narrative as the most editorial
// element on each page; it stays a quiet muted one-liner under the mono title so
// the figures, not the prose, lead the margin.
const railNoteStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '11.5px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
  margin: '10px 0 2px',
};

export function OfficeRail({ title, note, children }: OfficeRailProps) {
  return (
    <div style={railFrameStyle}>
      <div style={railTitleStyle}>{title}</div>
      {note ? <p style={railNoteStyle}>{note}</p> : null}
      <div style={{ marginTop: note ? 8 : 13, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rail figure — one label / value line, optionally status-dotted      */
/* ------------------------------------------------------------------ */

export type RailTone = 'ink' | 'green' | 'clay' | 'amber' | 'gold';

const RAIL_DOT_COLOR: Record<RailTone, string> = {
  ink: 'var(--ink-4)',
  green: 'var(--green)',
  clay: 'var(--clay)',
  amber: 'var(--amber)',
  gold: 'var(--gold)',
};

export interface RailFigureProps {
  label: string;
  value: string;
  /** Status dot before the label (also tints the value for exceptions). */
  tone?: RailTone;
  /** Emphasize as a headline figure (larger mono value). */
  headline?: boolean;
}

const figureRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  padding: '6px 0',
  borderBottom: '1px solid var(--hairline-faint)',
};

const figureLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  minWidth: 0,
};

const figureDotStyle: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
};

export function RailFigure({ label, value, tone, headline }: RailFigureProps) {
  const isException = tone === 'clay' || tone === 'amber';
  const valueStyle: CSSProperties = {
    fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
    fontSize: headline ? '20px' : '12.5px',
    fontWeight: headline ? 450 : 500,
    letterSpacing: headline ? '-0.01em' : '0',
    color: isException ? 'var(--clay)' : 'var(--ink)',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  };
  return (
    <div style={{ ...figureRowStyle, ...(headline ? { padding: '4px 0 9px' } : {}) }}>
      <span style={figureLabelStyle}>
        {tone ? (
          <span aria-hidden="true" style={{ ...figureDotStyle, background: RAIL_DOT_COLOR[tone] }} />
        ) : null}
        {label}
      </span>
      <span className="num" style={valueStyle}>
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Identity mark — the restrained square "office stamp"                */
/* ------------------------------------------------------------------ */

export interface IdentityMarkProps {
  /** Initials (residents / vendors) or a short type code (documents). */
  label: string;
  /** `portrait` = initials; `code` = mono reference stamp. */
  variant?: 'portrait' | 'code';
}

/**
 * A small squared identity stamp — the register/archive counterpart to a CRM
 * avatar circle. `portrait` renders initials; `code` renders a mono reference
 * (e.g. an accession code). Decorative — the row text and overlay aria-label
 * carry the meaning, so it is aria-hidden.
 */
export function IdentityMark({ label, variant = 'portrait' }: IdentityMarkProps) {
  const isCode = variant === 'code';
  const style: CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 5,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--canvas-deep)',
    border: '1px solid var(--hairline)',
    color: 'var(--ink-2)',
    fontFamily: isCode
      ? 'var(--font-mono-operator), ui-monospace, monospace'
      : 'var(--font-sans-operator), system-ui, sans-serif',
    fontSize: isCode ? '9px' : '12px',
    fontWeight: isCode ? 500 : 500,
    letterSpacing: isCode ? '0.02em' : '0',
  };
  return (
    <span aria-hidden="true" style={style}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Column head — the ruled ledger/register column-label row            */
/* ------------------------------------------------------------------ */

export interface ColumnHeadCell {
  label: string;
  align?: 'left' | 'right' | 'center';
}

export interface ColumnHeadProps {
  /** Grid template matching the instrument's row grid. */
  template: string;
  cells: ColumnHeadCell[];
  /** Optional test id. */
  testId?: string;
}

const columnHeadStyle = (template: string): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: template,
  alignItems: 'center',
  gap: 16,
  padding: '9px 16px',
  background: 'var(--panel)',
  borderBottom: '1px solid var(--hairline)',
});

const columnHeadCellStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9px',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  minWidth: 0,
};

/**
 * The ruled column-label band that turns a plain list into a ledger/register
 * sheet. The header sits inside the instrument frame, above the rows, and
 * mirrors the row grid so labels align to their columns.
 */
export function ColumnHead({ template, cells, testId }: ColumnHeadProps) {
  return (
    <>
      <div
        className="office-columnhead"
        style={columnHeadStyle(template)}
        data-testid={testId}
        aria-hidden="true"
      >
        {cells.map((cell, i) => (
          <span key={i} style={{ ...columnHeadCellStyle, textAlign: cell.align ?? 'left' }}>
            {cell.label}
          </span>
        ))}
      </div>
      <ColumnHeadStyles />
    </>
  );
}

function ColumnHeadStyles() {
  // The fixed multi-column template can't fit a 390px viewport, so the ruled
  // column labels drop on mobile — rows there collapse to name + status and
  // read fine without a header.
  return (
    <style precedence="office-columnhead">{`
      @media (max-width: 680px) {
        .office-columnhead { display: none !important; }
      }
    `}</style>
  );
}

/* ------------------------------------------------------------------ */
/* Section band — group divider inside an instrument (property/trade)  */
/* ------------------------------------------------------------------ */

export interface SectionBandProps {
  /** Group name, e.g. a property or a trade. */
  title: string;
  /** Mono count / coverage note aligned right. */
  note?: string;
  /** Optional leading accent color (a trade/exception cue). */
  accent?: string;
}

const sectionBandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '11px 16px 9px',
  background: 'var(--panel)',
  borderBottom: '1px solid var(--hairline-faint)',
  borderTop: '1px solid var(--hairline-faint)',
};

const sectionTitleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  fontSize: '12px',
  fontWeight: 550,
  letterSpacing: '0.01em',
  color: 'var(--ink)',
};

const sectionNoteStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

/**
 * A quiet in-sheet divider that opens a group (a property in the register, a
 * trade in the index). Reads as an archive section rule, not a card header.
 */
export function SectionBand({ title, note, accent }: SectionBandProps) {
  return (
    <div style={sectionBandStyle} role="presentation">
      <span style={sectionTitleStyle}>
        {accent ? (
          <span
            aria-hidden="true"
            style={{ width: 3, height: 12, borderRadius: 1, background: accent }}
          />
        ) : null}
        {title}
      </span>
      {note ? <span style={sectionNoteStyle}>{note}</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Instrument frame — the ruled sheet each list lives in               */
/* ------------------------------------------------------------------ */

/** The square-ish ruled sheet surface shared by all four instruments. */
export const instrumentSheetStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'var(--panel-clean)',
};
