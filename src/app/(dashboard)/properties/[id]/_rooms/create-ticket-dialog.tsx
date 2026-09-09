'use client';

/**
 * CreateTicketDialog — property-level "File a maintenance ticket" flow for the
 * maintenance room drawer.
 *
 * For a multi-hundred-property operator, manual maintenance intake is mandatory,
 * so this enables a real (not stubbed) ticket-creation path at the property
 * level. A work order is always filed against a specific unit, so unit
 * selection is required; the ticket is property-level in the sense that no
 * tenant is attached (tenantId omitted) — Odesa triages from the description.
 *
 * Reuses the existing, RLS-scoped `createWorkOrderAction` server action (which
 * derives property_id from the unit and revalidates the property + maintenance
 * paths) — no duplicate write path. Mirrors the warm paper/operator-console
 * modal pattern from `add-tenant-dialog.tsx`: a controlled base-ui Dialog with
 * native controls restyled to the paper/ink palette and the same
 * Field / TextControl / SelectControl helpers.
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import type { WorkOrderCategory, WorkOrderUrgency } from '@/types/database';

import { createWorkOrderAction } from '../units/[unitId]/actions';

export interface CreateTicketUnitOption {
  id: string;
  label: string;
}

export interface CreateTicketDialogProps {
  units: ReadonlyArray<CreateTicketUnitOption>;
}

/**
 * Category options + display labels. Mirrors the set used by the unit-level
 * `RequestModal`, mapped onto the DB `work_order_category` enum the action
 * expects.
 */
const CATEGORY_OPTIONS: ReadonlyArray<{
  value: WorkOrderCategory;
  label: string;
}> = [
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'hvac', label: 'HVAC / heating & cooling' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'appliances', label: 'Appliance' },
  { value: 'general', label: 'Structural' },
  { value: 'other', label: 'Other' },
];

/**
 * Urgency options + display labels. Same three-level DB `work_order_urgency`
 * enum the action validates against.
 */
const URGENCY_OPTIONS: ReadonlyArray<{
  value: WorkOrderUrgency;
  label: string;
}> = [
  { value: 'emergency', label: 'Emergency' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'routine', label: 'Routine' },
];

export function CreateTicketDialog({
  units,
}: CreateTicketDialogProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const singleUnit = units.length === 1;
  const [unitId, setUnitId] = React.useState<string>(
    singleUnit ? units[0]!.id : '',
  );
  const [category, setCategory] = React.useState<WorkOrderCategory>(
    CATEGORY_OPTIONS[0]!.value,
  );
  const [urgency, setUrgency] = React.useState<WorkOrderUrgency>('urgent');
  const [description, setDescription] = React.useState('');

  function resetForm() {
    setUnitId(singleUnit ? units[0]!.id : '');
    setCategory(CATEGORY_OPTIONS[0]!.value);
    setUrgency('urgent');
    setDescription('');
    setError(null);
    setPending(false);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = description.trim();
    if (unitId === '') {
      setError('Select a unit for this ticket.');
      return;
    }
    if (trimmed === '') {
      setError('Add a short description so Odesa can triage this ticket.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      // Property-level ticket: omit tenantId so the action files it without a
      // resident attached. entryConsent defaults to false (no tenant to grant).
      const result = await createWorkOrderAction({
        unitId,
        category,
        urgency,
        description: trimmed,
        entryConsent: false,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      resetForm();
      // The action revalidates the property + maintenance paths, but the open
      // drawer won't re-fetch its RSC tree on its own — refresh to surface it.
      router.refresh();
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
        if (!next) resetForm();
      }}
    >
      <Button
        type='button'
        variant='outline'
        size='sm'
        data-testid='create-ticket-trigger'
        onClick={() => setOpen(true)}
      >
        + Create ticket
      </Button>

      <DialogContent
        // Inline style guarantees width regardless of base-class merge order.
        style={{ width: 'min(560px, 92vw)', maxWidth: 'min(560px, 92vw)' }}
        className='border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-2xl shadow-[var(--ink-900)]/[0.08]'
        data-testid='create-ticket-dialog'
      >
        <div className='border-b border-[var(--ink-100)] px-8 pt-10 pb-6 pr-14'>
          <p className='mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-500)]'>
            Maintenance
          </p>
          <h2
            className='font-serif-display text-[22px] leading-tight text-[var(--ink-900)]'
            data-slot='dialog-title'
          >
            Create ticket
          </h2>
          <p className='mt-2 text-[13px] leading-relaxed text-[var(--ink-500)]'>
            File a maintenance ticket against a unit on this property. Odesa
            triages it, sets priority, and recommends a vendor.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          data-testid='create-ticket-form'
          className='flex flex-col gap-8 px-8 py-7'
        >
          <div className='grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2'>
            <Field id='ticket-unit' label='Unit'>
              <SelectControl
                id='ticket-unit'
                name='unitId'
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                required
              >
                {singleUnit ? null : (
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
            </Field>

            <Field id='ticket-category' label='Category'>
              <SelectControl
                id='ticket-category'
                name='category'
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as WorkOrderCategory)
                }
                required
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </SelectControl>
            </Field>

            <Field id='ticket-urgency' label='Urgency'>
              <SelectControl
                id='ticket-urgency'
                name='urgency'
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as WorkOrderUrgency)}
                required
              >
                {URGENCY_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </SelectControl>
            </Field>
          </div>

          <Field id='ticket-description' label='What’s happening?'>
            <TextareaControl
              id='ticket-description'
              name='description'
              placeholder='Describe the issue. Odesa will triage, categorize, and suggest a vendor.'
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (error && e.target.value.trim() !== '') setError(null);
              }}
              rows={4}
              required
            />
          </Field>

          {error ? (
            <p
              role='alert'
              data-testid='create-ticket-error'
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
              data-testid='create-ticket-submit'
              disabled={pending}
              className='min-w-[88px]'
            >
              {pending ? 'Filing…' : 'Create ticket'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Local form controls — same height/border/focus treatment as the rest of the
// property dialogs (mirrors add-tenant-dialog) so fields line up visually.
// ---------------------------------------------------------------------------

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
  'block w-full rounded-lg border border-[var(--ink-200)] bg-[var(--paper-0)] px-3 text-[14px] text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-400)] hover:border-[var(--ink-300)] focus-visible:border-[var(--ink-900)] focus-visible:ring-2 focus-visible:ring-[var(--ink-900)]/10 disabled:cursor-not-allowed disabled:opacity-50';

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
        style={{
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          appearance: 'none',
          ...style,
        }}
        className={`${CONTROL_BASE} h-10 cursor-pointer pr-10 ${className ?? ''}`}
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

function TextareaControl(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={`${CONTROL_BASE} resize-y py-2 leading-relaxed ${className ?? ''}`}
    />
  );
}
