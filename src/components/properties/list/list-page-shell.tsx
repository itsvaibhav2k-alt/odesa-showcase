/**
 * ListPageShell — shared chrome wrapper for all portfolio list pages.
 *
 * Composes:
 *   - .today-theme wrapper (activates warm CSS custom-property palette)
 *   - DetailGlobalBar (sticky breadcrumb + freshness)
 *   - Title block (mono eyebrow + serif h1 + optional meta line)
 *   - ListPageTabs (portfolio-level navigation tab bar)
 *   - .content / .wrap content area (maxWidth 1000px, matching mockup)
 *
 * Ask bar and page-specific filters are passed as children so each list page
 * stays in control of its own interactive islands.
 *
 * Server component — all interactivity is owned by children.
 */

import type { CSSProperties, ReactNode } from 'react';
import { DetailGlobalBar, type BreadcrumbItem } from '@/components/properties/detail/detail-global-bar';
import { getPortfolioTabCounts } from '@/lib/shell/nav-counts';
import { ListPageTabs, type ListTabId } from './list-page-tabs';

export interface ListPageShellProps {
  /** Breadcrumb items forwarded to DetailGlobalBar. Last item is the current page. */
  breadcrumb: BreadcrumbItem[];
  /** Mono uppercase eyebrow above the h1, e.g. "Portfolio". */
  eyebrow: string;
  /** Serif italic page title. */
  title: string;
  /** Optional mono meta segments joined by middots, e.g. ["17 tenants", "17 of 18 units occupied"]. */
  titleMeta?: string[];
  /** Which tab is currently active. Omit to render the shell without the tab bar (e.g. /settings). */
  activeTab?: ListTabId;
  /** Optional action rendered at the right edge of the title row (e.g. an upload pill). */
  titleAction?: ReactNode;
  /** Page body: filter bar, list, ask bar, etc. */
  children: ReactNode;
  /** Optional typography override for pages that should match the global app font stack. */
  typography?: 'operator' | 'site';
  /** Optional wider working canvas for dense operator surfaces such as Calls. */
  maxWidth?: number;
  /** Optional content background token override (defaults to the clean panel). */
  background?: string;
  /** VA list hierarchy hides owner-only financial navigation. */
  audience?: 'owner' | 'va';
}

const themWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  // Fill to the viewport bottom (minus the 56px TopBar / h-14) so the cream
  // content panel stretches on short pages — without this the non-flex
  // .dot-grid-bg parent leaves a dead dotted-grid canvas below /vendors,/rent.
  minHeight: 'calc(100dvh - 56px)',
};

const contentStyle: CSSProperties = {
  background: 'var(--panel-clean)',
  flex: 1,
  padding: '28px 0 30px',
};

const wrapStyle: CSSProperties = {
  maxWidth: 1000,
  margin: '0 auto',
  padding: '0 36px',
};

const titleBlockStyle: CSSProperties = {
  marginBottom: 24,
};

const eyebrowStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 8,
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
};

const h1Style: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: '34px',
  letterSpacing: '-0.02em',
  lineHeight: 1,
  color: 'var(--ink)',
};

const metaStyle: CSSProperties = {
  marginTop: 11,
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.04em',
  color: 'var(--ink-2)',
  textTransform: 'uppercase',
};

const metaSepStyle: CSSProperties = {
  color: 'var(--ink-4)',
  margin: '0 8px',
};

export async function ListPageShell({
  breadcrumb,
  eyebrow,
  title,
  titleMeta,
  activeTab,
  titleAction,
  children,
  typography = 'operator',
  maxWidth = 1000,
  background = 'var(--panel-clean)',
  audience = 'owner',
}: ListPageShellProps) {
  // Counts only feed the tab bar; skip the query entirely when it isn't rendered.
  const counts = activeTab ? await getPortfolioTabCounts() : undefined;
  const useSiteTypography = typography === 'site';
  const pageEyebrowStyle = useSiteTypography
    ? { ...eyebrowStyle, fontFamily: 'var(--font-mono), ui-monospace, monospace' }
    : eyebrowStyle;
  const pageH1Style = useSiteTypography
    ? {
        ...h1Style,
        fontFamily: 'var(--font-display), var(--font-sans), system-ui, sans-serif',
        fontStyle: 'normal',
        fontWeight: 700,
      }
    : h1Style;
  const pageMetaStyle = useSiteTypography
    ? { ...metaStyle, fontFamily: 'var(--font-mono), ui-monospace, monospace' }
    : metaStyle;

  return (
    <div className="today-theme" style={themWrapStyle} data-testid="list-page-shell">
      <DetailGlobalBar
        crumbs={breadcrumb}
        freshnessText="Data current · refreshed on open"
      />

      <main className="content" style={{ ...contentStyle, background }}>
        <div style={{ ...wrapStyle, maxWidth }}>
          {/* Title block */}
          <div style={titleBlockStyle}>
            <span style={pageEyebrowStyle}>{eyebrow}</span>

            <div style={titleRowStyle}>
              <h1 style={pageH1Style}>{title}</h1>
              {titleAction ? (
                <div style={{ marginLeft: 'auto' }}>{titleAction}</div>
              ) : null}
            </div>

            {titleMeta && titleMeta.length > 0 ? (
              <div style={pageMetaStyle}>
                {titleMeta.map((segment, idx) => (
                  <span key={idx}>
                    {idx > 0 ? (
                      <span aria-hidden="true" style={metaSepStyle}>
                        ·
                      </span>
                    ) : null}
                    {segment}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* Tab bar — omitted on pages outside the portfolio nav (e.g. /settings) */}
          {activeTab ? (
            <ListPageTabs
              active={activeTab}
              counts={counts}
              audience={audience}
            />
          ) : null}

          {/* Page-specific content: filters, list, ask bar */}
          {children}
        </div>
      </main>
    </div>
  );
}
