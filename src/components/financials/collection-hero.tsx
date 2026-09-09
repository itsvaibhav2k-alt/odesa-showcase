/**
 * CollectionHero — the monthly collection readout at the top of
 * `/financials`.
 *
 * Server component, warm-operator palette. Answers "did everyone pay?"
 * in one glance: a big serif "$X collected of $Y billed" (a quiet link
 * into the period's rent ledger), the collection %, an outstanding link,
 * a late-tenant-count link, honest Billed/Collected delta chips vs the
 * comparable prior window, a server-formatted freshness badge, and the
 * period selector chips.
 *
 * Honest by construction: delta chips are PRE-formatted by the caller
 * (`null` → omitted — never a fabricated `+$0` or a delta against an
 * empty prior window), all money is integer cents through
 * `formatMoneyCents`, and negatives use the true minus sign (U+2212).
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';

import { formatMoneyCents, formatPct } from '@/lib/financials/format';
import type { PeriodKey } from '@/lib/financials/trend';
import type { PortfolioFinancialSummary } from '@/lib/financials/types';

import { PeriodChips } from './period-chips';

export interface CollectionHeroProps {
  summary: PortfolioFinancialSummary;
  periodKey: PeriodKey;
  /** Distinct late leases for the period (incl. still-late prior months). */
  lateLeaseCount: number;
  /** Pre-formatted signed delta vs the prior window; `null` → chip omitted. */
  billedDelta?: string | null;
  /** Pre-formatted signed delta vs the prior window; `null` → chip omitted. */
  collectedDelta?: string | null;
  /** ISO timestamp from `reliability.generatedAt`; `null` → badge omitted. */
  generatedAtIso?: string | null;
  /** Where the period's rent drilldown lands (`/rent` or `/rent?cycle=…`). */
  rentHref: string;
}

const heroStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '22px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const topRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const freshnessStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
};

const figureLinkStyle: CSSProperties = {
  textDecoration: 'none',
  alignSelf: 'flex-start',
};

const figureStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontWeight: 400,
  fontSize: '34px',
  lineHeight: 1.1,
  letterSpacing: '-0.015em',
  color: 'var(--ink)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const collectedFigureStyle: CSSProperties = {
  color: 'var(--green-ink)',
};

const subRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
};

const subItemStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  fontVariantNumeric: 'tabular-nums',
};

const subLinkStyle: CSSProperties = {
  ...subItemStyle,
  color: 'var(--clay)',
  textDecoration: 'underline',
  textDecorationColor: 'var(--clay-border)',
  textUnderlineOffset: 3,
};

const chipBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  fontVariantNumeric: 'tabular-nums',
  padding: '2px 8px',
  borderRadius: 999,
  whiteSpace: 'nowrap',
};

const collectedChipStyle: CSSProperties = {
  ...chipBaseStyle,
  background: 'var(--green-bg)',
  color: 'var(--green-ink)',
};

// A shrinking collection delta must not wear the positive green chip.
const collectedChipNegativeStyle: CSSProperties = {
  ...chipBaseStyle,
  background: 'var(--amber-bg)',
  color: 'var(--amber-ink)',
};

const billedChipStyle: CSSProperties = {
  ...chipBaseStyle,
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  color: 'var(--ink-2)',
};

/** Server-formatted "Updated Jul 2, 3:42 PM"; `null` on a bad timestamp. */
function formatUpdatedLabel(iso: string): string | null {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return null;
  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(time);
  return `Updated ${formatted}`;
}

export function CollectionHero({
  summary,
  periodKey,
  lateLeaseCount,
  billedDelta,
  collectedDelta,
  generatedAtIso,
  rentHref,
}: CollectionHeroProps) {
  const collected = formatMoneyCents(summary.rentCollectedCents);
  const billed = formatMoneyCents(summary.rentBilledCents);
  const updatedLabel = generatedAtIso ? formatUpdatedLabel(generatedAtIso) : null;
  const collectedDeltaNegative =
    typeof collectedDelta === 'string' &&
    (collectedDelta.startsWith('−') || collectedDelta.startsWith('-'));
  // Name the outstanding driver above the fold: the property owed the most.
  const driver =
    summary.rentOutstandingCents > 0
      ? summary.properties.reduce(
          (top, property) =>
            property.rentOutstandingCents > (top?.rentOutstandingCents ?? 0) ? property : top,
          null as (typeof summary.properties)[number] | null,
        )
      : null;
  const driverText =
    driver === null
      ? ''
      : driver.rentOutstandingCents >= summary.rentOutstandingCents
        ? ` · all at ${driver.propertyName}`
        : ` · largest: ${driver.propertyName}`;

  return (
    <div style={heroStyle} data-testid="collection-hero">
      <div style={topRowStyle}>
        <span style={eyebrowStyle}>Rent collection · {summary.period.label}</span>
        {updatedLabel ? (
          <span style={freshnessStyle} data-testid="collection-hero-freshness">
            {updatedLabel}
          </span>
        ) : null}
      </div>

      <Link
        href={rentHref}
        style={figureLinkStyle}
        aria-label={`${collected} collected of ${billed} billed in ${summary.period.label} — open the rent ledger`}
        className="collection-hero-figure"
      >
        <span style={figureStyle} data-testid="collection-hero-figure">
          <span style={collectedFigureStyle}>{collected}</span>
          {' collected of '}
          {billed}
          {' billed'}
        </span>
      </Link>

      <div style={subRowStyle}>
        <span style={subItemStyle} data-testid="collection-hero-rate">
          <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>
            {formatPct(summary.collectionRatePct)}
          </strong>
          {' collected'}
        </span>
        {collectedDelta ? (
          <span
            style={collectedDeltaNegative ? collectedChipNegativeStyle : collectedChipStyle}
            data-testid="collection-hero-delta-collected"
          >
            {collectedDelta} collected vs prior
          </span>
        ) : null}
        {billedDelta ? (
          <span style={billedChipStyle} data-testid="collection-hero-delta-billed">
            {billedDelta} billed vs prior
          </span>
        ) : null}
        {summary.rentOutstandingCents > 0 ? (
          <Link
            href="/rent?filter=outstanding"
            style={subLinkStyle}
            data-testid="collection-hero-outstanding"
          >
            {formatMoneyCents(summary.rentOutstandingCents)} outstanding{driverText}
          </Link>
        ) : (
          <span style={subItemStyle} data-testid="collection-hero-outstanding">
            Nothing outstanding
          </span>
        )}
        {lateLeaseCount > 0 ? (
          <Link
            href="/rent?filter=outstanding"
            style={subLinkStyle}
            data-testid="collection-hero-late-count"
          >
            {lateLeaseCount} tenant{lateLeaseCount === 1 ? '' : 's'} late
          </Link>
        ) : (
          <span style={subItemStyle} data-testid="collection-hero-late-count">
            No tenants late
          </span>
        )}
      </div>

      <PeriodChips active={periodKey} />
      <CollectionHeroStyles />
    </div>
  );
}

function CollectionHeroStyles() {
  return (
    <style precedence="default" href="financials-collection-hero">{`
      .collection-hero-figure:hover span { text-decoration: underline; text-decoration-color: var(--hairline-strong); text-underline-offset: 5px; }
      .collection-hero-figure:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 3px;
        border-radius: 6px;
      }
    `}</style>
  );
}
