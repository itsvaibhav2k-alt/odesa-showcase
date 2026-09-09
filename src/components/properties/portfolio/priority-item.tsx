import type { CSSProperties } from 'react';
import type { PriorityItem as PriorityItemData } from '@/lib/properties/mock-portfolio';

/**
 * Single "needs attention" priority row.
 *
 * Presentational only — mirrors the mockup `.att-row` (odesa-properties4.html
 * lines 1212-1274) and the `renderAttention` markup (1698-1715).
 *
 * Accessibility contract (hard requirement): the row is an `<article>` (NEVER a
 * button) carrying the descriptive aria-label; the action `<button>`s are
 * SEPARATE interactive elements (no nested interactivity). The rank number and
 * status dot are decorative (aria-hidden). Each action button gets a specific
 * aria-label.
 *
 * The actions cluster is hidden by default and revealed on hover / focus-within
 * via opacity, but the buttons remain in the DOM and keyboard-focusable at all
 * times (see `<PriorityItemStyles>` co-located in the panel; this component
 * relies on the parent panel's `data-priority-row` scope).
 */

export interface PriorityItemProps {
  item: PriorityItemData;
  rank: number;
  onAction: (label: string) => void;
}

const DOT_COLOR: Record<PriorityItemData['dot'], string> = {
  clay: 'var(--clay)',
  amber: 'var(--amber)',
  neutral: 'var(--gold)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '13px 0',
  borderBottom: '1px solid var(--hairline-faint)',
};

const rankStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  width: 14,
  flexShrink: 0,
  paddingTop: 3,
};

const dotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
  marginTop: 5,
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const line1Style: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  marginBottom: 3,
};

const kindStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 500,
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
  whiteSpace: 'nowrap',
};

const locStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const detailStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  letterSpacing: '-0.003em',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 7,
  flexShrink: 0,
  paddingTop: 1,
};

const btnBase: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '11px',
  fontWeight: 450,
  padding: '5px 11px',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 5,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  letterSpacing: '-0.003em',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

export function PriorityItem({ item, rank, onAction }: PriorityItemProps) {
  return (
    <article
      data-testid={`priority-item-${item.id}`}
      data-priority-row
      aria-label={`${item.kind} at ${item.loc}. ${item.detail}`}
      style={rowStyle}
    >
      <span className="num" aria-hidden="true" style={rankStyle}>
        {rank}
      </span>
      <span aria-hidden="true" style={{ ...dotStyle, background: DOT_COLOR[item.dot] }} />

      <div style={bodyStyle}>
        <div style={line1Style}>
          <span style={kindStyle}>{item.kind}</span>
          <span style={locStyle}>{item.loc}</span>
        </div>
        <div style={detailStyle}>{item.detail}</div>
      </div>

      <span className="priority-actions" style={actionsStyle}>
        {item.actions.map((action) => (
          <button
            key={action.label}
            type="button"
            data-testid="priority-action"
            aria-label={`${action.label} — ${item.kind}, ${item.loc}`}
            onClick={() => onAction(action.label)}
            style={action.variant === 'primary' ? btnPrimary : btnBase}
          >
            {action.label}
          </button>
        ))}
      </span>
    </article>
  );
}
