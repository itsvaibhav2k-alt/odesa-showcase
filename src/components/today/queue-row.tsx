'use client';

import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { QueueChip, type QueueChipStatus } from './queue-chip';
import type { QueueItem } from '@/types/today';

/**
 * Single owner-review queue row.
 *
 * Client component (PR-3). PR-2 used the same shape as a server
 * component for the static visual scaffold; PR-3 promotes it to
 * `'use client'` and threads the selection contract:
 *  - `item` + `isSelected` + `onToggle` → drives the terracotta
 *    inset shadow + `var(--panel-lift)` background when the row is
 *    selected, and toggles selection on click / Enter / Space.
 *  - Action button clicks call `e.stopPropagation()` so they never
 *    bubble up and trigger row selection.
 *  - The row container is a non-button group because it contains real buttons
 *    and links. This avoids invalid nested interactive markup; the explicit
 *    controls remain independently clickable/navigable.
 *
 * Backward compatibility: callers that pass only the legacy props
 * (no `item`, no `onToggle`) still render the static row exactly as
 * PR-2 did. This keeps any storybook / test page that constructs
 * mock rows from props (rather than `QueueItem` objects) working
 * through the PR-3 migration.
 *
 * Layout: 3-column CSS grid.
 *   - 110px chip column
 *   - fluid body (title, mono-separated meta line, italic serif-display
 *     recommendation line)
 *   - auto-width actions cluster (timestamp + 0-2 buttons)
 *
 * Hard-rule notes:
 * - Recommendation line uses `var(--font-serif-display)` at 14px italic.
 *   This is the load-bearing typography decision in the design — not
 *   operator sans in italic.
 * - All numbers (money, times, durations, unit IDs) inside the row must
 *   carry the `.num` class so tabular numerals render. Callers thread
 *   numbers as `ReactNode` arrays so they can wrap each number span
 *   themselves.
 * - Action buttons get `6px` border-radius. Chips get 3px. No
 *   `rounded-2xl/3xl`.
 * - No hover transform — hover swaps background only.
 * - Selected row visual is `box-shadow: inset 3px 0 0 var(--terracotta)`
 *   + `background: var(--panel-lift)`. NOT a border, NOT a glow.
 */

export type QueueRowKey = 'leak' | 'rent' | 'vendor' | 'noise' | 'lockbox';

export interface QueueAction {
  /** Visible label (sentence case). */
  label: string;
  /** Visual variant — 'primary' is dark pill, 'secondary' is bordered pill. */
  variant: 'primary' | 'secondary';
}

export interface QueueRowProps {
  /** Stable row identity. Used for the `data-queue-row` attribute. */
  rowKey: QueueRowKey | string;
  status: QueueChipStatus;
  title: string;
  /**
   * Meta line tokens. Each entry becomes a span; tokens are joined with the
   * mono ` · ` separator. Pass `<span className="num">…</span>` for any
   * numeric token so tabular figures render.
   */
  meta: ReactNode[];
  /**
   * Italic Odesa-voice recommendation copy. Inline numbers should be wrapped
   * in `<span className="num">…</span>` by the caller (verbatim from
   * ref-context-map).
   */
  recommendation: ReactNode;
  /** Right-aligned timestamp (e.g. `12m ago`, `06:14`). */
  time: ReactNode;
  /** 0–2 action buttons. Order: primary first, secondary second. */
  actions: QueueAction[];
  /**
   * Full QueueItem the row represents. Required for selection wiring;
   * omit only when rendering the legacy static branch (PR-2 mocks).
   */
  item?: QueueItem;
  /** Whether this row is currently the selected row. Default `false`. */
  isSelected?: boolean;
  /**
   * Called when the row container is clicked / Entered / Spaced. The
   * caller decides whether to set or clear `selectedItem`. Required
   * for selection wiring; omit only in the static branch.
   */
  onToggle?: () => void;
}

function toKebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const rowBaseStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns:
    'minmax(96px, max-content) minmax(0, 1fr) minmax(120px, auto)',
  columnGap: 20,
  padding: '13px 18px 13px 16px',
  borderBottom: '1px solid var(--hairline-faint)',
  alignItems: 'start',
  position: 'relative',
  transition: 'box-shadow 220ms ease, background 220ms ease',
};

const titleStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink)',
  fontWeight: 500,
  letterSpacing: '-0.005em',
  lineHeight: 1.35,
  marginBottom: 3,
};

const metaStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.01em',
  marginBottom: 6,
};

const metaSepStyle: CSSProperties = {
  color: 'var(--ink-4)',
  margin: '0 6px',
};

const recStyle: CSSProperties = {
  fontSize: '14px',
  color: 'var(--ink-2)',
  fontStyle: 'italic',
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  lineHeight: 1.4,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 7,
};

const recDotStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: '50%',
  background: 'var(--terracotta)',
  marginTop: 8,
  flexShrink: 0,
};

// Accountability affordances (live rows only — guarded on QueueItem fields).
// Deliberately quiet: small, --ink-3/--ink-4, no new visual weight, so the
// calm operator console reads the same at a glance.

const boundaryStyle: CSSProperties = {
  marginTop: 7,
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.01em',
  lineHeight: 1.4,
  // Stack the owner-safety sentence above its quiet "owner approval required"
  // tag instead of competing on one flex line — the nowrap tag would
  // otherwise squeeze the sentence into a skinny 1-word-per-line column in
  // the narrow owner-review body.
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
};

const ownerRuleStyle: CSSProperties = {
  fontSize: '9.5px',
  color: 'var(--ink-4)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  whiteSpace: 'nowrap',
  flexShrink: 0,
};

const disclosureRowStyle: CSSProperties = {
  marginTop: 6,
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.01em',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const linkButtonStyle: CSSProperties = {
  font: 'inherit',
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationColor: 'var(--hairline-strong)',
  textUnderlineOffset: 2,
  letterSpacing: '0.01em',
};

const sourceLinkStyle: CSSProperties = {
  ...linkButtonStyle,
};

const reasonStyle: CSSProperties = {
  marginTop: 5,
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  fontStyle: 'italic',
  lineHeight: 1.4,
  letterSpacing: '0.01em',
};

const actionsStyle: CSSProperties = {
  // Fixed sub-grid so the timestamp and action buttons column-align
  // across every row regardless of label length. Order: time / primary
  // slot / secondary slot. Rows with only one action render an empty
  // placeholder in the primary slot so the single button still lands
  // in the rightmost (secondary) column.
  display: 'grid',
  gridTemplateColumns: '64px 88px 108px',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const timeStyle: CSSProperties = {
  fontSize: '11px',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  color: 'var(--ink-3)',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

const actionSlotStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'stretch',
};

const buttonBase: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '11.5px',
  fontWeight: 450,
  padding: '5px 11px',
  borderRadius: 6,
  border: '1px solid var(--hairline-strong)',
  background: 'var(--panel-lift)',
  color: 'var(--ink)',
  cursor: 'pointer',
  letterSpacing: '-0.003em',
};

