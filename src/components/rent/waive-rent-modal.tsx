'use client';

/**
 * WaiveRentModal — forgive the remaining balance of one rent cycle.
 *
 * Sibling of RecordPaymentModal on the shared warm-premium menu standard
 * (`ui/dialog` + `ui/dialog-parts`): icon-badge hero, reason field, a plain
 * callout stating exactly what a waive does (and does not do), solid primary
 * CTA. Width is set inline so it can't be beaten by base-class merge order.
 *
 * REASON-REQUIRED by design: waiving is money forgiveness, and the reason is
 * the audit trail (`rent_events.waived_reason`, with who/when/amount beside
 * it). Collected is never inflated — `waiveRentAction` lowers `amount_due`
 * to `amount_paid` instead of faking a payment, so the financials stay
 * honest and the ledger row reads "Waived", not "Paid".
 */

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { HandCoins, PenLine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DialogHero,
  Field,
  InputShell,
  TextControl,
} from '@/components/ui/dialog-parts';

import { waiveRentAction } from '@/app/(dashboard)/rent/actions';

/* ------------------------------------------------------------------ */
/* Trigger (quiet outline — secondary to the dark Record payment CTA)  */
/* ------------------------------------------------------------------ */

const triggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '11.5px',
  fontWeight: 450,
  letterSpacing: '-0.003em',
  whiteSpace: 'nowrap',
  borderRadius: 5,
  border: '1px solid var(--hairline-strong)',
  background: 'transparent',
  color: 'var(--ink-2)',
  padding: '5px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export interface WaiveRentModalProps {
  /** The exact rent_events row (displayed cycle) to waive. */
  rentEventId: string;
  /** Lease whose rent cycle is being waived. */
  leaseId: string;
  /** Current outstanding balance in DOLLARS — shown in the context block. */
  outstandingDollars: number;
  /** Trigger button copy. Defaults to "Waive rent". */
  triggerLabel?: string;
  /** Tenant name for the context block (e.g. "Hannah Ito"). */
  tenantName?: string;
  /** Unit label for the context block (e.g. "17th Street · A"). */
  unitLabel?: string;
  /** Rent cycle label for the context block (e.g. "July 2026"). */
  cycleLabel?: string;
}

