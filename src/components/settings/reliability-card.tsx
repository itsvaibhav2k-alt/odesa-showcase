/**
 * Reliability card — Settings section 6 ("Operator reliability").
 *
 * Renders the REAL job / notification / worker / config health produced by
 * the pure `buildReliabilityStatus` builder (`src/lib/reliability/status.ts`),
 * fetched RLS-scoped on the settings page via `getReliabilityStatus()`.
 *
 * Honesty contract (mirrors the builder): three levels only — `healthy`,
 * `degraded`, `unknown` — and `unknown` reads calm-neutral, NEVER green.
 * A green dot is shown only when a signal is provably healthy. Copy comes
 * straight from the builder's `detail` strings (e.g. "Last operator digest
 * delivered Monday 8:01 AM", "Worker health unknown — telemetry URL not
 * configured") so the words match everywhere reliability is surfaced.
 *
 * Pure presentational server component — no client state, no IO. It takes
 * the already-built status as a prop and matches the warm light card style
 * of the other settings cards (--paper-0 / --ink-* / --radius-lg-odesa).
 *
 * Division of labour: `/financials` renders the client-safe SUMMARY ALONE
 * (compact); THIS card is the full reference — the same `status.summary`
 * heading + readiness sentence ABOVE the complete row-by-row technical
 * detail. The detail rows stay here on purpose; do not strip them.
 */

import type { CSSProperties } from 'react';

import type {
  ReliabilityLevel,
  ReliabilityStatus,
} from '@/lib/reliability/status';

export interface ReliabilityCardProps {
  /** Real reliability status; `null` → honest "telemetry connecting" state. */
  status: ReliabilityStatus | null;
}

/** Reliability level → warm status color. `unknown` stays neutral, never green. */
function levelColor(level: ReliabilityLevel): string {
  switch (level) {
    case 'healthy':
      return 'var(--green)';
    case 'degraded':
      return 'var(--terracotta)';
    case 'unknown':
    default:
      return 'var(--ink-500)';
  }
}

const cardStyle: CSSProperties = {
  background: 'var(--paper-0)',
  border: '1px solid var(--ink-200)',
  borderRadius: 'var(--radius-lg-odesa)',
  padding: '24px 28px',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const dotStyle = (level: ReliabilityLevel, size = 9): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
  background: levelColor(level),
  flexShrink: 0,
});

const headStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const headTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const headTitleStyle: CSSProperties = {
  fontSize: '18px',
  lineHeight: 1.2,
  color: 'var(--ink-900)',
};

const headSubtitleStyle: CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-600)',
  maxWidth: '64ch',
};

const trustNoteStyle: CSSProperties = {
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-500)',
  maxWidth: '64ch',
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 12,
  alignItems: 'flex-start',
  padding: '12px 0',
  borderTop: '1px solid var(--ink-200)',
};

const rowNameStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--ink-800)',
};

const rowDetailStyle: CSSProperties = {
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-600)',
  marginTop: 2,
};

interface Row {
  key: string;
  name: string;
  level: ReliabilityLevel;
  detail: string;
}

export function ReliabilityCard({ status }: ReliabilityCardProps) {
  if (!status) {
    return (
      <section data-testid="settings-reliability-section" style={cardStyle}>
        <div style={headStyle}>
          <div style={headTitleRowStyle}>
            <span style={dotStyle('unknown')} aria-hidden="true" />
            <h3 className="font-serif-display" style={headTitleStyle}>
              Health telemetry connecting&hellip;
            </h3>
          </div>
          <p style={headSubtitleStyle}>
            Job-run and notification-delivery status are being read. Until telemetry
            resolves, Odesa shows this honestly rather than a green light it can&rsquo;t
            verify.
          </p>
        </div>
      </section>
    );
  }

  const rows: Row[] = [
    ...status.jobs.map((j) => ({
      key: j.key,
      name: j.name,
      level: j.lastStatus,
      detail: j.detail,
    })),
    {
      key: 'notifications',
      name: 'Notification delivery',
      level: status.notifications.level,
      detail: status.notifications.detail,
    },
    {
      key: 'worker',
      name: 'Operator worker',
      level: status.worker.level,
      detail: status.worker.detail,
    },
    {
      key: 'config',
      name: 'Messaging & Inngest',
      level: status.config.level,
      detail: status.config.detail,
    },
  ];

  return (
    <section
      data-testid="settings-reliability-section"
      data-overall={status.overall}
      style={cardStyle}
    >
      <div style={headStyle}>
        <div style={headTitleRowStyle}>
          <span style={dotStyle(status.overall)} aria-hidden="true" />
          <h3
            className="font-serif-display"
            style={headTitleStyle}
            data-testid="settings-reliability-overall"
          >
            {status.summary.heading}
          </h3>
        </div>
        <p style={headSubtitleStyle} data-testid="settings-reliability-summary">
          {status.summary.sentence}
        </p>
        <p style={trustNoteStyle}>
          No money movement is automated — every action stays a draft, queue, or review until you
          approve it.
        </p>
      </div>

      <ul style={listStyle}>
        {rows.map((r) => (
          <li
            key={r.key}
            style={rowStyle}
            data-testid={`settings-reliability-row-${r.key}`}
            data-level={r.level}
          >
            <span style={{ ...dotStyle(r.level, 8), marginTop: 5 }} aria-hidden="true" />
            <span>
              <span style={rowNameStyle}>{r.name}</span>
              <span style={rowDetailStyle}>
                <br />
                {r.detail}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
