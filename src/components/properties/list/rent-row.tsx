/**
 * RentRow — a single account line in the Collection Ledger (`/rent`).
 *
 * Art direction: a historic double-entry ledger / registrar's ruled account
 * book. Amount columns align (tabular mono, right-set), exception rows carry a
 * left accent rule so they lead the hierarchy, and the whole row reads as an
 * audited entry rather than a card. Consumed only by `/rent`, so this styling
 * is route-scoped.
 *
 * Grid columns: 1.7fr 118px 132px 126px 92px 16px
 *   [stamp+name+unit] [amount] [due] [status] [edit terms] [arrow]
 *
 * The "Edit terms" affordance lives in its own real grid cell (between the
 * status pill and the arrow) rather than floating as an absolute overlay, so it
 * can never overlap the status pill at any width. It is rendered via the
 * `editTerms` slot (the toggle is owned by the parent island, which holds the
 * expand/collapse state). The cell sits above the overlay link (zIndex 2 > 1)
 * so the button stays clickable; the column is always present to keep alignment.
 *
 * The "Due" column is honest: it shows the cycle's DUE date (never a fabricated
 * payment timestamp). Single overlay <a> (zIndex 1); no nested interactive
 * elements. Status never color-only (StatusChip: dot + label).
 *
 * @param row - RentLedgerRow from mock-portfolio-views
 * @param editTerms - optional "Edit terms" toggle rendered in its own cell
 */

import type { CSSProperties, ReactNode } from 'react';
import { StatusChip, type StatusChipTone } from '@/components/shared/status-chip';
import { IdentityMark } from '@/components/properties/list/office-primitives';
import type { RentLedgerRow, RentStatus } from '@/lib/properties/mock-portfolio-views';

export interface RentRowProps {
  row: RentLedgerRow;
  editTerms?: ReactNode;
}

/* ------------------------------------------------------------------ */
/* Pill tone + exception accent by rent status                         */
/* ------------------------------------------------------------------ */

const RENT_PILL_TONE: Record<RentStatus, StatusChipTone> = {
  paid: 'green',
  outstanding: 'clay',
  'on-plan': 'amber',
};

/** Left accent rule — exceptions lead the ledger's visual hierarchy. */
const RENT_ACCENT: Record<RentStatus, string | null> = {
  paid: null,
  outstanding: 'var(--clay)',
  'on-plan': 'var(--amber)',
};

/**
 * Plain-English explanation surfaced via the pill cell's `title` (hover + AT)
 * without changing the visible pill text. The `on-plan` label reads "On plan",
 * which alone doesn't make clear that rent is still owed — this spells it out.
 */
const RENT_PILL_TITLE: Partial<Record<RentStatus, string>> = {
  'on-plan': 'On a payment plan — rent still owed',
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const GRID = '1.6fr 108px 150px 122px 84px 16px';

const baseRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: GRID,
  alignItems: 'center',
  gap: 16,
  padding: '12px 16px 12px 15px',
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

// display/justify live in the stylesheet (see RentRowStyles) so the mobile
// media query can hide this cell — an inline `display` would out-specify it.
const editCellStyle: CSSProperties = {
  position: 'relative',
  zIndex: 2,
  minWidth: 0,
};

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

const amountStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '13px',
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  letterSpacing: '-0.01em',
};

const whenStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  lineHeight: 1.3,
  color: 'var(--ink-3)',
};

const arrowStyle: CSSProperties = {
  color: 'var(--ink-4)',
  fontSize: 13,
  textAlign: 'right',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function RentRow({ row, editTerms }: RentRowProps) {
  const ariaLabel = `View ${row.tenantName} rent at ${row.property} · ${row.unit}, ${row.statusPill.label}`;
  const accent = RENT_ACCENT[row.statusPill.status];
  const rowStyle: CSSProperties = accent
    ? { ...baseRowStyle, boxShadow: `inset 3px 0 0 ${accent}` }
    : baseRowStyle;

  return (
    <>
      <div style={rowStyle} className="rent-row">
        {/* Overlay link — single interactive element */}
        <a href={row.href} aria-label={ariaLabel} style={overlayLinkStyle} className="rent-row-link" />

        {/* Stamp + name + unit */}
        <div style={{ ...cellRelStyle, ...dnameStyle }}>
          <IdentityMark label={row.initial} />
          <div style={{ minWidth: 0 }}>
            <div style={nameStyle}>{row.tenantName}</div>
            <div style={subStyle}>
              {row.property} · {row.unit}
            </div>
          </div>
        </div>

        {/* Amount */}
        <div style={{ ...cellRelStyle, ...amountStyle }} className="num" data-rent-col="amount">
          {row.amount}
        </div>

        {/* Due (cycle due date — never a payment timestamp) */}
        <div style={{ ...cellRelStyle, ...whenStyle }} data-rent-col="when">
          {row.when}
        </div>

        {/* Status pill — text + dot, never color-only */}
        <div style={cellRelStyle} title={RENT_PILL_TITLE[row.statusPill.status]}>
          <StatusChip tone={RENT_PILL_TONE[row.statusPill.status]} label={row.statusPill.label} />
        </div>

        {/* Edit terms — own grid cell, never overlaps the status pill */}
        <div style={editCellStyle} data-rent-col="edit">
          {editTerms}
        </div>

        {/* Arrow — decorative */}
        <div aria-hidden="true" style={{ ...cellRelStyle, ...arrowStyle }}>
          →
        </div>
      </div>
      <RentRowStyles />
    </>
  );
}

function RentRowStyles() {
  return (
    <style precedence="rent-row">{`
      .rent-row:last-child { border-bottom: none; }
      .rent-row:hover { background: var(--panel-lift); }
      .rent-row:focus-within { background: var(--panel-lift); }
      .rent-row [data-rent-col="edit"] { display: flex; justify-content: flex-end; }
      .rent-row-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: -2px;
        border-radius: 6px;
      }
      @media (max-width: 680px) {
        .rent-row {
          grid-template-columns: minmax(0, 1fr) auto auto 16px !important;
          gap: 10px !important;
        }
        .rent-row [data-rent-col="when"],
        .rent-row [data-rent-col="edit"] {
          display: none !important;
        }
      }
    `}</style>
  );
}
