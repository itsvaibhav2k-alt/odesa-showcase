'use client';

/**
 * Property rulebook — auto-saving textarea bound to properties.rules_text.
 *
 * UX:
 *  - 4000-char hard ceiling enforced client-side; counter renders
 *    "234 / 4000" in monospace, switching to warning-600 over 3800.
 *  - 1s debounce after the last keystroke triggers a Server Action
 *    save, so we don't hammer the DB on every keypress.
 *  - The shared OptimisticSaveBadge anchors top-right of the header
 *    so the landlord sees Saving... → Saved without scanning.
 *  - On error we leave the local draft intact so a retry preserves
 *    the landlord's typing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  OptimisticSaveBadge,
  type OptimisticSaveState,
} from '@/components/settings/optimistic-save-badge';

import { updateRulebook } from './actions';

const MAX = 4000;
const WARN_AT = 3800;
const DEBOUNCE_MS = 1000;
const SAVED_HOLD_MS = 2200;

interface RulebookFormProps {
  propertyId: string;
  initialText: string;
}

export function RulebookForm({ propertyId, initialText }: RulebookFormProps) {
  const [text, setText] = useState(initialText);
  const [saveState, setSaveState] = useState<OptimisticSaveState>('idle');

  const lastSavedRef = useRef<string>(initialText);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSavedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (clearSavedRef.current) clearTimeout(clearSavedRef.current);
    };
  }, []);

  const performSave = useCallback(
    async (next: string) => {
      if (next === lastSavedRef.current) {
        setSaveState('idle');
        return;
      }
      setSaveState('saving');
      const result = await updateRulebook({ propertyId, rulesText: next });
      if (!result.success) {
        setSaveState('error');
        return;
      }
      lastSavedRef.current = result.data.rulesText;
      setSaveState('saved');
      if (clearSavedRef.current) clearTimeout(clearSavedRef.current);
      clearSavedRef.current = setTimeout(() => {
        setSaveState('idle');
      }, SAVED_HOLD_MS);
    },
    [propertyId],
  );

  function handleChange(next: string) {
    const capped = next.length > MAX ? next.slice(0, MAX) : next;
    setText(capped);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void performSave(capped);
    }, DEBOUNCE_MS);
  }

  function handleRetry() {
    void performSave(text);
  }

  const overWarning = text.length >= WARN_AT;

  return (
    <section
      data-testid="property-rulebook-section"
      aria-labelledby="property-rulebook-heading"
      className="flex flex-col gap-3"
      style={{
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-lg-odesa)',
        padding: '24px 28px',
      }}
    >
      <header className="flex items-baseline justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2
            id="property-rulebook-heading"
            className="font-serif-display"
            style={{
              fontSize: '20px',
              lineHeight: 1.2,
              letterSpacing: '-0.005em',
              color: 'var(--ink-900)',
            }}
          >
            Rulebook
          </h2>
          <p
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: 'var(--ink-600)',
              maxWidth: '60ch',
            }}
          >
            Tell Odesa how this property runs — quiet hours, escalation rules,
            preferred phrasing. Updates save as you type.
          </p>
        </div>
        <OptimisticSaveBadge
          state={saveState}
          testId="rulebook"
          onRetry={handleRetry}
        />
      </header>

      <textarea
        data-testid="property-rulebook-textarea"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={8}
        maxLength={MAX}
        placeholder="No rules yet. Anything you'd want a property manager to know goes here."
        spellCheck
        className="w-full rounded-md"
        style={{
          background: 'var(--paper-50)',
          border: '1px solid var(--ink-200)',
          color: 'var(--ink-800)',
          padding: '12px 14px',
          fontSize: '14px',
          lineHeight: 1.55,
          fontFamily: 'var(--font-body)',
          resize: 'vertical',
          minHeight: '160px',
          outline: 'none',
        }}
      />

      <div className="flex items-center justify-end">
        <span
          data-testid="property-rulebook-counter"
          className="tabular-nums"
          style={{
            fontFamily: "var(--font-mono-metrics), 'JetBrains Mono', monospace",
            fontSize: '12px',
            color: overWarning ? 'var(--warning-600)' : 'var(--ink-500)',
          }}
        >
          {text.length} / {MAX}
        </span>
      </div>
    </section>
  );
}
