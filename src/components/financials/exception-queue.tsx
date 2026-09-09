/**
 * ExceptionQueue — the deterministic, severity-sorted financial
 * exception list for `/financials`.
 *
 * Server component, warm palette. Each row shows: a severity chip, the
 * property it concerns, the money at stake (when money-shaped), a plain
 * "why" line, the recommended NEXT action, and contextual links into the
 * operator surfaces (outstanding rent, owner queue, the exact property).
 *
 * Honest by construction: amounts come straight from the typed summary
 * (integer cents → `formatMoneyCents`); a `—` shows when an exception is
 * not money-shaped. No money is moved — every action is review/queue/draft.
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';

import { StatusChip } from '@/components/shared/status-chip';
import { formatMoneyCents } from '@/lib/financials/format';
import type { FinancialException } from '@/lib/financials/types';
import { propertyHref } from '@/lib/properties/hrefs';

import { severityTone } from './tone';

export interface ExceptionQueueProps {
  exceptions: FinancialException[];
}

interface QueueLink {
  label: string;
  href: string;
}

/**
 * Contextual operator-surface links for an exception (no money movement).
 * Money-shaped exceptions go straight to the outstanding rent view + owner
 * queue; property-scoped exceptions (vacancy) open the exact property.
 * Empty result = no honest destination exists (the expense-imports row) —
 * the queue renders a muted "Not connected" chip instead of a fake link.
 */
function linksForException(exception: FinancialException): QueueLink[] {
  switch (exception.source) {
    case 'rent':
    case 'payment':
      return [
        { label: 'Open outstanding rent', href: '/rent?filter=outstanding' },
        { label: 'Owner Queue', href: '/owner-queue' },
      ];
    default:
      return exception.propertyId
        ? [{ label: 'Open property', href: propertyHref(exception.propertyId) }]
        : [];
  }
}

const listStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  overflow: 'hidden',
  background: 'var(--panel-lift)',
};

const rowStyle: CSSProperties = {
  padding: '15px 18px',
  borderBottom: '1px solid var(--hairline-faint)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const headRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const titleStyle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--ink)',
};

const propertyStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const amountStyle: CSSProperties = {
  marginLeft: 'auto',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '15px',
  color: 'var(--clay)',
  fontFeatureSettings: "'tnum' 1",
};

const detailStyle: CSSProperties = {
  fontSize: '12.5px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
};

const actionStyle: CSSProperties = {
  fontSize: '12.5px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
};

const actionLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginRight: 6,
};

const linksRowStyle: CSSProperties = {
  display: 'flex',
  gap: 14,
  flexWrap: 'wrap',
};

const linkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.04em',
  color: 'var(--terracotta)',
  textDecoration: 'none',
};

const notConnectedChipStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.04em',
  color: 'var(--ink-3)',
  border: '1px solid var(--hairline)',
  borderRadius: 999,
  padding: '2px 9px',
  alignSelf: 'flex-start',
};

const emptyStyle: CSSProperties = {
  padding: '28px 18px',
  textAlign: 'center',
  fontSize: '13px',
  color: 'var(--ink-3)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'var(--panel-lift)',
};

export function ExceptionQueue({ exceptions }: ExceptionQueueProps) {
  if (exceptions.length === 0) {
    return (
      <div style={emptyStyle} data-testid="financial-exception-queue-empty">
        Nothing needs attention — collections are on track and no money exceptions are open.
      </div>
    );
  }

  return (
    <div style={listStyle} data-testid="financial-exception-queue">
      {exceptions.map((exception, idx) => {
        const tone = severityTone(exception.severity);
        const isLast = idx === exceptions.length - 1;
        const links = linksForException(exception);
        return (
          <div
            key={exception.id}
            style={isLast ? { ...rowStyle, borderBottom: 'none' } : rowStyle}
            data-testid="financial-exception-row"
          >
            <div style={headRowStyle}>
              <StatusChip tone={tone.tone} label={tone.label} />
              <span style={titleStyle}>{exception.title}</span>
              {exception.propertyName ? (
                <span style={propertyStyle}>{exception.propertyName}</span>
              ) : null}
              {exception.amountCents !== undefined ? (
                <span style={amountStyle}>{formatMoneyCents(exception.amountCents)}</span>
              ) : null}
            </div>

            <p style={detailStyle}>{exception.detail}</p>

            <p style={actionStyle}>
              <span style={actionLabelStyle}>Recommended</span>
              {exception.recommendedAction}
            </p>

            {links.length > 0 ? (
              <div style={linksRowStyle}>
                {links.map((link) => (
                  <Link key={link.href + link.label} href={link.href} style={linkStyle}>
                    {link.label} →
                  </Link>
                ))}
              </div>
            ) : (
              <span style={notConnectedChipStyle}>Not connected</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
