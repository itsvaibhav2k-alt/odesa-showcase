'use client';

/**
 * LeaseTermsEditor — small inline form under an expanded /rent ledger row.
 *
 * Edits rent_amount / rent_due_day / lease end_date and offers a one-way
 * "End this lease" (active→terminated) path. Edits apply to FUTURE cycles
 * by design; the optional "also update this month's unpaid cycle" checkbox
 * triggers the action's conditional UPDATE, which only lands while the
 * current row is still status='pending' AND unpaid — a 0-row result is
 * surfaced as "already in progress, applies from next cycle".
 *
 * Two-stage flow (trust requirement): stage 1 edits fields and validates;
 * "Review term changes" advances to an inline review stage that diffs the
 * draft against the ORIGINAL loaded terms (`terms.*` props) and states
 * explicitly what does NOT happen. Only the review stage's confirm button
 * calls `updateLeaseTermsAction` — the form's onSubmit always
 * preventDefault()s and at most advances to review, so Enter in a field
 * can never trigger the save.
 *
 * Terminating disables the checkbox: the open cycle stays collectible and
 * keeps its reminder schedule until paid or escalated (no cancel path
 * exists in rent_event_status). Termination additionally requires typing
 * END LEASE in the review stage before the confirm button enables.
 */

import {
  useState,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type ReactElement,
} from 'react';
import { useRouter } from 'next/navigation';

import { dueDateFor } from '@/lib/rent/generate-cycle';
import type { RentLeaseTerms } from '@/lib/properties/mock-portfolio-views';

import { updateLeaseTermsAction } from './actions';

export interface LeaseTermsEditorProps {
  terms: RentLeaseTerms;
  tenantName: string;
  /** Display identity for the review stage, e.g. "22 Oak St · 1A". */
  unitLabel?: string;
  onClose: () => void;
}

interface Notice {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

type Stage = 'edit' | 'review';

const TERMINATE_CONFIRM_TEXT = 'END LEASE';

/* ------------------------------------------------------------------ */
/* Styles — quiet inline panel, mono micro-labels                      */
/* ------------------------------------------------------------------ */

const panelStyle: CSSProperties = {
  borderTop: '1px dashed var(--hairline)',
  background: 'var(--panel-clean)',
  padding: '14px 18px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'flex-end',
};

const labelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '12.5px',
  color: 'var(--ink)',
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  padding: '6px 9px',
  width: 110,
};

const checkLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontSize: '12px',
  color: 'var(--ink-2)',
};

const helperStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  margin: 0,
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const saveButtonStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--panel-lift)',
  background: 'var(--ink)',
  border: '1px solid var(--ink)',
  borderRadius: 999,
  padding: '6px 14px',
  cursor: 'pointer',
};

const cancelButtonStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-3)',
  background: 'transparent',
  border: '1px solid var(--hairline)',
  borderRadius: 999,
  padding: '6px 12px',
  cursor: 'pointer',
};

const dangerButtonStyle: CSSProperties = {
  ...saveButtonStyle,
  background: 'var(--terracotta, #b3592f)',
  border: '1px solid var(--terracotta, #b3592f)',
};

const reviewHeadingStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  margin: 0,
};

const dangerHeadingStyle: CSSProperties = {
  fontSize: '12.5px',
  fontWeight: 600,
  color: 'var(--terracotta, #b3592f)',
  margin: 0,
};

const diffRowStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'baseline',
};

const diffLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  width: 92,
  flexShrink: 0,
};

const diffValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '12.5px',
  color: 'var(--ink)',
};

