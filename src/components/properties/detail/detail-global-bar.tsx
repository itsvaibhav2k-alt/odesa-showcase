/**
 * DetailGlobalBar — sticky breadcrumb + freshness bar for detail pages.
 *
 * Mirrors the mockup's `.global-bar`: sticky top nav with breadcrumb on the
 * left and precise data freshness on the right.
 *
 * Breadcrumb: Link items with aria-hidden '/' separators; final crumb rendered
 * as <span aria-current="page">. Freshness: green dot (aria-hidden) + mono time.
 *
 * Server component — no interactivity needed.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

export interface BreadcrumbItem {
  label: string;
  /** When present renders as a <Link>; absent => current page <span>. */
  href?: string;
}

export interface DetailGlobalBarProps {
  crumbs: BreadcrumbItem[];
  /** Optional real freshness suffix already including the unit, e.g. "11m". */
  checkedAgoLabel?: string;
  /**
   * When provided, replaces the default "Data current" string verbatim.
   */
  freshnessText?: string;
}

const barStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  rowGap: '6px',
  minHeight: '52px',
  padding: '0 36px',
  background: 'var(--canvas)',
  borderBottom: '1px solid var(--hairline)',
};

const breadcrumbStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12.5px',
  color: 'var(--ink-3)',
  flexWrap: 'wrap',
};

const linkStyle: CSSProperties = {
  color: 'var(--ink-3)',
  textDecoration: 'none',
  borderRadius: '3px',
};

const currentStyle: CSSProperties = {
  color: 'var(--ink)',
  fontWeight: 450,
};

const sepStyle: CSSProperties = {
  color: 'var(--ink-4)',
};

const freshnessStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12px',
  color: 'var(--ink-2)',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-mono-operator)',
};

const liveDotStyle: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'var(--green)',
  boxShadow: '0 0 0 3px rgba(77, 122, 86, 0.18)',
  flexShrink: 0,
};

export function DetailGlobalBar({
  crumbs,
  checkedAgoLabel,
  freshnessText,
}: DetailGlobalBarProps) {
  return (
    <nav aria-label="Breadcrumb" style={barStyle}>
      <ol style={{ ...breadcrumbStyle, listStyle: 'none', margin: 0, padding: 0 }}>
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <li key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {idx > 0 && (
                <span aria-hidden="true" style={sepStyle}>
                  /
                </span>
              )}
              {!isLast && crumb.href ? (
                <Link href={crumb.href} style={linkStyle} className="detail-global-bar-link">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} style={isLast ? currentStyle : {}}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div style={freshnessStyle}>
        <span aria-hidden="true" style={liveDotStyle} />
        {freshnessText ? (
          <span>{freshnessText}</span>
        ) : checkedAgoLabel ? (
          <span>
            Data current · checked{' '}
            <span style={{ fontFamily: 'var(--font-mono-operator)' }}>{checkedAgoLabel}</span> ago
          </span>
        ) : (
          <span>Data current</span>
        )}
      </div>

      <DetailGlobalBarStyles />
    </nav>
  );
}

function DetailGlobalBarStyles() {
  return (
    <style precedence="detail-global-bar">{`
      .detail-global-bar-link:hover {
        color: var(--ink);
      }
      .detail-global-bar-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
    `}</style>
  );
}
