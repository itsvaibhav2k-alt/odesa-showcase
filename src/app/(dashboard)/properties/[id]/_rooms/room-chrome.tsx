/**
 * Shared, server-safe presentational pieces for the six room-drawer interiors.
 *
 * Every room interior imports these so the drawers stay visually consistent:
 * a primary action row, a 4-up→2-up stat grid, a hairline card wrapper, and an
 * illustrated empty state. No `'use client'` — these are universal components
 * (a client room may pass `onClick`; a server room renders them statically).
 *
 * Styling follows the Quiet Operator idiom: inline `CSSProperties` over the
 * existing `--paper-*`/`--ink-*`/`--hairline` tokens, with the responsive stat
 * grid handled by a scoped `<style>` (deduped by `href`, like `page.tsx`).
 */

import * as React from 'react';
import type { CSSProperties } from 'react';

// ---------------------------------------------------------------------------
// Action row + buttons
// ---------------------------------------------------------------------------

const actionsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

/** Primary dark pill: ink background, warm-paper text. */
export const roomPrimaryButtonStyle: CSSProperties = {
  minHeight: 38,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 16px',
  border: '1px solid var(--ink)',
  borderRadius: 999,
  background: 'var(--ink)',
  color: 'var(--panel-clean)',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.005em',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

/** Ghost/outline stub: deliberately quiet so it never reads as a broken pill. */
export const roomStubButtonStyle: CSSProperties = {
  minHeight: 38,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 14px',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--ink-3)',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.005em',
  whiteSpace: 'nowrap',
  cursor: 'not-allowed',
  opacity: 0.85,
};

export interface RoomActionsProps {
  children: React.ReactNode;
  style?: CSSProperties;
}

/** Row that lays out a room's action buttons (primary pill + stubs/overflow). */
export function RoomActions({
  children,
  style,
}: RoomActionsProps): React.ReactElement {
  return <div style={{ ...actionsRowStyle, ...style }}>{children}</div>;
}

/** Primary dark pill action. Forwards button props; safe in server rooms when
 *  no client-only handlers are passed. */
export function RoomPrimaryButton({
  children,
  style,
  type = 'button',
  ...props
}: React.ComponentProps<'button'>): React.ReactElement {
  return (
    <button type={type} {...props} style={{ ...roomPrimaryButtonStyle, ...style }}>
      {children}
    </button>
  );
}

export interface StubButtonProps {
  children: React.ReactNode;
  title?: string;
}

/** Disabled "coming soon" affordance — outline/ghost, never a dark pill. */
export function StubButton({
  children,
  title = 'Coming soon',
}: StubButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={title}
      style={roomStubButtonStyle}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stat grid
// ---------------------------------------------------------------------------

const statGridShellStyle: CSSProperties = {
  containerType: 'inline-size',
};

const statGridStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'color-mix(in srgb, var(--panel-lift) 76%, transparent)',
};

const statLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const statValueStyle: CSSProperties = {
  display: 'block',
  marginTop: 12,
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 26,
  lineHeight: 1,
  color: 'var(--ink)',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
};

const statHintStyle: CSSProperties = {
  display: 'block',
  marginTop: 7,
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 11.5,
  lineHeight: 1.35,
  color: 'var(--ink-3)',
};

export interface RoomStatGridProps {
  children: React.ReactNode;
}

/**
 * Compact stat rail: `repeat(4, minmax(0,1fr))` collapsing to 2-up below
 * ~640px of available width (container query, so it tracks the drawer width
 * rather than the viewport).
 */
export function RoomStatGrid({ children }: RoomStatGridProps): React.ReactElement {
  return (
    <div style={statGridShellStyle}>
      <RoomChromeStyles />
      <div className="room-stat-grid" style={statGridStyle}>
        {children}
      </div>
    </div>
  );
}

export interface RoomStatCellProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

/** Single stat cell: muted mono label, larger tabular-number value. */
export function RoomStatCell({
  label,
  value,
  hint,
}: RoomStatCellProps): React.ReactElement {
  return (
    <div className="room-stat-cell">
      <span style={statLabelStyle}>{label}</span>
      <span style={statValueStyle}>{value}</span>
      {hint != null ? <span style={statHintStyle}>{hint}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card + empty state
// ---------------------------------------------------------------------------

const cardStyle: CSSProperties = {
  minWidth: 0,
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel-lift) 76%, transparent)',
};

export interface RoomCardProps {
  children: React.ReactNode;
  /** Enable horizontal scroll so wide legacy tables don't blow out the drawer. */
  scrollX?: boolean;
  /** Drop the default inner padding (the child manages its own, e.g. tables). */
  flush?: boolean;
  style?: CSSProperties;
}

/** Hairline-bordered rounded panel — the room's main content surface. */
export function RoomCard({
  children,
  scrollX = false,
  flush = false,
  style,
}: RoomCardProps): React.ReactElement {
  return (
    <div
      style={{
        ...cardStyle,
        padding: flush ? 0 : 18,
        ...(scrollX ? { overflowX: 'auto' } : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const emptyStateStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 14,
  padding: '44px 28px 48px',
};

const emptyIllustrationStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--ink-4)',
  opacity: 0.9,
};

const emptyHeadlineStyle: CSSProperties = {
  margin: 0,
  maxWidth: '34ch',
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 21,
  fontWeight: 700,
  lineHeight: 1.2,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};

const emptyBodyStyle: CSSProperties = {
  margin: 0,
  maxWidth: '46ch',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 13.5,
  lineHeight: 1.55,
  color: 'var(--ink-2)',
};

export interface RoomEmptyStateProps {
  /** Aria-hidden spot illustration (small sepia line-art SVG). */
  illustration?: React.ReactNode;
  headline: React.ReactNode;
  body: React.ReactNode;
  /** Optional action (e.g. a primary pill or stub) below the explanation. */
  action?: React.ReactNode;
}

/** Centered empty state: spot illustration + serif headline + 2-line body. */
export function RoomEmptyState({
  illustration,
  headline,
  body,
  action,
}: RoomEmptyStateProps): React.ReactElement {
  return (
    <div style={emptyStateStyle}>
      {illustration != null ? (
        <span aria-hidden="true" style={emptyIllustrationStyle}>
          {illustration}
        </span>
      ) : null}
      <h3 style={emptyHeadlineStyle}>{headline}</h3>
      <p style={emptyBodyStyle}>{body}</p>
      {action != null ? <div style={{ marginTop: 4 }}>{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoped styles (deduped across multiple grids via `href`, like page.tsx)
// ---------------------------------------------------------------------------

function RoomChromeStyles(): React.ReactElement {
  return (
    <style href="room-chrome" precedence="room-chrome">{`
      .room-stat-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .room-stat-cell {
        min-height: 92px;
        padding: 15px 16px 17px;
        border-right: 1px solid var(--hairline-faint);
        border-bottom: 1px solid var(--hairline-faint);
      }
      @container (max-width: 640px) {
        .room-stat-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `}</style>
  );
}
