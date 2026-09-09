'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/shared';
import type { ApiResponse } from '@/types';

interface Props {
  propertyId: string;
  action: (formData: FormData) => Promise<ApiResponse<{ id: string }>>;
}

type FormState = { error: string | null };

const INITIAL: FormState = { error: null };

export function UnitForm({ propertyId, action }: Props) {
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
    <form action={formAction} className='space-y-4' data-testid='unit-form'>
      {state.error && (
        <p
          className='text-sm text-destructive'
          data-testid='unit-error'
          role='alert'
        >
          {state.error}
        </p>
      )}
      <input type='hidden' name='propertyId' value={propertyId} />
      <FormField label='Unit label' htmlFor='label'>
        <Input
          id='label'
          name='label'
          type='text'
          placeholder='101'
          required
          data-testid='unit-label'
        />
      </FormField>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <FormField label='Bedrooms' htmlFor='bedrooms'>
          <Input
            id='bedrooms'
            name='bedrooms'
            type='number'
            min={0}
            max={20}
            step={1}
            placeholder='2'
            data-testid='unit-bedrooms'
          />
        </FormField>
        <FormField label='Bathrooms' htmlFor='bathrooms'>
          <Input
            id='bathrooms'
            name='bathrooms'
            type='number'
            min={0}
            max={20}
            step='0.5'
            placeholder='1.5'
            data-testid='unit-bathrooms'
          />
        </FormField>
        <FormField label='Square feet' htmlFor='squareFeet'>
          <Input
            id='squareFeet'
            name='squareFeet'
            type='number'
            min={0}
            max={20000}
            step={1}
            placeholder='850'
            data-testid='unit-square-feet'
          />
        </FormField>
      </div>
      <Button
        type='submit'
        className='w-full'
        disabled={pending}
        data-testid='unit-submit'
      >
        {pending ? 'Saving...' : 'Continue to tenant'}
      </Button>
    </form>
  );
}
