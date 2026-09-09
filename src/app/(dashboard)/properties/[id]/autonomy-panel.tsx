/**
 * Autonomy panel — read-only display of the property's graduated trust
 * level + per-action-type rollup of how the commit gate has been
 * deciding.
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │  AUTONOMY        Level 0.50 · graduating               │
 *   │  ─────────────────────────────────────────────────     │
 *   │  Auto    SMS drafts            (47 successful)         │
 *   │  Review  Late-fee waivers      (12 reviewed)           │
 *   │  Blocked Lease changes         (3 refused)             │
 *   └────────────────────────────────────────────────────────┘
 *
 * This is a Server Component: it accepts the rollup as a prop so the
 * parent can fetch it once alongside the proposals feed. There's no
 * client interactivity here — autonomy is owned by the worker layer
 * and only reflected on this page.
 */

import type { AutonomyActionRow } from '@/lib/properties/queries';

interface AutonomyPanelProps {
  autonomyLevel: number;
  rows: AutonomyActionRow[];
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  draft_sms_reply: 'SMS drafts',
  classify_intent: 'Intent classification',
  confirm_emergency: 'Emergency confirmation',
  polish_briefing: 'Briefing polish',
  dispatch_vendor: 'Vendor dispatch',
  update_rulebook: 'Rulebook updates',
};

function formatActionType(actionType: string): string {
  if (ACTION_TYPE_LABELS[actionType]) return ACTION_TYPE_LABELS[actionType];
  // Fallback for unknown action_types: human-readable from snake_case.
  return actionType
    .split('_')
    .map((s, i) => (i === 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s))
    .join(' ');
}

// Row-specific, honest explanations keyed by the real action_type from
// seed data. These describe Odesa's actual posture on each action — never
// filler.
const ACTION_TYPE_EXPLANATIONS: Record<string, string> = {
  draft_lease_renewal:
    'Odesa can draft renewal language, but your approval is required before sending or changing any lease term.',
  offer_payment_plan:
    'Odesa can prepare payment-plan options, but owner approval is required before offering terms to the tenant.',
  update_rent:
    'Odesa can propose a rent change, but it never updates rent on its own — you approve the new amount first.',
  escalate_collections:
    'Odesa will not escalate collections automatically — this always waits for your explicit action.',
  health_flag:
    'Odesa surfaces health/risk flags for your review; it does not act on them by itself.',
  send_rent_reminder:
    'Odesa drafts rent reminders, but routes them to you before anything sends.',
};

// Decision-based fallback for any action_type without a specific
// explanation. Every row gets a real explanation, never placeholder copy.
const DECISION_EXPLANATIONS: Record<AutonomyActionRow['decision'], string> = {
  auto: 'Odesa commits these without asking.',
  review:
    'Odesa drafts these, then routes them to you; nothing happens until you approve.',
  block: 'Odesa will not do these automatically; they are held for you.',
};

const SHARED_TRUST_LINE =
  'This reflects graduated trust on this property, not a global setting.';

function explainAction(r: AutonomyActionRow): string {
  return ACTION_TYPE_EXPLANATIONS[r.actionType] ?? DECISION_EXPLANATIONS[r.decision];
}

function describeAutonomy(level: number): string {
  if (level >= 0.85) return 'broadly trusted';
  if (level >= 0.6) return 'trusted with review';
  if (level >= 0.35) return 'graduating';
  if (level > 0) return 'cautious';
  return 'unset';
}

