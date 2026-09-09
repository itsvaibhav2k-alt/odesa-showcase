'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { UrgentItem } from '@/lib/today/queries';

/**
 * Top-5 urgent items across conversations, rent events, and work
 * orders. Rendered as a compact table-like list with:
 *
 * - left column: tenant + unit label
 * - middle: status chip (warm copy, no raw enums)
 * - right: outline action button + hover-revealed chevron
 *
 * Row hover: `paper-50` background via the shared
 * `.transition-row-hover` utility (180ms `--ease-smooth`).
 *
 * Phase 1 scope: rows are clickable but Inbox detail routing lands
 * with Agent E's shell. We still write sensible hrefs so the links
 * don't feel broken; the server will render the Inbox page's
 * default state when the query param doesn't match anything.
 */
export interface UrgentItemsFeedProps {
  items: UrgentItem[];
}

export function UrgentItemsFeed({ items }: UrgentItemsFeedProps) {
  if (items.length === 0) {
    return (
      <section
        data-testid="today-urgent-items"
        aria-labelledby="today-urgent-heading"
        style={{
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: 'var(--radius-md-odesa)',
          padding: '24px 28px',
        }}
      >
        <div className="flex items-baseline justify-between mb-4">
          <h3
            id="today-urgent-heading"
            className="font-serif-display"
            style={{
              fontSize: '18px',
              color: 'var(--ink-900)',
              letterSpacing: '-0.005em',
            }}
          >
            Urgent items
          </h3>
          <p className="meta-label">Top 5</p>
        </div>
        <p
          data-testid="today-urgent-items-empty"
          style={{
            fontSize: '14px',
            color: 'var(--ink-500)',
            fontStyle: 'italic',
            padding: '18px 0',
          }}
        >
          Nothing urgent right now. Odesa is watching.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="today-urgent-items"
      aria-labelledby="today-urgent-heading"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-md-odesa)',
        padding: '20px 0 8px',
      }}
    >
      <div
        className="flex items-baseline justify-between"
        style={{ padding: '0 24px 12px' }}
      >
        <h3
          id="today-urgent-heading"
          className="font-serif-display"
          style={{
            fontSize: '18px',
            color: 'var(--ink-900)',
            letterSpacing: '-0.005em',
          }}
        >
          Urgent items
        </h3>
        <p className="meta-label">Top {Math.min(items.length, 5)}</p>
      </div>
      <ul role="list" data-testid="today-urgent-items-list">
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <UrgentRow item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function UrgentRow({ item }: { item: UrgentItem }) {
  const label = tenantAndUnit(item);

  return (
    <Link
      href={item.href}
      data-testid={`today-urgent-row-${item.kind}-${item.id}`}
      data-urgent-kind={item.kind}
      className="group flex items-center gap-4 transition-row-hover"
      style={{
        padding: '14px 24px',
        borderTop: '1px solid var(--paper-200)',
        textDecoration: 'none',
        color: 'var(--ink-800)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--paper-50)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="truncate"
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--ink-800)',
          }}
        >
          {label.primary}
        </p>
        {label.secondary ? (
          <p
            className="truncate"
            style={{ fontSize: '12px', color: 'var(--ink-500)' }}
          >
            {label.secondary}
          </p>
        ) : null}
      </div>
      <div
        data-testid={`today-urgent-row-${item.id}-status`}
        style={{
          fontSize: '12px',
          color: 'var(--ink-600)',
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {item.statusLabel}
      </div>
      <div
        className="flex items-center gap-2"
        style={{ whiteSpace: 'nowrap' }}
      >
        <span
          data-testid={`today-urgent-row-${item.id}-action`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm-odesa)',
            border: '1px solid var(--navy-700)',
            color: 'var(--navy-700)',
            background: 'transparent',
            fontSize: '12px',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {actionLabelFor(item.kind)}
        </span>
        <span
          data-testid={`today-urgent-row-${item.id}-chevron`}
          className="opacity-0 group-hover:opacity-100"
          style={{
            color: 'var(--ink-500)',
            display: 'inline-flex',
            transition: 'opacity 180ms var(--ease-smooth)',
          }}
          aria-hidden="true"
        >
          <ChevronRight size={16} />
        </span>
      </div>
    </Link>
  );
}

function tenantAndUnit(item: UrgentItem): { primary: string; secondary: string | null } {
  const tenant = item.tenantName?.trim() || 'Unknown tenant';
  const unit = item.unitLabel?.trim();
  const primary = unit ? `${tenant} — Unit ${unit}` : tenant;
  const secondary = kindLabel(item.kind);
  return { primary, secondary };
}

function kindLabel(kind: UrgentItem['kind']): string {
  switch (kind) {
    case 'conversation':
      return 'Conversation';
    case 'rent':
      return 'Rent';
    case 'work_order':
      return 'Work order';
  }
}

function actionLabelFor(kind: UrgentItem['kind']): string {
  switch (kind) {
    case 'conversation':
      return 'Review';
    case 'rent':
      return 'Resolve';
    case 'work_order':
      return 'Dispatch';
  }
}
