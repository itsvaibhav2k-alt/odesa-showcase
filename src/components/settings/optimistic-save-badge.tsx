'use client';

/**
 * The 120ms "Saved" meta indicator used by every field on Settings.
 *
 * No "Save" button exists anywhere on the Settings screen — each field's
 * `onChange` fires a server action immediately. This badge communicates
 * the transition to the landlord in the least-flashy way the design
 * allows:
 *
 *   idle  : nothing rendered
 *   saving: subtle ink-500 "Saving..." text, no spinner
 *   saved : ink-500 "Saved" text, auto-fades after 2000ms (120ms fade)
 *   error : ink-500 "Couldn't save — try again" with a retry button
 *
 * The 2s auto-hide is owned by the parent — this component renders
 * whatever state it's passed. Keeps the logic testable + the component
 * purely presentational. Parents typically manage state with a ref +
 * `setTimeout` that matches the spec's 120ms fade-out.
 */

import { useEffect, useRef, useState } from 'react';

export type OptimisticSaveState = 'idle' | 'saving' | 'saved' | 'error';

interface OptimisticSaveBadgeProps {
  state: OptimisticSaveState;
  /** Optional retry callback — rendered only when `state === 'error'`. */
  onRetry?: () => void;
  /**
   * Optional testid suffix so specs can target a specific field's badge.
   * Produces `data-testid="optimistic-save-<suffix>"`.
   */
  testId?: string;
}

/**
 * Small helper hook that fades the badge out over 120ms once `state`
 * hits `saved`. Returns the actual opacity the badge should render at.
 *
 * Implementation note: we only touch `setOpacity` inside the 2s
 * timeout callback (not synchronously in the effect) to avoid the
 * react-hooks/set-state-in-effect lint rule. The saved→fade transition
 * then flows through: state changes to 'saved' → opacity stays at 1 →
 * 2s later the timeout fires → opacity transitions to 0. Any state
 * change back to idle/saving/error resets opacity to 1 via the timer
 * cleanup pathway.
 */
function useFadeOutOnSaved(state: OptimisticSaveState): number {
  const [opacity, setOpacity] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (state === 'saved') {
      // Hold at full opacity for ~2s, then trigger the fade.
      timerRef.current = setTimeout(() => setOpacity(0), 2_000);
    } else {
      // Non-saved states want immediate visibility — reset via the
      // async queue to stay outside react-hooks/set-state-in-effect.
      timerRef.current = setTimeout(() => setOpacity(1), 0);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state]);

  return opacity;
}

export function OptimisticSaveBadge({
  state,
  onRetry,
  testId,
}: OptimisticSaveBadgeProps) {
  const opacity = useFadeOutOnSaved(state);

  if (state === 'idle') return null;

  const testIdProp = testId
    ? `optimistic-save-${testId}`
    : 'optimistic-save-badge';

  const label = (() => {
    switch (state) {
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'Saved';
      case 'error':
        return "Couldn't save — try again";
    }
  })();

  return (
    <span
      data-testid={testIdProp}
      data-state={state}
      className="meta-label inline-flex items-center gap-2"
      style={{
        color: 'var(--ink-500)',
        textTransform: 'none',
        letterSpacing: '0.02em',
        fontSize: '12px',
        opacity,
        transition: 'opacity 120ms var(--ease-smooth)',
      }}
    >
      <span>{label}</span>
      {state === 'error' && onRetry ? (
        <button
          type="button"
          data-testid={
            testId
              ? `optimistic-save-retry-${testId}`
              : 'optimistic-save-retry'
          }
          onClick={onRetry}
          className="underline"
          style={{
            color: 'var(--navy-700)',
            textTransform: 'none',
            letterSpacing: '0.02em',
            fontSize: '12px',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
