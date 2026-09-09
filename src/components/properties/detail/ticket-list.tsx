/**
 * TicketList — maintenance ticket reference list for the unit detail page.
 *
 * Each row is an <article> with a SINGLE overlay link to /work-orders/<woId>.
 * No nested interactive elements. Status via DetailBadge; priority via inline
 * dot+label (never color-only). Mirrors the mockup's .tickets / .ticket-row /
 * .ticket-link / .ticket-icon / .ticket-body / .ticket-meta pattern exactly.
 */

import type { CSSProperties } from 'react';
import type { MaintenanceRef, Urgency } from '@/lib/properties/mock-detail';
import { workOrderHref } from '@/lib/properties/hrefs';
import { DetailBadge } from './detail-badge';

export interface TicketListProps {
  items: MaintenanceRef[];
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 13,
  padding: '13px 0',
  borderBottom: '1px solid var(--hairline-faint)',
  position: 'relative',
};

const overlayLinkStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  // Above the position:relative content cells so a click anywhere on the row
  // hits the (transparent) link rather than the text — matches the working
  // overlay pattern in appliances-registry.
  zIndex: 1,
};

const cellRelStyle: CSSProperties = { position: 'relative' };

const iconBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  color: 'var(--terracotta)',
  paddingTop: 2,
  width: 14,
  flexShrink: 0,
  fontSize: 12,
  position: 'relative',
};

const iconCalmStyle: CSSProperties = {
  ...iconBaseStyle,
  color: 'var(--green)',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  position: 'relative',
};

const titleStyle: CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 500,
  color: 'var(--ink)',
};

const subWrapStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-2)',
  marginTop: 2,
};

const woChipStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginRight: 8,
};

const metaStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  flexShrink: 0,
  position: 'relative',
};

const prioDotColors: Record<Urgency, string> = {
  urgent: 'var(--clay)',
  high: 'var(--amber)',
  normal: 'var(--gold)',
  low: 'var(--ink-4)',
};

const prioLabels: Record<Urgency, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

const prioWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
};

const prioDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
};

export function TicketList({ items }: TicketListProps) {
  return (
    <>
      <div style={listStyle} data-ticket-list>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const finalRowStyle: CSSProperties = {
            ...rowStyle,
            ...(isLast ? { borderBottom: 'none' } : {}),
          };

          return (
            <article
              key={item.wo}
              style={finalRowStyle}
              aria-label={item.ariaLabel}
              data-testid={`wo-row-${item.wo}`}
            >
              {/* Single overlay link — links to the work order */}
              <a
                href={workOrderHref(item.woId ?? item.wo)}
                aria-label={item.ariaLabel}
                style={overlayLinkStyle}
                className="ticket-link"
                tabIndex={0}
              />

              {/* Status icon — ◆ terracotta or ✓ green; always aria-hidden */}
              <span
                aria-hidden="true"
                style={item.calm ? iconCalmStyle : iconBaseStyle}
              >
                {item.calm ? '✓' : '◆'}
              </span>

              {/* Body: title + sub */}
              <div style={bodyStyle}>
                <div style={titleStyle}>{item.title}</div>
                <div style={subWrapStyle}>
                  <span style={woChipStyle}>{item.wo}</span>
                  {item.sub}
                </div>
              </div>

              {/* Meta: badge + optional priority dot+label */}
              <div style={metaStyle}>
                <div style={cellRelStyle}>
                  <DetailBadge variant={item.badge.variant} label={item.badge.label} />
                </div>
                {item.prio && (
                  <div style={cellRelStyle}>
                    <span style={prioWrapStyle}>
                      <span
                        aria-hidden="true"
                        style={{
                          ...prioDotStyle,
                          background: prioDotColors[item.prio],
                        }}
                      />
                      {prioLabels[item.prio]}
                    </span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <TicketListStyles />
    </>
  );
}

function TicketListStyles() {
  return (
    <style precedence="ticket-list">{`
      .ticket-link:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
        border-radius: 6px;
      }
    `}</style>
  );
}
