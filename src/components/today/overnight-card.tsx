import type { CSSProperties } from 'react';

import type { DailyDigest } from '@/lib/today/queries';

/**
 * "Overnight" card — compact digest strip for the Today console.
 *
 * Server component. Renders the latest `daily_digests` snapshot as a
 * single warm panel: an eyebrow row (label + mono window date) over a
 * five-cell hairline grid of counts. Quiet by design — numbers carry
 * the weight; the only color is a clay accent when agent runs failed.
 *
 * Hidden gracefully: renders nothing when `digest` is null (no digest
 * generated yet, or an unknown sections shape was filtered out by the
 * reader's zod parse).
 */

interface OvernightCardProps {
  digest: DailyDigest | null;
}

interface OvernightCell {
  key: string;
  eyebrow: string;
  value: number;
  label: string;
  note?: string;
  noteTone?: 'quiet' | 'clay';
}

const cardStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '16px 18px 14px',
  fontFamily: 'var(--font-sans-operator)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  paddingBottom: 12,
  borderBottom: '1px solid var(--hairline-faint)',
  marginBottom: 12,
};

const eyebrowStyle: CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const windowLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  letterSpacing: '0.02em',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '1px',
  background: 'var(--hairline-faint)',
};

const cellStyle: CSSProperties = {
  background: 'var(--panel)',
  padding: '4px 14px 2px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const cellEyebrowStyle: CSSProperties = {
  fontSize: '9.5px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const cellValueRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
};

const cellValueStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display)',
  fontSize: '24px',
  lineHeight: 1.1,
  color: 'var(--ink-1)',
  fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const cellLabelStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  letterSpacing: '0.01em',
};

const NOTE_TONE_INK: Record<'quiet' | 'clay', string> = {
  quiet: 'var(--ink-3)',
  clay: 'var(--clay-ink)',
};

export function OvernightCard({ digest }: OvernightCardProps) {
  if (!digest) return null;

  const { sections } = digest;
  const agentRunTotal =
    sections.agent_runs.done_count + sections.agent_runs.failed_count;

  const cells: readonly OvernightCell[] = [
    {
      key: 'rent-activity',
      eyebrow: 'RENT ACTIVITY',
      value: sections.rent_activity.count,
      label: sections.rent_activity.count === 1 ? 'event touched' : 'events touched',
    },
    {
      key: 'drafts-pending',
      eyebrow: 'DRAFTS',
      value: sections.drafts_pending.count,
      label: 'drafts awaiting review',
    },
    {
      key: 'agent-runs',
      eyebrow: 'AGENT RUNS',
      value: agentRunTotal,
      label: 'finished',
      note:
        sections.agent_runs.failed_count > 0
          ? `${sections.agent_runs.failed_count} failed`
          : undefined,
      noteTone: 'clay',
    },
    {
      key: 'work-orders',
      eyebrow: 'WORK ORDERS',
      value: sections.work_orders.opened_count,
      label: 'opened',
      note:
        sections.work_orders.closed_count > 0
          ? `${sections.work_orders.closed_count} closed`
          : undefined,
      noteTone: 'quiet',
    },
    {
      key: 'timers-fired',
      eyebrow: 'TIMERS',
      value: sections.scheduled_actions_fired.count,
      label: 'fired',
    },
  ];

  return (
    <section data-section="overnight" style={cardStyle}>
      <div style={headStyle}>
        <span style={eyebrowStyle}>Overnight</span>
        <span className="num" style={windowLabelStyle}>
          {formatWindowLabel(digest.digestDate)}
        </span>
      </div>

      <div style={gridStyle}>
        {cells.map((cell) => (
          <div key={cell.key} data-overnight-cell={cell.key} style={cellStyle}>
            <span style={cellEyebrowStyle}>{cell.eyebrow}</span>
            <span style={cellValueRowStyle}>
              <span className="num" style={cellValueStyle}>
                {cell.value}
              </span>
              <span style={cellLabelStyle}>{cell.label}</span>
            </span>
            {cell.note ? (
              <span
                style={{
                  fontSize: '10.5px',
                  lineHeight: 1.4,
                  color: NOTE_TONE_INK[cell.noteTone ?? 'quiet'],
                }}
              >
                {cell.note}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** 'YYYY-MM-DD' → 'JUN 11 · LAST 24H' (mono micro-label voice). */
function formatWindowLabel(digestDate: string): string {
  const d = new Date(`${digestDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return 'LAST 24H';
  const label = d
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toUpperCase();
  return `${label} · LAST 24H`;
}
