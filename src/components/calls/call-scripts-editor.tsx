'use client';

/**
 * CallScriptsEditor — inspect + lightly customize the per-call-type scripts.
 *
 * One expandable row per CallScriptType (headers ALWAYS in the DOM so e2e can
 * pin them). Each expanded row shows the default behavior, the safety
 * boundaries (muted, NON-editable — they mirror the deterministic policy gate),
 * the fields Odesa collects, and a single owner-guidance textarea.
 *
 * Owner guidance is ADDITIVE context only — it is not system instructions and
 * can never relax a safety boundary. Saving sends the FULL merged overrides map
 * (whole-column replace, per the action's contract): existing overrides plus
 * this row's new notes, or with the key removed when notes are empty.
 *
 * Minimal by intent (plan amendment 7): no history, no autosave, no conflict
 * UX. `useTransition`, no effect-fetch loops.
 */

import { useState, useTransition } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { updateVoiceSettings } from '@/app/(dashboard)/calls/actions';
import {
  CALL_SCRIPTS,
  CALL_SCRIPT_TYPES,
  type CallScriptType,
  type ScriptOverrides,
} from '@/lib/voice/scripts';

export interface CallScriptsEditorProps {
  overrides: ScriptOverrides;
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const rowStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 14,
  background: 'var(--panel-lift)',
  overflow: 'hidden',
};

const headerButtonStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '13px 15px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
};

const caretStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink-3)',
  flexShrink: 0,
};

const rowTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-serif-display), Georgia, serif',
  fontStyle: 'italic',
  fontSize: '16px',
  fontWeight: 400,
  color: 'var(--ink)',
};

const customizedPillStyle: CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '9.5px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--amber-ink)',
  background: 'var(--amber-bg-soft)',
  border: '1px solid var(--amber-border)',
  borderRadius: 999,
  padding: '2px 8px',
};

const bodyStyle: CSSProperties = {
  borderTop: '1px solid var(--hairline)',
  padding: '14px 15px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const summaryStyle: CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
  margin: 0,
};

const groupLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 6,
};

const bulletListStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--ink-2)',
  fontSize: '12.5px',
  lineHeight: 1.55,
};

const boundaryBoxStyle: CSSProperties = {
  border: '1px solid var(--hairline)',
  borderRadius: 12,
  background: 'rgba(62, 45, 32, 0.03)',
  padding: '11px 13px',
};

const boundaryHintStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '11.5px',
  lineHeight: 1.45,
  margin: '0 0 7px',
};

const boundaryListStyle: CSSProperties = {
  ...bulletListStyle,
  color: 'var(--ink-3)',
};

const chipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const chipStyle: CSSProperties = {
  fontSize: '11.5px',
  color: 'var(--ink-2)',
  background: 'rgba(62, 45, 32, 0.05)',
  border: '1px solid var(--hairline)',
  borderRadius: 999,
  padding: '3px 9px',
};

const guidanceBoxStyle: CSSProperties = {
  border: '1px solid var(--green-border)',
  borderLeft: '3px solid var(--green)',
  borderRadius: 12,
  background: 'var(--green-bg)',
  padding: '11px 13px',
};

const editableLabelStyle: CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--green-ink)',
  marginBottom: 6,
};

const textareaStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--hairline)',
  borderRadius: 10,
  background: 'var(--panel-clean)',
  padding: '8px 10px',
  fontSize: '13px',
  lineHeight: 1.45,
  color: 'var(--ink)',
  fontFamily: 'inherit',
  minHeight: 74,
  resize: 'vertical',
};

const hintRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  justifyContent: 'space-between',
};

const hintStyle: CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: '11.5px',
  lineHeight: 1.45,
  margin: '5px 0 0',
};