const notHappenBlockStyle: CSSProperties = {
  border: '1px dashed var(--hairline)',
  borderRadius: 8,
  padding: '8px 11px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const NOTICE_COLOR: Record<Notice['tone'], string> = {
  ok: 'var(--ink-2)',
  warn: 'var(--terracotta, #b3592f)',
  error: 'var(--danger, #b91c1c)',
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatMoney(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

interface DiffRow {
  label: string;
  from: string;
  to: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function LeaseTermsEditor({
  terms,
  tenantName,
  unitLabel,
  onClose,
}: LeaseTermsEditorProps): ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [stage, setStage] = useState<Stage>('edit');
  const [rentAmount, setRentAmount] = useState(String(terms.rentAmount));
  const [rentDueDay, setRentDueDay] = useState(String(terms.rentDueDay));
  const [endDate, setEndDate] = useState(terms.endDate ?? '');
  const [terminate, setTerminate] = useState(false);
  const [touchCurrentCycle, setTouchCurrentCycle] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);

  // Preview of where the current month's due date would land if the
  // checkbox path succeeds — same clamp the generator uses.
  const now = new Date();
  const parsedDueDay = Number(rentDueDay);
  const previewDueDate =
    Number.isInteger(parsedDueDay) && parsedDueDay >= 1 && parsedDueDay <= 28
      ? dueDateFor(now.getUTCFullYear(), now.getUTCMonth() + 1, parsedDueDay)
      : null;

  // Draft values + diff against the ORIGINAL loaded terms (props), never
  // last-edited state — the review must describe the real before/after.
  const parsedAmount = Number(rentAmount);
  const nextEndDate = endDate === '' ? null : endDate;
  const diffRows: DiffRow[] = [];
  if (parsedAmount !== terms.rentAmount) {
    diffRows.push({
      label: 'Rent / mo',
      from: formatMoney(terms.rentAmount),
      to: formatMoney(parsedAmount),
    });
  }
  if (parsedDueDay !== terms.rentDueDay) {
    diffRows.push({
      label: 'Due day',
      from: String(terms.rentDueDay),
      to: String(parsedDueDay),
    });
  }
  if (nextEndDate !== (terms.endDate ?? null)) {
    diffRows.push({
      label: 'Lease end',
      from: terms.endDate ?? 'No end date',
      to: nextEndDate ?? 'No end date',
    });
  }

  /** Stage-1 validation; on success advances to the inline review stage. */
  function goToReview(): void {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setNotice({ tone: 'error', text: 'Rent amount must be a positive number.' });
      return;
    }
    if (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 28) {
      setNotice({ tone: 'error', text: 'Due day must be between 1 and 28.' });
      return;
    }
    setNotice(null);
    setConfirmText('');
    setStage('review');
  }

  /**
   * Form submit (incl. Enter inside any field) can never reach the action:
   * it always preventDefault()s and at most advances edit → review.
   */
  function handleFormSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (stage === 'edit') goToReview();
  }

  function backToEdit(): void {
    setConfirmText('');
    setStage('edit');
  }

  /** Final confirm — the only path that calls `updateLeaseTermsAction`. */
  function performSave(): void {
    if (terminate && confirmText !== TERMINATE_CONFIRM_TEXT) return;

    setNotice(null);
    startTransition(async () => {
      const result = await updateLeaseTermsAction({
        leaseId: terms.leaseId,
        rentAmount: parsedAmount,
        rentDueDay: parsedDueDay,
        endDate: nextEndDate,
        ...(terminate ? { status: 'terminated' as const } : {}),
        alsoUpdateCurrentCycle: !terminate && touchCurrentCycle,
      });

      setConfirmText('');
      setStage('edit');

      if (!result.success) {
        setNotice({ tone: 'error', text: result.error });
        return;
      }

      const d = result.data;
      if (d.currentCycleError) {
        setNotice({
          tone: 'warn',
          text: `Lease saved, but this month's cycle could not be touched (${d.currentCycleError}). Changes apply from the next cycle.`,
        });
      } else if (d.currentCycleRequested && d.currentCycleUpdated === 0) {
        setNotice({
          tone: 'warn',
          text: "Saved — this month's cycle is already in progress (or partially paid), so the change applies to future months.",
        });
      } else if (d.currentCycleRequested) {
        setNotice({
          tone: 'ok',
          text: `Saved — this month's unpaid cycle updated (due ${d.currentCycleDueDate ?? previewDueDate ?? ''}).`,
        });
      } else if (terminate) {
        setNotice({
          tone: 'ok',
          text: 'Lease terminated. Future cycles stop; the open cycle stays collectible.',
        });
      } else {
        setNotice({ tone: 'ok', text: 'Saved — applies from the next cycle.' });
      }
      router.refresh();
    });
  }

  const noticeEl = notice ? (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      style={{ ...helperStyle, color: NOTICE_COLOR[notice.tone] }}
      data-testid="lease-terms-notice"
    >
      {notice.text}
    </p>
  ) : null;

  const identityRows = (
    <>
      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>Tenant</span>
        <span style={diffValueStyle}>{tenantName}</span>
      </div>
      {unitLabel ? (
        <div style={diffRowStyle}>
          <span style={diffLabelStyle}>Unit</span>
          <span style={diffValueStyle}>{unitLabel}</span>
        </div>
      ) : null}
    </>
  );

  return (
    <form
      style={panelStyle}
      data-testid="lease-terms-editor"
      onSubmit={handleFormSubmit}
    >
      {stage === 'edit' ? (
        <>
          <div style={fieldRowStyle}>
            <label style={labelStyle}>
              Rent / mo
              <input
                type="number"
                min={1}
                step="0.01"
                value={rentAmount}
                onChange={(e) => setRentAmount(e.target.value)}
                style={inputStyle}
                data-testid="lease-rent-amount"
              />
            </label>
            <label style={labelStyle}>
              Due day (1–28)
              <input
                type="number"
                min={1}
                max={28}
                step={1}
                value={rentDueDay}
                onChange={(e) => setRentDueDay(e.target.value)}
                style={inputStyle}
                data-testid="lease-due-day"
              />
            </label>
            <label style={labelStyle}>
              Lease ends
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ ...inputStyle, width: 150 }}
                data-testid="lease-end-date"
              />
            </label>
          </div>

          <p style={helperStyle}>
            Changes apply from the next cycle. Already-generated months keep
            their amounts.
          </p>

          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              checked={!terminate && touchCurrentCycle}
              disabled={terminate || isPending}
              onChange={(e) => setTouchCurrentCycle(e.target.checked)}
              data-testid="lease-touch-cycle"
            />
            Also update this month&rsquo;s unpaid cycle
            {touchCurrentCycle && !terminate && previewDueDate ? (
              <span style={helperStyle}>
                (only while still pending &amp; unpaid — due date becomes {previewDueDate})
              </span>
            ) : null}
          </label>

          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              checked={terminate}
              disabled={isPending}
              onChange={(e) => setTerminate(e.target.checked)}
              data-testid="lease-terminate"
            />
            End this lease for {tenantName} (one-way — cannot be reactivated)
          </label>

          {terminate ? (
            <p style={{ ...helperStyle, color: NOTICE_COLOR.warn }}>
              The open rent cycle stays collectible and keeps its reminder
              schedule until it is paid or escalated. Future cycles stop.
            </p>
          ) : null}

          {noticeEl}

          <div style={buttonRowStyle}>
            <button
              type="submit"
              disabled={isPending}
              style={saveButtonStyle}
              data-testid="lease-terms-review"
            >
              Review term changes
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              style={cancelButtonStyle}
            >
              Close
            </button>
          </div>
        </>
      ) : terminate ? (
        <>
          <p style={dangerHeadingStyle}>
            End lease for {tenantName} and mark unit vacant
          </p>

          {identityRows}

          <p style={{ ...helperStyle, color: NOTICE_COLOR.warn }}>
            The open rent cycle stays collectible and keeps its reminder
            schedule until it is paid or escalated. Future cycles stop.
          </p>
          <p style={helperStyle}>
            Ending the lease does not forgive, delete, or send anything about
            current rent events — the open cycle stays collectible until paid
            or escalated. Future cycles stop.
          </p>

          <label style={labelStyle}>
            Type {TERMINATE_CONFIRM_TEXT} to confirm
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={TERMINATE_CONFIRM_TEXT}
              autoComplete="off"
              style={{ ...inputStyle, width: 150 }}
              data-testid="lease-terminate-confirm-input"
            />
          </label>

          {noticeEl}

          <div style={buttonRowStyle}>
            <button
              type="button"
              onClick={performSave}
              disabled={isPending || confirmText !== TERMINATE_CONFIRM_TEXT}
              style={dangerButtonStyle}
              data-testid="lease-terms-save"
            >
              {isPending ? 'Ending…' : 'End lease'}
            </button>
            <button
              type="button"
              onClick={backToEdit}
              disabled={isPending}
              style={cancelButtonStyle}
            >
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={reviewHeadingStyle}>Review term changes</p>

          {identityRows}

          {diffRows.length > 0 ? (
            diffRows.map((row) => (
              <div key={row.label} style={diffRowStyle}>
                <span style={diffLabelStyle}>{row.label}</span>
                <span style={diffValueStyle}>
                  {row.from} → {row.to}
                </span>
              </div>
            ))
          ) : (
            <p style={helperStyle}>No term changes — terms stay as they are.</p>
          )}

          {touchCurrentCycle ? (
            <p style={helperStyle}>
              This will update this month&rsquo;s unpaid rent cycle from{' '}
              {formatMoney(terms.rentAmount)} to {formatMoney(parsedAmount)},
              due {previewDueDate}. No payment request is sent.
            </p>
          ) : null}

          <div style={notHappenBlockStyle}>
            <span style={reviewHeadingStyle}>What does not happen</span>
            <p style={helperStyle}>
              No tenant message is sent. No payment link is issued. No legal
              notice is generated. Past cycles are unchanged.
            </p>
          </div>

          {noticeEl}

          <div style={buttonRowStyle}>
            <button
              type="button"
              onClick={performSave}
              disabled={isPending}
              style={saveButtonStyle}
              data-testid="lease-terms-save"
            >
              {isPending ? 'Saving…' : 'Confirm changes'}
            </button>
            <button
              type="button"
              onClick={backToEdit}
              disabled={isPending}
              style={cancelButtonStyle}
            >
              Back
            </button>
          </div>
        </>
      )}
    </form>
  );
}
