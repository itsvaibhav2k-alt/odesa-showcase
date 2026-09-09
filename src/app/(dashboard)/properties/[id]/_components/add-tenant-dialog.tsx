'use client';

/**
 * AddTenantDialog — owner-side form for adding a tenant to this property.
 *
 * A tenant is linked to a property only through a lease on one of its
 * units, so unit selection is required. Submits via the `addTenantAction`
 * server action, whose request key atomically creates/reuses the tenant and
 * links one active lease to a currently vacant unit.
 *
 * Warm-premium "briefing card" on the shared menu standard (`ui/dialog-parts`):
 * cream shell, hero (icon badge + eyebrow + serif title), elevated input shells
 * with leading icons, a peach guidance note, and the solid-orange primary CTA.
 * De-vibe-coded — no gradients, no decorative illustration, no sparkle icons.
 * Two trigger variants — `header` (compact outline button beside the panel
 * title) and `primary` (the filled CTA inside the empty state).
 */

import * as React from 'react';
import { Calendar, DollarSign, Home, Mail, Phone, User, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import {
  DialogHero,
  Field,
  InputShell,
  SelectControl,
  TextControl,
} from '@/components/ui/dialog-parts';

import { addTenantAction } from '../actions';

export interface TenantUnitOption {
  id: string;
  label: string;
}

export interface AddTenantDialogProps {
  propertyId: string;
  units: ReadonlyArray<TenantUnitOption>;
  /** `header` = compact outline trigger; `primary` = filled CTA. */
  variant?: 'header' | 'primary';
}

export function AddTenantDialog({
  propertyId,
  units,
  variant = 'header',
}: AddTenantDialogProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [requestId, setRequestId] = React.useState(() => crypto.randomUUID());

  const hasUnits = units.length > 0;

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    try {
      const result = await addTenantAction({ propertyId }, form);
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
      {variant === 'header' ? (
        <Button
          type='button'
          variant='outline'
          size='sm'
          data-testid='add-tenant-trigger'
          onClick={() => {
            setRequestId(crypto.randomUUID());
            setOpen(true);
          }}
        >
          + Add tenant
        </Button>
      ) : (
        <Button
          type='button'
          data-testid='add-tenant-trigger'
          onClick={() => {
            setRequestId(crypto.randomUUID());
            setOpen(true);
          }}
        >
          Add tenant
        </Button>
      )}

      <DialogContent
        // Inline style guarantees width regardless of base-class merge order.
        style={{ width: 'min(720px, 94vw)', maxWidth: 'min(720px, 94vw)' }}
        className='flex max-h-[calc(100dvh-2.5rem)] flex-col gap-0 overflow-hidden rounded-[28px] border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-[0_32px_90px_rgba(39,31,22,0.22)]'
        data-testid='add-tenant-dialog'
        aria-labelledby='add-tenant-title'
      >
        <DialogHero
          icon={UserPlus}
          eyebrow='Tenant'
          title='Add tenant'
          titleId='add-tenant-title'
          description='Assign a resident to a unit on this property. Their lease starts as owner-confirmed — you can fill in terms anytime.'
        />

        {hasUnits ? (
          <form
            action={onSubmit}
            data-testid='add-tenant-form'
            className='flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-8 py-8'
          >
            <input type='hidden' name='requestId' value={requestId} />
            <div className='grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2'>
              <Field id='tenant-name' label='Full name'>
                <InputShell icon={User}>
                  <TextControl
                    id='tenant-name'
                    name='fullName'
                    type='text'
                    placeholder='Jordan Rivera'
                    autoComplete='off'
                    autoFocus
                    required
                  />
                </InputShell>
              </Field>

              <Field id='tenant-unit' label='Unit'>
                <InputShell icon={Home}>
                  <SelectControl
                    id='tenant-unit'
                    name='unitId'
                    defaultValue={units.length === 1 ? units[0]!.id : ''}
                    required
                  >
                    {units.length === 1 ? null : (
                      <option value='' disabled>
                        Select a unit…
                      </option>
                    )}
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </SelectControl>
                </InputShell>
              </Field>

              <Field id='tenant-phone' label='Phone'>
                <InputShell icon={Phone}>
                  <TextControl
                    id='tenant-phone'
                    name='phone'
                    type='tel'
                    inputMode='tel'
                    placeholder='(571) 555-0134'
                    required
                  />
                </InputShell>
              </Field>

              <Field id='tenant-email' label='Email' optional>
                <InputShell icon={Mail}>
                  <TextControl
                    id='tenant-email'
                    name='email'
                    type='email'
                    placeholder='jordan@example.com'
                    autoComplete='off'
                  />
                </InputShell>
              </Field>

              <Field id='tenant-rent' label='Monthly rent' optional>
                <InputShell icon={DollarSign}>
                  <TextControl
                    id='tenant-rent'
                    name='monthlyRent'
                    type='number'
                    min='0'
                    step='1'
                    inputMode='numeric'
                    placeholder='1500'
                  />
                </InputShell>
              </Field>

              <Field id='tenant-start' label='Lease start' optional>
                <InputShell icon={Calendar}>
                  <TextControl id='tenant-start' name='startDate' type='date' />
                </InputShell>
              </Field>
            </div>

            {/* Guidance note — plain bordered callout, no sparkle. */}
            <div className='flex flex-col gap-0.5 rounded-2xl border border-[var(--amber-border)] bg-[var(--amber-bg-soft)] px-4 py-3.5'>
              <strong className='text-[13px] font-semibold text-[var(--clay-ink)]'>
                You can always add more details later.
              </strong>
              <p className='text-[12.5px] leading-relaxed text-[var(--ink-600)]'>
                Lease terms, deposits, documents, and additional residents can be
                added anytime.
              </p>
            </div>

            {error ? (
              <p
                role='alert'
                data-testid='add-tenant-error'
                className='rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3.5 py-2.5 text-[13px] text-[#b91c1c]'
              >
                {error}
              </p>
            ) : null}

            <div className='-mx-8 -mb-8 mt-1 flex flex-col-reverse gap-3 border-t border-[var(--hairline-faint)] bg-[var(--panel)] px-8 py-5 sm:flex-row sm:items-center sm:justify-end'>
              <DialogClose
                render={
                  <Button
                    type='button'
                    variant='ghost'
                    disabled={pending}
                    className='w-full sm:w-auto'
                  />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type='submit'
                data-testid='add-tenant-submit'
                disabled={pending}
                className='w-full min-w-[120px] sm:w-auto'
              >
                {pending ? 'Saving…' : 'Add tenant'}
              </Button>
            </div>
          </form>
        ) : (
          <div className='flex flex-col px-8 py-8'>
            <p
              data-testid='add-tenant-no-units'
              className='rounded-2xl border border-[var(--amber-border)] bg-[var(--amber-bg-soft)] px-4 py-3.5 text-[13px] leading-relaxed text-[var(--clay-ink)]'
            >
              A tenant has to be linked to a vacant unit, and this property
              doesn&rsquo;t have one available right now. Add a unit or end the
              current assignment, then come back to add the tenant.
            </p>
            <div className='-mx-8 -mb-8 mt-6 flex items-center justify-end border-t border-[var(--hairline-faint)] bg-[var(--panel)] px-8 py-5'>
              <DialogClose render={<Button type='button' variant='ghost' />}>
                Close
              </DialogClose>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * TenantsEmptyState — shown in the Units panel when no unit has a resident
 * yet. Carries its own primary "Add tenant" CTA so the first-tenant flow is
 * reachable without hunting through menus.
 */
export function TenantsEmptyState({
  propertyId,
  units,
}: {
  propertyId: string;
  units: ReadonlyArray<TenantUnitOption>;
}): React.ReactElement {
  return (
    <div
      data-testid='tenants-empty-state'
      className='flex flex-col items-start gap-3 border-b border-[var(--hairline-faint)] px-[18px] py-5'
    >
      <div>
        <p className='text-[13px] font-medium text-[var(--ink-900)]'>
          No tenants added yet
        </p>
        <p className='mt-1 max-w-[42ch] text-[13px] leading-relaxed text-[var(--ink-500)]'>
          Add the first tenant to start tracking occupancy, rent, and
          communication.
        </p>
      </div>
      <AddTenantDialog propertyId={propertyId} units={units} variant='primary' />
    </div>
  );
}
