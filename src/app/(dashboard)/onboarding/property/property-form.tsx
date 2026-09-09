'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/shared';
import type { ApiResponse } from '@/types';

interface Props {
  action: (formData: FormData) => Promise<ApiResponse<{ id: string }>>;
}

type FormState = { error: string | null };

const INITIAL: FormState = { error: null };

export function PropertyForm({ action }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_prev, formData) => {
      // Successful server actions redirect; the result only surfaces on
      // failure. The redirect throws a NEXT_REDIRECT control-flow signal
      // which React rethrows — we never see a "success" branch here.
      const result = await action(formData);
      if (result.success) {
        return { error: null };
      }
      return { error: result.error };
    },
    INITIAL,
  );

  return (
    <form
      action={formAction}
      className='space-y-4'
      data-testid='property-form'
    >
      {state.error && (
        <p
          className='text-sm text-destructive'
          data-testid='property-error'
          role='alert'
        >
          {state.error}
        </p>
      )}
      <FormField label='Property name' htmlFor='name'>
        <Input
          id='name'
          name='name'
          type='text'
          placeholder='Oakwood Apartments'
          required
          data-testid='property-name'
        />
      </FormField>
      <FormField label='Street address' htmlFor='addressStreet'>
        <Input
          id='addressStreet'
          name='addressStreet'
          type='text'
          placeholder='123 Main St'
          required
          data-testid='property-address-street'
        />
      </FormField>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_auto]'>
        <FormField label='City' htmlFor='addressCity'>
          <Input
            id='addressCity'
            name='addressCity'
            type='text'
            placeholder='Arlington'
            required
            data-testid='property-address-city'
          />
        </FormField>
        <FormField label='State' htmlFor='addressState' className='sm:w-20'>
          <Input
            id='addressState'
            name='addressState'
            type='text'
            placeholder='VA'
            maxLength={2}
            required
            className='uppercase'
            data-testid='property-address-state'
          />
        </FormField>
        <FormField label='ZIP' htmlFor='addressZip' className='sm:w-32'>
          <Input
            id='addressZip'
            name='addressZip'
            type='text'
            placeholder='22201'
            required
            data-testid='property-address-zip'
          />
        </FormField>
      </div>
      <FormField label='Timezone' htmlFor='timezone'>
        <Input
          id='timezone'
          name='timezone'
          type='text'
          defaultValue='America/New_York'
          data-testid='property-timezone'
        />
      </FormField>
      <Button
        type='submit'
        className='w-full'
        disabled={pending}
        data-testid='property-submit'
      >
        {pending ? 'Saving...' : 'Continue to unit'}
      </Button>
    </form>
  );
}
