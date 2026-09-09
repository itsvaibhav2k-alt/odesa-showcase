/**
 * Portfolio facet tabs.
 *
 * Reproduces the locked mockup's `.ptab-bar` / `.ptab`: a bottom-bordered row of
 * tabs, each showing a label and an optional mono count. The active tab gets
 * inked text and a terracotta underline (the mockup's `::after` bar, rendered
 * here as an absolutely-positioned span) and carries `aria-current="page"`.
 *
 * Overview is the in-page command center: it renders as a real tab `<button>`
 * and selection is lifted to the parent via `onSelect`. The remaining facets
 * (Tenants / Rent / Vendors / Documents) are real list routes, so they render
 * as Next `<Link>`s that navigate away — a tab is treated as a navigation link
 * when its spec carries an `href`.
 *
 * Each control receives a deterministic `data-testid` (`portfolio-tab-{id}`) for
 * the page's test contract. Colors come entirely from the warm CSS custom
 * properties (no hardcoded hex).
 */

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { PortfolioTab } from '@/lib/properties/mock-portfolio';

/** A tab spec plus an optional route — when present the tab navigates. */
export interface PortfolioTabSpec extends PortfolioTab {
  /** Destination route for navigation tabs (omit for the in-page Overview). */
  href?: string;
}

export interface PortfolioTabsProps {
  /** Facet tabs to render, in order. */
  tabs: PortfolioTabSpec[];
  /** Id of the currently active in-page tab (always `overview` here). */
  activeId: string;
  /** Called with a tab id when a non-navigating tab is selected. */
  onSelect: (id: string) => void;
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  // Wrap to a second line on narrow viewports instead of forcing the page
  // wider than the screen (5 tabs ~ 515px would overflow a phone).
  flexWrap: 'wrap',
  gap: 4,
  borderBottom: '1px solid var(--hairline)',
  marginBottom: 26,
};

const tabBaseStyle: CSSProperties = {
  position: 'relative',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '13px',
  padding: '10px 14px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  letterSpacing: '-0.005em',
  textDecoration: 'none',
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

function TabInner({ tab, isActive }: { tab: PortfolioTabSpec; isActive: boolean }): ReactNode {
  return (
    <>
      {tab.label}
      {tab.count !== undefined ? (
        <span className="num" style={countStyle}>
          {tab.count}
        </span>
      ) : null}
      {isActive ? <span aria-hidden="true" style={underlineStyle} /> : null}
    </>
  );
}

export function PortfolioTabs({ tabs, activeId, onSelect }: PortfolioTabsProps) {
  return (
    <div data-testid="portfolio-tabs" style={barStyle}>
      {tabs.map((tab) => {
        const isActive = activeId === tab.id;
        const tabStyle: CSSProperties = {
          ...tabBaseStyle,
          color: isActive ? 'var(--ink)' : 'var(--ink-3)',
          fontWeight: isActive ? 450 : 400,
        };

        // Navigation tab — drills into a real list route.
        if (tab.href) {
          return (
            <Link
              key={tab.id}
              href={tab.href}
              data-testid={`portfolio-tab-${tab.id}`}
              aria-current={isActive ? 'page' : undefined}
              style={tabStyle}
            >
              <TabInner tab={tab} isActive={isActive} />
            </Link>
          );
        }

        // In-page tab — selects the command-center Overview view.
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={`portfolio-tab-${tab.id}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(tab.id)}
            style={tabStyle}
          >
            <TabInner tab={tab} isActive={isActive} />
          </button>
        );
      })}
    </div>
  );
}
