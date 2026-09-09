import type { CSSProperties } from 'react';
import type {
  PortfolioProperty,
  PropertyStatus,
} from '@/lib/properties/mock-portfolio';
import { PropertyMetric } from './property-metric';
import { PropertyIssueRow } from './property-issue-row';

/**
 * Portfolio property card.
 *
 * Presentational only — mirrors the mockup `.prop-card` + `.card-link` +
 * `.prop-status` + `.prop-summary` + `.prop-loc` + `.prop-stats` +
 * `.prop-flags` + `.prop-cta` (odesa-properties4.html lines 1276-1468) and the
 * `renderGrid` markup (1725-1754).
 *
 * Accessibility contract (hard requirement): the ONLY interactive element in
 * the entire card is a single absolutely-positioned overlay `<a>` (first
 * child). Everything else — status pill, location, summary, metrics, issues,
 * and the hover-revealed CTA — is plain, non-interactive text. The overlay
 * link carries the full accessible label; visible content is layered above it
 * via `position: relative` (and the status pill at `zIndex: 2` so it stays
 * above the link's `zIndex: 1`).
 *
 * The left-border status tint is an inset box-shadow (atrisk → clay, watching
 * → amber, leasing → gold, calm → green). Hover / focus-within reveal the CTA
 * footer via opacity transitions defined in `<PropertyCardStyles>` — keep
 * those rules co-located so the card is self-contained.
 */

export interface PropertyCardProps {
  property: PortfolioProperty;
}

const STATUS_TINT: Record<PropertyStatus, string> = {
  atrisk: 'var(--clay)',
  watching: 'var(--amber)',
  leasing: 'var(--gold)',
  calm: 'var(--green)',
};

interface StatusPillTheme {
  color: string;
  background: string;
  borderColor: string;
  dot: string;
}

const STATUS_PILL: Record<PropertyStatus, StatusPillTheme> = {
  atrisk: {
    color: 'var(--clay-ink)',
    background: 'var(--clay-bg)',
    borderColor: 'var(--clay-border)',
    dot: 'var(--clay)',
  },
  watching: {
    color: 'var(--amber-ink)',
    background: 'var(--amber-bg)',
    borderColor: 'var(--amber-border)',
    dot: 'var(--amber)',
  },
  leasing: {
    color: 'var(--neutral-ink)',
    background: 'var(--neutral-bg)',
    borderColor: 'var(--neutral-border)',
    dot: 'var(--gold)',
  },
  calm: {
    color: 'var(--green-ink)',
    background: 'var(--green-bg)',
    borderColor: 'var(--green-border)',
    dot: 'var(--green)',
  },
};

const cardBase: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 11,
  padding: '18px 19px 16px',
  position: 'relative',
  transition: 'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
};

const overlayLinkStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  borderRadius: 11,
  textDecoration: 'none',
};

const topRowStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 3,
};

const nameStyle: CSSProperties = {
  fontSize: '18px',
  fontWeight: 450,
  letterSpacing: '-0.015em',
  color: 'var(--ink)',
  lineHeight: 1.15,
};

const pillBaseStyle: CSSProperties = {
  position: 'relative',
  zIndex: 2,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  padding: '3px 9px 3px 8px',
  borderRadius: 4,
  border: '1px solid transparent',
};

const pillDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
};

const locStyle: CSSProperties = {
  position: 'relative',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
  marginBottom: 14,
};

const summaryStyle: CSSProperties = {
  position: 'relative',
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  letterSpacing: '-0.003em',
  marginBottom: 16,
  lineHeight: 1.4,
};

const summaryLeadStyle: CSSProperties = {
  color: 'var(--ink)',
  fontWeight: 450,
};

const statsStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  gap: 0,
  padding: '13px 0',
  borderTop: '1px solid var(--hairline-faint)',
  borderBottom: '1px solid var(--hairline-faint)',
  marginBottom: 13,
};

const statDividerStyle: CSSProperties = {
  borderLeft: '1px solid var(--hairline-faint)',
  paddingLeft: 14,
};

const flagsStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minHeight: 18,
};

