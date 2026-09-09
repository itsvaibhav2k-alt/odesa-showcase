/**
 * Dev-only preview of the PortfolioHealthChart in its populated state.
 *
 * Reachable at /dev/chart-preview (public-route, no auth) so you can
 * see what the chart looks like with real 4-week history without
 * having to sign in as a seeded Galaxy owner. Synthetic data only —
 * never reads the database.
 */

import { notFound } from 'next/navigation';

import { ChartPreviewBoard } from './chart-preview-board';

export default function ChartPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--paper-100)',
        padding: '48px 24px',
      }}
    >
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: 'var(--font-serif-display)',
            fontSize: '32px',
            margin: 0,
            marginBottom: '8px',
            color: 'var(--ink-900)',
          }}
        >
          Portfolio Health Chart — Preview
        </h1>
        <p
          style={{
            color: 'var(--ink-600)',
            fontSize: '14px',
            margin: 0,
            marginBottom: '32px',
            maxWidth: '640px',
          }}
        >
          Three states side-by-side. Synthetic data. This page only
          renders outside production builds.
        </p>

        <ChartPreviewBoard />
      </div>
    </main>
  );
}