/** Formats DOLLARS with thousands separators (whole or 2dp) for display. */
function formatBalance(outstandingDollars: number): string {
  const value = Number.isFinite(outstandingDollars) ? outstandingDollars : 0;
  const hasCents = Math.round(value * 100) % 100 !== 0;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function WaiveRentModal({
  rentEventId,
  leaseId,
  outstandingDollars,
  triggerLabel = 'Waive rent',
  tenantName,
  unitLabel,
  cycleLabel,
}: WaiveRentModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waived, setWaived] = useState(false);

  function resetForm(): void {
    setReason('');
    setPending(false);
    setError(null);
    setWaived(false);
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    // Refresh once on close if the waive landed so every surface (rent
    // ledger, tenant brief, financials, today) re-reads the new balance.
    if (!next) {
      const didWaive = waived;
      resetForm();
      if (didWaive) router.refresh();
    }
  }

  async function handleWaive(): Promise<void> {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Give a short reason — it becomes the audit note.');
      return;
    }
    setError(null);
    setPending(true);

    const result = await waiveRentAction({ rentEventId, leaseId, reason: trimmed });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    setPending(false);
    setWaived(true);
  }

  const identityLine = [tenantName, unitLabel].filter(Boolean).join(' · ');
  const hasContext = Boolean(tenantName || unitLabel || cycleLabel);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger style={triggerStyle} data-testid='waive-rent-trigger'>
        {triggerLabel}
      </DialogTrigger>

      <DialogContent
        // Inline width guard — can't be beaten by base-class merge order.
        style={{ width: 'min(560px, 94vw)', maxWidth: 'min(560px, 94vw)' }}
        className='flex max-h-[calc(100dvh-2.5rem)] flex-col gap-0 overflow-hidden rounded-[28px] border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-[0_32px_90px_rgba(39,31,22,0.22)]'
        data-testid='waive-rent-modal'
        aria-labelledby='waive-rent-title'
      >
        <DialogHero
          icon={HandCoins}
          eyebrow='Rent'
          title='Waive this month&rsquo;s rent'
          titleId='waive-rent-title'
          description='Forgive what is still owed on this cycle. The tenant will no longer show as late for it.'
        />

        <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6'>
          {hasContext && (
            <div
              data-testid='waive-rent-context'
              className='rounded-2xl border border-[var(--hairline-faint)] bg-[var(--panel-lift)] px-[18px] py-4 shadow-[0_12px_30px_rgba(39,31,22,0.05)]'
            >
              <div className='flex items-start justify-between gap-4'>
                <div className='min-w-0'>
                  {identityLine && (
                    <div className='truncate text-[13px] font-medium leading-tight text-[var(--ink-900)]'>
                      {identityLine}
                    </div>
                  )}
                  {cycleLabel && (
                    <div className='mt-1.5 text-[12px] leading-none text-[var(--ink-500)]'>
                      {cycleLabel}
                    </div>
                  )}
                </div>
                <div className='shrink-0 text-right'>
                  <div className='text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--ink-500)]'>
                    Will be waived
                  </div>
                  <div className='num mt-1 text-[13px] font-semibold leading-none text-[var(--ink-900)]'>
                    ${formatBalance(outstandingDollars)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <Field id='waive-rent-reason' label='Reason (kept as the audit note)'>
            <InputShell icon={PenLine}>
              <TextControl
                id='waive-rent-reason'
                type='text'
                placeholder='e.g. Unit uninhabitable during repairs'
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError(null);
                }}
                disabled={pending || waived}
                data-testid='waive-rent-reason'
              />
            </InputShell>
          </Field>

          {/* What-this-does callout — plain bordered box, no icon. */}
          <div
            data-testid='waive-rent-note'
            className='rounded-2xl border border-[var(--amber-border)] bg-[var(--amber-bg-soft)] px-4 py-3.5'
          >
            <strong className='block text-[13px] font-semibold leading-tight text-[var(--clay-ink)]'>
              This forgives the balance — it is not a payment.
            </strong>
            <p className='mt-1.5 text-[12.5px] leading-relaxed text-[var(--ink-600)]'>
              Collected totals stay unchanged; the row shows as Waived with
              the amount, your name, and this reason. No money moves.
            </p>
          </div>

          {waived && (
            <p
              role='status'
              data-testid='waive-rent-success'
              className='rounded-xl border border-[var(--green-border)] bg-[var(--panel-lift)] px-4 py-3 text-[13px] text-[var(--green-ink)]'
            >
              Rent waived for this cycle. The balance is cleared.
            </p>
          )}

          {error && (
            <p
              role='alert'
              data-testid='waive-rent-error'
              className='rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]'
            >
              {error}
            </p>
          )}
        </div>

        <div className='flex flex-col-reverse gap-3 border-t border-[var(--hairline-faint)] bg-[var(--panel)] px-8 py-5 sm:flex-row sm:items-center sm:justify-end'>
          {waived ? (
            <DialogClose
              render={
                <Button
                  type='button'
                  data-testid='waive-rent-submit'
                  className='w-full sm:w-auto'
                />
              }
            >
              Done
            </DialogClose>
          ) : (
            <>
              <DialogClose
                render={
                  <Button
                    type='button'
                    variant='ghost'
                    data-testid='waive-rent-cancel'
                    className='w-full sm:w-auto'
                  />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type='button'
                onClick={() => void handleWaive()}
                disabled={pending}
                className='w-full min-w-[140px] sm:w-auto'
                data-testid='waive-rent-submit'
              >
                {pending ? 'Waiving…' : `Waive $${formatBalance(outstandingDollars)}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