const ctaStyle: CSSProperties = {
  position: 'relative',
  marginTop: 14,
  paddingTop: 13,
  borderTop: '1px solid var(--hairline-faint)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const ctaViewStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 450,
  color: 'var(--terracotta)',
  letterSpacing: '-0.005em',
};

const ctaQuickStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

/** Replace only the FIRST " · " in a location with ", " for the a11y label. */
function locToComma(location: string): string {
  return location.replace(' · ', ', ');
}

/** Property detail link — the row id is now a real property UUID. */
function propertyHref(id: string): string {
  return `/properties/${id}`;
}

export function PropertyCard({ property }: PropertyCardProps) {
  const pill = STATUS_PILL[property.status];
  const plural = property.activeItems === 1 ? '' : 's';
  const cardLabel = `View ${property.name} — ${locToComma(property.location)}, ${property.statusLabel}, ${property.activeItems} active item${plural}`;

  const cardStyle: CSSProperties = {
    ...cardBase,
    boxShadow: `inset 3px 0 0 ${STATUS_TINT[property.status]}`,
    // Exposed to the hoisted hover/focus rule so the colored left border
    // survives alongside the added drop shadow.
    ['--status-tint' as string]: STATUS_TINT[property.status],
  };

  return (
    <article
      data-testid={`property-card-${property.id}`}
      data-prop-card={property.id}
      style={cardStyle}
    >
      {/* The single interactive element in the card. */}
      <a
        data-testid={`property-card-link-${property.id}`}
        href={propertyHref(property.id)}
        aria-label={cardLabel}
        style={overlayLinkStyle}
      />

      <div style={topRowStyle}>
        <div style={nameStyle}>{property.name}</div>
        <span
          style={{
            ...pillBaseStyle,
            color: pill.color,
            background: pill.background,
            borderColor: pill.borderColor,
          }}
        >
          <span aria-hidden="true" style={{ ...pillDotStyle, background: pill.dot }} />
          {property.statusLabel}
        </span>
      </div>

      <div style={locStyle}>{property.location}</div>

      <div style={summaryStyle}>
        {property.summaryLead ? (
          <>
            <span style={summaryLeadStyle}>{property.summaryLead}</span>
            {' · '}
            {property.summaryRest}
          </>
        ) : (
          property.summaryRest
        )}
      </div>

      <div style={statsStyle}>
        {property.stats.map((metric, idx) => (
          <div key={metric.label} style={idx > 0 ? statDividerStyle : undefined}>
            <PropertyMetric metric={metric} />
          </div>
        ))}
      </div>

      <div style={flagsStyle}>
        {property.issues.map((issue, idx) => (
          <PropertyIssueRow key={`${issue.tone}-${idx}`} issue={issue} />
        ))}
      </div>

      <div className="prop-card-cta" style={ctaStyle}>
        <span style={ctaViewStyle}>View property →</span>
        <span style={ctaQuickStyle}>Rent · Tenants · Vendors</span>
      </div>

      <PropertyCardStyles />
    </article>
  );
}

/**
 * Hoisted scoped styles (mirrors the SidebarStyles pattern). Drives the
 * hover/focus-within affordances that inline styles cannot express:
 *  - card hover/focus-within lift + border emphasis,
 *  - CTA footer reveal (hidden by default, faded in on hover/focus-within),
 *  - the overlay link's visible terracotta focus ring.
 */
function PropertyCardStyles() {
  return (
    <style>{`
      [data-prop-card] .prop-card-cta {
        opacity: 0;
        transform: translateY(-3px);
        transition: opacity 140ms ease, transform 140ms ease;
      }
      [data-prop-card]:hover,
      [data-prop-card]:focus-within {
        border-color: var(--hairline-strong);
        box-shadow: inset 3px 0 0 var(--status-tint, transparent), 0 2px 0 var(--hairline-faint);
      }
      [data-prop-card]:hover {
        transform: translateY(-1px);
      }
      [data-prop-card]:hover .prop-card-cta,
      [data-prop-card]:focus-within .prop-card-cta {
        opacity: 1;
        transform: translateY(0);
      }
      [data-prop-card] a:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
