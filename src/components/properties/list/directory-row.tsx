/**
 * DirectoryRow — single-overlay-link row for list-view directories.
 *
 * Mirrors the mockup's `.dir-row` pattern: the entire row is wrapped in an
 * <article> with `position: relative`; a single absolutely-positioned <a>
 * overlay (zIndex 1) covers the whole row and carries the accessible label.
 * All visible children are text-only at `position: relative` (zIndex 2) so
 * they sit above the link in the paint order but remain inert to pointer
 * events (no nested interactive elements).
 *
 * Used by Tenants, Rent, Documents, and Open-Items list pages.
 * Server component — no interactivity.
 */

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';

export interface DirectoryRowProps {
  /** Destination URL for the overlay link. */
  href: string;
  /** Descriptive accessible name for the link (e.g. "View tenant Maya R. at 22 Oak St · 1A, Payment plan"). */
  ariaLabel: string;
  /** Single initial letter shown in the avatar circle. Optional — omit for rows without an avatar. */
  avatar?: string;
  /** Primary name / title of the row item. */
  name: string;
  /** Secondary descriptor below the name (address, unit, org, etc.). */
  sub: string;
  /** Optional mono metadata shown in the center slot (e.g. "$1,520/mo", date, type). */
  meta?: string;
  /** Optional pill node — pass a <DetailPill> or any inline element. */
  pill?: ReactNode;
  /** Optional trailing content (replaces the default arrow). */
  trailing?: ReactNode;
  /** Optional test id applied to the row <article>. */
  testId?: string;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '13px 18px',
  borderBottom: '1px solid var(--hairline-faint)',
  position: 'relative',
};

const overlayLinkStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  textDecoration: 'none',
  borderRadius: 0,
};

const contentStyle: CSSProperties = {
  position: 'relative',
  display: 'contents',
};

const avatarStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: 'var(--canvas-deep)',
  color: 'var(--ink-2)',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '12px',
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  position: 'relative',
};

const nameBlockStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  position: 'relative',
};

const nameStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 450,
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
};

const subStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  marginTop: 1,
};

const metaStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '12px',
  color: 'var(--ink-2)',
  whiteSpace: 'nowrap',
  position: 'relative',
  flexShrink: 0,
};

const pillSlotStyle: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
};

const arrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '13px',
  color: 'var(--ink-4)',
  textAlign: 'right',
  flexShrink: 0,
  position: 'relative',
};

export function DirectoryRow({
  href,
  ariaLabel,
  avatar,
  name,
  sub,
  meta,
  pill,
  trailing,
  testId,
}: DirectoryRowProps) {
  return (
    <>
      <article style={rowStyle} className="dir-row-article" data-testid={testId}>
        {/* Single overlay link — no nested interactive descendants */}
        <Link
          href={href}
          aria-label={ariaLabel}
          style={overlayLinkStyle}
          className="dir-row-link"
          tabIndex={0}
        />

        {/* All visible content is position:relative / inert to pointer events */}
        <div style={contentStyle}>
          {avatar !== undefined ? (
            <span aria-hidden="true" style={avatarStyle}>
              {avatar}
            </span>
          ) : null}

          <div style={nameBlockStyle}>
            <div style={nameStyle}>{name}</div>
            <div style={subStyle}>{sub}</div>
          </div>

          {meta !== undefined ? (
            <span className="num" style={metaStyle}>
              {meta}
            </span>
          ) : null}

          {pill !== undefined ? (
            <span style={pillSlotStyle}>{pill}</span>
          ) : null}

          <span aria-hidden="true" style={arrowStyle}>
            {trailing ?? '→'}
          </span>
        </div>
      </article>
      <DirectoryRowStyles />
    </>
  );
}

function DirectoryRowStyles() {
  return (
    <style precedence="directory-row">{`
      .dir-row-article:last-child {
        border-bottom: none;
      }
      .dir-row-article:hover {
        background: var(--panel-clean);
      }
      .dir-row-article:focus-within {
        background: var(--panel-clean);
      }
      .dir-row-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: -2px;
        border-radius: 4px;
      }
    `}</style>
  );
}
