'use client';

/**
 * RequestModal — "File a maintenance request" dialog for the unit detail page.
 *
 * Trigger button + @base-ui/react Dialog. Fields: Category, Related appliance
 * (optional), Urgency (radiogroup), Description (textarea), Photos (dropzone
 * visual), entry-consent checkbox. Cancel + Submit (real work_orders insert
 * via the createWorkOrderAction server action). Fully focus-trapped and
 * labelled via Dialog primitives.
 *
 * Mirrors the mockup's .modal / .modal-head / .modal-body / .modal-actions /
 * .field / .seg / .dropzone / .checkrow pattern exactly. Uses today-theme CSS
 * vars, no hardcoded hex.
 */

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';

import type { WorkOrderCategory, WorkOrderUrgency } from '@/types/database';

import { createWorkOrderAction } from '@/app/(dashboard)/properties/[id]/units/[unitId]/actions';

/** Local UI urgency union (distinct from the DB `work_order_urgency` enum). */
type UrgencyUi = 'urgent' | 'high' | 'normal' | 'low';

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '11.5px',
  fontWeight: 450,
  letterSpacing: '-0.003em',
  whiteSpace: 'nowrap',
  borderRadius: 5,
  border: '1px solid var(--hairline-strong)',
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  padding: '5px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(27, 23, 18, 0.34)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 100,
  padding: 24,
};

const popupStyle: CSSProperties = {
  background: 'var(--panel-clean)',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 14,
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 24px 60px rgba(27, 23, 18, 0.22)',
  outline: 'none',
};

const headStyle: CSSProperties = {
  padding: '20px 24px 16px',
  borderBottom: '1px solid var(--hairline-faint)',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display)',
  fontStyle: 'italic',
  fontSize: '23px',
  color: 'var(--ink)',
  letterSpacing: '-0.015em',
  marginBottom: 5,
};

const subStyle: CSSProperties = {
  fontSize: '12.5px',
  color: 'var(--ink-2)',
};

const bodyStyle: CSSProperties = {
  padding: '18px 24px 8px',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '15px 24px 20px',
  borderTop: '1px solid var(--hairline-faint)',
};

const odesaNoteStyle: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-3)',
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  lineHeight: 1.4,
};

const odesaChipStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--terracotta)',
  flexShrink: 0,
};

const actionsRightStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
};

/* Field styles */
const fieldStyle: CSSProperties = { marginBottom: 15 };
const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono-operator)',
  fontSize: '9.5px',
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
  marginBottom: 7,
};
const fieldOptionalStyle: CSSProperties = {
  textTransform: 'none',
  letterSpacing: 0,
  color: 'var(--ink-4)',
};
const selectStyle: CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '13px',
  color: 'var(--ink)',
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 7,
  padding: '9px 11px',
  outline: 'none',
};
const textareaStyle: CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-sans-operator)',
  fontSize: '13px',
  color: 'var(--ink)',
  background: 'var(--panel-lift)',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 7,
  padding: '9px 11px',
  outline: 'none',
  resize: 'vertical',
  minHeight: 68,
  lineHeight: 1.5,
};
const dropzoneStyle: CSSProperties = {
  border: '1px dashed var(--hairline-strong)',
  borderRadius: 8,
  padding: 15,
  textAlign: 'center',
  fontSize: '12px',
  color: 'var(--ink-3)',
  background: 'var(--panel-lift)',
};
const checkrowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 9,
  fontSize: '12.5px',
  color: 'var(--ink-2)',
  lineHeight: 1.4,
  cursor: 'pointer',
};
const checkboxStyle: CSSProperties = {
  width: 15,
  height: 15,
  accentColor: 'var(--terracotta)',
  marginTop: 1,
  flexShrink: 0,
  cursor: 'pointer',
};

/* Segment radiogroup styles */
const segStyle: CSSProperties = { display: 'flex', gap: 7, flexWrap: 'wrap' };
const segLabelBase: CSSProperties = {
  fontSize: '12px',
  color: 'var(--ink-2)',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 6,
  padding: '6px 11px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  position: 'relative',
};
const segLabelSelected: CSSProperties = {
  ...segLabelBase,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};
const hiddenRadioStyle: CSSProperties = {
  position: 'absolute',
  opacity: 0,
  width: 0,
  height: 0,
};
const segDotBase: CSSProperties = { width: 6, height: 6, borderRadius: '50%' };

const URGENCY_DOT: Record<UrgencyUi, string> = {
  urgent: 'var(--clay)',
  high: 'var(--amber)',
  normal: 'var(--gold)',
  low: 'var(--ink-4)',
};

