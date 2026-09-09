'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/shared';
import type { ApiResponse } from '@/types';

interface Props {
  unitId: string;
  tenantId: string;
  action: (formData: FormData) => Promise<ApiResponse<{ id: string }>>;
}

type FormState = { error: string | null };

const INITIAL: FormState = { error: null };

export function LeaseForm({ unitId, tenantId, action }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      const result = await action(formData);
      if (result.success) {
        return { error: null };
      }
      return { error: result.error };
    },
    INITIAL,
  );

  return (
    <form action={formAction} className='space-y-4' data-testid='lease-form'>
      {state.error && (
        <p
          className='text-sm text-destructive'
          data-testid='lease-error'
          role='alert'
        >
          {state.error}
        </p>
      )}
      <input type='hidden' name='unitId' value={unitId} />
      <input type='hidden' name='tenantId' value={tenantId} />
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <FormField label='Monthly rent' htmlFor='rentAmount'>
          <Input
            id='rentAmount'
            name='rentAmount'
            type='number'
            min={1}
            step='0.01'
            placeholder='1800'
            required
            data-testid='lease-rent-amount'
          />
        </FormField>
        <FormField label='Due day (1-31)' htmlFor='rentDueDay'>
          <Input
            id='rentDueDay'
            name='rentDueDay'
            type='number'
            min={1}
            max={31}
            step={1}
            placeholder='1'
            required
            data-testid='lease-rent-due-day'
          />
        </FormField>
      </div>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <FormField label='Start date' htmlFor='startDate'>
          <Input
            id='startDate'
            name='startDate'
            type='date'
            required
            data-testid='lease-start-date'
          />
        </FormField>
        <FormField label='End date' htmlFor='endDate'>
          <Input
            id='endDate'
            name='endDate'
            type='date'
            required
            data-testid='lease-end-date'
          />
        </FormField>
      </div>
      <Button
        type='submit'
        className='w-full'
        disabled={pending}
        data-testid='lease-submit'
      >
        {pending ? 'Saving...' : 'Finish setup'}
      </Button>
    </form>
  );
}
