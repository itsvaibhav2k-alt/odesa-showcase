/**
 * Portfolio operations command center — sticky page header.
 *
 * Server component (no client interactivity). Reproduces the locked mockup's
 * `.global-bar`: a sticky page-chrome strip above the portfolio feed.
 *
 * Left ("page-mark"): a mono uppercase eyebrow ("Portfolio"), the page title
 * ("Properties" in italic Instrument Serif), and a meta line summarizing the
 * portfolio — each value carries the `.num` class for tabular figures, with
 * muted middot separators.
 *
 * Right: a freshness dot + precise data-current wording, with a real checked
 * age only when one is available.
 *
 * All props are driven by the page's server-side data fetch so the counts and
 * timestamp reflect the live portfolio on every render.
 */

import type { CSSProperties } from 'react';
import type { PortfolioSummary } from '@/lib/properties/mock-portfolio';

export interface PortfolioHeaderProps {
  /** Portfolio roll-up counts (properties / units / occupancy / mrr). */
  summary: PortfolioSummary;
  /**
   * Short "checked Nm ago" stamp. Already includes the unit ("11m", "3h",
   * "2d") — the component renders "checked {checkedAgoLabel} ago" around it.
   */
  checkedAgoLabel: string;
  /** Optional truthful replacement when no persisted freshness timestamp exists. */
  freshnessText?: string;
}

const barStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  // Wrap (and grow past 52px) on narrow viewports instead of pushing the
  // freshness block past the screen edge — mirrors the mockup's
  // ≤820px global-bar behavior.
  flexWrap: 'wrap',
  rowGap: '6px',
  minHeight: '52px',
  padding: '8px 18px',
  background: 'var(--canvas)',
  borderBottom: '1px solid var(--hairline)',
};

const pageMarkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '12px',
  flexWrap: 'wrap',
  minWidth: 0,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display)',
  fontStyle: 'italic',
  fontSize: '22px',
  fontWeight: 400,
  letterSpacing: '-0.015em',
  lineHeight: 1,
  color: 'var(--ink)',
};

const metaStyle: CSSProperties = {
  marginLeft: '6px',
  fontSize: '12.5px',
  color: 'var(--ink-3)',
  minWidth: 0,
};

const numStyle: CSSProperties = {
  color: 'var(--ink)',
  fontWeight: 450,
};

const rightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12px',
  color: 'var(--ink-2)',
};

const liveDotStyle: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'var(--green)',
  boxShadow: '0 0 0 3px rgba(77, 122, 86, 0.18)',
};

export function PortfolioHeader({
  summary,
  checkedAgoLabel,
  freshnessText,
}: PortfolioHeaderProps) {
  return (
    <div data-testid="portfolio-header" style={barStyle}>
      <div style={pageMarkStyle}>
        <span style={eyebrowStyle}>Portfolio</span>

        <h1 style={titleStyle}>Properties</h1>

        <span style={metaStyle}>
          <span className="num" style={numStyle} data-testid="portfolio-property-count">
            {summary.properties}
          </span>{' '}
          properties
          <Separator />
          <span className="num" style={numStyle} data-testid="portfolio-unit-count">
            {summary.units}
          </span>{' '}
          units
          <Separator />
          <span className="num" style={numStyle} data-testid="portfolio-occupancy">
            {summary.occupancy}
          </span>{' '}
          occupied
          <Separator />
          <span className="num" style={numStyle} data-testid="portfolio-mrr">
            {summary.mrr}
          </span>
          /mo
        </span>
      </div>

      <div style={rightStyle}>
        <span aria-hidden="true" style={liveDotStyle} />
        {freshnessText ? (
          freshnessText
        ) : (
          <>
            Data current · checked{' '}
            <span
              className="num"
              style={{ fontFamily: 'var(--font-mono-operator)' }}
            >
              {checkedAgoLabel}
            </span>{' '}
            ago
          </>
        )}
      </div>
    </div>
  );
}

/** Muted middot separator between meta values. */
function Separator() {
  return (
    <span aria-hidden="true" style={{ color: 'var(--ink-4)', margin: '0 7px' }}>
      ·
    </span>
  );
}