/* Shared btn */
const btnBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '11.5px',
  fontWeight: 450,
  letterSpacing: '-0.003em',
  whiteSpace: 'nowrap',
  borderRadius: 5,
  border: '1px solid var(--hairline-strong)',
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
  padding: '5px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  borderColor: 'var(--ink)',
};

const btnPrimaryDisabled: CSSProperties = {
  ...btnPrimary,
  opacity: 0.6,
  cursor: 'progress',
};

const errorRowStyle: CSSProperties = {
  margin: '0 24px 14px',
  padding: '9px 11px',
  borderRadius: 7,
  border: '1px solid var(--clay)',
  background: 'var(--panel-lift)',
  color: 'var(--clay)',
  fontSize: '12.5px',
  lineHeight: 1.4,
};

const fieldErrorStyle: CSSProperties = {
  marginTop: 6,
  fontSize: '12px',
  color: 'var(--clay)',
  lineHeight: 1.4,
};

/* ------------------------------------------------------------------ */
/* Form state                                                           */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'Plumbing',
  'HVAC / heating & cooling',
  'Electrical',
  'Appliance',
  'Structural',
  'Pest',
  'Other',
] as const;

/** Sentinel for "no related appliance" — maps to an undefined applianceLabel. */
const NONE_APPLIANCE = 'None';

/** Map the displayed category label → DB `work_order_category` enum. */
const CATEGORY_TO_DB: Record<string, WorkOrderCategory> = {
  Plumbing: 'plumbing',
  'HVAC / heating & cooling': 'hvac',
  Electrical: 'electrical',
  Appliance: 'appliances',
  Structural: 'general',
  Pest: 'other',
  Other: 'other',
};

/** Map the UI urgency segment → DB `work_order_urgency` enum. */
const URGENCY_TO_DB: Record<UrgencyUi, WorkOrderUrgency> = {
  urgent: 'emergency',
  high: 'urgent',
  normal: 'routine',
  low: 'routine',
};

const URGENCIES: UrgencyUi[] = ['urgent', 'high', 'normal', 'low'];
const URGENCY_LABELS: Record<UrgencyUi, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export interface RequestModalProps {
  /** units.id UUID the work order is filed against. */
  unitId: string;
  /** tenants.id UUID for the unit's active tenant, or null when vacant. */
  tenantId: string | null;
  /** Subtitle, e.g. "Unit 1A · 22 Oak St". */
  contextLabel: string;
  /** Related-appliance choices derived from the unit's appliance rows. */
  applianceOptions: string[];
}

