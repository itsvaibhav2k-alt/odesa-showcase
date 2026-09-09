'use client';

/**
 * Two-state OTP form for the onboarding "verify personal phone" step.
 *
 *   State A (`mode='request'`)
 *     E.164 phone input (pre-filled with `+1` country code).
 *     "Send code" → `requestPhoneVerification({ phoneE164 })`.
 *     On `success`, transitions to State B and remembers the phone.
 *     On error, surfaces an inline destructive `<p>`.
 *
 *   State B (`mode='confirm'`)
 *     6-digit numeric input.
 *     "Confirm" → `confirmPhoneVerification({ phoneE164, code })`.
 *     On `success`, `router.push('/today')` + `router.refresh()` so the
 *       layout re-reads `users.phone_verified_at`.
 *     "Resend code" sends the operator back to State A.
 *
 * Reuses the same server actions as `phone-verification-card.tsx` (the
 * Settings → Integrations surface). Both actions take a payload object
 * and return `ApiResponse<T>` (`{ success: true, data }` |
 * `{ success: false, error }`).
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/shared';
import {
  confirmPhoneVerification,
  requestPhoneVerification,
} from '@/app/(dashboard)/settings/integrations/actions';

type Mode = 'request' | 'confirm';

const E164_RE = /^\+[1-9]\d{6,14}$/;
const SIX_DIGIT_RE = /^\d{6}$/;
const DEFAULT_PHONE_PREFIX = '+1';

interface VerifyPhoneFormProps {
  initialPhone: string | null;
  alreadyVerified: boolean;
}

export function VerifyPhoneForm({
  initialPhone,
  alreadyVerified,
}: VerifyPhoneFormProps) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('request');
  const [phone, setPhone] = useState(initialPhone ?? DEFAULT_PHONE_PREFIX);
  const [code, setCode] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSendCode = (event: React.FormEvent) => {
    event.preventDefault();
    setRequestError(null);

    const trimmed = phone.trim();
    if (!E164_RE.test(trimmed)) {
      setRequestError(
        'Enter your number in E.164 format, e.g. +15555550100.',
      );
      return;
    }

    startTransition(async () => {
      const result = await requestPhoneVerification({ phoneE164: trimmed });
      if (!result.success) {
        setRequestError(result.error);
        return;
      }
      setPhone(trimmed);
      setCode('');
      setConfirmError(null);
      setMode('confirm');
    });
  };

  const handleConfirm = (event: React.FormEvent) => {
    event.preventDefault();
    setConfirmError(null);

    const trimmedCode = code.trim();
    if (!SIX_DIGIT_RE.test(trimmedCode)) {
      setConfirmError('Enter the 6-digit code from your text message.');
      return;
    }

    startTransition(async () => {
      const result = await confirmPhoneVerification({
        phoneE164: phone,
        code: trimmedCode,
      });
      if (!result.success) {
        setConfirmError(result.error);
        return;
      }
      router.push('/today');
      router.refresh();
    });
  };

  const handleResend = () => {
    setMode('request');
    setCode('');
    setConfirmError(null);
  };

  if (mode === 'request') {
    return (
      <form
        data-testid='verify-phone-request'
        onSubmit={handleSendCode}
        className='flex flex-col gap-4'
      >
        <FormField
          label='Personal mobile number'
          htmlFor='verify-phone-input'
          description={
            alreadyVerified
              ? 'You already verified a number — re-verifying replaces it.'
              : 'We text a 6-digit code from your Odesa number to confirm.'
          }
          error={requestError ?? undefined}
        >
          <Input
            id='verify-phone-input'
            data-testid='verify-phone-input'
            type='tel'
            inputMode='tel'
            autoComplete='tel'
            placeholder='+15555550100'
            value={phone}
            disabled={pending}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormField>

        <div>
          <Button
            type='submit'
            disabled={pending || phone.trim() === ''}
            data-testid='verify-phone-send'
          >
            {pending ? 'Sending...' : 'Send code'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      data-testid='verify-phone-confirm'
      onSubmit={handleConfirm}
      className='flex flex-col gap-4'
    >
      <FormField
        label='6-digit code'
        htmlFor='verify-phone-code'
        description={`Code sent to ${phone}. Codes expire in 10 minutes.`}
        error={confirmError ?? undefined}
      >
        <Input
          id='verify-phone-code'
          data-testid='verify-phone-code-input'
          type='text'
          inputMode='numeric'
          autoComplete='one-time-code'
          maxLength={6}
          placeholder='123456'
          value={code}
          disabled={pending}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
          }
        />
      </FormField>

      <div className='flex items-center gap-2'>
        <Button
          type='submit'
          disabled={pending || code.length !== 6}
          data-testid='verify-phone-confirm-btn'
        >
          {pending ? 'Confirming...' : 'Confirm'}
        </Button>
        <Button
          type='button'
          variant='ghost'
          onClick={handleResend}
          disabled={pending}
          data-testid='verify-phone-resend'
        >
          Resend code
        </Button>
      </div>
    </form>
  );
}
