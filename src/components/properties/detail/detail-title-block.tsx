/**
 * DetailTitleBlock — page title block atom for property detail pages.
 *
 * Matches the mockup's `.title-block`:
 *   - mono eyebrow label (`.eyebrow-label`)
 *   - serif italic <h1>
 *   - inline DetailBadge (when provided)
 *   - mono meta line with muted middot separators
 *
 * Server component — purely presentational.
 */

import type { CSSProperties } from 'react';
import type { BadgeSpec } from '@/lib/properties/mock-detail';
import { DetailBadge } from './detail-badge';

export interface DetailTitleBlockProps {
  /** Mono uppercase eyebrow, e.g. "Property" or "Unit 1A · 22 Oak St". */
  eyebrow: string;
  /** Page title rendered in serif italic <h1>. */
  title: string;
  /** Optional status badge rendered inline in the title row. */
  badge?: BadgeSpec;
  /** Meta segments joined by middot separators, e.g. ["Sterling, VA", "5 units"]. */
  meta: string[];
}

const blockStyle: CSSProperties = {
  marginBottom: '24px',
};

const eyebrowStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: '8px',
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  flexWrap: 'wrap',
};

const h1Style: CSSProperties = {
  fontFamily: 'var(--font-serif-display)',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: '34px',
  letterSpacing: '-0.02em',
  lineHeight: 1,
  color: 'var(--ink)',
};

const metaStyle: CSSProperties = {
  marginTop: '11px',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '11px',
  letterSpacing: '0.04em',
  color: 'var(--ink-2)',
  textTransform: 'uppercase',
};

const sepStyle: CSSProperties = {
  color: 'var(--ink-4)',
  margin: '0 8px',
};

export function DetailTitleBlock({ eyebrow, title, badge, meta }: DetailTitleBlockProps) {
  return (
    <div style={blockStyle}>
      <span style={eyebrowStyle}>{eyebrow}</span>

      <div style={titleRowStyle}>
        <h1 style={h1Style}>{title}</h1>
        {badge && <DetailBadge variant={badge.variant} label={badge.label} />}
      </div>

      {meta.length > 0 && (
        <div style={metaStyle}>
          {meta.map((segment, idx) => (
            <span key={idx}>
              {idx > 0 && (
                <span aria-hidden="true" style={sepStyle}>
                  ·
                </span>
              )}
              {segment}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
