'use client';

/**
 * Client form for the admin phone-number pool top-up page.
 *
 * Lets an Odesa operator paste E.164 numbers (one per line) and submit
 * them via `addPoolNumbersAction`. Shows the result inline.
 *
 * T2b (2026-05-17): created for pool-based provisioning v1.
 */

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import type { ApiResponse } from '@/types';
import type { AddNumbersSuccess } from './actions';

interface PoolTopUpFormProps {
  addNumbers: (input: { rawNumbers: string }) => Promise<ApiResponse<AddNumbersSuccess>>;
  availableCount: number;
}

interface FormState {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  inserted?: number;
  skipped?: string[];
}

export function PoolTopUpForm({ addNumbers, availableCount }: PoolTopUpFormProps) {
  const [rawNumbers, setRawNumbers] = useState('');
  const [formState, setFormState] = useState<FormState>({ status: 'idle', message: null });
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormState({ status: 'idle', message: null });

    startTransition(async () => {
      const result = await addNumbers({ rawNumbers });
      if (result.success) {
        setRawNumbers('');
        const skippedMsg =
          result.data.skipped.length > 0
            ? ` (${result.data.skipped.length} invalid lines skipped: ${result.data.skipped.join(', ')})`
            : '';
        setFormState({
          status: 'success',
          message: `Added ${result.data.inserted} number${result.data.inserted !== 1 ? 's' : ''} to the pool.${skippedMsg}`,
          inserted: result.data.inserted,
          skipped: result.data.skipped,
        });
      } else {
        setFormState({ status: 'error', message: result.error });
      }
    });
  };

  return (
    <div
      className='max-w-xl space-y-6'
      data-testid='admin-pool-topup-form'
    >
      {/* Pool status badge */}
      <div
        className={[
          'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
          availableCount <= 3
            ? 'bg-destructive/10 text-destructive'
            : 'bg-green-50 text-green-700',
        ].join(' ')}
        data-testid='admin-pool-count'
      >
        <span
          className={[
            'size-2 rounded-full',
            availableCount <= 3 ? 'bg-destructive' : 'bg-green-500',
          ].join(' ')}
          aria-hidden
        />
        {availableCount} available in pool
        {availableCount <= 3 && ' — LOW'}
      </div>

      <form onSubmit={handleSubmit} className='space-y-4'>
        <div className='space-y-1.5'>
          <label
            htmlFor='pool-numbers'
            className='text-sm font-medium leading-none'
          >
            E.164 numbers to add
          </label>
          <p className='text-xs text-muted-foreground'>
            One number per line, e.g. <code>+16505551234</code>. Legacy
            Sendblue pool — deprecated for V1; numbers must be purchased
            in the Sendblue dashboard first.
          </p>
          <textarea
            id='pool-numbers'
            name='pool-numbers'
            rows={8}
            value={rawNumbers}
            onChange={(e) => setRawNumbers(e.target.value)}
            disabled={pending}
            placeholder={'+16505551234\n+16505555678\n...'}
            className='w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
            data-testid='admin-pool-numbers-input'
          />
        </div>

        <Button
          type='submit'
          disabled={pending || rawNumbers.trim().length === 0}
          data-testid='admin-pool-submit'
        >
          {pending ? 'Adding...' : 'Add to pool'}
        </Button>

        {formState.message && (
          <p
            role='status'
            className={
              formState.status === 'success'
                ? 'text-sm text-foreground'
                : 'text-sm text-destructive'
            }
            data-testid={
              formState.status === 'success'
                ? 'admin-pool-success'
                : 'admin-pool-error'
            }
          >
            {formState.message}
          </p>
        )}
      </form>
    </div>
  );
}