export function RequestModal({
  unitId,
  tenantId,
  contextLabel,
  applianceOptions,
}: RequestModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [appliance, setAppliance] = useState<string>(NONE_APPLIANCE);
  const [urgency, setUrgency] = useState<UrgencyUi>('high');
  const [description, setDescription] = useState('');
  const [entryConsent, setEntryConsent] = useState(true);
  const [pending, setPending] = useState(false);
  const [descError, setDescError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const applianceChoices = [NONE_APPLIANCE, ...applianceOptions];

  function resetForm() {
    setCategory(CATEGORIES[0]);
    setAppliance(NONE_APPLIANCE);
    setUrgency('high');
    setDescription('');
    setEntryConsent(true);
    setPending(false);
    setDescError(false);
    setSubmitError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  async function handleSubmit() {
    const trimmed = description.trim();
    if (trimmed === '') {
      setDescError(true);
      return;
    }
    setDescError(false);
    setSubmitError(null);
    setPending(true);

    const result = await createWorkOrderAction({
      unitId,
      tenantId,
      category: CATEGORY_TO_DB[category] ?? 'other',
      urgency: URGENCY_TO_DB[urgency],
      description: trimmed,
      applianceLabel: appliance === NONE_APPLIANCE ? undefined : appliance,
      entryConsent,
    });

    if (!result.success) {
      setSubmitError(result.error);
      setPending(false);
      return;
    }

    setOpen(false);
    resetForm();
    // The server action revalidates the unit route, but the open page won't
    // re-fetch its RSC tree on its own — refresh so the new ticket appears.
    router.refresh();
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger
          style={triggerStyle}
          className="req-modal-trigger"
          data-testid="req-modal-trigger"
        >
          File a request
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Backdrop style={backdropStyle} />

          <Dialog.Popup
            style={popupStyle}
            data-testid="req-modal"
            className="req-modal-popup"
          >
            {/* Header */}
            <div style={headStyle}>
              <Dialog.Title style={titleStyle}>File a maintenance request</Dialog.Title>
              <Dialog.Description style={subStyle}>
                {contextLabel}
              </Dialog.Description>
            </div>

            {/* Body */}
            <div style={bodyStyle}>
              {/* Category */}
              <div style={fieldStyle}>
                <label htmlFor="req-cat" style={fieldLabelStyle}>
                  Category
                </label>
                <select
                  id="req-cat"
                  style={selectStyle}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="req-modal-select"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Related appliance */}
              <div style={fieldStyle}>
                <label htmlFor="req-appl" style={fieldLabelStyle}>
                  Related appliance{' '}
                  <span style={fieldOptionalStyle}>(optional)</span>
                </label>
                <select
                  id="req-appl"
                  style={selectStyle}
                  value={appliance}
                  onChange={(e) => setAppliance(e.target.value)}
                  className="req-modal-select"
                >
                  {applianceChoices.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>

              {/* Urgency radiogroup */}
              <div style={fieldStyle}>
                <span style={fieldLabelStyle} id="urgency-legend">
                  Urgency
                </span>
                <div style={segStyle} role="radiogroup" aria-labelledby="urgency-legend">
                  {URGENCIES.map((u) => {
                    const isSelected = urgency === u;
                    return (
                      <label key={u} style={isSelected ? segLabelSelected : segLabelBase}>
                        <input
                          type="radio"
                          name="req-urgency"
                          value={u}
                          checked={isSelected}
                          onChange={() => setUrgency(u)}
                          style={hiddenRadioStyle}
                        />
                        <span
                          aria-hidden="true"
                          style={{
                            ...segDotBase,
                            background: URGENCY_DOT[u],
                            ...(isSelected
                              ? { boxShadow: '0 0 0 2px var(--panel-lift)' }
                              : {}),
                          }}
                        />
                        {URGENCY_LABELS[u]}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Description */}
              <div style={fieldStyle}>
                <label htmlFor="req-desc" style={fieldLabelStyle}>
                  {"What's happening?"}
                </label>
                <textarea
                  id="req-desc"
                  style={textareaStyle}
                  placeholder="Describe the issue. Odesa will triage, categorize, and suggest a vendor."
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (descError && e.target.value.trim() !== '') {
                      setDescError(false);
                    }
                  }}
                  aria-invalid={descError}
                  className="req-modal-textarea"
                />
                {descError && (
                  <p style={fieldErrorStyle} data-testid="req-modal-desc-error">
                    Add a short description so Odesa can triage this request.
                  </p>
                )}
              </div>

              {/* Photos dropzone (visual only) */}
              <div style={fieldStyle}>
                <span style={fieldLabelStyle}>Photos</span>
                <div style={dropzoneStyle} aria-label="Photo upload area">
                  Drop photos here or browse · helps Odesa triage faster
                </div>
              </div>

              {/* Entry consent checkbox */}
              <div style={{ ...fieldStyle, marginBottom: 0 }}>
                <label style={checkrowStyle}>
                  <input
                    type="checkbox"
                    checked={entryConsent}
                    onChange={(e) => setEntryConsent(e.target.checked)}
                    style={checkboxStyle}
                  />
                  Tenant grants entry if no one is home (per lease §9)
                </label>
              </div>
            </div>

            {/* Submission error (keeps the dialog open) */}
            {submitError && (
              <div role="alert" style={errorRowStyle} data-testid="req-modal-error">
                {submitError}
              </div>
            )}

            {/* Actions */}
            <div style={actionsStyle}>
              <div style={odesaNoteStyle}>
                <span aria-hidden="true" style={odesaChipStyle}>
                  Odesa
                </span>
                <span>
                  Will auto-triage, set priority, and recommend a vendor before you submit.
                </span>
              </div>
              <div style={actionsRightStyle}>
                <Dialog.Close
                  style={btnBase}
                  className="req-modal-btn"
                  data-testid="req-modal-cancel"
                >
                  Cancel
                </Dialog.Close>
                <button
                  type="button"
                  style={pending ? btnPrimaryDisabled : btnPrimary}
                  onClick={handleSubmit}
                  disabled={pending}
                  className="req-modal-btn"
                  data-testid="req-modal-submit"
                >
                  {pending ? 'Submitting…' : 'Submit request'}
                </button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <RequestModalStyles />
    </>
  );
}

function RequestModalStyles() {
  return (
    <style precedence="request-modal">{`
      .req-modal-trigger:focus-visible,
      .req-modal-btn:focus-visible {
        outline: 2px solid var(--terracotta);
        outline-offset: 2px;
      }
      .req-modal-select:focus,
      .req-modal-textarea:focus {
        border-color: var(--terracotta);
        outline: none;
      }
      .req-modal-trigger:hover {
        background: #000;
      }
    `}</style>
  );
}
