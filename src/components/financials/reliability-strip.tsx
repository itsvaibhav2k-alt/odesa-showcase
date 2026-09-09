/**
 * ReliabilityStrip — the "Financial data coverage" strip on `/financials`.
 *
 * Warm, compact, honest. Instead of a dark telemetry block, it answers the
 * only coverage questions this page raises:
 *   - Rent ledger: Data current — the ledger is exactly what this page reads,
 *     without implying provider or webhook readiness.
 *   - Expense imports: always Not connected — no import exists (hardcoded
 *     honesty; the page's NOI/margin nulls come from the same fact).
 *   - Messaging config / Worker telemetry: real levels from the pure
 *     `buildReliabilityStatus` signals (`status.config` / `status.worker`),
 *     fetched RLS-scoped on the page via `getReliabilityStatus()`.
 *
 * It never shows a green light it can't verify: a missing `status` renders
 * the telemetry rows as an honest "Connecting…", never green. The full
 * row-by-row detail lives on `/settings` (linked in the footer).
 */

import Link from 'next/link';
import type { CSSProperties, ReactElement } from 'react';

import type { ReliabilityLevel, ReliabilityStatus } from '@/lib/reliability/status';

export interface ReliabilityStripProps {
  /** Real reliability status; `null`/`undefined` → honest connecting state. */
  status?: ReliabilityStatus | null;
}

const panelStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const headingStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const summaryStyle: CSSProperties = {
  fontSize: '12.5px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
  margin: 0,
};

const rowsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: '12.5px',
  color: 'var(--ink-2)',
};

const rowLabelStyle: CSSProperties = {
  minWidth: 130,
  color: 'var(--ink-2)',
};

const rowValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11px',
  letterSpacing: '0.03em',
};

const footerLinkStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.04em',
  color: 'var(--terracotta)',
  textDecoration: 'none',
  alignSelf: 'flex-start',
};

/** One coverage row's display state. */
interface CoverageRow {
  label: string;
  value: string;
  dotColor: string;
  valueColor: string;
}

/** Map a real reliability level onto row copy + colors (never green on unknown). */
function rowFromLevel(label: string, level: ReliabilityLevel): CoverageRow {
  switch (level) {
    case 'healthy':
      return { label, value: 'Ready', dotColor: 'var(--green)', valueColor: 'var(--green-ink)' };
    case 'degraded':
      return { label, value: 'Needs setup', dotColor: 'var(--amber)', valueColor: 'var(--amber-ink)' };
    case 'unknown':
    default:
      return { label, value: 'Connecting…', dotColor: 'var(--ink-3)', valueColor: 'var(--ink-3)' };
  }
}

function dotStyle(color: string): CSSProperties {
  return {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  };
}

export function ReliabilityStrip({ status }: ReliabilityStripProps): ReactElement {
  const rows: CoverageRow[] = [
    // The rent ledger is this page's data source; this is freshness, not readiness.
    { label: 'Rent ledger', value: 'Data current', dotColor: 'var(--green)', valueColor: 'var(--green-ink)' },
    // ponytail: hardcoded-honest — no expense integration exists to probe.
    { label: 'Expense imports', value: 'Not connected', dotColor: 'var(--ink-3)', valueColor: 'var(--ink-3)' },
    rowFromLevel('Messaging config', status ? status.config.level : 'unknown'),
    rowFromLevel('Worker telemetry', status ? status.worker.level : 'unknown'),
  ];

  const summary = status
    ? 'Every number on this page comes from the current rent ledger. Expense imports are not connected, so spend never appears as $0.'
    : 'Health telemetry connecting… Rent numbers come from the current ledger; telemetry status will resolve shortly.';

  return (
    <div
      style={panelStyle}
      data-testid="reliability-strip"
      {...(status ? { 'data-overall': status.overall } : {})}
    >
      <span style={headingStyle} data-testid="reliability-strip-heading">
        Financial data coverage
      </span>
      <p style={summaryStyle} data-testid="reliability-strip-summary">
        {summary}
      </p>
      <div style={rowsStyle}>
        {rows.map((row) => (
          <div key={row.label} style={rowStyle}>
            <span style={dotStyle(row.dotColor)} aria-hidden="true" />
            <span style={rowLabelStyle}>{row.label}</span>
            <span style={{ ...rowValueStyle, color: row.valueColor }}>{row.value}</span>
          </div>
        ))}
      </div>
      <Link href="/settings" style={footerLinkStyle}>
        Full reliability in Settings →
      </Link>
    </div>
  );
}
