'use client';

/**
 * Owner Queue — decision edit drawer (Pass 2: real decision control).
 *
 * A right-side `Sheet` that lets the owner INSPECT and EDIT a proposal's
 * recommendation before any commit, then either save the edits (no side effect)
 * or save-and-approve (the EXPLICIT in-drawer confirm that fires the real
 * send / charge / lease write). Modelled on `review-action-panel.tsx`'s
 * editable-draft styling (draftWrap / draftBox / "Odesa's draft · editable
 * before send"), and on the warm `today-theme` tokens used across the desk.
 *
 * SAFETY — committing is real and dangerous. For tenant-facing / money / lease
 * decisions, the card's primary action OPENS THIS DRAWER; it never commits
 * directly. The commit only happens when the owner clicks "Save & approve"
 * here, with a boundary line in the footer spelling out exactly what will
 * send / charge / mutate. "Save changes" persists edits and leaves the
 * proposal pending ("Edited by owner · pending approval" upstream); "Cancel"
 * closes without writing.
 *
 * Per-`editKind` forms render ONLY real worker-payload schema fields (see
 * `WORKER_PAYLOAD_SCHEMAS`) — never a fabricated spend cap, ETA, or figure.
 * The payload patch is built from ONLY the fields the owner actually changed
 * (dirty-tracked against the decision's `editDraft`), so unedited keys
 * (tenantRef / leaseRef / candidateIndex) survive the server's deep-merge +
 * re-validate untouched.
 */

import { useMemo, useState, useTransition, type CSSProperties } from 'react';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  saveDecisionEdits,
  saveAndApproveDecision,
} from '@/app/(dashboard)/owner-queue/actions';
import type {
  Decision,
  DecisionEditDraft,
} from '@/lib/owner-queue/mock-decisions';
import type { ReviewActionResult } from '@/lib/review/types';

// ---------------------------------------------------------------------------
// Result the drawer reports back to the parent island.
// ---------------------------------------------------------------------------

/** The owner-facing outcome the drawer hands back so the parent can reconcile. */
export interface DecisionEditResult {
  /** The decision the action targeted. */
  id: string;
  /**
   * The new card state: 'edited' after a save (no commit), 'approved' after a
   * save-and-approve commit. The parent flips the card feedback accordingly.
   */
  state: 'edited' | 'approved';
}

export interface DecisionEditDrawerProps {
  /** The decision being edited; null when nothing is open (drawer renders closed). */
  decision: Decision | null;
  /** Whether the drawer is open. */
  open: boolean;
  /** Open-state change handler (backdrop / Escape / Cancel / close button). */
  onOpenChange: (open: boolean) => void;
  /** Reports a successful save / save-and-approve so the parent can reconcile. */
  onResult: (result: DecisionEditResult) => void;
}

// ---------------------------------------------------------------------------
// Styles — mirror review-action-panel.tsx (draftWrap / draftBox / draftLabel)
// and the warm today-theme tokens used across the desk.
// ---------------------------------------------------------------------------

const contentStyle: CSSProperties = {
  width: '100%',
  maxWidth: 460,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  padding: 0,
  gap: 0,
};

const headerStyle: CSSProperties = {
  padding: '20px 22px 16px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 7,
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontSize: '20px',
  fontStyle: 'italic',
  letterSpacing: '-0.015em',
  color: 'var(--ink)',
};

const bodyScrollStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '18px 22px 8px',
};

const fieldStyle: CSSProperties = {
  marginBottom: 18,
};

const draftLabel: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 8,
};

const draftBox: CSSProperties = {
  width: '100%',
  minHeight: '92px',
  padding: '11px 13px',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '14px',
  lineHeight: 1.5,
  resize: 'vertical',
  boxSizing: 'border-box',
};

const inputBox: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--hairline)',
  borderRadius: 8,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '14px',
  lineHeight: 1.4,
  boxSizing: 'border-box',
};

const selectBox: CSSProperties = {
  ...inputBox,
  cursor: 'pointer',
};

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
};

const readOnlyValueStyle: CSSProperties = {
  fontSize: '14px',
  color: 'var(--ink-2)',
  padding: '9px 12px',
  border: '1px solid var(--hairline-faint)',
  borderRadius: 8,
  background: 'var(--panel)',
  letterSpacing: '-0.003em',
};

// Tenant-facing preview — distinct lifted block (mirrors draftWrap intent).
const previewWrapStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  background: 'var(--panel-lift)',
  padding: '13px 15px',
  marginBottom: 18,
};

const previewMetaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 9,
};

const previewMetaLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.06em',
  color: 'var(--ink-3)',
};

const previewRecipientStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 450,
  color: 'var(--ink)',
  letterSpacing: '-0.005em',
};

const previewChannelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const previewBodyStyle: CSSProperties = {
  fontSize: '13.5px',
  lineHeight: 1.55,
  color: 'var(--ink)',
  letterSpacing: '-0.003em',
  whiteSpace: 'pre-wrap',
};

const previewEmptyStyle: CSSProperties = {
  ...previewBodyStyle,
  color: 'var(--ink-3)',
  fontStyle: 'italic',
};

const errStyle: CSSProperties = {
  color: 'var(--terracotta)',
  fontSize: '12.5px',
  marginBottom: 12,
};

const footerStyle: CSSProperties = {
  borderTop: '1px solid var(--hairline-faint)',
  padding: '14px 22px 18px',
  gap: 12,
};

const boundaryStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  lineHeight: 1.45,
  letterSpacing: '-0.002em',
  marginBottom: 4,
};

const boundaryMarkStyle: CSSProperties = {
  color: 'var(--ink-3)',
  flexShrink: 0,
};

const actionsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const spacerStyle: CSSProperties = {
  flex: 1,
};

const btnBase: CSSProperties = {
  fontFamily: 'var(--font-sans-operator), system-ui, sans-serif',
  fontSize: '13px',
  fontWeight: 450,
  padding: '9px 16px',
  borderRadius: 8,
  border: '1px solid var(--hairline-strong)',
  background: 'var(--panel-lift)',
  color: 'var(--ink)',
  cursor: 'pointer',
  letterSpacing: '-0.005em',
};

const btnGhost: CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: 'var(--ink-2)',
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

const btnDisabled: CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

const TONE_OPTIONS: ReadonlyArray<DecisionEditDraft['tone']> = [
  'neutral',
  'firm',
  'warm',
  'apologetic',
];

// ---------------------------------------------------------------------------
// Local editable form state — one flat shape covering every editKind. Only the
// fields relevant to the active editKind are rendered + diffed.
// ---------------------------------------------------------------------------

interface FormState {
  body: string;
  tone: NonNullable<DecisionEditDraft['tone']>;
  smsBody: string;
  /** Whole dollars as a string (rent_payment amount). */
  amountDollars: string;
  dueDate: string;
  /** Whole dollars as a string (lease rent). */
  rentAmount: string;
  rentDueDay: string;
  startDate: string;
  endDate: string;
}

function initialFormState(draft: DecisionEditDraft | undefined): FormState {
  const d = draft ?? {};
  return {
    body: d.body ?? '',
    tone: d.tone ?? 'neutral',
    smsBody: d.smsBody ?? '',
    amountDollars: centsToDollarString(d.amountCents),
    dueDate: d.dueDate ?? '',
    rentAmount: d.rentAmount != null ? String(d.rentAmount) : '',
    rentDueDay: d.rentDueDay != null ? String(d.rentDueDay) : '',
    startDate: d.startDate ?? '',
    endDate: d.endDate ?? '',
  };
}

