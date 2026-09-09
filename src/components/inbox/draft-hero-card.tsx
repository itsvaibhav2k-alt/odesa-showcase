'use client';

/**
 * DraftHeroCard — Wave 6 of the Inbox redesign.
 *
 * The case-pane hero when a pending draft awaits owner review. Replaces
 * the inline `PendingDraftCard` that previously rendered inside the
 * chat-bubble thread. Visual: warm-gold (amber) panel with inset
 * left-bar, three sections (head / body / actions) separated by amber
 * hairlines.
 *
 * Wiring: approve / reject / edit are pulled from `useConversations()`
 * (NOT passed as props). Server actions are reached through the
 * provider so auth gates and DB writes stay unchanged from wave 3.
 *
 * Send safety (trust sprint, Stage 7): "Review & send" opens
 * `<SendConfirmDialog />`; ONLY the dialog's confirm handler calls
 * `approvePendingDraft()`. The Ask Odesa `approve_draft` chip routes
 * here too via the `sendConfirmRequestKey` counter-pulse.
 *
 * Visual fidelity rules (Vaibhav's polish note):
 *   - Body text uses IBM Plex Sans (`--font-sans-operator`), not italic
 *     serif. Contrast over flourish.
 *   - Eyebrow, meta, and to-line use the metrics mono.
 *   - Tokens under `:root` (--amber-*, --terracotta, --panel-lift,
 *     --hairline-strong) are referenced directly. `--ink*` tokens are
 *     only defined under `.today-theme` scope, so they are referenced
 *     with inline fallbacks.
 *
 * Test-id preservation (see test-id-map.md, wave 6 rows):
 *   - `pending-draft-{messageId}` on the card root.
 *   - `pending-draft-approve`, `pending-draft-edit`, `pending-draft-reject`
 *     on the three primary action buttons.
 *   - `pending-draft-edit-textarea`, `pending-draft-edit-cancel`,
 *     `pending-draft-edit-save` on the inline edit affordances when
 *     `isEditing` is true.
 */

import {
  useCallback,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { useConversations } from '@/components/inbox/conversations-context';
import { SendConfirmDialog } from '@/components/inbox/send-confirm-dialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DraftRecipientChannel = 'SMS' | 'Text' | 'Voice' | 'Vendor SMS';

export interface DraftHeroCardProps {
  /** Stable id of the pending-review message — feeds the card root test-id. */
  messageId: string;
  draft: {
    id: string;
    body: string;
    reasoning: string | null;
  };
  recipient: {
    name: string;
    channel: DraftRecipientChannel;
  };
  /** ISO timestamp recorded when the draft was produced. */
  draftedAt: string;
  /**
   * Evidence-only mode. Defaults fail closed so draft commitments stay in
   * Owner Queue; retained legacy controls require an explicit opt-in.
   */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
});

/**
 * `formatDraftedMeta` produces the "DRAFTED HH:MM · Xm AGO" string for
 * the head-meta line. Returns just "DRAFTED —" if the ISO is invalid.
 *
 * Implementation note: no new dependencies — this only relies on
 * built-in `Intl.DateTimeFormat` plus arithmetic on the timestamp. The
 * "ago" label rounds minutes down, switching to hours past 60m and to
 * days past 24h. Future drafts (shouldn't happen, but be defensive)
 * fall back to the literal clock time.
 */
export function formatDraftedMeta(iso: string, now: Date = new Date()): string {
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return 'DRAFTED —';
  const clock = TIME_FORMATTER.format(ts);
  const diffMs = now.getTime() - ts.getTime();
  if (diffMs < 0) return `DRAFTED ${clock}`;

  const diffMinutes = Math.floor(diffMs / 60_000);
  let ago: string;
  if (diffMinutes < 1) {
    ago = 'JUST NOW';
  } else if (diffMinutes < 60) {
    ago = `${diffMinutes}M AGO`;
  } else {
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      ago = `${diffHours}H AGO`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      ago = `${diffDays}D AGO`;
    }
  }
  return `DRAFTED ${clock} · ${ago}`;
}

