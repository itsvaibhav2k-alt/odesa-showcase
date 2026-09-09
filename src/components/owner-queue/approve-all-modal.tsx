'use client';

import { useState, type CSSProperties } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Decision } from '@/lib/owner-queue/mock-decisions';
import { editKindFor } from '@/lib/owner-queue/decision-actions';
import type { BatchApproveItemResult } from '@/app/(dashboard)/owner-queue/actions';

/**
 * Batch-approve confirmation modal for the /owner-queue "Decisions Desk".
 *
 * Built on the @base-ui/react Dialog primitives, which provide the
 * focus-trap, Escape-to-close, and aria-labelledby/describedby wiring via
 * DialogTitle / DialogDescription. We drive open state externally and funnel
 * any close intent (backdrop, Escape) back through `onClose`.
 *
 * OWNER-QUEUE PASS 2 — REAL batch commit. The modal scopes the batch to the
 * `routine` decisions it is handed (the page passes ONLY `gate_decision==='auto'`
 * / recommendation 'approve' items — the auto-gated set safe to bulk-approve).
 * The "Included" list enumerates those decisions by title + location and, for
 * any item that sends a message, issues a payment link, or changes a lease,
 * renders a per-row side-effect line derived from `decision.actionType` (so an
 * owner sees exactly what each approval would do). The "Not included" section
 * lists the decisions that need owner judgment, honestly — no fabricated
 * "held until 3 PM" status, no invented amounts.
 *
 * SAFETY — committing is real and dangerous. When ANY included item is
 * side-effecting (sends a message / issues a payment link / changes a lease),
 * the confirm button stays DISABLED behind an explicit acknowledgement checkbox
 * — "I understand this sends N message(s) / issues M payment link(s) / changes
 * K lease(s)." — so a bulk commit can never fire from a single click. A pure
 * dispatch-only batch (records approvals, contacts nobody) needs no second
 * confirm.
 *
 * `onConfirm(ids)` is the batchApprove-backed handler the client owns: it runs
 * `batchApprove(ids)` and reconciles per-decision state, returning the per-id
 * results so the modal can render partial-failure honestly. On full success the
 * modal closes (the client flips the banner to its success state); on partial
 * failure the modal stays open and lists which items failed and why.
 *
 * All colors come from the warm CSS custom properties (no hardcoded hex).
 */

/** Aggregate result the batchApprove-backed handler returns to the modal. */
export interface ApproveAllResult {
  ok: boolean;
  results: BatchApproveItemResult[];
}

export interface ApproveAllModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Close handler (backdrop / Escape / Cancel / Done). */
  onClose: () => void;
  /**
   * Confirm handler — runs `batchApprove(ids)` and reconciles state in the
   * client, resolving to the per-id results. The modal passes the auto-gated
   * `routine` ids it enumerated.
   */
  onConfirm: (ids: string[]) => Promise<ApproveAllResult>;
  /** Routine decisions included in the batch (auto-gated, recommendation 'approve'). */
  routine: Decision[];
  /** Decisions excluded because they need owner judgment. */
  excluded: Decision[];
  /** Pre-formatted total dollar amount (e.g. "$4,040"). */
  totalAmount: string;
}

/** A side-effect kind for an included decision (null when it has none). */
type SideEffectKind = 'message' | 'rent_payment' | 'lease' | 'dispatch' | null;

/**
 * The per-row side-effect line for an included decision, derived ONLY from its
 * real `actionType`. Returns null for items with no tenant/vendor/money/lease
 * side effect (so we never invent one).
 */
function sideEffectFor(decision: Decision): string | null {
  switch (sideEffectKindFor(decision)) {
    case 'message':
      return 'Sends a message to the tenant';
    case 'rent_payment':
      return 'Issues a rent payment request to the tenant';
    case 'lease':
      return 'Changes the lease terms';
    case 'dispatch':
      return 'Records your approval for the dispatch workflow (vendor is not contacted)';
    default:
      return null;
  }
}

/** The side-effect kind for an included decision, from its real action type. */
function sideEffectKindFor(decision: Decision): SideEffectKind {
  return editKindFor(decision.actionType);
}

/**
 * The real money figure for an included row, or null. We only surface a figure
 * the decision actually carries (its relabeled money chip) — never a value
 * hardcoded against a mock id.
 */
function amountFor(decision: Decision): string | null {
  if (decision.financialLabel == null) return null;
  return decision.metricChips[0]?.value ?? null;
}

