import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { PriorityItem as PriorityItemData } from '@/lib/properties/mock-portfolio';
import { openItemsHref } from '@/lib/properties/mock-portfolio-views';
import { PriorityItem } from './priority-item';

/**
 * "Needs attention" priority panel.
 *
 * Presentational only — mirrors the mockup `.attention` + `.attention-head`
 * (odesa-properties4.html styles 1135-1173, markup 1604-1613): a bordered
 * panel with a head row (mono label + mono count + spacer + a real "View all
 * open items" link) over a list of priority rows.
 *
 * The only interactive elements are the head's "view all" link (to the
 * `/open-items` list) and each priority row's action buttons (the row itself is
 * a non-interactive `<article>`). The hover/focus-within action reveal and the
 * visible focus rings live in `<NeedsAttentionStyles>`, co-located so the panel
 * is self-contained.
 */

export interface NeedsAttentionPanelProps {
  items: PriorityItemData[];
  onAction: (itemId: string, label: string) => void;
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'var(--panel-lift)',
  padding: '4px 18px 8px',
  marginBottom: 24,
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  // Wrap the "View all" control below the label/count on narrow viewports
  // rather than overflowing the panel width.
  flexWrap: 'wrap',
  gap: 11,
  rowGap: 6,
  padding: '13px 0 11px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11.5px',
  fontWeight: 500,
  letterSpacing: '0.13em',
  textTransform: 'uppercase',
  color: 'var(--ink)',
};

const countStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11.5px',
  color: 'var(--ink-2)',
};

const spacerStyle: CSSProperties = {
  flex: 1,
};

const viewAllStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: '2px 0',
  textDecoration: 'none',
};

export function NeedsAttentionPanel({
  items,
  onAction,
}: NeedsAttentionPanelProps) {
  const propertyCount = new Set(items.map((item) => item.loc.split(' · ')[0])).size;

  return (
    <div data-testid="needs-attention-panel" data-attention-panel style={panelStyle}>
      <div style={headStyle}>
        <span style={labelStyle}>Needs attention</span>
        <span className="num" style={countStyle}>
          {items.length} priority items · {propertyCount} properties
        </span>
        <span style={spacerStyle} />
        <Link
          href={openItemsHref()}
          data-testid="view-all-open-items"
          className="attention-view-all"
          style={viewAllStyle}
        >
          View all open items →
        </Link>
      </div>

      <div>
        {items.map((item, index) => (
          <PriorityItem
            key={item.id}
            item={item}
            rank={index + 1}
            onAction={(label) => onAction(item.id, label)}
          />
        ))}
      </div>

      <NeedsAttentionStyles />
    </div>
  );
}

/**
 * Hoisted scoped styles (mirrors the SidebarStyles pattern). Drives the
 * affordances inline styles cannot express:
 *  - last priority row drops its bottom hairline,
 *  - priority-row hover bleed + action reveal (actions stay in the DOM and
 *    keyboard-focusable; only their opacity animates),
 *  - action-button hover border emphasis + the inked primary variant hover,
 *  - visible terracotta focus rings on every interactive control.
 */
function NeedsAttentionStyles() {
  return (
    <style>{`
      [data-attention-panel] [data-priority-row]:last-child {
        border-bottom: none;
      }
      [data-attention-panel] [data-priority-row]:hover {
        background: var(--panel-clean);
        margin: 0 -18px;
        padding-left: 18px;
        padding-right: 18px;
      }
      [data-attention-panel] .priority-actions {
        opacity: 0;
        transition: opacity 130ms ease;
      }
      [data-attention-panel] [data-priority-row]:hover .priority-actions,
      [data-attention-panel] [data-priority-row]:focus-within .priority-actions {
        opacity: 1;
      }
      [data-attention-panel] [data-testid="priority-action"]:hover {
        border-color: var(--ink-3);
      }
      [data-attention-panel] .attention-view-all:hover {
        color: var(--ink);
      }
      [data-attention-panel] button:focus-visible,
      [data-attention-panel] a:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
        border-radius: 3px;
      }
      @media (max-width: 680px) {
        [data-attention-panel] [data-priority-row] { flex-wrap: wrap; }
        [data-attention-panel] .priority-actions { opacity: 1; }
      }
    `}</style>
  );
}
