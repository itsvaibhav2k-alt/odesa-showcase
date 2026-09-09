/**
 * FinancialCommandCenter — composes the `/financials` body from a typed
 * `FinancialsConsole`.
 *
 * Server component, warm-operator palette only. Sections:
 *   1. Collection hero          — "$X collected of $Y billed", period chips.
 *   2. KPI row                  — Billed / Collected / Outstanding / Late
 *      cards with sparklines, honest deltas, and rent-ledger drilldowns.
 *   3. Collection pace          — flagship cumulative billed-vs-collected
 *      area chart + portfolio status ring (summary counts, not payments).
 *   4. Monthly pulse            — collected-vs-billed bars per month.
 *   5. Operator summary         — What changed / Why it matters /
 *      Recommended move, deterministic from real figures.
 *   6. Exceptions queue         — severity-sorted, with operator links.
 *   7. Delinquency aging        — bucketed as-of-today balances.
 *   8. Property P&L rollup      — occupancy × collection performance
 *      board (dots drill into properties) + risk-ordered table.
 *   9. Operating result         — honest data-coverage chips, no NOI guess.
 *  10. Reliability strip        — real job/notification/worker health.
 *
 * Honest-data invariant: rent / collection figures are real (integer
 * cents); maintenance / vendor SPEND and NOI are NOT fabricated — the
 * spend panel renders a "not connected" state. Prior-period delta chips
 * appear ONLY on Billed / Collected (the only honestly comparable
 * figures — there is no payment-date history to reconstruct a historical
 * outstanding/late position) and ONLY when the prior window actually has
 * rent activity. No money is moved: every action is draft / queue /
 * review only.
 */

import type { CSSProperties, ReactNode } from 'react';

import { formatMoneyCents, formatPct, formatSignedMoneyCents } from '@/lib/financials/format';
import type { FinancialsConsole } from '@/lib/financials/queries';
import type { ReliabilityStatus } from '@/lib/reliability/status';

import { AgingRow } from './aging-row';
import { CollectionHero } from './collection-hero';
import { CollectionPace } from './collection-pace';
import { CollectionTrend } from './collection-trend';
import { ExceptionQueue } from './exception-queue';
import { MetricCard } from './metric-card';
import { OperatorSummary } from './operator-summary';
import { PropertyFinancialTable } from './property-financial-table';
import { PropertyPerformanceBoard } from './property-performance-board';
import { ReliabilityStrip } from './reliability-strip';
import { Sparkline } from './sparkline';

export interface FinancialCommandCenterProps {
  console: FinancialsConsole;
  /** Real reliability status; `null`/omitted → honest "connecting" state. */
  reliability?: ReliabilityStatus | null;
}

const sectionStyle: CSSProperties = {
  marginTop: 28,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
};

const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: '20px',
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
};

const sectionMetaStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const noteStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.04em',
  color: 'var(--ink-3)',
};

const metricCardGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
  gap: 12,
  marginTop: 14,
};

const spendPanelStyle: CSSProperties = {
  border: '1px dashed var(--hairline-strong)',
  borderRadius: 12,
  padding: '20px 22px',
  background: 'var(--panel-lift)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const spendTitleStyle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--ink)',
};

const spendBodyStyle: CSSProperties = {
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
  maxWidth: 620,
};

const coverageChipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const coverageChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--hairline)',
  borderRadius: 999,
  padding: '4px 10px',
  background: 'var(--panel)',
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.05em',
  color: 'var(--ink-2)',
  whiteSpace: 'nowrap',
};

