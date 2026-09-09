/**
 * Recent decisions feed — last N action_proposals for the property.
 *
 * Each row shows: relative timestamp · action_type · gate_decision pill
 * · status pill · expandable reasoning paragraph · edit_diff (when the
 * owner edited the worker's draft before committing).
 *
 * The expansion control is a `<details>` element so server-rendered
 * markup stays interactive without client-side JS — meaningful for
 * sub-second hydration on a property page that already ships a
 * client component (rulebook + privacy mode card).
 */

import type { ProposalFeedRow } from '@/lib/properties/queries';

interface ProposalsFeedProps {
  rows: ProposalFeedRow[];
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  draft_sms_reply: 'SMS draft',
  classify_intent: 'Intent classification',
  confirm_emergency: 'Emergency confirmation',
  polish_briefing: 'Briefing polish',
  dispatch_vendor: 'Vendor dispatch',
  update_rulebook: 'Rulebook update',
  send_tenant_message: 'Tenant message',
  request_rent_payment: 'Rent payment request',
  update_rent: 'Rent update',
  offer_payment_plan: 'Payment plan offer',
  health_flag: 'Portfolio follow-up needed',
};

/** "set_lease_terms" → "Set Lease Terms" — never leak a raw action_type. */
function humanizeActionType(actionType: string): string {
  return actionType
    .split('_')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ')
    .trim();
}

function formatActionType(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] ?? humanizeActionType(actionType);
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function ProposalsFeed({ rows }: ProposalsFeedProps) {
  return (
    <section
      data-testid="property-proposals-feed"
      aria-labelledby="property-proposals-heading"
      className="flex flex-col gap-0"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        overflow: 'hidden',
      }}
    >
      <header
        className="flex items-baseline justify-between gap-4"
        style={{
          padding: '24px 28px 16px',
          borderBottom: '1px solid var(--ink-200)',
        }}
      >
        <div className="flex flex-col gap-1">
          <h2
            id="property-proposals-heading"
            className="font-serif-display"
            style={{
              fontSize: '20px',
              lineHeight: 1.2,
              letterSpacing: '-0.005em',
              color: 'var(--ink-900)',
            }}
          >
            Recent decisions
          </h2>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-600)',
              maxWidth: '60ch',
            }}
          >
            What Odesa proposed for this property and how the gate decided.
            Click a row to read the reasoning.
          </p>
        </div>
        <p
          className="meta-label"
          style={{ color: 'var(--ink-500)' }}
        >
          {rows.length} {rows.length === 1 ? 'decision' : 'decisions'}
        </p>
      </header>

      {rows.length === 0 ? (
        <p
          data-testid="property-proposals-empty"
          style={{
            padding: '24px 28px',
            fontSize: '13px',
            lineHeight: 1.55,
            color: 'var(--ink-500)',
          }}
        >
          No proposals yet. Once Odesa starts working this property, every
          decision lands here for review.
        </p>
      ) : (
        <ul
          className="flex flex-col"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {rows.map((row, i) => (
            <ProposalRow
              key={row.id}
              row={row}
              isLast={i === rows.length - 1}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProposalRow({
  row,
  isLast,
}: {
  row: ProposalFeedRow;
  isLast: boolean;
}) {
  const editDiffJson =
    row.editDiff != null ? safeStringify(row.editDiff) : null;

  return (
    <li
      data-testid={`property-proposals-row-${row.id}`}
      data-action-type={row.actionType}
      data-gate-decision={row.gateDecision}
      data-status={row.status}
      style={{
        padding: '16px 28px',
        borderBottom: isLast ? 'none' : '1px solid var(--ink-200)',
      }}
    >
      <details style={{ margin: 0 }}>
        <summary
          data-testid={`property-proposals-summary-${row.id}`}
          className="flex flex-wrap items-center gap-3"
          style={{
            cursor: 'pointer',
            listStyle: 'none',
          }}
        >
          <span
            className="tabular-nums"
            style={{
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontSize: '12px',
              color: 'var(--ink-500)',
              minWidth: '64px',
            }}
          >
            {formatRelativeTime(row.createdAt)}
          </span>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--ink-800)',
            }}
          >
            {formatActionType(row.actionType)}
          </span>
          <GatePill decision={row.gateDecision} />
          <StatusPill status={row.status} />
          <span
            className="tabular-nums"
            style={{
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontSize: '12px',
              color: 'var(--ink-500)',
              marginLeft: 'auto',
            }}
          >
            {Math.round(row.confidence * 100)}%
          </span>
        </summary>

        <div
          data-testid={`property-proposals-detail-${row.id}`}
          className="flex flex-col gap-3"
          style={{ marginTop: '12px' }}
        >
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.6,
              color: 'var(--ink-700)',
              whiteSpace: 'pre-wrap',
              maxWidth: '70ch',
            }}
          >
            {row.reasoning || 'No reasoning recorded.'}
          </p>

          {editDiffJson ? (
            <div
              data-testid={`property-proposals-edit-${row.id}`}
              className="flex flex-col gap-1.5"
            >
              <p
                className="meta-label"
                style={{ color: 'var(--ink-500)' }}
              >
                Owner edits
              </p>
              <pre
                style={{
                  fontFamily:
                    "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: 'var(--ink-700)',
                  background: 'var(--paper-50)',
                  border: '1px solid var(--ink-200)',
                  borderRadius: 'var(--radius-md-odesa)',
                  padding: '10px 12px',
                  margin: 0,
                  overflowX: 'auto',
                  maxHeight: '200px',
                }}
              >
                {editDiffJson}
              </pre>
            </div>
          ) : null}

          <span
            className="meta-label"
            style={{ color: 'var(--ink-500)' }}
          >
            via {row.workerModel}
            {row.committedAt
              ? ` · committed ${formatRelativeTime(row.committedAt)}`
              : ''}
          </span>
        </div>
      </details>
    </li>
  );
}

