'use client';

/**
 * Owner controls for a work order. Two honest paths:
 *
 *  - Priority (urgency): a plain select, auto-saved through the Wave 2
 *    `updateWorkOrderFieldsAction` (urgency-only).
 *  - Vendor lifecycle: guarded action buttons that drive
 *    `transitionWorkOrderLifecycleAction`. Only the transitions VALID for the
 *    current state are shown; every call carries the `expectedVersion` this
 *    page loaded with plus a fresh `requestId` generated once per click, so a
 *    double-click is idempotent and a stale page fails honestly (refresh msg).
 *
 * After a successful mutation we `router.refresh()`, which re-renders the
 * server component and hands the controls the new `lifecycleVersion` + state.
 */

import * as React from 'react';
import type { CSSProperties } from 'react';

import {
  updateWorkOrderFieldsAction,
  transitionWorkOrderLifecycleAction,
  type UpdateWorkOrderInput,
  type TransitionWorkOrderInput,
} from '@/lib/work-orders/actions';
import type { WorkOrderLifecycleProps } from '@/lib/work-orders/queries';
import type { WorkOrderStatus } from '@/types/database';

const URGENCY_OPTIONS = [
  { value: 'emergency', label: 'Emergency' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'routine', label: 'Routine' },
] as const;

const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: '16px',
};

const columnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 500,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const selectStyle: CSSProperties = {
  minWidth: '150px',
  height: '34px',
  borderRadius: '8px',
  border: '1px solid var(--hairline)',
  background: 'var(--panel-clean)',
  color: 'var(--ink-1)',
  padding: '0 10px',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '13.5px',
  cursor: 'pointer',
};

const buttonStyle: CSSProperties = {
  height: '34px',
  borderRadius: '8px',
  border: '1px solid var(--hairline)',
  background: 'var(--panel-clean)',
  color: 'var(--ink-1)',
  padding: '0 14px',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '13px',
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--primary, #E07A2E)',
  borderColor: 'var(--primary, #E07A2E)',
  color: '#fff',
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: 'var(--clay, #b3421f)',
  borderColor: 'color-mix(in srgb, var(--clay, #b3421f) 45%, var(--hairline))',
};

const groupStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: '10px',
};

const feedbackStyle: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '12.5px',
  color: 'var(--ink-3)',
  minHeight: '18px',
};

type Feedback =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'noop' }
  | { kind: 'error'; message: string };

type ConfirmationAction = 'approve' | 'reopen' | 'cancel';

