'use client';

/**
 * ComposeMessageModal — owner-initiated message to a tenant.
 *
 * Built on the shared warm-premium menu standard (`ui/dialog` +
 * `ui/dialog-parts`): centered briefing card with an icon-badge hero,
 * elevated field shells, and the solid-orange primary CTA. Width is set
 * inline so it can't be beaten by base-class merge order (same guard as
 * the Add-tenant and Record-payment dialogs).
 *
 * Two launch postures share this component:
 *   - `/inbox` header "Compose": full tenant select.
 *   - Tenant brief "Message": single tenant, select pre-filled and
 *     locked via `initialTenantId`.
 *
 * Send goes through `composeToTenantAction` → find-or-create OPEN
 * conversation → `sendOwnerMessageAction` (insert-before-send). On
 * provider failure the message row is left `pending_review` in the
 * inbox, so the error copy says exactly that instead of pretending the
 * text vanished.
 */

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, User } from 'lucide-react';

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
  SelectControl,
} from '@/components/ui/dialog-parts';

import { composeToTenantAction } from '@/app/(dashboard)/inbox/compose-actions';
import type { ComposeTenantOption } from '@/lib/inbox/compose';

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

const triggerQuietStyle: CSSProperties = {
  ...triggerStyle,
  background: 'var(--panel-clean)',
  color: 'var(--ink)',
};

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export interface ComposeMessageModalProps {
  /** Recipient options (tenants with a phone on file). */
  tenants: readonly ComposeTenantOption[];
  /** Pre-selected tenant — locks the select when provided. */
  initialTenantId?: string;
  /** Trigger button copy. Defaults to "Message". */
  triggerLabel?: string;
  /** Quiet (outline) trigger instead of the filled ink button. */
  quietTrigger?: boolean;
}

/** Maps action errors to operator-facing copy. */
function describeError(error: string): string {
  if (error === 'All providers failed') {
    return 'Send failed. No delivery was confirmed. Review the message and recipient before trying a new send.';
  }
  if (error === 'Tenant missing phone_e164') {
    return 'This tenant has no phone number on file.';
  }
  return error;
}

export function ComposeMessageModal({
  tenants,
  initialTenantId,
  triggerLabel = 'Message',
  quietTrigger = false,
}: ComposeMessageModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tenantId, setTenantId] = useState(initialTenantId ?? tenants[0]?.id ?? '');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenantLocked = initialTenantId !== undefined;

  function resetForm(): void {
    setTenantId(initialTenantId ?? tenants[0]?.id ?? '');
    setBody('');
    setPending(false);
    setError(null);
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) resetForm();
  }

  async function handleSend(): Promise<void> {
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      setError('Write a message first.');
      return;
    }
    if (!tenantId) {
      setError('Pick a tenant first.');
      return;
    }
    setError(null);
    setPending(true);

    const result = await composeToTenantAction(tenantId, trimmed);

    if (!result.ok) {
      setError(describeError(result.error));
      setPending(false);
      // Even on provider failure the pending row now exists in /inbox —
      // refresh so the queue shows it once the operator closes the modal.
      router.refresh();
      return;
    }

    setOpen(false);
    resetForm();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        style={quietTrigger ? triggerQuietStyle : triggerStyle}
        data-testid='compose-modal-trigger'
      >
        {triggerLabel}
      </DialogTrigger>

      <DialogContent
        // Inline width guard — can't be beaten by base-class merge order.
        style={{ width: 'min(560px, 94vw)', maxWidth: 'min(560px, 94vw)' }}
        className='flex max-h-[calc(100dvh-2.5rem)] flex-col gap-0 overflow-hidden rounded-[28px] border-0 bg-[var(--paper-0)] p-0 ring-1 ring-[var(--ink-200)] shadow-[0_32px_90px_rgba(39,31,22,0.22)]'
        data-testid='compose-modal'
        aria-labelledby='compose-modal-title'
      >
        <DialogHero
          icon={MessageSquare}
          eyebrow='Messaging'
          title='Message a tenant'
          titleId='compose-modal-title'
          description="Sends as you, from your Odesa number. Lands in the tenant's open thread."
        />

        {/* min-h-0 + overflow-y-auto: on short viewports the body scrolls
            instead of shoving the hero past the clipped top edge. */}
        <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6'>
          <Field id='compose-tenant' label='To'>
            <InputShell icon={User}>
              <SelectControl
                id='compose-tenant'
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                disabled={tenantLocked || pending}
                data-testid='compose-modal-tenant'
              >
                {tenants.length === 0 && (
                  <option value=''>No tenants with a phone on file</option>
                )}
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectControl>
            </InputShell>
          </Field>

          <Field id='compose-body' label='Message'>
            <textarea
              id='compose-body'
              className='min-h-[104px] w-full resize-y rounded-xl border border-[var(--hairline-faint)] bg-[var(--panel-lift)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--ink-900)] outline-none transition-colors placeholder:text-[var(--ink-400)] hover:border-[var(--hairline-strong)] focus:border-[var(--clay-border)] focus:ring-2 focus:ring-[var(--clay-border)]/40 disabled:cursor-not-allowed disabled:opacity-50'
              placeholder='Write it the way you’d text it…'
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                if (error && e.target.value.trim() !== '') setError(null);
              }}
              maxLength={2000}
              disabled={pending}
              data-testid='compose-modal-body'
            />
          </Field>

          {error && (
            <p
              role='alert'
              data-testid='compose-modal-error'
              className='rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]'
            >
              {error}
            </p>
          )}
        </div>

        <div className='flex flex-col-reverse gap-3 border-t border-[var(--hairline-faint)] bg-[var(--panel)] px-8 py-5 sm:flex-row sm:items-center sm:justify-between'>
          <span className='text-[12px] leading-snug text-[var(--ink-500)]'>
            Sent directly — no AI draft step.
          </span>
          <div className='flex flex-col-reverse gap-3 sm:flex-row sm:items-center'>
            <DialogClose
              render={
                <Button
                  type='button'
                  variant='ghost'
                  data-testid='compose-modal-cancel'
                  className='w-full sm:w-auto'
                />
              }
            >
              Cancel
            </DialogClose>
            <Button
              type='button'
              onClick={() => void handleSend()}
              disabled={pending || body.trim().length === 0}
              className='w-full min-w-[140px] sm:w-auto'
              data-testid='compose-modal-send'
            >
              {pending ? 'Sending…' : 'Send message'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
