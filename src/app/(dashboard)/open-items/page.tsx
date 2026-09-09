/**
 * /open-items — standalone portfolio "Open items" list view.
 *
 * Reached from the command center's "View all open items" affordance (NOT a
 * portfolio tab), so this page renders its own chrome — DetailGlobalBar +
 * title block — instead of the tabbed ListPageShell. Composes:
 *   - DetailGlobalBar — Portfolio / Open items breadcrumb + freshness
 *   - OpenItemsFilterList — Filter island + filtered open-item rows
 *   - AskOdesaBar — scoped "Ask Odesa about open items…" bar
 *
 * Each row's primary action drills into its detail page or /owner-queue (hrefs
 * baked into the mock rows). Server component; force-dynamic so the freshness
 * line and any future live lookups never get statically cached.
 */

import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { DetailGlobalBar } from '@/components/properties/detail/detail-global-bar';
import { AskOdesaBar } from '@/components/properties/detail/ask-odesa-bar';
import { listOpenItems } from '@/lib/open-items/queries';
import { OpenItemsFilterList } from './open-items-filter-list';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Open items · Odesa',
};

const ASK_PROMPTS: string[] = [
  'What’s most urgent?',
  'Group by property',
  'Which need an owner decision?',
  'Summarize for the owner',
  'What can wait?',
];

const themeWrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
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

export default async function OpenItemsPage() {
  const { header, facets, rows } = await listOpenItems();
  const metaSegments = header.summary.split(' · ');

  return (
    <div className="today-theme" style={themeWrapStyle} data-testid="open-items-page">
      <DetailGlobalBar
        crumbs={[{ label: 'Portfolio', href: '/properties' }, { label: 'Open items' }]}
        freshnessText="Data current · refreshed on open"
      />

      {/* Labeled region, not <main> — the dashboard layout owns the sole main landmark. */}
      <section className="content" aria-label="Open items" style={contentStyle}>
        <div style={wrapStyle}>
          <div style={titleBlockStyle}>
            <span style={eyebrowStyle}>Open items</span>

            <div style={titleRowStyle}>
              <h1 style={h1Style}>Open items</h1>
            </div>

            <div style={metaStyle}>
              {metaSegments.map((segment, idx) => (
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
          </div>

          <OpenItemsFilterList facets={facets} rows={rows} />

          <AskOdesaBar
            scopeLabel="Open items"
            placeholder="Ask Odesa about open items…"
            prompts={ASK_PROMPTS}
          />
        </div>
      </section>
    </div>
  );
}