const buttonPrimary: CSSProperties = {
  ...buttonBase,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

const SELECTED_STYLE: CSSProperties = {
  boxShadow: 'inset 3px 0 0 var(--terracotta)',
  background: 'var(--panel-lift)',
};

export function QueueRow({
  rowKey,
  status,
  title,
  meta,
  recommendation,
  time,
  actions,
  item,
  isSelected = false,
  onToggle,
}: QueueRowProps) {
  // Action handlers stub: log the action label so PR-3 can verify
  // click isolation without wiring real mutations. Replaced with
  // real handlers in a future PR.
  const handleAction = useCallback(
    (label: string) => (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      // Action handlers are stubbed until a future PR wires real
      // mutations. `console.log` is intentional for PR-3 verification
      // (Playwright spies on it to assert action clicks don't trigger
      // row selection). Replace with real handlers via the QueueItem
      // `primaryAction.handler` / `secondaryAction.handler` strings.
      console.log('[QueueRow] action', {
        row: rowKey,
        label,
        itemId: item?.id,
      });
    },
    [rowKey, item?.id],
  );

  const handleContainerClick = useCallback(() => {
    if (onToggle) {
      onToggle();
    }
  }, [onToggle]);

  const isInteractive = Boolean(onToggle);

  // Inline "Why this?" disclosure. Local-only; the reason copy is the
  // grounded `item.reason` string the adapter authored — never derived
  // or AI-voiced here.
  const [reasonOpen, setReasonOpen] = useState(false);

  const handleToggleReason = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      setReasonOpen((open) => !open);
    },
    [],
  );

  // Source link target: prefer the explicit evidence route, fall back to
  // the primary action handler (which is `item.href` for live rows).
  const sourceHref = item?.sourceHref ?? item?.primaryAction.handler ?? null;

  const rowStyle: CSSProperties = {
    ...rowBaseStyle,
    ...(isSelected ? SELECTED_STYLE : null),
    cursor: isInteractive ? 'pointer' : 'default',
  };

  // Keyboard access: the row is a focusable selection target. Enter/Space
  // toggle via the same handler clicks use (Space would otherwise scroll,
  // hence preventDefault); Escape-clears-selection already lives in the
  // global listener in today-interactions.tsx. The visible focus outline is
  // the existing `[data-queue-row]:focus` rule in globals.css.
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleContainerClick();
      }
    },
    [handleContainerClick],
  );

  const interactiveProps = isInteractive
    ? {
        role: 'group',
        tabIndex: 0,
        onClick: handleContainerClick,
        onKeyDown: handleKeyDown,
      }
    : {};

  return (
    <div
      data-queue-row={rowKey}
      data-selected={isSelected ? 'true' : 'false'}
      className="today-queue-row"
      style={rowStyle}
      {...interactiveProps}
    >
      <div className="today-queue-chip-slot">
        <QueueChip status={status} />
      </div>

      <div className="today-queue-body" style={{ minWidth: 0 }}>
        <div style={titleStyle}>{title}</div>
        <div style={metaStyle}>
          {meta.map((token, idx) => (
            <span key={idx}>
              {idx > 0 ? (
                <span aria-hidden="true" style={metaSepStyle}>
                  ·
                </span>
              ) : null}
              {token}
            </span>
          ))}
        </div>
        <div style={recStyle}>
          <span aria-hidden="true" style={recDotStyle} />
          <span>{recommendation}</span>
        </div>

        {item?.nextStep ? (
          <div style={boundaryStyle}>
            <span>{item.nextStep}</span>
            {item.ownerRule ? (
              <span style={ownerRuleStyle}>{item.ownerRule}</span>
            ) : null}
          </div>
        ) : null}

        {item?.ifIgnored ? (
          <div style={boundaryStyle}>
            <span>{item.ifIgnored}</span>
          </div>
        ) : null}

        {item?.reason || (item?.sourceLabel && sourceHref) ? (
          <div style={disclosureRowStyle}>
            {item?.reason ? (
              <button
                type="button"
                data-disclosure="why"
                style={linkButtonStyle}
                aria-expanded={reasonOpen}
                onClick={handleToggleReason}
              >
                Why this?
              </button>
            ) : null}
            {item?.sourceLabel && sourceHref ? (
              <Link
                href={sourceHref}
                data-source-link
                style={sourceLinkStyle}
                onClick={(e) => e.stopPropagation()}
              >
                {item.sourceLabel}
              </Link>
            ) : null}
          </div>
        ) : null}

        {item?.reason && reasonOpen ? (
          <div style={reasonStyle}>{item.reason}</div>
        ) : null}
      </div>

      <div
        className="today-queue-actions"
        style={
          actions.length === 0
            ? { ...actionsStyle, gridTemplateColumns: '64px' }
            : actionsStyle
        }
      >
        <span style={timeStyle} className="num">
          {time}
        </span>
        {actions.length === 1 ? <span aria-hidden="true" /> : null}
        {actions.map((action, index) => {
          // The primary (first) action navigates when its handler is a route
          // (live queue: `/review/<kind>/<id>`). Legacy mock handlers like
          // 'approve'/'send' are not routes and keep the click-log stub.
          const routeHref =
            index === 0 && item?.primaryAction.handler.startsWith('/')
              ? item.primaryAction.handler
              : null;
          const actionStyle: CSSProperties = {
            ...(action.variant === 'primary' ? buttonPrimary : buttonBase),
            width: '100%',
            boxSizing: 'border-box',
            textAlign: 'center',
            textDecoration: 'none',
            display: 'inline-block',
          };
          return (
            <div key={action.label} style={actionSlotStyle}>
              {routeHref ? (
                <Link
                  href={routeHref}
                  data-action="review"
                  data-action-slug={toKebab(action.label)}
                  style={actionStyle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  data-action={toKebab(action.label)}
                  style={actionStyle}
                  onClick={
                    isInteractive ? handleAction(action.label) : undefined
                  }
                >
                  {action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
