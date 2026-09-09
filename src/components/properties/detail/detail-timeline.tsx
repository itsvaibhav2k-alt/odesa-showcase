/**
 * DetailTimeline — vertical timeline for payment and work-order sequences.
 *
 * Mirrors the mockup `.timeline` / `.event` / `.event-time` / `.event-marker`
 * / `.edot` / `.event-line` / `.actor` structure. The connector line between
 * events is rendered via a CSS ::after pseudo-element on each non-last event
 * row. Dots are aria-hidden. Actor labels render in mono; Odesa actor renders
 * in terracotta. Future events render faded.
 *
 * Used by: tenant payment timeline (TenantDetailMock.timeline) and
 * work-order activity timeline (WorkOrderMock.timeline).
 */

import type { CSSProperties } from 'react';
import type { TimelineEvent } from '@/lib/properties/mock-detail';

export interface DetailTimelineProps {
  events: TimelineEvent[];
}

const timelineStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const eventStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '72px 16px minmax(0, 1fr)',
  padding: '11px 0',
  position: 'relative',
};

const timeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  color: 'var(--ink-2)',
  paddingTop: 1,
};

const markerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
};

const DOT_STYLES: Record<TimelineEvent['variant'], CSSProperties> = {
  tenant: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--ink)',
    border: '2px solid var(--panel-clean)',
    marginTop: 6,
    boxSizing: 'content-box',
  },
  odesa: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--terracotta)',
    border: '2px solid var(--panel-clean)',
    marginTop: 6,
    boxSizing: 'content-box',
  },
  future: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--panel-clean)',
    boxShadow: 'inset 0 0 0 1.5px var(--amber)',
    border: '2px solid var(--panel-clean)',
    marginTop: 6,
    boxSizing: 'content-box',
  },
  neutral: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--ink-4)',
    border: '2px solid var(--panel-clean)',
    marginTop: 6,
    boxSizing: 'content-box',
  },
};

const lineStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ink)',
  lineHeight: 1.5,
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const futureLineStyle: CSSProperties = {
  ...lineStyle,
  color: 'var(--ink-3)',
};

const actorBaseStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
  marginRight: 10,
};

const actorOdesaStyle: CSSProperties = {
  ...actorBaseStyle,
  color: 'var(--terracotta)',
};

export function DetailTimeline({ events }: DetailTimelineProps) {
  return (
    <div style={timelineStyle} data-detail-timeline>
      {events.map((event, idx) => {
        const isLast = idx === events.length - 1;
        const isFuture = event.variant === 'future';
        const isOdesa = event.variant === 'odesa';

        return (
          <div
            key={idx}
            style={eventStyle}
            data-tl-event
            data-tl-last={isLast ? '' : undefined}
          >
            <span style={timeStyle}>{event.time}</span>

            <span aria-hidden="true" style={markerStyle}>
              <span style={DOT_STYLES[event.variant]} />
            </span>

            <div style={isFuture ? futureLineStyle : lineStyle}>
              {event.actor && (
                <span style={isOdesa ? actorOdesaStyle : actorBaseStyle}>
                  {event.actor}
                </span>
              )}
              {event.line}
            </div>
          </div>
        );
      })}

      <DetailTimelineStyles />
    </div>
  );
}

function DetailTimelineStyles() {
  return (
    <style precedence="detail-timeline">{`
      [data-detail-timeline] [data-tl-event]:not([data-tl-last])::after {
        content: '';
        position: absolute;
        left: 79px;
        top: 24px;
        bottom: -11px;
        width: 1px;
        background: var(--hairline-faint);
      }
    `}</style>
  );
}
