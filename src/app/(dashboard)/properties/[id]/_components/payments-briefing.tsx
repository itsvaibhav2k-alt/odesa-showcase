/**
 * Property financial briefing — the compact money panel rendered BEFORE
 * the transaction rows in both the Payments room (drawer) and the legacy
 * Payments tab.
 *
 * It answers, for the current rent cycle: what was expected, what was
 * collected, what is still outstanding, how much is late, the most recent
 * confirmed payments, the property's deterministic financial exceptions,
 * and a plain "what Odesa is watching" line.
 *
 * Honest-data invariant (this sprint): maintenance / vendor SPEND is not
 * in the schema, so operating result / NOI are never invented. The panel
 * states "Expense imports not connected yet" and never turns a work-order
 * COUNT into a dollar figure. No money is moved — every action elsewhere
 * is draft / queue / review only.
 *
 * Pure presentational server component: all data is fetched by the parent
 * (`getPropertyFinancialSnapshot`) and passed in, so the same panel renders
 * identically in either surface and stays trivially testable.
 */

import * as React from 'react';
import type { CSSProperties } from 'react';

import { StatusChip } from '@/components/shared/status-chip';
import { ExceptionQueue } from '@/components/financials/exception-queue';
import { riskTone } from '@/components/financials/tone';
import {
  formatMoneyCents,
  formatMoneyCentsPrecise,
  formatPct,
} from '@/lib/financials/format';
import type { PropertyFinancialBriefing } from '@/lib/financials/queries';
import type { RentPaymentRow } from '@/lib/properties/queries';

export interface BriefingRecentPayment {
  id: string;
  tenantName: string | null;
  unitLabel: string | null;
  amountCents: number;
  paidAt: string | null;
}

export interface PaymentsBriefingProps {
  /** The property briefing, or `null` when unavailable (renders nothing). */
  briefing: PropertyFinancialBriefing | null;
  /** Most-recent confirmed payments (newest first); may be empty. */
  recentPayments: BriefingRecentPayment[];
}

/**
 * Pick the most-recent confirmed (succeeded) payments for the briefing's
 * recent-activity list. Rows arrive newest-first from
 * `listRentPaymentsForProperty`, so we only filter + slice.
 */
export function selectRecentPayments(
  rows: ReadonlyArray<RentPaymentRow>,
  limit = 4,
): BriefingRecentPayment[] {
  return rows
    .filter((row) => row.status === 'succeeded')
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      tenantName: row.tenantName,
      unitLabel: row.unitLabel,
      amountCents: row.amountCents,
      paidAt: row.paidAt,
    }));
}

