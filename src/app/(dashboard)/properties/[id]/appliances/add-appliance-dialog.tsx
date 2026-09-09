'use client';

/**
 * AddApplianceDialog — owner-side form for inserting a new appliance.
 *
 * Submits via the `addApplianceAction` server action. Source is set to
 * `'owner'` and confidence to `1.0` server-side; the form doesn't
 * expose those knobs (that's a wave-7 contract — UI form writes are
 * always owner-confirmed).
 *
 * Centered modal Dialog with custom-styled inputs/selects (native
 * controls under the hood, restyled to match the rest of the app —
 * appearance:none on selects + explicit chevron icon).
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
} from '@/components/ui/dialog';

import { addApplianceAction } from './actions';
import {
  APPLIANCE_TYPE_OPTIONS,
  type ApplianceType,
} from './shared-types';

export interface AddApplianceDialogProps {
  propertyId: string;
  units: ReadonlyArray<{ id: string; label: string }>;
}

export function AddApplianceDialog({
  propertyId,
  units,
}: AddApplianceDialogProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [type, setType] = React.useState<ApplianceType>('fridge');

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await addApplianceAction({ propertyId }, form);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setType('fridge');
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
      <Button
        type='button'
        variant='outline'
        size='sm'
        data-testid='add-appliance-trigger'
        onClick={() => setOpen(true)}
      >
        + Add appliance
      </Button>

      <DialogContent
        // Inline style guarantees width regardless of base-class merge order.
        style={{ width: 'min(620px, 92vw)', maxWidth: 'min(620px, 92vw)' }}
        className='border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-2xl shadow-[var(--ink-900)]/[0.08]'
        data-testid='add-appliance-dialog'
      >
        {/* pt-10 keeps the eyebrow well below the absolute-positioned close ×
        (top-2 = 8px + 28px button = 36px). pr-14 keeps the title from running
        into it horizontally. */}
        <div className='border-b border-[var(--ink-100)] px-8 pt-10 pb-6 pr-14'>
          <p className='mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-500)]'>
            Property
          </p>
          <h2
            className='font-serif-display text-[22px] leading-tight text-[var(--ink-900)]'
            data-slot='dialog-title'
          >
            Add appliance
          </h2>
          <p className='mt-2 text-[13px] leading-relaxed text-[var(--ink-500)]'>
            Log a new appliance for this property. Saved as owner-confirmed.
          </p>
        </div>

        <form
          action={onSubmit}
          data-testid='add-appliance-form'
          className='flex flex-col gap-8 px-8 py-7'
        >
          <div className='grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2'>
            <Field id='appliance-type' label='Type'>
              <SelectControl
                id='appliance-type'
                name='type'
                value={type}
                onChange={(e) => setType(e.target.value as ApplianceType)}
                required
              >
                {APPLIANCE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectControl>
            </Field>

            <Field id='appliance-unit' label='Unit' optional>
              <SelectControl
                id='appliance-unit'
                name='unitId'
                defaultValue=''
              >
                <option value=''>Property-wide</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </SelectControl>
            </Field>

            <Field id='appliance-make' label='Make'>
              <TextControl
                id='appliance-make'
                name='make'
                type='text'
                placeholder='Samsung'
              />
            </Field>

            <Field id='appliance-model' label='Model'>
              <TextControl
                id='appliance-model'
                name='model'
                type='text'
                placeholder='RF28R7351SR'
              />
            </Field>

            <Field id='appliance-install-date' label='Install date'>
              <TextControl
                id='appliance-install-date'
                name='installDate'
                type='date'
              />
            </Field>

            <Field id='appliance-warranty' label='Warranty expires'>
              <TextControl
                id='appliance-warranty'
                name='warrantyExpiresAt'
                type='date'
              />
            </Field>
          </div>

          <Field id='appliance-notes' label='Notes' optional>
            <textarea
              id='appliance-notes'
              name='notes'
              rows={3}
              placeholder='Last service, quirks, where the filter is hidden, etc.'
              className='block w-full resize-y rounded-lg border border-[var(--ink-200)] bg-[var(--paper-0)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-400)] hover:border-[var(--ink-300)] focus-visible:border-[var(--ink-900)] focus-visible:ring-2 focus-visible:ring-[var(--ink-900)]/10'
            />
          </Field>

          {error ? (
            <p
              role='alert'
              className='rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]'
            >
              {error}
            </p>
          ) : null}

          <div className='-mx-8 -mb-7 mt-2 flex items-center justify-end gap-2 border-t border-[var(--ink-100)] bg-[var(--paper-50,var(--paper-0))] px-8 py-4'>
            <DialogClose
              render={
                <Button
                  type='button'
                  variant='ghost'
                  disabled={pending}
                />
              }
            >
              Cancel
            </DialogClose>
            <Button
              type='submit'
              data-testid='add-appliance-submit'
              disabled={pending}
              className='min-w-[88px]'
            >
              {pending ? 'Saving…' : 'Save appliance'}
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

// Shared input/select base — same height, border treatment, focus ring,
// so Type/Unit/Make/Model/Install/Warranty all line up visually.
const CONTROL_BASE =
  'block h-10 w-full rounded-lg border border-[var(--ink-200)] bg-[var(--paper-0)] px-3 text-[14px] text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-400)] hover:border-[var(--ink-300)] focus-visible:border-[var(--ink-900)] focus-visible:ring-2 focus-visible:ring-[var(--ink-900)]/10 disabled:cursor-not-allowed disabled:opacity-50';

function TextControl(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={`${CONTROL_BASE} ${className ?? ''}`} />;
}

function SelectControl({
  className,
  children,
  style,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className='relative'>
      <select
        {...rest}
        // Inline `-webkit-appearance: none` is required to hide the native
        // double-chevron on Safari/Webkit; Tailwind v4's `appearance-none`
        // only emits the unprefixed property.
        style={{
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          appearance: 'none',
          ...style,
        }}
        className={`${CONTROL_BASE} cursor-pointer pr-10 ${className ?? ''}`}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-500)]'
      />
    </div>
  );
}