function GatePill({ decision }: { decision: ProposalFeedRow['gateDecision'] }) {
  const { fg, bg, label } = (() => {
    switch (decision) {
      case 'auto':
        return {
          label: 'Auto',
          fg: 'var(--success-600)',
          bg: 'rgba(46, 125, 91, 0.10)',
        };
      case 'review':
        return {
          label: 'Review',
          fg: 'var(--warning-600)',
          bg: 'rgba(192, 136, 53, 0.10)',
        };
      case 'block':
        return {
          label: 'Blocked',
          fg: 'var(--error-600)',
          bg: 'rgba(180, 67, 76, 0.10)',
        };
    }
  })();
  return (
    <span
      data-testid={`property-proposals-gate-${decision}`}
      className="inline-flex items-center justify-center rounded-md"
      style={{
        color: fg,
        background: bg,
        fontSize: '11px',
        fontWeight: 500,
        padding: '3px 8px',
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: ProposalFeedRow['status'] }) {
  const { fg, label } = (() => {
    switch (status) {
      case 'committed':
        return { fg: 'var(--success-600)', label: 'Committed' };
      case 'committing':
        return { fg: 'var(--gold-700)', label: 'In progress' };
      case 'failed':
        return { fg: 'var(--error-600)', label: 'Failed' };
      case 'unsupported':
        return { fg: 'var(--error-600)', label: 'Unsupported' };
      case 'edited':
        return { fg: 'var(--navy-700)', label: 'Edited' };
      case 'rejected':
        return { fg: 'var(--error-600)', label: 'Rejected' };
      case 'expired':
        return { fg: 'var(--ink-500)', label: 'Expired' };
      case 'proposed':
        return { fg: 'var(--ink-600)', label: 'Proposed' };
    }
  })();
  return (
    <span
      data-testid={`property-proposals-status-${status}`}
      className="meta-label"
      style={{
        color: fg,
        textTransform: 'none',
        letterSpacing: '0.02em',
        fontSize: '11px',
      }}
    >
      {label}
    </span>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
