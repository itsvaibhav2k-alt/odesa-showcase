'use client';

import { type CSSProperties } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Inbox — send-confirmation dialog (trust sprint, Stage 7).
 *
 * The single gate between "Review & send" and a real tenant SMS. Both
 * approve paths (the DraftHeroCard button and the Ask Odesa
 * `approve_draft` chip) open this dialog; ONLY its confirm handler may
 * call `approvePendingDraft()`.
 *
 * HONESTY — every row is built from real `ConversationDetail` fields
 * and omitted when the field is absent. Nothing is fabricated.
 *
 * Styling mirrors `owner-queue/save-guidance-dialog.tsx` (warm tokens,
 * serif title, mono field labels, `--panel-clean` surface). The dialog
 * portals to document.body, outside `.today-theme`, so the theme class
 * is re-established on the popup (same trick as save-guidance).
 */

export interface SendConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ONLY caller of `approvePendingDraft()` in the inbox UI. */
  onConfirm: () => Promise<void>;
  /** True while the approve server action is in flight. */
  busy: boolean;
  /** Recipient display name (always present — falls back server-side). */
  recipientName: string;
  /** First name for the final button; empty string falls back to the full name. */
  recipientFirstName: string;
  /** E.164 phone — the SMS destination. Omits the suffix when null. */
  phoneE164: string | null;
  propertyName: string | null;
  unitLabel: string | null;
  /** Exact `pendingDraft.body`, rendered verbatim. */
  messageBody: string;
  /** Real case-context lines (open work order, days late). Row omitted when empty. */
  contextLines: readonly string[];
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
  padding: '22px 24px 16px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: '21px',
  fontStyle: 'italic',
  letterSpacing: '-0.015em',
  color: 'var(--ink)',
  marginBottom: 6,
};

const descStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ink-2)',
  lineHeight: 1.5,
};

const bodyStyle: CSSProperties = {
  padding: '18px 24px 6px',
};

const fieldLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 7,
};

const fieldValueStyle: CSSProperties = {
  fontSize: '13.5px',
  color: 'var(--ink)',
  lineHeight: 1.5,
  marginBottom: 14,
};

const messageBlockStyle: CSSProperties = {
  border: '1px solid var(--hairline-strong)',
  borderRadius: 8,
  background: 'var(--panel-lift)',
  padding: '11px 13px',
  fontSize: '14px',
  lineHeight: 1.5,
  color: 'var(--ink)',
  letterSpacing: '-0.003em',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  marginBottom: 14,
};

const contextLineStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  lineHeight: 1.5,
};

const contextListStyle: CSSProperties = {
  margin: '0 0 14px',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 10,
  padding: '16px 24px 20px',
  borderTop: '1px solid var(--hairline-faint)',
  marginTop: 14,
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

const confirmBtnStyle: CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  border: '1px solid var(--ink)',
  borderRadius: 6,
  padding: '8px 15px',
  fontSize: '12.5px',
  fontWeight: 450,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const confirmBtnDisabledStyle: CSSProperties = {
  ...confirmBtnStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

export function SendConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  busy,
  recipientName,
  recipientFirstName,
  phoneE164,
  propertyName,
  unitLabel,
  messageBody,
  contextLines,
}: SendConfirmDialogProps) {
  const firstName = recipientFirstName.trim() || recipientName;

  const toValue = phoneE164
    ? `${recipientName} · SMS ${phoneE164}`
    : recipientName;
  const propertyValue = propertyName
    ? unitLabel
      ? `${propertyName} · Unit ${unitLabel}`
      : propertyName
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Never dismiss mid-send; the action settles first.
        if (busy && !o) return;
        onOpenChange(o);
      }}
    >
      <DialogContent
        data-testid="send-confirm-dialog"
        showCloseButton={false}
        // Re-establish the theme inside the portal so warm tokens resolve
        // (same pattern as save-guidance-dialog).
        className="today-theme p-0 max-w-[460px]"
        style={contentStyle}
      >
        <div style={headStyle}>
          <DialogTitle style={titleStyle}>Send this SMS?</DialogTitle>
          <DialogDescription style={descStyle}>
            This message will be sent now over SMS. It cannot be unsent.
          </DialogDescription>
        </div>

        <div style={bodyStyle}>
          <div style={fieldLabelStyle}>To</div>
          <div style={fieldValueStyle} data-testid="send-confirm-to">
            {toValue}
          </div>

          {propertyValue != null && (
            <>
              <div style={fieldLabelStyle}>Property</div>
              <div style={fieldValueStyle} data-testid="send-confirm-property">
                {propertyValue}
              </div>
            </>
          )}

          <div style={fieldLabelStyle}>Message</div>
          <div style={messageBlockStyle} data-testid="send-confirm-message">
            {messageBody}
          </div>

          {contextLines.length > 0 && (
            <>
              <div style={fieldLabelStyle}>Context</div>
              <ul style={contextListStyle} data-testid="send-confirm-context">
                {contextLines.map((line) => (
                  <li key={line} style={contextLineStyle}>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div style={actionsStyle}>
          <button
            type="button"
            data-testid="send-confirm-cancel"
            style={cancelBtnStyle}
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="send-confirm-send"
            style={busy ? confirmBtnDisabledStyle : confirmBtnStyle}
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? 'Sending…' : `Send SMS to ${firstName}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SendConfirmDialog;