export function AutonomyPanel({ autonomyLevel, rows }: AutonomyPanelProps) {
  const descriptor = describeAutonomy(autonomyLevel);
  const levelText = autonomyLevel.toFixed(2);

  return (
    <section
      data-testid="property-autonomy-panel"
      aria-labelledby="property-autonomy-heading"
      data-autonomy-level={levelText}
      className="flex flex-col gap-0"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        overflow: 'hidden',
      }}
    >
      {/* CSS-only disclosure affordances: hide the native marker (incl.
          webkit) and rotate the chevron when expanded. No JS. */}
      <style>{`
        .autonomy-summary::-webkit-details-marker { display: none; }
        .autonomy-summary { list-style: none; }
        details[open] > .autonomy-summary .autonomy-chevron {
          transform: rotate(90deg);
        }
      `}</style>
      <header
        className="flex items-baseline justify-between gap-4"
        style={{
          padding: '24px 28px 16px',
          borderBottom: '1px solid var(--ink-200)',
        }}
      >
        <div className="flex flex-col gap-1">
          <h2
            id="property-autonomy-heading"
            className="font-serif-display"
            style={{
              fontSize: '20px',
              lineHeight: 1.2,
              letterSpacing: '-0.005em',
              color: 'var(--ink-900)',
            }}
          >
            Autonomy
          </h2>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-600)',
              maxWidth: '60ch',
            }}
          >
            What Odesa commits without asking, and what gets routed back
            for your eyes.
          </p>
        </div>
        <div
          data-testid="property-autonomy-level"
          className="flex flex-col items-end gap-0"
        >
          <span
            className="tabular-nums"
            style={{
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              fontSize: '24px',
              fontWeight: 600,
              lineHeight: 1.1,
              color: 'var(--ink-900)',
            }}
          >
            {levelText}
          </span>
          <span
            className="meta-label"
            style={{
              color: 'var(--ink-500)',
              textTransform: 'none',
              letterSpacing: '0.02em',
              fontSize: '12px',
            }}
          >
            {descriptor}
          </span>
        </div>
      </header>

      {rows.length === 0 ? (
        <p
          data-testid="property-autonomy-empty"
          style={{
            padding: '24px 28px',
            fontSize: '13px',
            lineHeight: 1.55,
            color: 'var(--ink-500)',
          }}
        >
          No proposals yet. Once Odesa starts working this property, the
          gate decisions show up here grouped by action type.
        </p>
      ) : (
        <ul
          data-testid="property-autonomy-rows"
          className="flex flex-col"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {rows.map((r, i) => (
            <li
              key={r.actionType}
              data-testid={`property-autonomy-row-${r.actionType}`}
              data-decision={r.decision}
              style={{
                borderBottom:
                  i === rows.length - 1
                    ? 'none'
                    : '1px solid var(--ink-200)',
              }}
            >
              <details
                data-testid={`property-autonomy-details-${r.actionType}`}
                style={{ width: '100%' }}
              >
                <summary
                  className="autonomy-summary grid items-center"
                  style={{
                    gridTemplateColumns: '92px 1fr auto auto',
                    gap: '16px',
                    padding: '16px 28px',
                    cursor: 'pointer',
                    listStyle: 'none',
                  }}
                >
                  <DecisionPill decision={r.decision} />
                  <span
                    style={{
                      fontSize: '14px',
                      lineHeight: 1.4,
                      color: 'var(--ink-800)',
                    }}
                  >
                    {formatActionType(r.actionType)}
                  </span>
                  <span
                    className="tabular-nums"
                    style={{
                      fontFamily:
                        "var(--font-mono-metrics), 'JetBrains Mono', monospace",
                      fontSize: '12px',
                      color: 'var(--ink-500)',
                    }}
                  >
                    {summaryCount(r)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="autonomy-chevron"
                    style={{
                      fontSize: '11px',
                      lineHeight: 1,
                      color: 'var(--ink-500)',
                      transition: 'transform 120ms ease',
                    }}
                  >
                    ▸
                  </span>
                </summary>
                <p
                  data-testid={`property-autonomy-explain-${r.actionType}`}
                  style={{
                    margin: 0,
                    padding: '0 28px 16px',
                    fontSize: '13px',
                    lineHeight: 1.55,
                    color: 'var(--ink-600)',
                    maxWidth: '64ch',
                  }}
                >
                  {explainAction(r)}{' '}
                  <span style={{ color: 'var(--ink-500)' }}>
                    {SHARED_TRUST_LINE}
                  </span>
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function summaryCount(r: AutonomyActionRow): string {
  switch (r.decision) {
    case 'auto':
      return `${r.committedCount} successful`;
    case 'review':
      return `${r.reviewCount} reviewed`;
    case 'block':
      return `${r.blockedCount} refused`;
  }
}

interface DecisionPillProps {
  decision: AutonomyActionRow['decision'];
}

function DecisionPill({ decision }: DecisionPillProps) {
  const { label, fg, bg } = decisionStyle(decision);
  return (
    <span
      data-testid={`property-autonomy-pill-${decision}`}
      data-decision={decision}
      className="meta-label inline-flex items-center justify-center rounded-md"
      style={{
        color: fg,
        background: bg,
        textTransform: 'none',
        letterSpacing: '0.02em',
        fontSize: '11px',
        fontWeight: 500,
        padding: '4px 8px',
        width: 'fit-content',
        minWidth: '64px',
      }}
    >
      {label}
    </span>
  );
}

function decisionStyle(decision: AutonomyActionRow['decision']): {
  label: string;
  fg: string;
  bg: string;
} {
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
}