export function DecisionEditDrawer({
  decision,
  open,
  onOpenChange,
  onResult,
}: DecisionEditDrawerProps) {
  const draft = decision?.editDraft;
  const editKind = decision?.editKind ?? null;

  const [form, setForm] = useState<FormState>(() => initialFormState(draft));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form (and clear any error) when a DIFFERENT decision opens, so
  // the inputs reflect that proposal's current values rather than the
  // previously edited one. React's endorsed "adjust state during render when a
  // prop changes" pattern (https://react.dev/.../you-might-not-need-an-effect)
  // — tracking the active id avoids an effect + its cascading-render warning.
  const [seededId, setSeededId] = useState<string | null>(decision?.id ?? null);
  const activeId = decision?.id ?? null;
  if (activeId !== seededId) {
    setSeededId(activeId);
    setForm(initialFormState(decision?.editDraft));
    setError(null);
  }

  // Build the patch from ONLY the fields the owner actually changed. Unedited
  // keys are omitted so the server's deep-merge preserves them (and so an empty
  // patch is a harmless no-op re-validate of the existing payload).
  const patch = useMemo<Record<string, unknown>>(
    () => (decision ? buildPatch(editKind, form, draft) : {}),
    [decision, editKind, form, draft],
  );

  const dirty = Object.keys(patch).length > 0;

  if (!decision) {
    // Keep the Sheet mounted-but-empty so open/close transitions stay smooth;
    // render nothing inside until a decision is selected.
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="today-theme" style={contentStyle} />
      </Sheet>
    );
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function run(
    action: (id: string, patch: Record<string, unknown>) => Promise<ReviewActionResult>,
    state: DecisionEditResult['state'],
  ): void {
    if (!decision) return;
    const id = decision.id;
    setError(null);
    startTransition(async () => {
      const result = await action(id, patch);
      if (result.ok) {
        onResult({ id, state });
        onOpenChange(false);
      } else {
        setError(result.error);
      }
    });
  }

  const isTenantFacing = editKind === 'message';
  const recipientLabel = (draft?.recipientLabel ?? '').trim() || 'Tenant';
  const channelLabel = (draft?.channel ?? '').trim() || 'SMS';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="decision-edit-drawer"
        className="today-theme"
        style={contentStyle}
      >
        <SheetHeader style={headerStyle}>
          <div style={eyebrowStyle}>
            {decision.type} · {decision.location}
          </div>
          <SheetTitle style={titleStyle}>{decision.title}</SheetTitle>
          <SheetDescription className="sr-only">
            Inspect and edit Odesa&apos;s recommendation before approving.
          </SheetDescription>
        </SheetHeader>

        <div style={bodyScrollStyle}>
          {editKind === 'message' && (
            <MessageFields
              decision={decision}
              form={form}
              update={update}
              disabled={pending}
              recipientLabel={recipientLabel}
              channelLabel={channelLabel}
            />
          )}
          {editKind === 'dispatch' && (
            <DispatchFields
              draft={draft}
              form={form}
              update={update}
              disabled={pending}
            />
          )}
          {editKind === 'rent_payment' && (
            <RentPaymentFields form={form} update={update} disabled={pending} />
          )}
          {editKind === 'lease' && (
            <LeaseFields
              draft={draft}
              form={form}
              update={update}
              disabled={pending}
            />
          )}
          {editKind == null && (
            <p style={previewEmptyStyle} data-testid="decision-edit-unsupported">
              This decision has no editable details.
            </p>
          )}
        </div>

        <SheetFooter style={footerStyle}>
          {error ? (
            <div role="alert" data-testid="decision-edit-error" style={errStyle}>
              {error}
            </div>
          ) : null}

          {/*
            The boundary line is the honest, in-drawer warning that "Save &
            approve" is the real commit — it will actually send / charge /
            mutate. Drawn from the decision's adapter boundary copy.
          */}
          {(decision.boundary ?? '').trim().length > 0 ? (
            <div style={boundaryStyle} data-testid="decision-edit-boundary">
              <span aria-hidden="true" style={boundaryMarkStyle}>
                ↳
              </span>
              <span>
                {isTenantFacing
                  ? `Save & approve sends this ${channelLabel} to ${recipientLabel} now.`
                  : approveBoundaryFor(editKind, decision.boundary)}
              </span>
            </div>
          ) : null}

          <div style={actionsRowStyle}>
            <button
              type="button"
              data-testid="decision-edit-cancel"
              style={pending ? { ...btnGhost, ...btnDisabled } : btnGhost}
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </button>
            <span style={spacerStyle} />
            <button
              type="button"
              data-testid="decision-edit-save"
              style={
                pending || !dirty || editKind == null
                  ? { ...btnBase, ...btnDisabled }
                  : btnBase
              }
              disabled={pending || !dirty || editKind == null}
              title={
                editKind == null
                  ? 'This decision has no editable details'
                  : !dirty
                    ? 'No changes to save'
                    : undefined
              }
              onClick={() => run(saveDecisionEdits, 'edited')}
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              data-testid="decision-edit-save-approve"
              style={
                pending || editKind == null
                  ? { ...btnPrimary, ...btnDisabled }
                  : btnPrimary
              }
              disabled={pending || editKind == null}
              onClick={() => run(saveAndApproveDecision, 'approved')}
            >
              {pending ? 'Working…' : 'Save & approve'}
            </button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ===========================================================================
// Per-type field groups
// ===========================================================================

interface FieldGroupProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  disabled: boolean;
}

/**
 * message (draft_sms_reply / send_tenant_message): editable body, a tone select
 * for draft_sms_reply only, and a tenant-facing preview (recipient + channel +
 * the current body).
 */
