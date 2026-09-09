'use client';

import { KpiCard } from './kpi-card';
import {
  occupancyTone,
  rentCollectionTone,
  lateTenantsTone,
  type StatusTone,
} from '@/lib/today/status';
import type { TodayKpis, TodayKpiDeltas } from '@/lib/today/queries';

/**
 * KPI strip on the Today screen — five compact signal cards that
 * collapse to 2-up on narrow viewports.
 *
 * The strip is a purely presentational component; the `page.tsx`
 * server component fetches data and passes it down.
 */
export interface KpiStripProps {
  kpis: TodayKpis;
  deltas: TodayKpiDeltas;
  /**
   * Count of lease deadlines (expiring leases) within this week's
   * look-ahead window. Lives outside `TodayKpis` because it is not a
   * KPI-view field — the integrator derives it from expiring leases /
   * `getUpcomingMoveIns` and passes the scalar in.
   */
  upcomingCount: number;
}

export function KpiStrip({ kpis, deltas, upcomingCount }: KpiStripProps) {
  return (
    <section
      data-testid="today-kpi-strip"
      aria-label="Portfolio KPIs"
      className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5"
    >
      <KpiCard
        testId="today-kpi-occupancy"
        label="Occupancy"
        value={kpis.occupancyPct}
        formatValue={(n) => `${Math.round(n)}%`}
        delta={deltas.occupancyPct}
        positiveIsGood
        status={{
          label: occupancyStatusLabel(occupancyTone(kpis.occupancyPct)),
          tone: occupancyTone(kpis.occupancyPct),
        }}
      />
      <KpiCard
        testId="today-kpi-rent-collected"
        label="Rent collected"
        value={kpis.rentCollectedCents}
        formatValue={(n) => formatMoneyCents(n)}
        delta={deltas.rentCollectedCents}
        formatDelta={(n) => formatMoneyDelta(n)}
        positiveIsGood
        context={`of ${formatMoneyCents(kpis.rentDueCents)} this month`}
        status={{
          label: rentStatusLabel(
            rentCollectionTone(kpis.rentCollectedCents, kpis.rentDueCents),
          ),
          tone: rentCollectionTone(kpis.rentCollectedCents, kpis.rentDueCents),
        }}
      />
      <KpiCard
        testId="today-kpi-late-balance"
        label="Late balance"
        value={kpis.lateBalanceCents}
        formatValue={(n) => formatMoneyCents(n)}
        positiveIsGood={false}
        context={lateBalanceContext(kpis.lateTenantsCount)}
        status={{
          label: lateStatusLabel(lateTenantsTone(kpis.lateTenantsCount)),
          tone: lateTenantsTone(kpis.lateTenantsCount),
        }}
      />
      <KpiCard
        testId="today-kpi-open-wos"
        label="Open work orders"
        value={kpis.openWorkOrdersCount}
        formatValue={(n) => `${Math.round(n)}`}
        delta={deltas.openWorkOrdersCount}
        positiveIsGood={false}
        context={openWorkOrdersContext(kpis.openWorkOrdersCount)}
        status={{
          label: openWorkOrdersStatusLabel(kpis.openWorkOrdersCount),
          tone: kpis.openWorkOrdersCount > 0 ? 'watching' : 'healthy',
        }}
      />
      <KpiCard
        testId="today-kpi-upcoming"
        label="Upcoming"
        value={upcomingCount}
        formatValue={(n) => `${Math.round(n)}`}
        positiveIsGood={false}
        context="lease deadlines this week"
        status={{
          label: upcomingCount > 0 ? 'Soon' : 'Clear',
          tone: upcomingCount > 0 ? 'review' : 'neutral',
        }}
      />
    </section>
  );
}

/**
 * Status pill labels per tone. Kept terse so the pill stays a glance,
 * not a sentence. The tone (and thus color) carries the meaning; the
 * word just names it for screen readers and color-blind operators.
 */
function occupancyStatusLabel(tone: StatusTone): string {
  if (tone === 'healthy') return 'Full';
  if (tone === 'review') return 'Vacancy';
  return 'Steady';
}

function rentStatusLabel(tone: StatusTone): string {
  if (tone === 'healthy') return 'Collected';
  if (tone === 'review') return 'Unpaid';
  return 'In progress';
}

function lateStatusLabel(tone: StatusTone): string {
  if (tone === 'healthy') return 'Clear';
  if (tone === 'review') return 'Watch';
  return 'Attention';
}

/** Context line for the late-balance card, keyed off the late count. */
function lateBalanceContext(lateCount: number): string {
  if (lateCount <= 0) return 'None late';
  return `${lateCount} tenant${lateCount === 1 ? '' : 's'} need follow-up`;
}

/** Context line for the open-work-orders card. */
function openWorkOrdersContext(count: number): string {
  if (count <= 0) return 'All clear';
  return `${count} waiting on vendor`;
}

/** Status word for the open-work-orders card. */
function openWorkOrdersStatusLabel(count: number): string {
  return count > 0 ? 'Open' : 'Clear';
}

/**
 * Render cents as a shortened dollar string. Values >= $10,000 collapse
 * to "$12.5k" to keep the KPI card visually calm; smaller numbers
 * render with full precision ("$2,300").
 */
function formatMoneyCents(cents: number): string {
  const dollars = Math.round(cents) / 100;
  if (dollars >= 10_000) {
    const k = dollars / 1000;
    return `$${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

function formatMoneyDelta(cents: number): string {
  if (cents === 0) return 'No change';
  const dollars = Math.round(cents) / 100;
  const sign = cents > 0 ? '+' : '-';
  const abs = Math.abs(dollars);
  if (abs >= 10_000) {
    return `${sign}$${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k vs. last week`;
  }
  return `${sign}$${Math.round(abs).toLocaleString('en-US')} vs. last week`;
}
