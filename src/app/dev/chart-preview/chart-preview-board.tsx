'use client';

import * as React from 'react';

import { PortfolioHealthChart } from '@/components/today/portfolio-health-chart';
import type { TodayKpis, TodayKpiDeltas } from '@/lib/today/queries';
import type { WeekSnapshot } from '@/app/api/today/kpi-history/route';

const HEALTHY_HISTORY: WeekSnapshot[] = [
  { weekLabel: 'Apr 22', weekStart: '2026-04-15T00:00:00Z', weekEnd: '2026-04-22T00:00:00Z', occupancyPct: 87.5, rentCollectedCents: 1_185_000 },
  { weekLabel: 'Apr 29', weekStart: '2026-04-22T00:00:00Z', weekEnd: '2026-04-29T00:00:00Z', occupancyPct: 95.0, rentCollectedCents: 1_286_500 },
  { weekLabel: 'May 6',  weekStart: '2026-04-29T00:00:00Z', weekEnd: '2026-05-06T00:00:00Z', occupancyPct: 91.7, rentCollectedCents: 1_241_000 },
  { weekLabel: 'May 13', weekStart: '2026-05-06T00:00:00Z', weekEnd: '2026-05-13T00:00:00Z', occupancyPct: 100.0, rentCollectedCents: 1_302_500 },
];

const HEALTHY_KPIS: TodayKpis = {
  occupancyPct: 100,
  rentCollectedCents: 1_302_500,
  rentDueCents: 1_302_500,
  openWorkOrdersCount: 2,
  lateTenantsCount: 1,
  stripeRentCollectedThisMonthCents: 845_000,
  lateBalanceCents: 95_000,
};

const HEALTHY_DELTAS: TodayKpiDeltas = {
  occupancyPct: 8.3,
  rentCollectedCents: 61_500,
  openWorkOrdersCount: -1,
  lateTenantsCount: 0,
};

const VOLATILE_HISTORY: WeekSnapshot[] = [
  { weekLabel: 'Apr 22', weekStart: '2026-04-15T00:00:00Z', weekEnd: '2026-04-22T00:00:00Z', occupancyPct: 100, rentCollectedCents: 1_302_500 },
  { weekLabel: 'Apr 29', weekStart: '2026-04-22T00:00:00Z', weekEnd: '2026-04-29T00:00:00Z', occupancyPct: 85.7, rentCollectedCents: 1_115_000 },
  { weekLabel: 'May 6',  weekStart: '2026-04-29T00:00:00Z', weekEnd: '2026-05-06T00:00:00Z', occupancyPct: 71.4, rentCollectedCents: 930_000 },
  { weekLabel: 'May 13', weekStart: '2026-05-06T00:00:00Z', weekEnd: '2026-05-13T00:00:00Z', occupancyPct: 78.6, rentCollectedCents: 1_022_500 },
];

const VOLATILE_KPIS: TodayKpis = {
  occupancyPct: 78.6,
  rentCollectedCents: 1_022_500,
  rentDueCents: 1_302_500,
  openWorkOrdersCount: 5,
  lateTenantsCount: 3,
  stripeRentCollectedThisMonthCents: 412_000,
  lateBalanceCents: 280_000,
};

const VOLATILE_DELTAS: TodayKpiDeltas = {
  occupancyPct: 7.2,
  rentCollectedCents: 92_500,
  openWorkOrdersCount: 1,
  lateTenantsCount: 2,
};

const EMPTY_KPIS: TodayKpis = {
  occupancyPct: 100,
  rentCollectedCents: 0,
  rentDueCents: 0,
  openWorkOrdersCount: 0,
  lateTenantsCount: 0,
  stripeRentCollectedThisMonthCents: 0,
  lateBalanceCents: 0,
};

const EMPTY_DELTAS: TodayKpiDeltas = {
  occupancyPct: null,
  rentCollectedCents: null,
  openWorkOrdersCount: null,
  lateTenantsCount: null,
};

interface PreviewSlotProps {
  title: string;
  blurb: string;
  history: WeekSnapshot[] | null;
  kpis: TodayKpis;
  deltas: TodayKpiDeltas;
}

function PreviewSlot({ title, blurb, history, kpis, deltas }: PreviewSlotProps) {
  // The chart fetches /api/today/kpi-history on mount. Intercept fetch
  // for this preview by stuffing a synthetic Response into a sessionStorage
  // bag the chart can read via a wrapper. Simpler: monkey-patch window.fetch
  // for the lifetime of this slot so the chart's existing useEffect just
  // works without changing its API.
  const installedRef = React.useRef(false);

  React.useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/today/kpi-history')) {
        return new Response(JSON.stringify({ weeks: history ?? [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  }, [history]);

  return (
    <div style={{ marginBottom: '40px' }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-500)',
          marginBottom: '6px',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '13px',
          color: 'var(--ink-600)',
          marginBottom: '14px',
          maxWidth: '720px',
        }}
      >
        {blurb}
      </div>
      <PortfolioHealthChart kpis={kpis} deltas={deltas} />
    </div>
  );
}

export function ChartPreviewBoard(): React.ReactElement {
  // Multiple PreviewSlots on the same page would race on the fetch
  // monkey-patch, so we render them one-at-a-time via a tab switcher.
  // Cleaner than installing 3 different fetch handlers and a Suspense
  // boundary.
  const [view, setView] = React.useState<'healthy' | 'volatile' | 'empty'>(
    'healthy',
  );

  return (
    <>
      <div
        style={{
          display: 'inline-flex',
          gap: '4px',
          padding: '4px',
          background: 'var(--paper-0)',
          border: '1px solid var(--ink-200)',
          borderRadius: '8px',
          marginBottom: '24px',
        }}
      >
        {(
          [
            ['healthy', 'Healthy 4-week'],
            ['volatile', 'Volatile portfolio'],
            ['empty', 'New account'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type='button'
            onClick={() => setView(key)}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: '13px',
              fontWeight: 500,
              background: view === key ? 'var(--navy-700)' : 'transparent',
              color: view === key ? 'var(--paper-0)' : 'var(--ink-700)',
              transition: 'background 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'healthy' && (
        <PreviewSlot
          key='healthy'
          title='State 1 — Healthy portfolio, 4 weeks of history'
          blurb='Occupancy trending up and to the right (solid navy). Rent collection holding steady (gold dashed). This is what the chart looks like for a seasoned account like Galaxy Estates.'
          history={HEALTHY_HISTORY}
          kpis={HEALTHY_KPIS}
          deltas={HEALTHY_DELTAS}
        />
      )}

      {view === 'volatile' && (
        <PreviewSlot
          key='volatile'
          title='State 2 — Volatile portfolio'
          blurb='Occupancy dropped mid-window (a tenant moved out) and the line recovers slowly. Rent collection mirrors that dip.'
          history={VOLATILE_HISTORY}
          kpis={VOLATILE_KPIS}
          deltas={VOLATILE_DELTAS}
        />
      )}

      {view === 'empty' && (
        <PreviewSlot
          key='empty'
          title='State 3 — New account (< 2 weeks old)'
          blurb='No populated history yet. The chart shows an explicit empty state instead of pretending to be a 4-week timeline of zeros.'
          history={[]}
          kpis={EMPTY_KPIS}
          deltas={EMPTY_DELTAS}
        />
      )}
    </>
  );
}
