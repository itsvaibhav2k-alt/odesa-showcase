'use client';

/**
 * RecordPaymentModal — record an offline/imported rent payment.
 *
 * Built on the shared warm-premium menu standard (`ui/dialog` + `ui/dialog-parts`):
 * a centered briefing card with an icon-badge hero, an elevated amount field, a
 * plain reassurance callout, and the solid-orange primary CTA. De-vibe-coded —
 * no gradients, no decorative art. Width is set inline so it can't be beaten by
 * base-class merge order (the same guard the Add-tenant dialog uses).
 *
 * AMOUNT-ONLY by design. The confirmed schema persists `rent_events`
 * `amount_paid` (DOLLARS, numeric(10,2)) on the current cycle — there is
 * no paid-date / method / note column, so those inputs are omitted rather
 * than collected and silently discarded. No money moves; this only
 * corrects the current cycle balance via `recordOfflinePaymentAction`,
 * which never writes the rent status enum (the derived status is
 * balance-first, so balance->0 becomes "Paid" on its own).
 */

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { DollarSign, Receipt } from 'lucide-react';

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

import { recordOfflinePaymentAction } from '@/app/(dashboard)/rent/actions';

/* ------------------------------------------------------------------ */
/* Trigger (the dark row action button — distinct from the menu CTA)   */
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
  background: 'var(--ink)',
  color: 'var(--panel-lift)',
  padding: '5px 10px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export interface RecordPaymentModalProps {
  /** The exact rent_events row (displayed cycle) to record against. */
  rentEventId: string;
  /** Lease whose rent cycle the payment is recorded against. */
  leaseId: string;
  /** Current outstanding balance in DOLLARS — the default amount. */
  outstandingDollars: number;
  /** Trigger button copy. Defaults to "Record payment". */
  triggerLabel?: string;
  /** Tenant name for the context block (e.g. "Marcus Lee"). */
  tenantName?: string;
  /** Unit label for the context block (e.g. "Oakwood · 4B"). */
  unitLabel?: string;
  /** Rent cycle label for the context block (e.g. "May 2026"). */
  cycleLabel?: string;
}

/** Rounds a dollar amount to a clean 2-decimal default for the input. */
function defaultAmount(outstandingDollars: number): string {
  if (!Number.isFinite(outstandingDollars) || outstandingDollars <= 0) return '';
  return String(Number(outstandingDollars.toFixed(2)));
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

export function RecordPaymentModal({
  rentEventId,
  leaseId,
  outstandingDollars,
  triggerLabel = 'Record payment',
  tenantName,
  unitLabel,
  cycleLabel,
}: RecordPaymentModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultAmount(outstandingDollars));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  function resetForm(): void {
    setAmount(defaultAmount(outstandingDollars));
    setPending(false);
    setError(null);
    setRecorded(false);
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    // Refresh once on close if a payment was recorded so every surface
    // (rent ledger, tenant brief, financials) re-reads the new balance.
    if (!next) {
      const didRecord = recorded;
      resetForm();
      if (didRecord) router.refresh();
    }
  }

  async function handleRecord(): Promise<void> {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than $0.');
      return;
    }
    setError(null);
    setPending(true);

    const result = await recordOfflinePaymentAction({
      rentEventId,
      leaseId,
      amountDollars: value,
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    setPending(false);
    setRecorded(true);
  }

  const identityLine = [tenantName, unitLabel].filter(Boolean).join(' · ');
  const hasContext = Boolean(tenantName || unitLabel || cycleLabel);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        style={triggerStyle}
        data-testid='record-payment-trigger'
      >
        {triggerLabel}
      </DialogTrigger>

      <DialogContent
        // Inline width guard — can't be beaten by base-class merge order.
        style={{ width: 'min(560px, 94vw)', maxWidth: 'min(560px, 94vw)' }}
        className='flex max-h-[calc(100dvh-2.5rem)] flex-col gap-0 overflow-hidden rounded-[28px] border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-[0_32px_90px_rgba(39,31,22,0.22)]'
        data-testid='record-payment-modal'
        aria-labelledby='record-payment-title'
      >
        <DialogHero
          icon={Receipt}
          eyebrow='Rent'
          title='Record offline payment'
          titleId='record-payment-title'
          description='Log a payment the tenant already made offline. No money is moved — this only updates the current rent cycle balance.'
        />

        {/* min-h-0 + overflow-y-auto: on short viewports (page zoom) the body
            scrolls instead of shoving the hero past the clipped top edge. */}
        <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6'>
          {hasContext && (
            <div
              data-testid='record-payment-context'
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
                    Outstanding
                  </div>
                  <div className='num mt-1 text-[13px] font-semibold leading-none text-[var(--ink-900)]'>
                    ${formatBalance(outstandingDollars)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <Field id='record-payment-amount' label='Amount received'>
            <InputShell icon={DollarSign}>
              <TextControl
                id='record-payment-amount'
                type='number'
                inputMode='decimal'
                min='0'
                step='0.01'
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (error) setError(null);
                }}
                disabled={pending || recorded}
                data-testid='record-payment-amount'
              />
            </InputShell>
          </Field>

          {/* Reassurance callout — plain bordered box, no icon. */}
          <div
            data-testid='record-payment-nomoney-note'
            className='rounded-2xl border border-[var(--amber-border)] bg-[var(--amber-bg-soft)] px-4 py-3.5'
          >
            <strong className='block text-[13px] font-semibold leading-tight text-[var(--clay-ink)]'>
              No money is moved.
            </strong>
            <p className='mt-1.5 text-[12.5px] leading-relaxed text-[var(--ink-600)]'>
              Recording this doesn&apos;t charge the tenant or send a payment
              link — it only updates this cycle&apos;s balance.
            </p>
          </div>

          {recorded && (
            <p
              role='status'
              data-testid='record-payment-success'
              className='rounded-xl border border-[var(--green-border)] bg-[var(--panel-lift)] px-4 py-3 text-[13px] text-[var(--green-ink)]'
            >
              Payment recorded. Current cycle balance updated.
            </p>
          )}

          {error && (
            <p
              role='alert'
              data-testid='record-payment-error'
              className='rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]'
            >
              {error}
            </p>
          )}
        </div>

        <div className='flex flex-col-reverse gap-3 border-t border-[var(--hairline-faint)] bg-[var(--panel)] px-8 py-5 sm:flex-row sm:items-center sm:justify-end'>
          {recorded ? (
            <DialogClose
              render={
                <Button
                  type='button'
                  data-testid='record-payment-submit'
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
                    data-testid='record-payment-cancel'
                    className='w-full sm:w-auto'
                  />
                }
              >
                Cancel
              </DialogClose>
              <Button
                type='button'
                onClick={() => void handleRecord()}
                disabled={pending}
                className='w-full min-w-[140px] sm:w-auto'
                data-testid='record-payment-submit'
              >
                {pending ? 'Recording…' : 'Record payment'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