/** Data-coverage chips — one connected source (rent ledger), three honest gaps. */
const COVERAGE_CHIPS: ReadonlyArray<{ label: string; connected: boolean }> = [
  { label: 'Rent ledger · connected', connected: true },
  { label: 'Expense imports · not connected', connected: false },
  { label: 'Vendor spend · not connected', connected: false },
  { label: 'Schedule E · unavailable', connected: false },
];

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <div style={sectionStyle}>
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>{title}</h2>
        {meta ? <span style={sectionMetaStyle}>{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function FinancialCommandCenter({
  console: financials,
  reliability,
}: FinancialCommandCenterProps) {
  const { summary, series, aging, totals, priorTotals, periodKey } = financials;

  // Honest deltas: only Billed / Collected are comparable across windows,
  // and only when the prior window actually has rent activity (a delta
  // against an empty window would just restate the period's total).
  const hasPriorActivity = priorTotals.billedCents > 0 || priorTotals.collectedCents > 0;
  const billedDelta = hasPriorActivity
    ? formatSignedMoneyCents(totals.billedCents - priorTotals.billedCents)
    : null;
  const collectedDelta = hasPriorActivity
    ? formatSignedMoneyCents(totals.collectedCents - priorTotals.collectedCents)
    : null;

  // 'last' drills into that month's ledger; mtd/qtd/ytd land on the current
  // ledger (no multi-month ledger view exists — deliberate).
  const rentHref =
    periodKey === 'last' ? `/rent?cycle=${summary.period.startDate.slice(0, 7)}` : '/rent';

  // The summary's outstanding includes still-late prior months (aged
  // balances survive rollover); the in-period slice comes from totals.
  const priorOwedCents = summary.rentOutstandingCents - totals.outstandingCents;
  const occupancyContext = `${summary.occupiedUnitCount} of ${summary.unitCount} units occupied`;

  return (
    <div data-testid="financial-command-center">
      {/* 1–2. Collection hero + KPI row */}
      <CollectionHero
        summary={summary}
        periodKey={periodKey}
        lateLeaseCount={totals.lateLeaseCount}
        billedDelta={billedDelta}
        collectedDelta={collectedDelta}
        generatedAtIso={reliability?.generatedAt ?? null}
        rentHref={rentHref}
      />
      <div style={metricCardGridStyle}>
        <MetricCard
          label="Billed"
          value={formatMoneyCents(summary.rentBilledCents)}
          context={occupancyContext}
          delta={billedDelta}
          deltaTone="neutral"
          sparkline={<Sparkline values={series.map((p) => p.billedCents)} />}
          href={rentHref}
          testId="metric-billed"
        />
        <MetricCard
          label="Collected"
          value={formatMoneyCents(summary.rentCollectedCents)}
          context={`${formatPct(summary.collectionRatePct)} of billed`}
          tone="good"
          delta={collectedDelta}
          deltaTone={collectedDelta?.startsWith('+') ? 'good' : 'neutral'}
          sparkline={<Sparkline values={series.map((p) => p.collectedCents)} stroke="var(--green)" />}
          href={rentHref}
          testId="metric-collected"
        />
        <MetricCard
          label="Outstanding"
          value={formatMoneyCents(summary.rentOutstandingCents)}
          context={
            priorOwedCents > 0
              ? `incl. ${formatMoneyCents(priorOwedCents)} still owed from prior months`
              : `All owed from ${summary.period.label}`
          }
          tone={summary.rentOutstandingCents > 0 ? 'warn' : 'good'}
          sparkline={<Sparkline values={series.map((p) => p.outstandingCents)} stroke="var(--clay)" />}
          href="/rent?filter=outstanding"
          testId="metric-outstanding"
        />
        <MetricCard
          label="Late"
          value={formatMoneyCents(summary.rentLateCents)}
          context={
            totals.lateLeaseCount > 0
              ? `${totals.lateLeaseCount} tenant${totals.lateLeaseCount === 1 ? '' : 's'} paying late`
              : 'Nothing past due'
          }
          tone={summary.rentLateCents > 0 ? 'warn' : 'good'}
          sparkline={<Sparkline values={series.map((p) => p.lateCents)} stroke="var(--clay)" />}
          href="/rent?filter=outstanding"
          testId="metric-late-exposure"
        />
      </div>
      <p style={{ ...noteStyle, marginTop: 10 }}>No money movement is automated.</p>

      {/* 3. Collection pace — flagship (carries its own heading) */}
      <div style={{ marginTop: 28 }}>
        <CollectionPace
          series={series}
          unitCount={summary.unitCount}
          occupiedUnitCount={summary.occupiedUnitCount}
          lateLeaseCount={totals.lateLeaseCount}
        />
      </div>

      {/* 4. Monthly pulse — the secondary per-month bar view */}
      <Section
        title="Monthly pulse"
        meta={`${series.length} month${series.length === 1 ? '' : 's'} · billed vs collected`}
      >
        <CollectionTrend series={series} />
      </Section>

      {/* 5. Operator summary — replaces the paragraph readout */}
      <Section title="Operator summary">
        <OperatorSummary summary={summary} totals={totals} aging={aging} />
      </Section>

      {/* 6. Exceptions queue */}
      <Section
        title="Exceptions queue"
        meta={`${summary.exceptions.length} open`}
      >
        <ExceptionQueue exceptions={summary.exceptions} />
      </Section>

      {/* 7. Delinquency aging */}
      <Section title="Delinquency aging" meta="Balances as of today">
        <AgingRow buckets={aging} />
      </Section>

      {/* 8. Property P&L rollup — performance board, then the table */}
      <Section title="Property P&L rollup" meta="Highest attention first">
        <PropertyPerformanceBoard properties={summary.properties} />
        <PropertyFinancialTable properties={summary.properties} />
      </Section>

      {/* 9. Operating result — honest data-coverage state, no NOI guess */}
      <Section title="Spend & operating result">
        <div style={spendPanelStyle} data-testid="spend-pressure-panel">
          <span style={spendTitleStyle}>Operating result unavailable</span>
          <div style={coverageChipRowStyle}>
            {COVERAGE_CHIPS.map((chip) => (
              <span key={chip.label} style={coverageChipStyle}>
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: chip.connected ? 'var(--green)' : 'var(--ink-3)',
                    opacity: chip.connected ? 1 : 0.45,
                  }}
                />
                {chip.label}
              </span>
            ))}
          </div>
          <p style={spendBodyStyle}>
            Odesa is showing rent-ledger financials only; it will not estimate NOI from work
            orders.
            {summary.openWorkOrderCount !== undefined && summary.openWorkOrderCount > 0
              ? ` ${summary.openWorkOrderCount} open work order${
                  summary.openWorkOrderCount === 1 ? '' : 's'
                } are tracked as a risk signal only — never converted to a dollar figure.`
              : ''}
          </p>
        </div>
      </Section>

      {/* 10. Reliability strip — real job/notification/worker health */}
      <Section title="Reliability">
        <ReliabilityStrip status={reliability} />
        <p style={noteStyle}>No estimated expense data is shown.</p>
      </Section>
    </div>
  );
}