/** First word of the display name, with non-name characters stripped. */
function firstNameOf(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first.replace(/[^\p{L}\p{M}'\-]/gu, '');
}

/** Humanise a snake_case work-order status for display. */
function humaniseStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

// ---------------------------------------------------------------------------
// Inline styles — keyed to the warm-gold panel tokens from Wave 1.
// ---------------------------------------------------------------------------

const monoFamily =
  "var(--font-mono-metrics), 'JetBrains Mono', ui-monospace, monospace";
const sansOperatorFamily = 'var(--font-sans-operator), system-ui, sans-serif';

const cardStyle: CSSProperties = {
  margin: '28px 36px 0',
  background: 'var(--amber-bg-soft)',
  border: '1px solid var(--amber-border)',
  borderRadius: 10,
  boxShadow: 'inset 4px 0 0 var(--amber)',
  color: 'var(--ink, #1B1712)',
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 18px',
  gap: 16,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: monoFamily,
  fontSize: 10.5,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--amber-ink)',
};

const metaStyle: CSSProperties = {
  fontFamily: monoFamily,
  fontSize: 10,
  color: 'var(--amber-ink)',
  opacity: 0.7,
  letterSpacing: '0.04em',
};

const bodyStyle: CSSProperties = {
  borderTop: '1px solid var(--amber-border)',
  padding: '14px 18px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const toLineStyle: CSSProperties = {
  fontFamily: monoFamily,
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #75674F)',
};

const arrowStyle: CSSProperties = {
  color: 'var(--terracotta)',
  marginRight: 6,
};

const bodyTextStyle: CSSProperties = {
  fontFamily: sansOperatorFamily,
  fontSize: 14.5,
  lineHeight: 1.5,
  color: 'var(--ink, #1B1712)',
  whiteSpace: 'pre-wrap',
};

const editTextareaStyle: CSSProperties = {
  fontFamily: sansOperatorFamily,
  fontSize: 14.5,
  lineHeight: 1.5,
  color: 'var(--ink, #1B1712)',
  background: 'var(--panel-lift)',
  border: '1px solid var(--amber-border)',
  borderRadius: 6,
  padding: '10px 12px',
  width: '100%',
  minHeight: 88,
  resize: 'vertical',
  outline: 'none',
};

const editActionsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
};

const actionsStyle: CSSProperties = {
  borderTop: '1px solid var(--amber-border)',
  padding: '12px 18px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const spacerStyle: CSSProperties = { flex: 1 };

const baseBtnStyle: CSSProperties = {
  fontFamily: sansOperatorFamily,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  borderRadius: 5,
  transition: 'opacity 120ms ease',
};

const primaryBtnStyle: CSSProperties = {
  ...baseBtnStyle,
  background: 'var(--ink, #1B1712)',
  color: 'var(--panel-lift)',
  border: '1px solid var(--ink, #1B1712)',
  padding: '7px 16px',
};

const neutralBtnStyle: CSSProperties = {
  ...baseBtnStyle,
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline-strong)',
  color: 'var(--ink, #1B1712)',
  padding: '7px 14px',
};

const ghostBtnStyle: CSSProperties = {
  ...baseBtnStyle,
  background: 'transparent',
  border: '1px solid var(--amber-border)',
  color: 'var(--amber-ink)',
  padding: '7px 14px',
};

const whyBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontFamily: sansOperatorFamily,
  fontSize: 12.5,
  color: 'var(--amber-ink)',
  textDecoration: 'underline',
  textDecorationColor: 'var(--amber-border)',
  textUnderlineOffset: 3,
  cursor: 'pointer',
};

const popoverContentStyle: CSSProperties = {
  background: 'var(--panel-lift)',
  border: '1px solid var(--amber-border)',
  borderRadius: 8,
  padding: '12px 14px',
  maxWidth: 320,
  fontFamily: sansOperatorFamily,
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--ink, #1B1712)',
  boxShadow: '0 8px 24px rgba(27,23,18,0.12)',
};

const popoverHeadingStyle: CSSProperties = {
  fontFamily: monoFamily,
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--amber-ink)',
  marginBottom: 6,
};

const regenNoteStyle: CSSProperties = {
  fontFamily: sansOperatorFamily,
  fontSize: 12,
  lineHeight: 1.4,
  color: 'var(--amber-ink)',
};

const fallbackLineStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const spinnerStyle: CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  marginLeft: 6,
  border: '1.5px solid currentColor',
  borderTopColor: 'transparent',
  borderRadius: '50%',
  animation: 'draftHeroSpin 0.7s linear infinite',
  verticalAlign: '-2px',
};

// Inline keyframes — scoped via a single `<style>` so we don't pollute
// globals.css for a wave-6-only affordance.
const SPINNER_KEYFRAMES = `@keyframes draftHeroSpin { to { transform: rotate(360deg); } }`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function InlineSpinner({ label }: { label: string }) {
  return (
    <span
      role='status'
      aria-label={label}
      data-testid='pending-draft-spinner'
      style={spinnerStyle}
    />
  );
}

