'use client';

import type { CSSProperties } from 'react';

/**
 * Green batch banner for the /owner-queue "Decisions Desk".
 *
 * Three states:
 *  - batchApproved → honest success status bar (role=status, aria-live=polite).
 *    There is NO "Undo" affordance: the approvals are recorded server-side and
 *    cannot be reversed by the client, so the banner never offers a no-op undo.
 *  - routineCount === 0 → honest zero-routine bar with NO approve action
 *    ("No routine approvals right now."); the approve-all button never
 *    renders at 0.
 *  - otherwise → recommendation bar with a "Review batch {n}" action.
 *
 * All copy is COMPUTED from props with correct singular/plural — there are no
 * hardcoded counts or fabricated framing (no "the 5th needs a closer look", no
 * invented audit-trail promise). The default-state sub-line states the routine
 * total and, when there are review items, how many need a closer look.
 *
 * OWNER-QUEUE PASS 2 — REAL batch commit. The review-batch button is ENABLED
 * and opens the ApproveAllModal (the explicit confirm + commit happen there).
 * The success-state sub-line is HONEST about what the commit actually did:
 * `committedSummary` carries the counts of each committed kind, so the line
 * reads "messages sent / payment links issued / leases changed / dispatch
 * recorded" — only for the kinds that were actually in the batch. With no
 * summary it falls back to a neutral "Odesa recorded your approval" line, and
 * `committedCount` (when supplied) reflects how many of the batch actually
 * committed, so a partial success never overstates.
 *
 * All colors come from the warm CSS custom properties so the banner tracks the
 * `today-theme` wrapper. Numbers carry `.num` for tabular figures.
 */

/** Counts of each kind that actually committed in the batch (for honest copy). */
export interface CommittedSummary {
  /** `send_tenant_message` / `draft_sms_reply` commits — "messages sent". */
  messages: number;
  /** `request_rent_payment` commits — "payment links issued". */
  payments: number;
  /** `update_rent` / `set_lease_terms` commits — "leases changed". */
  leases: number;
  /** `dispatch_vendor` commits — "dispatch recorded" (vendor not contacted). */
  dispatches: number;
}

export interface DecisionSummaryBannerProps {
  /** Number of routine decisions Odesa recommends approving. */
  routineCount: number;
  /** Number of decisions that need owner judgment and are excluded from batch. */
  reviewCount?: number;
  /** Pre-formatted total dollar amount (e.g. "$4,040"). */
  totalAmount: string;
  /** Whether the batch has been approved (flips to the success state). */
  batchApproved: boolean;
  /** Approve-all click handler (opens the confirm modal). */
  onApproveAll: () => void;
  /**
   * How many of the batch actually committed (success state). Defaults to
   * `routineCount` so a full-success batch reads naturally; pass the real
   * committed count after a partial success so the banner never overstates.
   */
  committedCount?: number;
  /**
   * Per-kind committed counts (success state). When present, drives the honest
   * "messages sent / payment links issued / leases changed / dispatch recorded"
   * sub-line reflecting ONLY the kinds that were in the batch.
   */
  committedSummary?: CommittedSummary;
}

const barStyle: CSSProperties = {
  background: 'var(--green-bg)',
  border: '1px solid var(--green-border)',
  borderRadius: 10,
  boxShadow: 'inset 4px 0 0 var(--green)',
  padding: '16px 20px',
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  marginBottom: 28,
};

const bodyStyle: CSSProperties = {
  flex: 1,
};

const titleStyle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--green-ink)',
  letterSpacing: '-0.005em',
  marginBottom: 2,
};

const subStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--green-ink)',
  opacity: 0.82,
};

