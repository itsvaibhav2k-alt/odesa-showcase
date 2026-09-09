'use client';

/**
 * EditPropertyDialog — owner-side edit of a property's name + mailing
 * address, opened from the "Edit" affordance in the property header.
 *
 * Replaces the former no-op header button. Mirrors the AddTenantDialog
 * modal (warm paper/ink palette, controlled base-ui Dialog, server-action
 * form) and renders a trigger styled as the header's other
 * `property-action-control` buttons so the header layout is unchanged.
 */

import * as React from 'react';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';

import { updateProperty } from '../actions';

export interface EditPropertyInitial {
  name: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}

export interface EditPropertyDialogProps {
  propertyId: string;
  initial: EditPropertyInitial;
}

export function EditPropertyDialog({
  propertyId,
  initial,
}: EditPropertyDialogProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await updateProperty({ propertyId }, form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <button
        type='button'
        className='property-action-control'
        data-testid='edit-property-trigger'
        onClick={() => setOpen(true)}
      >
        <Pencil size={14} strokeWidth={1.8} />
        <span>Edit</span>
      </button>

      <DialogContent
        style={{ width: 'min(560px, 92vw)', maxWidth: 'min(560px, 92vw)' }}
        className='border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-2xl shadow-[var(--ink-900)]/[0.08]'
        data-testid='edit-property-dialog'
        aria-labelledby='edit-property-title'
      >
        <div className='border-b border-[var(--ink-100)] px-8 pt-10 pb-6 pr-14'>
          <p className='mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-500)]'>
            Property
          </p>
          <h2
            id='edit-property-title'
            className='font-serif-display text-[22px] leading-tight text-[var(--ink-900)]'
            data-slot='dialog-title'
          >
            Edit property
          </h2>
          <p className='mt-2 text-[13px] leading-relaxed text-[var(--ink-500)]'>
            Update the name and mailing address for this property.
          </p>
        </div>

        <form
          action={onSubmit}
          data-testid='edit-property-form'
          className='flex flex-col gap-8 px-8 py-7'
        >
          <Field id='property-name' label='Property name'>
            <TextControl
              id='property-name'
              name='name'
              type='text'
              defaultValue={initial.name}
              placeholder='22 Oak St'
              autoFocus
              required
            />
          </Field>

          <Field id='property-street' label='Street address' optional>
            <TextControl
              id='property-street'
              name='addressStreet'
              type='text'
              defaultValue={initial.addressStreet ?? ''}
              placeholder='22 Oak Street'
            />
          </Field>

          <div className='grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-3'>
            <Field id='property-city' label='City' optional>
              <TextControl
                id='property-city'
                name='addressCity'
                type='text'
                defaultValue={initial.addressCity ?? ''}
                placeholder='Arlington'
              />
            </Field>
            <Field id='property-state' label='State' optional>
              <TextControl
                id='property-state'
                name='addressState'
                type='text'
                defaultValue={initial.addressState ?? ''}
                placeholder='VA'
              />
            </Field>
            <Field id='property-zip' label='ZIP' optional>
              <TextControl
                id='property-zip'
                name='addressZip'
                type='text'
                defaultValue={initial.addressZip ?? ''}
                placeholder='22201'
              />
            </Field>
          </div>

          {error ? (
            <p
              role='alert'
              data-testid='edit-property-error'
              className='rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]'
            >
              {error}
            </p>
          ) : null}

          <div className='-mx-8 -mb-7 mt-2 flex items-center justify-end gap-2 border-t border-[var(--ink-100)] bg-[var(--paper-50,var(--paper-0))] px-8 py-4'>
            <DialogClose
              render={<Button type='button' variant='ghost' disabled={pending} />}
            >
              Cancel
            </DialogClose>
            <Button
              type='submit'
              data-testid='edit-property-submit'
              disabled={pending}
              className='min-w-[88px]'
            >
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-2'>
      <label
        htmlFor={id}
        className='flex items-baseline gap-1.5 text-[12px] font-medium text-[var(--ink-700)]'
      >
        {label}
        {optional ? (
          <span className='text-[11px] font-normal text-[var(--ink-400)]'>
            optional
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

const CONTROL_BASE =
  'block h-10 w-full rounded-lg border border-[var(--ink-200)] bg-[var(--paper-0)] px-3 text-[14px] text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-400)] hover:border-[var(--ink-300)] focus-visible:border-[var(--ink-900)] focus-visible:ring-2 focus-visible:ring-[var(--ink-900)]/10 disabled:cursor-not-allowed disabled:opacity-50';

function TextControl(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={`${CONTROL_BASE} ${className ?? ''}`} />;
}