export function EditableTicketControls({
  woId,
  urgency,
  status,
  lifecycle,
}: {
  woId: string;
  urgency: string;
  status: string;
  lifecycle: WorkOrderLifecycleProps;
}): React.ReactElement {
  const [pending, startTransition] = React.useTransition();
  const [feedback, setFeedback] = React.useState<Feedback>({ kind: 'idle' });
  const [urg, setUrg] = React.useState(urgency);
  const [vendorPick, setVendorPick] = React.useState<string>('');
  const [confirmation, setConfirmation] = React.useState<ConfirmationAction | null>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = React.useRef<HTMLElement | null>(null);

  const st = status as WorkOrderStatus;
  const hasVendor = lifecycle.vendorId != null;
  const reviewed = lifecycle.reviewedAt != null;

  React.useEffect(() => {
    if (confirmation) confirmButtonRef.current?.focus();
  }, [confirmation]);

  function commitUrgency(input: UpdateWorkOrderInput): void {
    setFeedback({ kind: 'saving' });
    startTransition(async () => {
      const res = await updateWorkOrderFieldsAction(woId, input);
      setFeedback(res.ok ? { kind: 'saved' } : { kind: 'error', message: 'Save failed — try again' });
    });
  }

  function runTransition(
    action: TransitionWorkOrderInput['action'],
    extra?: { vendorId?: string; vendorResponse?: TransitionWorkOrderInput['vendorResponse'] },
  ): void {
    // One fresh idempotency key per click — a double-click replays, never re-applies.
    const requestId = crypto.randomUUID();
    setFeedback({ kind: 'saving' });
    startTransition(async () => {
      const res = await transitionWorkOrderLifecycleAction(woId, {
        action,
        expectedVersion: lifecycle.lifecycleVersion,
        requestId,
        ...(extra?.vendorId ? { vendorId: extra.vendorId } : {}),
        ...(extra?.vendorResponse ? { vendorResponse: extra.vendorResponse } : {}),
      });
      if (res.ok) {
        setFeedback(res.changed ? { kind: 'saved' } : { kind: 'noop' });
      } else {
        // res.error already carries the honest refresh copy on code:'stale'.
        setFeedback({ kind: 'error', message: res.error });
      }
    });
  }

  const message =
    feedback.kind === 'saving'
      ? 'Working…'
      : feedback.kind === 'saved'
        ? 'Saved ✓'
        : feedback.kind === 'noop'
          ? 'No changes needed.'
          : feedback.kind === 'error'
            ? feedback.message
            : 'Changes are owner-only and logged to the audit trail.';

  // --- state → which lifecycle controls are valid (mirrors the RPC table) ---
  const canAssign = (st === 'open' && !hasVendor) || (st === 'assigned' && hasVendor);
  const canRecordReply = st === 'assigned' && hasVendor;
  const canStart = st === 'assigned' && hasVendor && lifecycle.vendorResponse === 'accepted';
  const canComplete = st === 'in_progress';
  const canReview = st === 'completed' && !reviewed;
  const canCancel = st === 'open' || st === 'assigned' || st === 'in_progress';
  const assignAction = hasVendor ? 'reassign_vendor' : 'assign_vendor';
  const assignLabel = hasVendor ? 'Reassign vendor' : 'Assign vendor';
  const availableVendors = lifecycle.vendors
    .filter((vendor) => vendor.id !== lifecycle.vendorId)
    .map((vendor) => ({
      ...vendor,
      relevant: vendor.category === lifecycle.category,
    }))
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.name.localeCompare(b.name));

  const confirmationCopy: Record<ConfirmationAction, { prompt: string; confirm: string }> = {
    approve: {
      prompt: 'Approve this completed work and remove it from open items?',
      confirm: 'Confirm approval',
    },
    reopen: {
      prompt: 'Reopen this completed work and return it to in progress?',
      confirm: 'Confirm reopen',
    },
    cancel: {
      prompt: 'Cancel this work order? This lifecycle change is logged.',
      confirm: 'Confirm cancellation',
    },
  };

  function confirmAction(action: ConfirmationAction): void {
    setConfirmation(null);
    runTransition(action);
  }

  function requestConfirmation(action: ConfirmationAction): void {
    confirmationTriggerRef.current = document.activeElement as HTMLElement | null;
    setConfirmation(action);
  }

  function dismissConfirmation(): void {
    setConfirmation(null);
    window.requestAnimationFrame(() => confirmationTriggerRef.current?.focus());
  }

  return (
    <div
      style={columnStyle}
      data-testid="wo-edit-controls"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && confirmation) {
          event.preventDefault();
          dismissConfirmation();
        }
      }}
    >
      <div style={rowStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Priority</span>
          <select
            value={urg}
            disabled={pending}
            data-testid="wo-edit-priority"
            aria-label="Work order priority"
            style={selectStyle}
            onChange={(e) => {
              setUrg(e.target.value);
              commitUrgency({ urgency: e.target.value as UpdateWorkOrderInput['urgency'] });
            }}
          >
            {URGENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canAssign && (
        <div style={groupStyle} data-testid="wo-assign-group">
          <label style={fieldStyle}>
            <span style={labelStyle}>{assignLabel}</span>
            <select
              value={vendorPick}
              disabled={pending || availableVendors.length === 0}
              data-testid="wo-assign-vendor-select"
              aria-label="Choose a vendor"
              style={selectStyle}
              onChange={(e) => setVendorPick(e.target.value)}
            >
              <option value="">
                {availableVendors.length === 0
                  ? hasVendor
                    ? 'No other vendors on file'
                    : 'No vendors on file'
                  : 'Select a vendor…'}
              </option>
              {availableVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} — {v.relevant ? `${v.category} match` : `${v.category} fallback`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || vendorPick === ''}
            data-testid="wo-assign-vendor"
            style={primaryButtonStyle}
            onClick={() => runTransition(assignAction, { vendorId: vendorPick })}
          >
            {assignLabel}
          </button>
        </div>
      )}

      {canRecordReply && (
        <div style={fieldStyle} data-testid="wo-record-reply">
          <span style={labelStyle}>Record vendor reply</span>
          <div style={groupStyle}>
            <button
              type="button"
              disabled={pending || lifecycle.vendorResponse === 'accepted'}
              data-testid="wo-record-accepted"
              style={buttonStyle}
              onClick={() => runTransition('record_response', { vendorResponse: 'accepted' })}
            >
              Accepted
            </button>
            <button
              type="button"
              disabled={pending || lifecycle.vendorResponse === 'declined'}
              data-testid="wo-record-declined"
              style={buttonStyle}
              onClick={() => runTransition('record_response', { vendorResponse: 'declined' })}
            >
              Declined
            </button>
            <button
              type="button"
              disabled={pending || lifecycle.vendorResponse === 'no_response'}
              data-testid="wo-record-no-response"
              style={buttonStyle}
              onClick={() => runTransition('record_response', { vendorResponse: 'no_response' })}
            >
              No response
            </button>
          </div>
        </div>
      )}

      {(canStart || canComplete || canReview) && (
        <div style={groupStyle} data-testid="wo-progress-group">
          {canStart && (
            <button
              type="button"
              disabled={pending}
              data-testid="wo-start-work"
              style={primaryButtonStyle}
              onClick={() => runTransition('start_work')}
            >
              Start work
            </button>
          )}
          {canComplete && (
            <button
              type="button"
              disabled={pending}
              data-testid="wo-complete"
              style={primaryButtonStyle}
              onClick={() => runTransition('complete')}
            >
              Mark complete
            </button>
          )}
          {canReview && (
            <>
              <button
                type="button"
                disabled={pending}
                data-testid="wo-approve"
                style={primaryButtonStyle}
                onClick={() => requestConfirmation('approve')}
              >
                Approve result
              </button>
              <button
                type="button"
                disabled={pending}
                data-testid="wo-reopen"
                style={buttonStyle}
                onClick={() => requestConfirmation('reopen')}
              >
                Reopen
              </button>
            </>
          )}
        </div>
      )}

      {canCancel && (
        <div style={groupStyle}>
          <button
            type="button"
            disabled={pending}
            data-testid="wo-cancel"
            style={dangerButtonStyle}
            onClick={() => requestConfirmation('cancel')}
          >
            Cancel work order
          </button>
        </div>
      )}

      {confirmation && (
        <div
          style={{ ...groupStyle, alignItems: 'center' }}
          role="group"
          aria-label={`${confirmation} confirmation`}
          data-testid="wo-confirmation"
        >
          <span style={feedbackStyle}>{confirmationCopy[confirmation].prompt}</span>
          <button
            ref={confirmButtonRef}
            type="button"
            disabled={pending}
            data-testid={`wo-confirm-${confirmation}`}
            style={confirmation === 'cancel' ? dangerButtonStyle : primaryButtonStyle}
            onClick={() => confirmAction(confirmation)}
          >
            {confirmationCopy[confirmation].confirm}
          </button>
          <button
            type="button"
            disabled={pending}
            data-testid="wo-confirm-dismiss"
            style={buttonStyle}
            onClick={dismissConfirmation}
          >
            Keep current state
          </button>
        </div>
      )}

      <span style={feedbackStyle} aria-live="polite" data-testid="wo-edit-feedback">
        {message}
      </span>
    </div>
  );
}