/** Counts of each acknowledgement-worthy side effect across the included set. */
interface SideEffectCounts {
  messages: number;
  payments: number;
  leases: number;
}

/**
 * Tallies the acknowledgement-worthy side effects across the included batch.
 * `dispatch` is excluded — recording a dispatch approval contacts nobody and
 * spends nothing, so it never gates the confirm behind a second check.
 */
function countSideEffects(routine: Decision[]): SideEffectCounts {
  let messages = 0;
  let payments = 0;
  let leases = 0;
  for (const decision of routine) {
    switch (sideEffectKindFor(decision)) {
      case 'message':
        messages += 1;
        break;
      case 'rent_payment':
        payments += 1;
        break;
      case 'lease':
        leases += 1;
        break;
      default:
        break;
    }
  }
  return { messages, payments, leases };
}

/** True when the batch contains any acknowledgement-worthy side effect. */
function hasSideEffects(counts: SideEffectCounts): boolean {
  return counts.messages > 0 || counts.payments > 0 || counts.leases > 0;
}

/** "N message(s)" / "M payment link(s)" / "K lease(s)" — only nonzero clauses. */
function acknowledgementCopy(counts: SideEffectCounts): string {
  const parts: string[] = [];
  if (counts.messages > 0) {
    parts.push(`${counts.messages} message${counts.messages === 1 ? '' : 's'}`);
  }
  if (counts.payments > 0) {
    parts.push(
      `${counts.payments} payment link${counts.payments === 1 ? '' : 's'}`,
    );
  }
  if (counts.leases > 0) {
    parts.push(`${counts.leases} lease${counts.leases === 1 ? '' : ' change'}`);
  }
  return joinClauses(parts);
}

/** Joins clauses with commas + a trailing "and" — "a, b and c". */
function joinClauses(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const contentStyle: CSSProperties = {
  background: 'var(--panel-clean)',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 14,
  boxShadow: '0 24px 60px rgba(27, 23, 18, 0.22)',
  color: 'var(--ink)',
  overflow: 'hidden',
};

const headStyle: CSSProperties = {
  padding: '22px 24px 18px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: '22px',
  fontStyle: 'italic',
  letterSpacing: '-0.015em',
  color: 'var(--ink)',
  marginBottom: 6,
};

const impactStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ink-2)',
};

const impactNumStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  color: 'var(--ink)',
  fontWeight: 450,
};

const bodyStyle: CSSProperties = {
  padding: '16px 24px 6px',
  maxHeight: '52vh',
  overflowY: 'auto',
};

const listLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 9,
};

const itemStyle: CSSProperties = {
  padding: '7px 0',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  fontSize: '13px',
  color: 'var(--ink)',
};

const nameStyle: CSSProperties = {
  fontWeight: 450,
  letterSpacing: '-0.005em',
};

const locStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  flex: 1,
};

const amtStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '12.5px',
  color: 'var(--ink)',
  fontFeatureSettings: "'tnum' 1",
};

const sideEffectStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  letterSpacing: '-0.003em',
  marginTop: 3,
};

/** Per-row failure line shown after a partial-failure commit. */
const failLineStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--terracotta)',
  letterSpacing: '-0.003em',
  marginTop: 3,
};

/** Per-row committed line shown after a successful commit. */
const committedLineStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--green-ink)',
  letterSpacing: '-0.003em',
  marginTop: 3,
};

const mutedNameStyle: CSSProperties = {
  ...nameStyle,
  color: 'var(--ink-2)',
};

const excludedStyle: CSSProperties = {
  marginTop: 12,
  paddingTop: 14,
  borderTop: '1px dashed var(--amber-border)',
};

const excludedLabelStyle: CSSProperties = {
  ...listLabelStyle,
  color: 'var(--amber-ink)',
};

const noteStyle: CSSProperties = {
  padding: '0 0 4px',
};

const notePrimaryStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-3)',
  marginTop: 6,
};

// Explicit acknowledgement block — the second confirm gate for side-effecting
// batches. Drawn in amber so it reads as a deliberate stop, not a casual note.
const ackStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  marginTop: 12,
  padding: '12px 14px',
  border: '1px solid var(--amber-border)',
  borderRadius: 8,
  background: 'var(--amber-bg-soft)',
};

const ackCheckboxStyle: CSSProperties = {
  marginTop: 2,
  width: 15,
  height: 15,
  accentColor: 'var(--amber-ink)',
  cursor: 'pointer',
  flexShrink: 0,
};

const ackLabelStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--amber-ink)',
  lineHeight: 1.45,
  letterSpacing: '-0.003em',
  cursor: 'pointer',
};

// Batch-level error (e.g. the handler threw / auth lapsed) — terracotta.
const batchErrorStyle: CSSProperties = {
  marginTop: 12,
  fontSize: '12.5px',
  color: 'var(--terracotta)',
  letterSpacing: '-0.003em',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  padding: '16px 24px 20px',
  borderTop: '1px solid var(--hairline-faint)',
  marginTop: 10,
};

const cancelBtnStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-2)',
  padding: '8px 13px',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 6,
  background: 'transparent',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
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

const approveBtnDisabledStyle: CSSProperties = {
  ...approveBtnStyle,
  background: 'var(--green-border)',
  border: '1px solid var(--green-border)',
  color: 'var(--green-ink)',
  opacity: 0.6,
  cursor: 'not-allowed',
};

export function ApproveAllModal({
  open,
  onClose,
  onConfirm,
  routine,
  excluded,
  totalAmount,
}: ApproveAllModalProps) {
  // The explicit second confirm for side-effecting batches.
  const [acknowledged, setAcknowledged] = useState(false);
  // In-flight commit (batchApprove is real and can take a beat).
  const [committing, setCommitting] = useState(false);
  // Per-id results after a (possibly partial) commit; null before any attempt.
  const [results, setResults] = useState<BatchApproveItemResult[] | null>(null);
  // A batch-level failure message (handler threw / nothing committed).
  const [batchError, setBatchError] = useState<string | null>(null);
  // The batch enumerated at confirm time. Snapshotting it keeps the results
  // list stable even as the live `routine` prop shrinks (the client reconciles
  // committed cards out of eligibility once a partial commit resolves).
  const [committedBatch, setCommittedBatch] = useState<Decision[] | null>(null);

  // Reset the transient state on each FRESH open (open false → true), so a
  // previous attempt's results never bleed in. Keyed on `open` ONLY — NOT on
  // the batch ids — so a partial commit (which shrinks the live `routine`)
  // can't wipe the results being displayed. React's adjust-state-during-render
  // pattern (no effect needed).
  const [seededOpen, setSeededOpen] = useState(open);
  if (open !== seededOpen) {
    setSeededOpen(open);
    if (open) {
      setAcknowledged(false);
      setCommitting(false);
      setResults(null);
      setBatchError(null);
      setCommittedBatch(null);
    }
  }

  const hasResults = results != null;
  // Once a commit has resolved, render the snapshot; before that, the live set.
  const includedList = hasResults && committedBatch ? committedBatch : routine;

  const counts = countSideEffects(routine);
  const needsAck = hasSideEffects(counts);

  // Index the per-id results for quick per-row lookup.
  const resultById = new Map<string, BatchApproveItemResult>();
  if (results) {
    for (const r of results) resultById.set(r.id, r);
  }
  const failedCount = results
    ? results.filter((r) => !r.ok).length
    : 0;

  // The confirm is blocked while committing, when an empty batch, or when a
  // side-effecting batch hasn't been explicitly acknowledged.
  const confirmDisabled =
    committing || routine.length === 0 || (needsAck && !acknowledged);

  function handleConfirm(): void {
    if (confirmDisabled) return;
    const batch = routine;
    const ids = batch.map((decision) => decision.id);
    setCommittedBatch(batch);
    setCommitting(true);
    setBatchError(null);
    void onConfirm(ids)
      .then((result) => {
        setResults(result.results);
        if (result.ok) {
          // Every id committed — hand off to the client's success state.
          onClose();
        }
      })
      .catch(() => {
        setBatchError(
          'Something went wrong approving this batch. No further items were committed.',
        );
      })
      .finally(() => {
        setCommitting(false);
      });
  }

  const confirmLabel = confirmLabelFor(
    routine.length,
    counts,
    needsAck,
    committing,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !committing) onClose();
      }}
    >
      <DialogContent
        data-testid="approve-all-modal"
        showCloseButton={false}
        // Portals to document.body (outside `.today-theme`) — re-establish the
        // theme so warm tokens (--ink / --green / --amber-bg-soft …) resolve and
        // the confirm button + chips don't render invisibly.
        className="today-theme p-0 max-w-[460px]"
        style={contentStyle}
      >
        <div style={headStyle}>
          <DialogTitle style={titleStyle}>
            {hasResults
              ? failedCount === 1
                ? '1 decision couldn’t be approved'
                : `${failedCount} decisions couldn’t be approved`
              : routine.length === 1
                ? 'Approve 1 routine decision?'
                : `Approve ${routine.length} routine decisions?`}
          </DialogTitle>
          <DialogDescription style={impactStyle}>
            {hasResults ? (
              'The successful approvals were recorded. Review the items below, then close.'
            ) : (
              <>
                Total cash impact{' '}
                <span className="num" style={impactNumStyle}>
                  {totalAmount}
                </span>{' '}
                this week
              </>
            )}
          </DialogDescription>
        </div>

        <div style={bodyStyle}>
          <div style={listLabelStyle}>Included</div>
          {includedList.map((decision) => {
            const amount = amountFor(decision);
            const sideEffect = sideEffectFor(decision);
            const result = resultById.get(decision.id);
            return (
              <div key={decision.id} style={itemStyle}>
                <div style={rowStyle}>
                  <span style={nameStyle}>{decision.title}</span>
                  <span style={locStyle}>{decision.location}</span>
                  {amount != null && (
                    <span className="num" style={amtStyle}>
                      {amount}
                    </span>
                  )}
                </div>
                {sideEffect != null && (
                  <div style={sideEffectStyle}>{sideEffect}</div>
                )}
                {result != null && !result.ok && (
                  <div
                    role="alert"
                    data-testid={`batch-item-error-${decision.id}`}
                    style={failLineStyle}
                  >
                    Couldn&apos;t approve — {result.error ?? 'please try again'}
                  </div>
                )}
                {result != null && result.ok && (
                  <div
                    data-testid={`batch-item-ok-${decision.id}`}
                    style={committedLineStyle}
                  >
                    Approved
                  </div>
                )}
              </div>
            );
          })}

          {excluded.length > 0 && (
            <div style={excludedStyle}>
              <div style={excludedLabelStyle}>
                Not included · needs your judgment
              </div>
              {excluded.map((decision) => (
                <div key={decision.id} style={itemStyle}>
                  <div style={rowStyle}>
                    <span style={mutedNameStyle}>{decision.title}</span>
                    <span style={locStyle}>{decision.location}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!hasResults && (
            <div role="note" style={noteStyle}>
              <p style={notePrimaryStyle}>
                Approving records your decision for each included item. Items
                that send a message, request a payment, or change a lease are
                noted above.
              </p>
            </div>
          )}

          {/*
            The explicit second confirm. A bulk commit that sends messages,
            issues payment links, or changes leases must be acknowledged before
            the approve button enables — a single click can never fire it.
            A dispatch-only batch (records approvals, contacts nobody) skips this.
          */}
          {needsAck && !hasResults && (
            <label style={ackStyle} data-testid="approve-all-ack">
              <input
                type="checkbox"
                data-testid="approve-all-ack-checkbox"
                style={ackCheckboxStyle}
                checked={acknowledged}
                disabled={committing}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span style={ackLabelStyle}>
                I understand approving this batch sends{' '}
                {acknowledgementCopy(counts)} now.
              </span>
            </label>
          )}

          {batchError && (
            <div role="alert" data-testid="approve-all-error" style={batchErrorStyle}>
              {batchError}
            </div>
          )}
        </div>

        <div style={actionsStyle}>
          <button
            type="button"
            data-testid="modal-cancel-button"
            style={cancelBtnStyle}
            disabled={committing}
            onClick={onClose}
          >
            {hasResults ? 'Close' : 'Cancel'}
          </button>
          {/*
            After a partial-failure commit the batch is no longer re-runnable
            from here (the succeeded items are already committed); the owner
            closes and the remaining items stay on the desk. We only show the
            confirm button before the first attempt resolves.
          */}
          {!hasResults || failedCount > 0 ? (
            <button
              type="button"
              data-testid="modal-approve-button"
              style={
                confirmDisabled ? approveBtnDisabledStyle : approveBtnStyle
              }
              disabled={confirmDisabled}
              aria-disabled={confirmDisabled}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The confirm-button label. Counts make the consequence explicit on the button
 * itself for side-effecting batches ("Confirm — sends 2 messages"); a
 * dispatch-only / no-side-effect batch reads as a plain "Approve N".
 */
function confirmLabelFor(
  count: number,
  counts: SideEffectCounts,
  needsAck: boolean,
  committing: boolean,
): string {
  if (committing) return 'Approving…';
  if (needsAck) {
    return `Confirm — sends ${acknowledgementCopy(counts)}`;
  }
  return count === 1 ? 'Approve 1' : `Approve ${count}`;
}
