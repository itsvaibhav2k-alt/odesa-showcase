'use client';

import { useState, type CSSProperties } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Owner Queue — "Save as owner guidance" dialog (Pass 2).
 *
 * The owner teaches Odesa how to handle a situation in future by saving a line
 * of guidance to the property's rulebook. The guidance is EDITABLE here (a
 * textarea pre-filled with a sensible default for the decision kind) — it is
 * never the bare decision title. The dialog owns its own save lifecycle
 * (edit → Save → success / error) so the owner gets real confirmation that the
 * guidance was written.
 *
 * HONESTY — this is GUIDANCE, not an enforced rule. Confirming calls
 * `onSave(propertyId, text)` which appends to the property rulebook; the copy
 * reads "Odesa will use it in future recommendations", never "enforced".
 */

/** The guidance the owner is about to save, with its property scope. */
export interface GuidanceTarget {
  /** The decision the guidance was derived from (for reconciling card state). */
  decisionId: string;
  /** The property the guidance is scoped to. */
  propertyId: string;
  /** Human-readable property scope shown to the owner, e.g. "OAKWOOD COMMONS". */
  propertyLabel: string;
  /** The DEFAULT/initial guidance text (editable before save). */
  text: string;
}

/** Result of a save attempt, returned by the parent's server-action wrapper. */
export interface SaveGuidanceResult {
  ok: boolean;
  error?: string;
  /** True when the exact guidance line was already present (idempotent skip). */
  duplicate?: boolean;
}

export interface SaveGuidanceDialogProps {
  /** The guidance target; null closes the dialog. */
  target: GuidanceTarget | null;
  /** Close handler (backdrop / Escape / Cancel / Done). */
  onClose: () => void;
  /** Persists the (edited) guidance; resolves to a result the dialog renders. */
  onSave: (propertyId: string, text: string) => Promise<SaveGuidanceResult>;
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

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 84,
  resize: 'vertical',
  border: '1px solid var(--hairline-strong)',
  borderRadius: 8,
  background: 'var(--panel-lift)',
  padding: '11px 13px',
  fontSize: '14px',
  lineHeight: 1.5,
  color: 'var(--ink)',
  letterSpacing: '-0.003em',
  fontFamily: 'inherit',
  marginBottom: 6,
  boxSizing: 'border-box',
};

const hintRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 10,
  marginBottom: 16,
};

const hintStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-3)',
  lineHeight: 1.4,
};

const counterStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const scopeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 4,
};

const scopeValueStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-operator), ui-monospace, monospace',
  fontSize: '11.5px',
  color: 'var(--ink-2)',
  letterSpacing: '0.02em',
};

const errStyle: CSSProperties = {
  color: 'var(--terracotta)',
  fontSize: '12.5px',
  marginTop: 12,
};

const successBodyStyle: CSSProperties = {
  padding: '20px 24px 6px',
};

const successTitleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--ink)',
  marginBottom: 6,
};

const checkStyle: CSSProperties = {
  color: 'var(--green-ink, #4d7a56)',
  fontSize: '15px',
};

const successSubStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--ink-2)',
  lineHeight: 1.5,
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

const MAX_LEN = 280;

export function SaveGuidanceDialog({
  target,
  onClose,
  onSave,
}: SaveGuidanceDialogProps) {
  const open = target != null;

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<null | 'saved' | 'duplicate'>(null);
  const [error, setError] = useState<string | null>(null);
  const [seededId, setSeededId] = useState<string | null>(null);

  // Re-seed the editable text (and reset lifecycle) whenever a NEW decision's
  // dialog opens — done during render per React's "you might not need an
  // effect" guidance, so it never triggers a cascading-effect render.
  if (target && target.decisionId !== seededId) {
    setSeededId(target.decisionId);
    setText(target.text);
    setBusy(false);
    setSaved(null);
    setError(null);
  }

  const trimmed = text.trim();
  const hasScope = target != null && target.propertyId.length > 0;
  const canSave =
    target != null && hasScope && trimmed.length > 0 && !busy && saved == null;

  async function handleSave() {
    if (!target || !canSave) return;
    setBusy(true);
    setError(null);
    const result = await onSave(target.propertyId, trimmed.slice(0, MAX_LEN));
    setBusy(false);
    if (result.ok) {
      setSaved(result.duplicate ? 'duplicate' : 'saved');
    } else {
      setError(result.error ?? 'Could not save guidance');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        data-testid="save-guidance-dialog"
        showCloseButton={false}
        // The dialog PORTALS to document.body, outside the page's
        // `.today-theme` wrapper — so theme-scoped tokens like `--ink` /
        // `--ink-2` would resolve empty here (making the dark "Save guidance"
        // button render transparent + cream-on-cream = invisible). Re-establish
        // the theme on the popup so every token resolves inside the portal.
        className="today-theme p-0 max-w-[460px]"
        style={contentStyle}
      >
        <div style={headStyle}>
          <DialogTitle style={titleStyle}>Save as owner guidance?</DialogTitle>
          <DialogDescription style={descStyle}>
            This is guidance Odesa considers — not an enforced rule. Odesa will
            use it when drafting future recommendations.
          </DialogDescription>
        </div>

        {target != null && saved == null && (
          <div style={bodyStyle}>
            <div style={fieldLabelStyle}>Guidance to save</div>
            <textarea
              data-testid="save-guidance-text"
              aria-label="Guidance to save"
              style={textareaStyle}
              value={text}
              maxLength={MAX_LEN}
              disabled={busy}
              autoFocus
              onChange={(e) => setText(e.target.value)}
            />
            <div style={hintRowStyle}>
              <span style={hintStyle}>
                Edit this into your own words — it&apos;s saved to the property
                rulebook.
              </span>
              <span style={counterStyle} className="num">
                {trimmed.length}/{MAX_LEN}
              </span>
            </div>

            <div style={fieldLabelStyle}>Applies to</div>
            <div style={scopeRowStyle}>
              <span style={scopeValueStyle} data-testid="save-guidance-scope">
                {target.propertyLabel}
              </span>
            </div>

            {!hasScope ? (
              <div role="alert" data-testid="save-guidance-error" style={errStyle}>
                This decision has no property scope, so guidance can&apos;t be
                saved for it.
              </div>
            ) : error ? (
              <div role="alert" data-testid="save-guidance-error" style={errStyle}>
                {error}
              </div>
            ) : null}
          </div>
        )}

        {target != null && saved != null && (
          <div style={successBodyStyle} data-testid="save-guidance-success">
            <div style={successTitleStyle}>
              <span aria-hidden="true" style={checkStyle}>
                ✓
              </span>
              {saved === 'duplicate'
                ? 'Already saved as guidance'
                : 'Saved as guidance'}
            </div>
            <div style={successSubStyle}>
              {saved === 'duplicate'
                ? `This guidance was already on the ${target.propertyLabel} rulebook.`
                : `Added to the ${target.propertyLabel} rulebook — Odesa will use it when drafting future recommendations.`}
            </div>
          </div>
        )}

        <div style={actionsStyle}>
          {saved == null ? (
            <>
              <button
                type="button"
                data-testid="save-guidance-cancel"
                style={cancelBtnStyle}
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="save-guidance-confirm"
                style={canSave ? confirmBtnStyle : confirmBtnDisabledStyle}
                disabled={!canSave}
                onClick={handleSave}
              >
                {busy ? 'Saving…' : 'Save guidance'}
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="save-guidance-done"
              style={confirmBtnStyle}
              onClick={onClose}
            >
              Done
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
