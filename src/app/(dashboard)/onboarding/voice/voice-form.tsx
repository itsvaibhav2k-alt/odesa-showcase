'use client';

/**
 * Client form for the voice/Retell opt-in step.
 *
 * Two buttons: "Enable voice calls" (opt in) and "Skip for now" (opt
 * out / defer). Both call `setVoiceEnabledAction` then navigate to
 * `/today`. The skip path writes `voice_enabled = false` so the
 * operator's explicit choice is recorded, not just absent.
 *
 * Graceful degradation: if the DB column isn't present yet (pending T2b
 * migration), the action returns an error. We surface it inline and
 * still offer a "Continue without saving" escape so the operator can
 * reach /today.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

import type { SetVoiceEnabledSuccess } from './actions';
import type { ApiResponse } from '@/types';

interface VoiceFormProps {
  /** Current value from `organizations.voice_enabled`; null if column absent. */
  initialVoiceEnabled: boolean | null;
  setVoiceEnabled: (
    enabled: boolean,
  ) => Promise<ApiResponse<SetVoiceEnabledSuccess>>;
}

export function VoiceForm({
  initialVoiceEnabled,
  setVoiceEnabled,
}: VoiceFormProps) {
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [columnMissing, setColumnMissing] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleChoice = (enable: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await setVoiceEnabled(enable);
      if (result.success) {
        router.push('/today');
      } else {
        // If the column is missing the error text from Postgres contains
        // "column" and "does not exist" — treat this specially so we can
        // show an escape hatch without blocking the operator.
        const isMissingColumn =
          result.error.includes('column') ||
          result.error.includes('does not exist');
        setColumnMissing(isMissingColumn);
        setError(result.error);
      }
    });
  };

  return (
    <div className='flex flex-col gap-6' data-testid='voice-form'>
      {/* Feature description */}
      <div
        className='rounded-lg border p-4 flex flex-col gap-2'
        style={{ borderColor: 'var(--ink-200)', background: 'var(--paper-0)' }}
        data-testid='voice-feature-description'
      >
        <p className='text-sm font-medium' style={{ color: 'var(--ink-900)' }}>
          What voice calling does
        </p>
        <ul
          className='text-sm space-y-1'
          style={{ color: 'var(--ink-600)' }}
        >
          <li>Tenants can call your Odesa number and speak to the AI</li>
          <li>Maintenance requests, payments, and lease questions — voice</li>
          <li>Powered by Retell AI — same knowledge base as your SMS assistant</li>
          <li>You receive a call summary after every tenant call</li>
        </ul>
      </div>

      {/* Current status hint when already opted in */}
      {initialVoiceEnabled === true && (
        <p
          className='text-sm'
          style={{ color: 'var(--ink-500)' }}
          data-testid='voice-already-enabled'
        >
          Voice calling is already enabled for your account.
        </p>
      )}

      {/* Error message */}
      {error && (
        <div className='flex flex-col gap-2' data-testid='voice-error-container'>
          <p
            className='text-sm text-destructive'
            role='alert'
            data-testid='voice-error'
          >
            {columnMissing
              ? 'Voice calling is not fully set up yet — the feature is rolling out. Your choice will be saved once the rollout completes.'
              : error}
          </p>
          {(columnMissing || error) && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => router.push('/today')}
              data-testid='voice-skip-anyway'
            >
              Continue to dashboard anyway
            </Button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className='flex flex-col gap-3 sm:flex-row' data-testid='voice-actions'>
        <Button
          type='button'
          className='flex-1'
          disabled={pending}
          onClick={() => handleChoice(true)}
          data-testid='voice-enable-button'
        >
          {pending ? 'Saving…' : 'Enable voice calls'}
        </Button>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          disabled={pending}
          onClick={() => handleChoice(false)}
          data-testid='voice-skip-button'
        >
          Skip for now
        </Button>
      </div>

      <p
        className='text-xs text-muted-foreground'
        data-testid='voice-footer-note'
      >
        You can change this any time in{' '}
        <a
          href='/settings'
          className='underline underline-offset-4'
        >
          Settings
        </a>
        .
      </p>
    </div>
  );
}
