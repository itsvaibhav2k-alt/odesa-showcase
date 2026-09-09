/**
 * ListPageTabs — portfolio-level tab bar for list routes.
 *
 * Renders the mockup's `.ptab-bar` as real Next <Link>s (not buttons), since
 * each tab is a distinct navigable route. Mirrors the portfolio-tabs.tsx
 * visual idiom: terracotta underline on active, `aria-current="page"`, mono
 * count badge. All tabs are navigation landmarks, not ARIA tab roles, because
 * they perform full navigation (not in-page switching).
 *
 * Server component — no interactivity.
 */

import type { CSSProperties } from 'react';
import Link from 'next/link';

export type ListTabId = 'overview' | 'tenants' | 'rent' | 'vendors' | 'documents';

interface TabDef {
  id: ListTabId;
  label: string;
  href: string;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', href: '/properties' },
  { id: 'tenants', label: 'Tenants', href: '/tenants' },
  { id: 'vendors', label: 'Vendors', href: '/vendors' },
  { id: 'rent', label: 'Rent', href: '/rent' },
  { id: 'documents', label: 'Documents', href: '/documents' },
];

/** Live RLS-scoped counts keyed by tab id. Absent values hide the badge. */
export interface ListTabCounts {
  tenants?: number;
  vendors?: number;
  documents?: number;
}

export interface ListPageTabsProps {
  active: ListTabId;
  /** Live counts for the count-bearing tabs; absent values hide the badge. */
  counts?: ListTabCounts;
  audience?: 'owner' | 'va';
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  borderBottom: '1px solid var(--hairline)',
  marginBottom: 16,
};

const tabBaseStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '13px',
  letterSpacing: '-0.005em',
  padding: '10px 14px',
  textDecoration: 'none',
  borderRadius: '4px 4px 0 0',
};

const countStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  color: 'var(--ink-3)',
  marginLeft: 7,
};

const underlineStyle: CSSProperties = {
  position: 'absolute',
  left: 14,
  right: 14,
  bottom: -1,
  height: 2,
  background: 'var(--terracotta)',
  borderRadius: '2px 2px 0 0',
};

export function ListPageTabs({
  active,
  counts,
  audience = 'owner',
}: ListPageTabsProps) {
  const visibleTabs =
    audience === 'va' ? TABS.filter((tab) => tab.id !== 'rent') : TABS;

  return (
    <>
      <nav
        aria-label="Portfolio sections"
        data-testid="list-page-tabs"
        style={barStyle}
      >
        {visibleTabs.map((tab) => {
          const isActive = active === tab.id;
          const count =
            tab.id === 'tenants'
              ? counts?.tenants
              : tab.id === 'vendors'
                ? counts?.vendors
                : tab.id === 'documents'
                  ? counts?.documents
                  : undefined;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-testid={`list-tab-${tab.id}`}
              aria-current={isActive ? 'page' : undefined}
              className="list-page-tab"
              style={{
                ...tabBaseStyle,
                color: isActive ? 'var(--ink)' : 'var(--ink-3)',
                fontWeight: isActive ? 450 : 400,
              }}
            >
              {tab.label}
              {count !== undefined ? (
                <span className="num" style={countStyle}>
                  {count}
                </span>
              ) : null}
              {isActive ? <span aria-hidden="true" style={underlineStyle} /> : null}
            </Link>
          );
        })}
      </nav>
      <ListPageTabsStyles />
    </>
  );
}

function ListPageTabsStyles() {
  return (
    <style precedence="list-page-tabs">{`
      .list-page-tab:hover {
        color: var(--ink);
        background: var(--canvas-deep);
      }
      .list-page-tab:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 1px;
      }
    `}</style>
  );
}