const counterStyle: CSSProperties = {
  flexShrink: 0,
  marginTop: 5,
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: '10.5px',
  color: 'var(--ink-3)',
};

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const saveButtonStyle: CSSProperties = {
  background: 'var(--green-bg)',
  color: 'var(--green-ink)',
  border: '1px solid var(--green-border)',
  borderRadius: 10,
  padding: '9px 15px',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const saveButtonDisabledStyle: CSSProperties = {
  ...saveButtonStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const removeButtonStyle: CSSProperties = {
  background: 'transparent',
  color: 'var(--clay)',
  border: 'none',
  padding: 0,
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
};

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: '9px 12px',
  background: 'var(--clay-bg)',
  color: 'var(--clay-ink)',
  border: '1px solid var(--clay-border)',
  borderRadius: 8,
  fontSize: '12.5px',
  lineHeight: 1.45,
};

export function CallScriptsEditor({ overrides }: CallScriptsEditorProps) {
  const router = useRouter();
  const [openType, setOpenType] = useState<CallScriptType | null>(null);
  // Editable draft per type, seeded from saved overrides.
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const type of CALL_SCRIPT_TYPES) {
      seed[type] = overrides[type]?.customNotes ?? '';
    }
    return seed;
  });
  const [pendingType, setPendingType] = useState<CallScriptType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Build the FULL merged map (whole-column replace) for one row's save.
  const save = (type: CallScriptType, nextNotes: string) => {
    setError(null);
    setPendingType(type);
    const trimmed = nextNotes.trim();
    const nextMap: ScriptOverrides = { ...overrides };
    if (trimmed === '') {
      delete nextMap[type];
    } else {
      nextMap[type] = { customNotes: trimmed };
    }
    startTransition(async () => {
      const result = await updateVoiceSettings({ scriptOverrides: nextMap });
      if (!result.success) {
        setError(result.error);
        setPendingType(null);
        return;
      }
      setPendingType(null);
      router.refresh();
    });
  };

  const handleRemove = (type: CallScriptType) => {
    setNotes((prev) => ({ ...prev, [type]: '' }));
    save(type, '');
  };

  return (
    <div data-testid="call-scripts-editor">
      <div style={listStyle}>
        {CALL_SCRIPT_TYPES.map((type) => {
          const script = CALL_SCRIPTS[type];
          const isOpen = openType === type;
          const isCustomized = Boolean(overrides[type]);
          const isPending = pendingType === type;

          return (
            <div key={type} style={rowStyle} data-testid={`call-script-row-${type}`}>
              <button
                type="button"
                style={headerButtonStyle}
                aria-expanded={isOpen}
                onClick={() => setOpenType(isOpen ? null : type)}
              >
                <span aria-hidden="true" style={caretStyle}>
                  {isOpen ? '▾' : '▸'}
                </span>
                <span style={rowTitleStyle}>{script.title}</span>
                {isCustomized ? (
                  <span style={customizedPillStyle} data-testid={`call-script-customized-${type}`}>
                    Customized
                  </span>
                ) : null}
              </button>

              {isOpen ? (
                <div style={bodyStyle}>
                  <p style={summaryStyle}>{script.summary}</p>

                  <div>
                    <span style={groupLabelStyle}>Default behavior</span>
                    <ul style={bulletListStyle}>
                      {script.defaultBehavior.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div style={boundaryBoxStyle}>
                    <span style={groupLabelStyle}>🔒 Safety boundaries (locked)</span>
                    <p style={boundaryHintStyle}>
                      Odesa will never cross these, and they cannot be edited here — they mirror the
                      policy gate enforced on every call.
                    </p>
                    <ul style={boundaryListStyle}>
                      {script.safetyBoundaries.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <span style={groupLabelStyle}>Odesa collects</span>
                    <div style={chipRowStyle}>
                      {script.collectedFields.map((field, idx) => (
                        <span key={idx} style={chipStyle}>
                          {field}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div style={guidanceBoxStyle}>
                    <label style={editableLabelStyle} htmlFor={`call-script-notes-input-${type}`}>
                      ✎ Your guidance (editable)
                    </label>
                    <textarea
                      id={`call-script-notes-input-${type}`}
                      value={notes[type] ?? ''}
                      onChange={(e) =>
                        setNotes((prev) => ({ ...prev, [type]: e.target.value }))
                      }
                      disabled={isPending}
                      maxLength={2000}
                      placeholder={'e.g. Ask for the best callback window. Prefer to close with "Thanks for calling — we’re on it."'}
                      style={textareaStyle}
                      data-testid={`call-script-notes-${type}`}
                    />
                    <div style={hintRowStyle}>
                      <p style={hintStyle}>
                        Extra context for Odesa on this call type — not system instructions. It can
                        add guidance but can never relax the safety boundaries above.
                      </p>
                      <span style={counterStyle}>{(notes[type] ?? '').length}/2000</span>
                    </div>
                  </div>

                  <div style={footerStyle}>
                    <button
                      type="button"
                      onClick={() => save(type, notes[type] ?? '')}
                      disabled={isPending}
                      style={isPending ? saveButtonDisabledStyle : saveButtonStyle}
                      data-testid={`call-script-save-${type}`}
                    >
                      {isPending ? 'Saving…' : 'Save notes'}
                    </button>
                    {isCustomized ? (
                      <button
                        type="button"
                        onClick={() => handleRemove(type)}
                        disabled={isPending}
                        style={removeButtonStyle}
                        data-testid={`call-script-remove-${type}`}
                      >
                        Remove customization
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? (
        <div style={errorStyle} role="alert" data-testid="call-scripts-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