function MessageFields({
  decision,
  form,
  update,
  disabled,
  recipientLabel,
  channelLabel,
}: FieldGroupProps & {
  decision: Decision;
  recipientLabel: string;
  channelLabel: string;
}) {
  // Tone only exists on the draft_sms_reply payload schema.
  const showTone = decision.actionType === 'draft_sms_reply';

  return (
    <>
      <div style={fieldStyle}>
        <div style={draftLabel}>Odesa&apos;s draft · editable before send</div>
        <textarea
          data-testid="decision-edit-body"
          style={draftBox}
          value={form.body}
          disabled={disabled}
          onChange={(e) => update('body', e.target.value)}
        />
      </div>

      {showTone ? (
        <div style={fieldStyle}>
          <div style={draftLabel}>Tone</div>
          <select
            data-testid="decision-edit-tone"
            style={selectBox}
            value={form.tone}
            disabled={disabled}
            onChange={(e) =>
              update('tone', e.target.value as FormState['tone'])
            }
          >
            {TONE_OPTIONS.map((tone) => (
              <option key={tone} value={tone}>
                {capitalize(tone ?? 'neutral')}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div style={previewWrapStyle} data-testid="decision-edit-preview">
        <div style={previewMetaStyle}>
          <span style={previewMetaLabelStyle}>To</span>
          <span style={previewRecipientStyle}>{recipientLabel}</span>
          <span style={previewChannelStyle}>· {channelLabel}</span>
        </div>
        {form.body.trim().length > 0 ? (
          <div style={previewBodyStyle}>{form.body}</div>
        ) : (
          <div style={previewEmptyStyle}>No message yet.</div>
        )}
      </div>
    </>
  );
}

/**
 * dispatch (dispatch_vendor): editable `smsBody` + a read-only vendor label.
 * NO spend-cap field — the proposal carries no such figure and committing a
 * dispatch does not contact the vendor.
 */
function DispatchFields({
  draft,
  form,
  update,
  disabled,
}: FieldGroupProps & { draft: DecisionEditDraft | undefined }) {
  const vendorLabel = (draft?.vendorLabel ?? '').trim();

  return (
    <>
      {vendorLabel ? (
        <div style={fieldStyle}>
          <div style={draftLabel}>Vendor</div>
          <div style={readOnlyValueStyle} data-testid="decision-edit-vendor">
            {vendorLabel}
          </div>
        </div>
      ) : null}

      <div style={fieldStyle}>
        <div style={draftLabel}>Message to vendor · editable</div>
        <textarea
          data-testid="decision-edit-sms-body"
          style={draftBox}
          value={form.smsBody}
          disabled={disabled}
          onChange={(e) => update('smsBody', e.target.value)}
        />
      </div>
    </>
  );
}

/**
 * rent_payment (request_rent_payment): amount in whole dollars (converted to
 * `amountCents` in the patch) + a due date.
 */
function RentPaymentFields({ form, update, disabled }: FieldGroupProps) {
  return (
    <div style={fieldRowStyle}>
      <div style={{ ...fieldStyle, flex: 1 }}>
        <div style={draftLabel}>Amount ($)</div>
        <input
          data-testid="decision-edit-amount"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          style={inputBox}
          value={form.amountDollars}
          disabled={disabled}
          onChange={(e) => update('amountDollars', e.target.value)}
        />
      </div>
      <div style={{ ...fieldStyle, flex: 1 }}>
        <div style={draftLabel}>Due date</div>
        <input
          data-testid="decision-edit-due-date"
          type="date"
          style={inputBox}
          value={form.dueDate}
          disabled={disabled}
          onChange={(e) => update('dueDate', e.target.value)}
        />
      </div>
    </div>
  );
}

/**
 * lease (update_rent / set_lease_terms): rent amount in whole dollars. For
 * set_lease_terms (`isFullLease`), also surface rent due day + start/end dates.
 */
function LeaseFields({
  draft,
  form,
  update,
  disabled,
}: FieldGroupProps & { draft: DecisionEditDraft | undefined }) {
  const isFullLease = draft?.isFullLease === true;

  return (
    <>
      <div style={fieldStyle}>
        <div style={draftLabel}>Monthly rent ($)</div>
        <input
          data-testid="decision-edit-rent-amount"
          type="number"
          inputMode="numeric"
          min={1}
          step="1"
          style={inputBox}
          value={form.rentAmount}
          disabled={disabled}
          onChange={(e) => update('rentAmount', e.target.value)}
        />
      </div>

      {isFullLease ? (
        <>
          <div style={fieldStyle}>
            <div style={draftLabel}>Rent due day (1–28)</div>
            <input
              data-testid="decision-edit-rent-due-day"
              type="number"
              inputMode="numeric"
              min={1}
              max={28}
              step="1"
              style={inputBox}
              value={form.rentDueDay}
              disabled={disabled}
              onChange={(e) => update('rentDueDay', e.target.value)}
            />
          </div>
          <div style={fieldRowStyle}>
            <div style={{ ...fieldStyle, flex: 1 }}>
              <div style={draftLabel}>Start date</div>
              <input
                data-testid="decision-edit-start-date"
                type="date"
                style={inputBox}
                value={form.startDate}
                disabled={disabled}
                onChange={(e) => update('startDate', e.target.value)}
              />
            </div>
            <div style={{ ...fieldStyle, flex: 1 }}>
              <div style={draftLabel}>End date</div>
              <input
                data-testid="decision-edit-end-date"
                type="date"
                style={inputBox}
                value={form.endDate}
                disabled={disabled}
                onChange={(e) => update('endDate', e.target.value)}
              />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

// ===========================================================================
// Patch construction (pure) — emit ONLY the fields the owner actually changed.
// ===========================================================================

/**
 * Builds the payload patch from the dirty fields for an `editKind`. Each branch
 * maps a changed form field to its real worker-payload key; unchanged fields
 * are omitted so the server's deep-merge preserves the proposal's other keys
 * (tenantRef / leaseRef / candidateIndex) and re-validates the merged result.
 *
 * @param editKind - The decision's edit kind (null when not editable).
 * @param form - The current form values.
 * @param draft - The decision's original editable values, for dirty comparison.
 * @returns A partial payload patch containing only the edited fields.
 */
function buildPatch(
  editKind: Decision['editKind'],
  form: FormState,
  draft: DecisionEditDraft | undefined,
): Record<string, unknown> {
  const d = draft ?? {};
  const patch: Record<string, unknown> = {};

  switch (editKind) {
    case 'message': {
      if (form.body !== (d.body ?? '')) patch.body = form.body;
      if (form.tone !== (d.tone ?? 'neutral')) patch.tone = form.tone;
      return patch;
    }
    case 'dispatch': {
      if (form.smsBody !== (d.smsBody ?? '')) patch.smsBody = form.smsBody;
      return patch;
    }
    case 'rent_payment': {
      const cents = dollarStringToCents(form.amountDollars);
      if (cents != null && cents !== (d.amountCents ?? null)) {
        patch.amountCents = cents;
      }
      if (form.dueDate && form.dueDate !== (d.dueDate ?? '')) {
        patch.dueDate = form.dueDate;
      }
      return patch;
    }
    case 'lease': {
      const rent = parseIntOrNull(form.rentAmount);
      if (rent != null && rent !== (d.rentAmount ?? null)) {
        patch.rentAmount = rent;
      }
      if (d.isFullLease === true) {
        const dueDay = parseIntOrNull(form.rentDueDay);
        if (dueDay != null && dueDay !== (d.rentDueDay ?? null)) {
          patch.rentDueDay = dueDay;
        }
        if (form.startDate && form.startDate !== (d.startDate ?? '')) {
          patch.startDate = form.startDate;
        }
        if (form.endDate && form.endDate !== (d.endDate ?? '')) {
          patch.endDate = form.endDate;
        }
      }
      return patch;
    }
    default:
      return patch;
  }
}

// ===========================================================================
// Small pure helpers
// ===========================================================================

/** "Save & approve" boundary copy for non-message kinds, derived from adapter. */
function approveBoundaryFor(
  editKind: Decision['editKind'],
  boundary: Decision['boundary'],
): string {
  switch (editKind) {
    case 'rent_payment':
      return 'Save & approve issues the payment request to the tenant now.';
    case 'lease':
      return 'Save & approve changes the lease terms now.';
    case 'dispatch':
      return 'Save & approve records your approval for the dispatch workflow (vendor is not contacted).';
    default:
      return (boundary ?? '').trim();
  }
}

/** Whole-dollar string for an input from a cents value; '' when absent. */
function centsToDollarString(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '';
  return String(Math.round(cents) / 100);
}

/** Parses a dollars string to integer cents; null when blank/invalid. */
function dollarStringToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

/** Parses an integer string; null when blank/invalid. */
function parseIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/** Capitalizes the first letter of a short label. */
function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value[0].toUpperCase() + value.slice(1);
}
