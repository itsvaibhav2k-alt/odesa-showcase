/**
 * VendorRow — a single entry in the Trades Index (`/vendors`).
 *
 * Art direction: an atelier supplier book / material sample index. Each entry
 * is a compact roster line — squared identity stamp, name, its trade, a
 * data-backed rating, open-work state, and an honest readiness pill — grouped
 * under trade sections by the page. Never a CRM tile.
 *
 * Grid columns (mirror the trades-index row): 1fr 74px 96px 132px 16px
 *   [stamp+name+trade] [rating] [open] [pill] [arrow]
 *
 * Single overlay <a> (zIndex 1) over position:relative content. No nested
 * interactive elements. Status never color-only (StatusChip: dot + label).
 * Rating stars are aria-hidden glyphs; the rating value is woven into the
 * overlay link's accessible label. Terracotta focus ring.
 *
 * Consumed only by `/vendors` (the property-detail vendors room has its own
 * row type), so this styling is route-scoped and safe to restyle here.
 *
 * @param row - VendorDirectoryRow from mock-portfolio-views
 */

import type { CSSProperties } from 'react';
import { StatusChip, type StatusChipTone } from '@/components/shared/status-chip';
import { IdentityMark } from '@/components/properties/list/office-primitives';
import type { VendorDirectoryRow, VendorStatusVariant } from '@/lib/properties/mock-portfolio-views';

export interface VendorRowProps {
  row: VendorDirectoryRow;
  /** Optional test id applied to the row container. */
  testId?: string;
  /** Optional factual replacement for the legacy rating presentation. */
  metric?: { text: string; ariaLabel: string };
}

/* ------------------------------------------------------------------ */
/* Pill tone by vendor status variant                                  */
/* ------------------------------------------------------------------ */

const VENDOR_PILL_TONE: Record<VendorStatusVariant, StatusChipTone> = {
  preferred: 'green',
  active: 'green',
  alternative: 'neutral-gold',
  switch: 'clay',
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const GRID = '1fr 74px 96px 132px 16px';

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
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginTop: 2,
};

const ratingStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11.5px',
  color: 'var(--ink-2)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const openCountStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const arrowStyle: CSSProperties = {
  color: 'var(--ink-4)',
  fontSize: 13,
  textAlign: 'right',
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function VendorRow({ row, testId, metric }: VendorRowProps) {
  // Accessible label bakes in rating so screen readers get it without the star glyph.
  const metricAria = metric?.ariaLabel ?? `rated ${row.rating} stars`;
  const ariaLabel = `View vendor ${row.name}, ${row.trade}, ${metricAria}, ${row.statusPill.label}`;

  return (
    <>
      <div style={rowStyle} className="vendor-row" data-testid={testId} role="listitem">
        {/* Overlay link — single interactive element */}
        <a href={row.href} aria-label={ariaLabel} style={overlayLinkStyle} className="vendor-row-link" />

        {/* Stamp + name + trade */}
        <div style={{ ...cellRelStyle, ...dnameStyle }}>
          <IdentityMark label={row.initial} />
          <div style={{ minWidth: 0 }}>
            <div style={nameStyle}>{row.name}</div>
            <div style={subStyle}>{row.trade}</div>
          </div>
        </div>

        {/* Factual metric; meaning is carried by the overlay link label. */}
        <div style={{ ...cellRelStyle, ...ratingStyle }} data-vendor-col="rating">
          <span aria-hidden="true">{metric?.text ?? `${row.rating}★`}</span>
        </div>

        {/* Open work order count */}
        <div style={{ ...cellRelStyle, ...openCountStyle }} data-vendor-col="open">
          {row.openLabel}
        </div>

        {/* Status pill — text + dot, never color-only */}
        <div style={cellRelStyle}>
          <StatusChip tone={VENDOR_PILL_TONE[row.statusPill.variant]} label={row.statusPill.label} />
        </div>

        {/* Arrow — decorative */}
        <div aria-hidden="true" style={{ ...cellRelStyle, ...arrowStyle }}>
          →
        </div>
      </div>
      <VendorRowStyles />
    </>
  );
}

function VendorRowStyles() {
  return (
    <style precedence="vendor-row">{`
      .vendor-row:last-child { border-bottom: none; }
      .vendor-row:hover { background: var(--panel-lift); }
      .vendor-row:focus-within { background: var(--panel-lift); }
      .vendor-row-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: -2px;
        border-radius: 6px;
      }
      @media (max-width: 680px) {
        .vendor-row {
          grid-template-columns: 1fr auto 16px !important;
        }
        .vendor-row [data-vendor-col="rating"],
        .vendor-row [data-vendor-col="open"] {
          display: none;
        }
      }
    `}</style>
  );
}
