import type { CSSProperties } from 'react';
import { QueueRow, type QueueRowProps } from './queue-row';

/**
 * Owner-review queue section.
 *
 * Server component. Renders the section head (`OWNER REVIEW · 5` eyebrow plus
 * a right-aligned `sorted by attention ▾` affordance) and the 5 hardcoded
 * queue rows. Mock data is verbatim from `ref-context-map.md` — do not
 * paraphrase, do not promote/demote rows, do not "improve" the italic
 * recommendation copy.
 *
 * PR-3 will replace the hardcoded `ROWS` constant with adapter output from
 * `src/lib/today/queue-adapter.ts` and add selection state. For PR-2 this is
 * fully static.
 */

const sectionStyle: CSSProperties = {
  background: 'transparent',
};

const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  padding: '0 2px 12px',
  gap: 12,
};

const eyebrowStyle: CSSProperties = {
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  padding: 0,
};

const countStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-2)',
  background: 'var(--canvas-deep)',
  padding: '1px 6px',
  borderRadius: 3,
  fontFeatureSettings: "'tnum' 1",
};

const rightStyle: CSSProperties = {
  marginLeft: 'auto',
  fontSize: '11px',
  color: 'var(--ink-3)',
  letterSpacing: '0.04em',
};

const sortStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
};

const queueStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  overflow: 'hidden',
};

/**
 * Hardcoded 5-row mock data. Copy comes verbatim from
 * `Plans/odesa-today-v2-port/ref-context-map.md` → "Row mock data" table.
 *
 * The recommendation strings include inline `.num` spans for tabular numerals
 * on any numeric tokens ($640, $1,425, etc.). The meta tokens are an array so
 * the row can render the ` · ` separators between them; numeric tokens are
 * wrapped in `<span className="num">` per the typography rules.
 */
const ROWS: QueueRowProps[] = [
  {
    rowKey: 'leak',
    status: 'review',
    title: 'Maintenance escalation — slow leak under kitchen sink',
    meta: [
      '14 Maple Ct',
      <span key="unit" className="num">
        Unit 3B
      </span>,
      'tenant: Priya R.',
      <span key="reported">
        reported{' '}
        <span className="num">06:42</span>
      </span>,
    ],
    recommendation: (
      <>
        Odesa recommends approving Greene Plumbing —{' '}
        <span className="num">$640</span> quote,{' '}
        <span className="num">48-hour</span> SLA, used twice before.
      </>
    ),
    time: '12m ago',
    actions: [
      { label: 'Approve', variant: 'primary' },
      { label: 'Review quote', variant: 'secondary' },
    ],
  },
  {
    rowKey: 'rent',
    status: 'draft',
    title: 'Late rent reminder for Sandra K.',
    meta: [
      '22 Oak St',
      <span key="unit" className="num">
        Unit 1
      </span>,
      <span key="late">
        day <span className="num">5</span> late
      </span>,
      <span key="amt" className="num">
        $1,425
      </span>,
    ],
    recommendation: (
      <>
        Odesa drafted a warm but firm message. No payment plan needed yet —
        she&apos;s been on time eleven months running.
      </>
    ),
    time: '1h ago',
    actions: [
      { label: 'Send', variant: 'primary' },
      { label: 'Edit draft', variant: 'secondary' },
    ],
  },
  {
    rowKey: 'vendor',
    status: 'waiting',
    title: 'Vendor silence — Greene HVAC, second nudge unanswered',
    meta: [
      '108 Cedar Ln',
      <span key="unit" className="num">
        Unit 2A
      </span>,
      'no reply since Friday',
      <span key="dur" className="num">
        3 days
      </span>,
    ],
    recommendation: (
      <>
        Two SMS nudges sent. A phone call from you reads firmer than a third
        message — Odesa can ghost-write the script.
      </>
    ),
    time: '3h ago',
    actions: [
      { label: 'Escalate', variant: 'secondary' },
      { label: 'Snooze', variant: 'secondary' },
    ],
  },
  {
    rowKey: 'noise',
    status: 'escalated',
    title: 'Tenant complaint — noise dispute, second mention this month',
    meta: [
      '22 Oak St',
      <span key="unit" className="num">
        Unit 4
      </span>,
      'tenant: Marcus T.',
      <span key="thread">
        thread of <span className="num">4</span>
      </span>,
    ],
    recommendation: (
      <>
        Context logged across both incidents. A short reply now is cheaper than
        a pattern later — Odesa has a tone-neutral draft.
      </>
    ),
    time: 'yesterday',
    actions: [
      { label: 'Reply', variant: 'secondary' },
      { label: 'Open thread', variant: 'secondary' },
    ],
  },
  {
    rowKey: 'lockbox',
    status: 'resolved',
    title: 'Quarterly lockbox code rotation — all six properties',
    meta: [
      'portfolio-wide',
      <span key="codes">
        <span className="num">6</span> codes rotated
      </span>,
      'vendors notified',
    ],
    recommendation: (
      <>
        Completed automatically overnight. New codes are shared in the vendor
        portal — no owner action needed.
      </>
    ),
    time: (
      <span className="num">06:14</span>
    ),
    actions: [{ label: 'View log', variant: 'secondary' }],
  },
];

export function OwnerReviewQueue() {
  return (
    <section data-section="owner-review" style={sectionStyle}>
      <div style={sectionHeadStyle}>
        <div style={eyebrowStyle}>Owner review</div>
        <div className="num" style={countStyle}>
          {ROWS.length}
        </div>
        <div style={rightStyle}>
          sorted by <span style={sortStyle}>attention ▾</span>
        </div>
      </div>

      <div style={queueStyle}>
        {ROWS.map((row) => (
          <QueueRow key={row.rowKey} {...row} />
        ))}
      </div>
    </section>
  );
}