const approveBtnStyle: CSSProperties = {
  background: 'var(--green)',
  color: '#FBF8EE',
  border: '1px solid var(--green)',
  borderRadius: 6,
  padding: '8px 15px',
  fontSize: '12.5px',
  fontWeight: 450,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

/** "1 routine decision" / "3 routine decisions" — correct singular/plural. */
function routineLabel(count: number): string {
  return `${count} routine decision${count === 1 ? '' : 's'}`;
}

/**
 * The zero-routine sub-line: singular/plural safe, without implying any
 * nonexistent batch action.
 */
function reviewJudgmentLine(count: number): string {
  if (count === 0) return 'No owner decisions are waiting on a batch action.';
  return count === 1
    ? '1 judgment item needs your decision below.'
    : `${count} judgment items need your decisions below.`;
}

/**
 * Honest success sub-line: enumerates ONLY the kinds that actually committed,
 * e.g. "2 messages sent · 1 payment link issued". Falls back to a neutral line
 * when no per-kind summary is supplied (or nothing identifiable committed).
 */
function committedSubLine(
  committedCount: number,
  summary: CommittedSummary | undefined,
): string {
  if (!summary) {
    return committedCount === 1
      ? 'Odesa recorded your approval for this decision.'
      : 'Odesa recorded your approval for each decision.';
  }

  const clauses: string[] = [];
  if (summary.messages > 0) {
    clauses.push(
      `${summary.messages} message${summary.messages === 1 ? '' : 's'} sent`,
    );
  }
  if (summary.payments > 0) {
    clauses.push(
      `${summary.payments} payment link${summary.payments === 1 ? '' : 's'} issued`,
    );
  }
  if (summary.leases > 0) {
    clauses.push(
      `${summary.leases} lease${summary.leases === 1 ? '' : 's'} changed`,
    );
  }
  if (summary.dispatches > 0) {
    clauses.push(
      `${summary.dispatches} dispatch${
        summary.dispatches === 1 ? '' : 'es'
      } recorded`,
    );
  }

  if (clauses.length === 0) {
    return committedCount === 1
      ? 'Odesa recorded your approval for this decision.'
      : 'Odesa recorded your approval for each decision.';
  }

  return clauses.join(' · ');
}

export function DecisionSummaryBanner({
  routineCount,
  reviewCount = 0,
  totalAmount,
  batchApproved,
  onApproveAll,
  committedCount,
  committedSummary,
}: DecisionSummaryBannerProps) {
  if (batchApproved) {
    const committed = committedCount ?? routineCount;
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="batch-success"
        style={barStyle}
      >
        <div style={bodyStyle}>
          <div style={titleStyle}>
            {committed === 1
              ? '1 decision committed'
              : `${committed} decisions committed`}
          </div>
          <div style={subStyle}>
            {committedSubLine(committed, committedSummary)}
          </div>
        </div>
      </div>
    );
  }

  // Zero-routine branch: an honest status bar with NO approve action. The
  // "Approve all 0" button must never render — bulk approval is meaningless
  // (and server-guarded) when nothing is auto-gated.
  if (routineCount === 0) {
    return (
      <div data-testid="decision-summary-banner" style={barStyle}>
        <div style={bodyStyle}>
          <div style={titleStyle}>No routine approvals right now.</div>
          <div style={subStyle}>{reviewJudgmentLine(reviewCount)}</div>
        </div>
      </div>
    );
  }

  // Honest default-state sub-line, computed from props. Only mention the
  // review items when there actually are some.
  const reviewClause =
    reviewCount > 0
      ? reviewCount === 1
        ? ' · 1 judgment item stays separate'
        : ` · ${reviewCount} judgment items stay separate`
      : '';

  return (
    <div data-testid="decision-summary-banner" style={barStyle}>
      <div style={bodyStyle}>
        <div style={titleStyle}>
          Routine approvals ready: {routineLabel(routineCount)}
        </div>
        <div style={subStyle}>
          <span className="num">{totalAmount}</span> total · review the exact
          included actions before anything commits{reviewClause}
        </div>
      </div>
      <button
        type="button"
        data-testid="approve-all-button"
        style={approveBtnStyle}
        onClick={onApproveAll}
      >
        Review batch {routineCount}
      </button>
    </div>
  );
}
