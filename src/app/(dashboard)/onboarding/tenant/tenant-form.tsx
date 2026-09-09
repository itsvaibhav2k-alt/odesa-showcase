'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/shared';
import type { ApiResponse } from '@/types';

interface Props {
  unitId: string;
  action: (formData: FormData) => Promise<ApiResponse<{ id: string }>>;
}

type FormState = { error: string | null };

const INITIAL: FormState = { error: null };

export function TenantForm({ unitId, action }: Props) {
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
    <form action={formAction} className='space-y-4' data-testid='tenant-form'>
      {state.error && (
        <p
          className='text-sm text-destructive'
          data-testid='tenant-error'
          role='alert'
        >
          {state.error}
        </p>
      )}
      <input type='hidden' name='unitId' value={unitId} />
      <FormField label='Full name' htmlFor='fullName'>
        <Input
          id='fullName'
          name='fullName'
          type='text'
          placeholder='Jane Smith'
          required
          data-testid='tenant-full-name'
        />
      </FormField>
      <FormField
        label='Phone (E.164)'
        htmlFor='phoneE164'
        description='Include the country code — 10-digit US numbers auto-prefix with +1.'
      >
        <Input
          id='phoneE164'
          name='phoneE164'
          type='tel'
          placeholder='+15715551234'
          required
          data-testid='tenant-phone'
        />
      </FormField>
      <FormField label='Email (optional)' htmlFor='email'>
        <Input
          id='email'
          name='email'
          type='email'
          placeholder='jane@example.com'
          data-testid='tenant-email'
        />
      </FormField>
      <FormField label='Date of birth (optional)' htmlFor='dateOfBirth'>
        <Input
          id='dateOfBirth'
          name='dateOfBirth'
          type='date'
          data-testid='tenant-dob'
        />
      </FormField>
      <Button
        type='submit'
        className='w-full'
        disabled={pending}
        data-testid='tenant-submit'
      >
        {pending ? 'Saving...' : 'Continue to lease'}
      </Button>
    </form>
  );
}
