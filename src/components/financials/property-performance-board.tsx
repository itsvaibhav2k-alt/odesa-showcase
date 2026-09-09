/**
 * PropertyPerformanceBoard — per-property driver board for `/financials`.
 *
 * Server component, plain HTML. Replaces the old occupancy × collection
 * scatter (sparse and clip-prone at 2 dots) with three labeled groups of
 * card rows, ordered by what needs the operator's attention:
 *
 *   1. Collection problem — billed properties with money still open,
 *      largest outstanding first (terracotta accent).
 *   2. Healthy — billed, nothing outstanding (green accent).
 *   3. No rent billed — nothing billed this period, so there is no
 *      collection rate to show (honest-null: `buildPropertyMarks`
 *      benches these instead of faking a 0% point).
 *
 * Rows form a contribution graph on ONE dollar axis: each bar's width
 * is that property's billed rent relative to the largest billed
 * property, with collected (green) vs outstanding (terracotta) stacked
 * inside; unbilled rows get a dashed empty track. Bars are comparable
 * at a glance — widest bar = most rent billed.
 *
 * Every row IS the drilldown: one `<Link>` to the property page with a
 * full-value aria-label. All numbers exist as text, never color-only.
 */

import Link from 'next/link';
import type { CSSProperties, ReactElement } from 'react';

import { buildPropertyMarks, type PropertyMark } from '@/lib/financials/chart';
import { formatMoneyCents, formatMoneyCentsShort, formatPct } from '@/lib/financials/format';
import type { PropertyFinancialSnapshot } from '@/lib/financials/types';
import { propertyHref } from '@/lib/properties/hrefs';

export interface PropertyPerformanceBoardProps {
  properties: PropertyFinancialSnapshot[];
}

const cardStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const headingStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: '16px',
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};

const subtitleStyle: CSSProperties = {
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
  marginTop: 2,
};

const groupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const groupCaptionStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'baseline',
  rowGap: 10,
  columnGap: 16,
  padding: '14px 16px 15px',
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  textDecoration: 'none',
};

const rowNameStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 500,
  lineHeight: 1.35,
  color: 'var(--ink)',
  overflowWrap: 'anywhere',
};

const rowMetaStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.03em',
  color: 'var(--ink-3)',
  marginTop: 3,
};

const openAmountStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '19px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--clay-ink)',
  whiteSpace: 'nowrap',
};

const healthyPctStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '15px',
  fontWeight: 600,
  color: 'var(--green-ink)',
  whiteSpace: 'nowrap',
};

/** Full row-width lane every bar sits in — the shared dollar axis. */
const barLaneStyle: CSSProperties = {
  gridColumn: '1 / -1',
  height: 11,
};

/** The bar itself: width = property billed / max billed, stacked fills inside. */
const barTrackStyle: CSSProperties = {
  display: 'flex',
  height: '100%',
  borderRadius: 999,
  border: '1px solid var(--hairline-faint)',
  overflow: 'hidden',
  // ponytail: 2% floor so a tiny-billed property still renders a visible bar
  minWidth: '2%',
};

const dashedTrackStyle: CSSProperties = {
  gridColumn: '1 / -1',
  height: 11,
  borderRadius: 999,
  border: '1px dashed var(--hairline-strong)',
};

const scaleHintStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.05em',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const unbilledRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'baseline',
  rowGap: 8,
  columnGap: 16,
  padding: '10px 16px 12px',
  background: 'var(--panel)',
  border: '1px solid var(--hairline-faint)',
  borderRadius: 10,
  textDecoration: 'none',
};

/** Clamp a percent to a drawable 0–100 bar width (text stays honest). */
function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function billedAriaLabel(mark: PropertyMark): string {
  const outstanding =
    mark.outstandingCents > 0
      ? `, ${formatMoneyCents(mark.outstandingCents)} outstanding`
      : '';
  return `${mark.propertyName}: ${mark.occupiedUnits} of ${mark.units} units occupied (${formatPct(mark.occupancyPct)}), ${formatPct(mark.collectionPct)} of billed rent collected${outstanding} — open property`;
}