export function PaymentsBriefing({
  briefing,
  recentPayments,
}: PaymentsBriefingProps): React.ReactElement | null {
  if (briefing === null) return null;

  const { snapshot, exceptions, period } = briefing;
  const risk = riskTone(snapshot.riskLevel);
  const lateTone = snapshot.rentLateCents > 0;
  const watching =
    snapshot.riskReasons.length > 0
      ? snapshot.riskReasons
      : ['Collections are on track. Odesa flags late rent and new exceptions here.'];

  return (
    <section data-testid="payments-briefing" style={panelStyle}>
      <BriefingStyles />

      <header style={headerStyle}>
        <div>
          <span style={eyebrowStyle}>Financial briefing</span>
          <span style={periodStyle}>{period.label}</span>
        </div>
        <StatusChip tone={risk.tone} label={risk.label} />
      </header>

      <div className="payments-briefing-metrics" style={metricsStyle}>
        <Metric label="Expected" value={formatMoneyCents(snapshot.rentBilledCents)} />
        <Metric
          label="Collected"
          value={formatMoneyCents(snapshot.rentCollectedCents)}
          hint={
            snapshot.collectionRatePct !== null
              ? `${formatPct(snapshot.collectionRatePct)} of billed`
              : undefined
          }
        />
        <Metric
          label="Outstanding"
          value={formatMoneyCents(snapshot.rentOutstandingCents)}
        />
        <Metric
          label="Late balance"
          value={formatMoneyCents(snapshot.rentLateCents)}
          tone={lateTone ? 'warn' : undefined}
        />
      </div>

      {recentPayments.length > 0 ? (
        <div style={blockStyle}>
          <span style={blockLabelStyle}>Recent payments</span>
          <ul style={recentListStyle} data-testid="payments-briefing-recent">
            {recentPayments.map((payment) => (
              <li key={payment.id} style={recentRowStyle}>
                <span style={recentWhoStyle}>
                  {payment.tenantName ?? 'Tenant'}
                  {payment.unitLabel ? (
                    <span style={recentUnitStyle}> · {payment.unitLabel}</span>
                  ) : null}
                </span>
                <span style={recentMetaStyle}>
                  <span className="tabular-nums" style={recentAmountStyle}>
                    {formatMoneyCentsPrecise(payment.amountCents)}
                  </span>
                  <span style={recentDateStyle}>{formatShortDate(payment.paidAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {exceptions.length > 0 ? (
        <div style={blockStyle}>
          <span style={blockLabelStyle}>Needs attention</span>
          <ExceptionQueue exceptions={exceptions} />
        </div>
      ) : null}

      <div style={blockStyle}>
        <span style={blockLabelStyle}>What Odesa is watching</span>
        <ul style={watchListStyle} data-testid="payments-briefing-watching">
          {watching.map((line, index) => (
            <li key={index} style={watchRowStyle}>
              <span aria-hidden="true" style={watchDotStyle} />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <p style={honestNoteStyle} data-testid="payments-briefing-spend-note">
        Operating result &amp; NOI: expense imports not connected yet. No money
        movement is automated — actions are draft, queue, or review only.
      </p>
    </section>
  );
}

interface MetricProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn';
}

function Metric({ label, value, hint, tone }: MetricProps): React.ReactElement {
  return (
    <div style={metricCellStyle}>
      <span style={metricLabelStyle}>{label}</span>
      <span
        className="tabular-nums"
        style={{
          ...metricValueStyle,
          color: tone === 'warn' ? 'var(--clay)' : 'var(--ink)',
        }}
      >
        {value}
      </span>
      {hint != null ? <span style={metricHintStyle}>{hint}</span> : null}
    </div>
  );
}

/** Short, locale-stable date (e.g. "Jun 3"); em-dash when absent. */
function formatShortDate(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Styles — warm operator-console tokens only.
// ---------------------------------------------------------------------------

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: '18px 20px',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'color-mix(in srgb, var(--panel-lift) 80%, transparent)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 9.5,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginRight: 10,
};

const periodStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 16,
  fontStyle: 'italic',
  color: 'var(--ink)',
};

const metricsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  border: '1px solid var(--hairline-faint)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'var(--panel-clean)',
};

const metricCellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minHeight: 78,
  padding: '13px 14px',
  borderRight: '1px solid var(--hairline-faint)',
};

const metricLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 9.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const metricValueStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: 23,
  lineHeight: 1,
  letterSpacing: 0,
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
};

const metricHintStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: 11,
  lineHeight: 1.3,
  color: 'var(--ink-3)',
};

const blockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const blockLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 9.5,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const recentListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  border: '1px solid var(--hairline-faint)',
  borderRadius: 8,
  overflow: 'hidden',
  background: 'var(--panel-clean)',
};

const recentRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 14px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const recentWhoStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--ink)',
  minWidth: 0,
};

const recentUnitStyle: CSSProperties = {
  color: 'var(--ink-3)',
};

const recentMetaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  whiteSpace: 'nowrap',
};

const recentAmountStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 13,
  color: 'var(--ink)',
  fontFeatureSettings: "'tnum' 1",
};

const recentDateStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: 10.5,
  letterSpacing: '0.04em',
  color: 'var(--ink-3)',
};

const watchListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
};

const watchRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  fontSize: 13,
  lineHeight: 1.45,
  color: 'var(--ink-2)',
};

const watchDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  marginTop: 6,
  borderRadius: '50%',
  background: 'var(--amber)',
  flexShrink: 0,
};

const honestNoteStyle: CSSProperties = {
  margin: 0,
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--ink-3)',
};

function BriefingStyles(): React.ReactElement {
  return (
    <style href="payments-briefing" precedence="payments-briefing">{`
      .payments-briefing-metrics > div:last-child { border-right: 0; }
      [data-testid="payments-briefing-recent"] > li:last-child { border-bottom: 0; }
      @container (max-width: 560px) {
        .payments-briefing-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 560px) {
        .payments-briefing-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
    `}</style>
  );
}