export default function DraftHeroCard({
  messageId,
  draft,
  recipient,
  draftedAt,
  readOnly = true,
}: DraftHeroCardProps) {
  const {
    approvingDraft,
    approvePendingDraft,
    rejectingDraft,
    rejectPendingDraft,
    editingDraft,
    editPendingDraft,
    regeneratingDraft,
    selectedDetail,
    sendConfirmRequestKey,
  } = useConversations();

  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(draft.body);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Note on draft-id swaps: when a new pending draft replaces the
  // current one the parent (`CaseFileColumn`) is expected to key the
  // hero with `messageId` so React remounts the component with fresh
  // local state. Handling that reset inside the component would either
  // require update-during-render or a setState-in-effect, both of
  // which the react-hooks linter rejects. Parent-driven remount is the
  // canonical pattern.

  const busy =
    approvingDraft || rejectingDraft || editingDraft || regeneratingDraft;

  const draftedMeta = useMemo(() => formatDraftedMeta(draftedAt), [draftedAt]);

  const toLineLabel = useMemo(() => {
    const name = recipient.name.toUpperCase();
    const channel =
      recipient.channel === 'Vendor SMS' ? 'VENDOR SMS' : recipient.channel;
    return `TO ${name} · ${channel}`;
  }, [recipient.name, recipient.channel]);

  // ---------------------------------------------------------------------------
  // Send-confirmation dialog (Stage 7 send safety)
  //
  // "Review & send" only OPENS the dialog. The dialog's confirm handler
  // below is the only call site of `approvePendingDraft()` in the UI.
  // ---------------------------------------------------------------------------

  const onApproveClick = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const onConfirmSend = useCallback(async () => {
    await approvePendingDraft();
    setConfirmOpen(false);
  }, [approvePendingDraft]);

  // Counter-pulse subscription: the Ask Odesa `approve_draft` chip
  // bumps `sendConfirmRequestKey` via `requestSendConfirm()` — the chip
  // never sends. Render-time state adjustment (per React's "you might
  // not need an effect" guidance, same pattern as save-guidance-dialog)
  // so the linter-rejected setState-in-effect is avoided. Seeding the
  // tracker with the mount value means only genuine pulses open the
  // dialog.
  const [seenConfirmKey, setSeenConfirmKey] = useState(sendConfirmRequestKey);
  if (sendConfirmRequestKey !== seenConfirmKey) {
    setSeenConfirmKey(sendConfirmRequestKey);
    setConfirmOpen(true);
  }

  // Display data for the confirm dialog and the why-popover fallback,
  // sourced from real ConversationDetail fields only.
  const detailTenant = selectedDetail?.tenant ?? null;
  const caseContext = selectedDetail?.caseContext ?? null;
  const recipientDisplayName = detailTenant?.name ?? recipient.name;
  const recipientFirstName = firstNameOf(recipientDisplayName);
  const confirmBody = selectedDetail?.pendingDraft?.body ?? draft.body;

  const workOrder = caseContext?.workOrder ?? null;
  const openWorkOrder =
    workOrder &&
    workOrder.status !== 'completed' &&
    workOrder.status !== 'cancelled'
      ? workOrder
      : null;
  const daysLateTier = caseContext?.payments.daysLateTier ?? null;

  const contextLines = useMemo<string[]>(() => {
    const lines: string[] = [];
    if (openWorkOrder) {
      lines.push(
        `Open work order — ${openWorkOrder.category} · ${humaniseStatus(openWorkOrder.status)}`,
      );
    }
    if (typeof daysLateTier === 'number' && daysLateTier > 0) {
      lines.push(`Rent ${daysLateTier}+ days late`);
    } else if (daysLateTier === 'escalated') {
      lines.push('Rent escalated');
    }
    return lines;
  }, [openWorkOrder, daysLateTier]);

  const onRejectClick = useCallback(() => {
    void rejectPendingDraft();
  }, [rejectPendingDraft]);

  const onEditClick = useCallback(() => {
    setEditBody(draft.body);
    setIsEditing(true);
  }, [draft.body]);

  const onCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditBody(draft.body);
  }, [draft.body]);

  const onSaveEdit = useCallback(async () => {
    const next = editBody.trim();
    if (!next) return;
    await editPendingDraft(next);
    // Exit edit mode after the server action resolves; the provider
    // surfaces failures via the toast — we still drop out of edit mode
    // because the buffer reflects the user's intended body.
    setIsEditing(false);
  }, [editBody, editPendingDraft]);

  const reasoningId = useId();

  return (
    <div data-testid={`pending-draft-${messageId}`} style={cardStyle}>
      <style dangerouslySetInnerHTML={{ __html: SPINNER_KEYFRAMES }} />

      <div style={headStyle}>
        <div style={eyebrowStyle}>
          {readOnly
            ? '◆ Message draft · owner review required'
            : '◆ Message draft ready for review'}
        </div>
        <div style={metaStyle}>{draftedMeta}</div>
      </div>

      <div style={bodyStyle}>
        <div style={toLineStyle}>
          <span aria-hidden style={arrowStyle}>
            →
          </span>
          {toLineLabel}
        </div>
        {isEditing ? (
          <>
            {regeneratingDraft ? (
              <div
                data-testid='pending-draft-regenerating-note'
                style={regenNoteStyle}
              >
                Odesa is rewriting this draft — your unsaved edits will be
                replaced.
              </div>
            ) : null}
            <textarea
              data-testid='pending-draft-edit-textarea'
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              disabled={busy}
              style={editTextareaStyle}
              aria-label='Edit draft body'
            />
            <div style={editActionsRowStyle}>
              <button
                type='button'
                data-testid='pending-draft-edit-cancel'
                onClick={onCancelEdit}
                disabled={busy}
                style={{ ...neutralBtnStyle, opacity: busy ? 0.55 : 1 }}
              >
                Cancel
              </button>
              <button
                type='button'
                data-testid='pending-draft-edit-save'
                onClick={() => {
                  void onSaveEdit();
                }}
                disabled={busy || editBody.trim().length === 0}
                style={{
                  ...primaryBtnStyle,
                  opacity: busy || editBody.trim().length === 0 ? 0.55 : 1,
                }}
              >
                Save
                {editingDraft ? <InlineSpinner label='Saving draft' /> : null}
              </button>
            </div>
          </>
        ) : (
          <div style={bodyTextStyle}>{draft.body}</div>
        )}
      </div>

      <div style={actionsStyle}>
        {readOnly ? (
          <span
            data-testid='pending-draft-owner-boundary'
            style={{
              fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
              fontSize: '10.5px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--amber-700, #8A631B)',
            }}
          >
            Owner Queue review required
          </span>
        ) : (
          <>
            <button
              type='button'
              data-testid='pending-draft-approve'
              onClick={onApproveClick}
              disabled={busy || isEditing}
              style={{
                ...primaryBtnStyle,
                opacity: busy || isEditing ? 0.55 : 1,
              }}
            >
              Review &amp; send
              {approvingDraft ? (
                <InlineSpinner label='Approving draft' />
              ) : null}
            </button>
            <button
              type='button'
              data-testid='pending-draft-edit'
              onClick={onEditClick}
              disabled={busy || isEditing}
              style={{
                ...neutralBtnStyle,
                opacity: busy || isEditing ? 0.55 : 1,
              }}
            >
              Edit
            </button>
            <button
              type='button'
              data-testid='pending-draft-reject'
              onClick={onRejectClick}
              disabled={busy || isEditing}
              style={{
                ...ghostBtnStyle,
                opacity: busy || isEditing ? 0.55 : 1,
              }}
            >
              Reject
              {rejectingDraft ? (
                <InlineSpinner label='Rejecting draft' />
              ) : null}
            </button>
          </>
        )}
        <div style={spacerStyle} />
        <PopoverPrimitive.Root>
          <PopoverPrimitive.Trigger
            data-testid='pending-draft-why'
            style={whyBtnStyle}
            aria-describedby={reasoningId}
          >
            Why this draft?
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner
              align='end'
              side='top'
              sideOffset={8}
              style={{ zIndex: 50 }}
            >
              <PopoverPrimitive.Popup
                id={reasoningId}
                data-testid='pending-draft-why-content'
                style={popoverContentStyle}
              >
                <div style={popoverHeadingStyle}>Why this draft?</div>
                {/* Model reasoning stays in audit evidence. The customer view
                    shows only structured source-record context. */}
                <div data-testid='pending-draft-why-fallback'>
                    <div style={popoverHeadingStyle}>
                      No stored reasoning trace
                    </div>
                    <ul style={fallbackLineStyle}>
                      <li>{draftedMeta}</li>
                      <li>
                        To {recipientDisplayName} · {recipient.channel}
                      </li>
                      {detailTenant?.propertyName ? (
                        <li>
                          {detailTenant.propertyName}
                          {detailTenant.unitLabel
                            ? ` · Unit ${detailTenant.unitLabel}`
                            : ''}
                        </li>
                      ) : null}
                      {contextLines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 8 }}>
                      No message sends until owner review is complete.
                    </div>
                </div>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      </div>

      {!readOnly ? (
        <SendConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={onConfirmSend}
          busy={approvingDraft}
          recipientName={recipientDisplayName}
          recipientFirstName={recipientFirstName}
          phoneE164={detailTenant?.phoneE164 ?? null}
          propertyName={detailTenant?.propertyName ?? null}
          unitLabel={detailTenant?.unitLabel ?? null}
          messageBody={confirmBody}
          contextLines={contextLines}
        />
      ) : null}
    </div>
  );
}
