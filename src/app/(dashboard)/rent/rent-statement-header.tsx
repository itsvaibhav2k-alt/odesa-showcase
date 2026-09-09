/**
 * Dense collection summary for `/rent`.
 *
 * Every figure is derived from the selected cycle's rent ledger. The account
 * ring is explicitly account-based (not a dollar-allocation chart), and the
 * collected amount comes from the live summary facts rather than inferred
 * payment timestamps.
 */

import type { CSSProperties } from 'react';

import type {
  FacetSpec,
  RentFacetId,
  RentLedgerRow,
  RentSummary,
} from '@/lib/properties/mock-portfolio-views';

import styles from './rent-console.module.css';

export interface RentStatementHeaderProps {
  summary: RentSummary;
  facets: readonly FacetSpec<RentFacetId>[];
  rows: readonly RentLedgerRow[];
}

function facetCount(
  facets: readonly FacetSpec<RentFacetId>[],
  id: RentFacetId,
): number {
  return facets.find((facet) => facet.id === id)?.count ?? 0;
}

function metricValue(summary: RentSummary, label: string): string | undefined {
  return summary.metrics.find((metric) => metric.label === label)?.value;
}

function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function parseCount(value: string | undefined): number {
  const parsed = Number(value?.replace(/[^0-9.-]/g, '') ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function balanceCents(rows: readonly RentLedgerRow[]): number {
  return Math.round(
    rows.reduce((total, row) => total + (row.outstandingDollars ?? 0), 0) * 100,
  );
}

function accountDistributionGradient(groups: readonly number[]): string {
  const total = groups.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 'var(--canvas-deep)';

  const colors = ['var(--green)', 'var(--amber)', 'var(--clay)', 'var(--gold)'];
  let cursor = 0;
  const segments = groups.map((count, index) => {
    const start = cursor;
    cursor += (count / total) * 100;
    return `${colors[index]} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${segments.join(', ')})`;
}

interface MetricProps {
  label: string;
  value: string;
  detail: string;
  warn?: boolean;
  progress?: number;
}

function Metric({ label, value, detail, warn, progress }: MetricProps) {
  return (
    <div className={`${styles.metric} ${warn ? styles.metricWarn : ''}`}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
      {progress === undefined ? (
        <div className={styles.metricDetail}>{detail}</div>
      ) : (
        <>
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressFill}
              style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
            />
          </div>
          <div className={styles.metricDetail}>{detail}</div>
        </>
      )}
    </div>
  );
}

export function RentStatementHeader({
  summary,
  facets,
  rows,
}: RentStatementHeaderProps) {
  const billedCents =
    summary.facts?.billedCents ?? parseMoney(metricValue(summary, 'Billed'));
  const outstandingCents =
    summary.facts?.outstandingCents ??
    parseMoney(metricValue(summary, 'Outstanding'));
  const collectedCents =
    summary.facts?.collectedCents ?? Math.max(billedCents - outstandingCents, 0);
  const collectionRate =
    summary.facts?.collectionRate ?? parseCount(metricValue(summary, 'Collected'));

  const totalCount = facetCount(facets, 'all');
  const paidCount = facetCount(facets, 'paid');
  const outstandingCount = facetCount(facets, 'outstanding');
  const planCount = facetCount(facets, 'on-plan');
  const overdueRows = rows.filter(
    (row) =>
      row.statusPill.status === 'outstanding' &&
      /overdue|escalated/i.test(row.statusPill.label),
  );
  const dueCount = Math.max(outstandingCount - overdueRows.length, 0);
  const overdueBalance = balanceCents(overdueRows);
  const planBalance = balanceCents(
    rows.filter((row) => row.statusPill.status === 'on-plan'),
  );

  const donutStyle: CSSProperties = {
    background: accountDistributionGradient([
      paidCount,
      dueCount,
      overdueRows.length,
      planCount,
    ]),
  };

  const legend = [
    { label: 'Paid', count: paidCount, dot: styles.dotPaid },
    { label: 'Outstanding', count: dueCount, dot: styles.dotOutstanding },
    { label: 'Overdue', count: overdueRows.length, dot: styles.dotOverdue },
    { label: 'On plan', count: planCount, dot: styles.dotPlan },
  ];

  return (
    <section className={styles.summaryLayout} data-testid="rent-statement-header">
      <div className={styles.metricStrip} aria-label={`${summary.period} collection summary`}>
        <Metric
          label="Billed"
          value={money(billedCents)}
          detail={`${totalCount} account${totalCount === 1 ? '' : 's'}`}
        />
        <Metric
          label="Collected"
          value={money(collectedCents)}
          detail={`${collectionRate}% of billed`}
        />
        <Metric
          label="Collection rate"
          value={`${collectionRate}%`}
          detail="Current ledger balance"
          progress={collectionRate}
        />
        <Metric
          label="Outstanding"
          value={money(outstandingCents)}
          detail={`${outstandingCount + planCount} open account${outstandingCount + planCount === 1 ? '' : 's'}`}
          warn={outstandingCents > 0}
        />
        <Metric
          label="Overdue accounts"
          value={String(overdueRows.length)}
          detail={money(overdueBalance)}
          warn={overdueRows.length > 0}
        />
        <Metric
          label="On payment plan"
          value={String(planCount)}
          detail={money(planBalance)}
        />
      </div>

      <div
        className={styles.distributionCard}
        aria-label={`Account status distribution for ${summary.period}`}
      >
        <div className={styles.donut} style={donutStyle} aria-hidden="true">
          <span className={styles.donutHole}>{totalCount}</span>
        </div>
        <div className={styles.distributionLegend}>
          {legend.map((item) => (
            <div key={item.label} className={styles.legendItem}>
              <span className={`${styles.legendDot} ${item.dot}`} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>
                {item.count} ({totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0}%)
              </strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