function BilledRow({
  mark,
  problem,
  billedCents,
  maxBilledCents,
}: {
  mark: PropertyMark;
  problem: boolean;
  billedCents: number;
  maxBilledCents: number;
}): ReactElement {
  // Common dollar axis: bar width = this property's billed share of the
  // largest billed property; inside, collected (green) vs outstanding
  // (terracotta) split the bar.
  const trackPct = clampPct(maxBilledCents > 0 ? (billedCents / maxBilledCents) * 100 : 0);
  const collectedCents = Math.max(0, billedCents - mark.outstandingCents);
  const collectedPct = billedCents > 0 ? clampPct((collectedCents / billedCents) * 100) : 0;
  return (
    <Link
      href={propertyHref(mark.propertyId)}
      className="board-row"
      style={{
        ...rowStyle,
        borderLeft: `3px solid ${problem ? 'var(--terracotta)' : 'var(--green)'}`,
      }}
      data-testid={`property-mark-${mark.propertyId}`}
      aria-label={billedAriaLabel(mark)}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ ...rowNameStyle, display: 'block' }}>{mark.propertyName}</span>
        <span style={{ ...rowMetaStyle, display: 'block' }}>
          {problem
            ? `${mark.occupiedUnits}/${mark.units} occupied · ${formatPct(mark.collectionPct)} collected`
            : `${formatPct(mark.collectionPct)} collected · ${mark.occupiedUnits}/${mark.units} occupied`}
          {' · '}
          {formatMoneyCentsShort(billedCents)} billed
        </span>
      </span>
      {problem ? (
        <span style={openAmountStyle}>{formatMoneyCents(mark.outstandingCents)} open</span>
      ) : (
        <span style={healthyPctStyle}>{formatPct(mark.collectionPct)}</span>
      )}
      <span style={barLaneStyle} aria-hidden="true">
        <span style={{ ...barTrackStyle, width: `${trackPct}%` }}>
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${collectedPct}%`,
              background: 'var(--green)',
            }}
          />
          <span
            style={{
              display: 'block',
              height: '100%',
              flex: 1,
              background: problem ? 'var(--terracotta)' : 'transparent',
            }}
          />
        </span>
      </span>
    </Link>
  );
}

export function PropertyPerformanceBoard({
  properties,
}: PropertyPerformanceBoardProps): ReactElement | null {
  const { plotted, unbilled } = buildPropertyMarks(properties);
  if (plotted.length === 0 && unbilled.length === 0) return null;

  const problems = plotted
    .filter((mark) => mark.outstandingCents > 0)
    .sort((a, b) => b.outstandingCents - a.outstandingCents);
  const healthy = plotted.filter((mark) => mark.outstandingCents <= 0);

  // PropertyMark carries no billed figure; look it up from the snapshots
  // so every bar shares one dollar axis (widest bar = most billed).
  const billedByProperty = new Map(
    properties.map((property) => [property.propertyId, property.rentBilledCents]),
  );
  const billedFor = (mark: PropertyMark): number => billedByProperty.get(mark.propertyId) ?? 0;
  const maxBilledCents = plotted.reduce((max, mark) => Math.max(max, billedFor(mark)), 0);

  return (
    <div style={cardStyle} data-testid="property-performance-board">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 style={headingStyle}>Property performance</h3>
          <p style={subtitleStyle}>
            Who is collecting, who is behind, and where nothing is billed yet.
          </p>
        </div>
        {maxBilledCents > 0 ? (
          <span style={scaleHintStyle}>
            $ scale · max {formatMoneyCentsShort(maxBilledCents)} billed
          </span>
        ) : null}
      </div>

      {problems.length > 0 ? (
        <div style={groupStyle}>
          <span style={{ ...groupCaptionStyle, color: 'var(--terracotta)' }}>
            Collection problem · {problems.length}
          </span>
          {problems.map((mark) => (
            <BilledRow
              key={mark.propertyId}
              mark={mark}
              problem
              billedCents={billedFor(mark)}
              maxBilledCents={maxBilledCents}
            />
          ))}
        </div>
      ) : null}

      {healthy.length > 0 ? (
        <div style={groupStyle}>
          <span style={{ ...groupCaptionStyle, color: 'var(--green-ink)' }}>
            Healthy · {healthy.length}
          </span>
          {healthy.map((mark) => (
            <BilledRow
              key={mark.propertyId}
              mark={mark}
              problem={false}
              billedCents={billedFor(mark)}
              maxBilledCents={maxBilledCents}
            />
          ))}
        </div>
      ) : null}

      {unbilled.length > 0 ? (
        <div style={groupStyle} data-testid="property-board-unbilled">
          <span style={{ ...groupCaptionStyle, color: 'var(--ink-3)' }}>
            No rent billed · {unbilled.length}
          </span>
          <p style={{ ...subtitleStyle, marginTop: 0 }}>
            Listing problem, not collection failure.
          </p>
          {unbilled.map((mark) => (
            <Link
              key={mark.propertyId}
              href={propertyHref(mark.propertyId)}
              className="board-row"
              style={unbilledRowStyle}
              data-testid={`property-mark-${mark.propertyId}`}
              aria-label={`${mark.propertyName}: no rent billed this period, ${mark.occupiedUnits} of ${mark.units} units occupied — open property`}
            >
              <span style={{ ...rowNameStyle, color: 'var(--ink-2)' }}>
                {mark.propertyName}
              </span>
              <span style={{ ...rowMetaStyle, marginTop: 0, whiteSpace: 'nowrap' }}>
                no rent billed · {mark.occupiedUnits}/{mark.units} occupied
              </span>
              <span style={dashedTrackStyle} aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}

      <PropertyPerformanceBoardStyles />
    </div>
  );
}

function PropertyPerformanceBoardStyles(): ReactElement {
  return (
    <style precedence="default" href="financials-property-board">{`
      .board-row { transition: background 120ms ease, border-color 120ms ease; }
      .board-row:hover { background: var(--panel-clean); border-color: var(--hairline); }
      .board-row:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
