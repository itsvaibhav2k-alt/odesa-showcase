'use client';

/**
 * Operator phone verification — Settings → Integrations.
 *
 * Two-state card embedded inside the Personal Phone section:
 *
 *   State A — entry: phone input + "Send code" button. Calls
 *     `requestPhoneVerification` which generates a 6-digit OTP, hashes
 *     it into `phone_verifications`, and sends it via the org's primary
 *     MessagingProvider.
 *
 *   State B — confirm: 6-digit code input + "Verify" button. Calls
 *     `confirmPhoneVerification`; on success the page is refreshed so
 *     the parent Server Component re-reads `users.phone_e164` +
 *     `phone_verified_at`.
 *
 * Until the operator's phone is verified, the inbound Linq router
 * cannot match them to a `users` row, so the iMessage transport simply
 * falls through to the tenant flow. This card is the unblock.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  confirmPhoneVerification,
  requestPhoneVerification,
} from '@/app/(dashboard)/settings/integrations/actions';

type Step = 'entry' | 'confirm';

const E164_RE = /^\+[1-9]\d{6,14}$/;
const SIX_DIGIT_RE = /^\d{6}$/;

export function PhoneVerificationCard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('entry');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmed = phone.trim();
    if (!E164_RE.test(trimmed)) {
      setError('Enter your number in E.164 format, e.g. +15555550100.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestPhoneVerification({ phoneE164: trimmed });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPhone(trimmed);
      setStep('confirm');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedCode = code.trim();
    if (!SIX_DIGIT_RE.test(trimmedCode)) {
      setError('Enter the 6-digit code from your text message.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await confirmPhoneVerification({
        phoneE164: phone,
        code: trimmedCode,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBackToEntry = () => {
    setStep('entry');
    setError(null);
    setCode('');
  };

  if (step === 'entry') {
    return (
      <form
        data-testid="phone-verify-entry"
        onSubmit={handleSendCode}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Label htmlFor="phone-verify-input" className="meta-label" style={{ color: 'var(--ink-500)' }}>
            Mobile number
          </Label>
          <Input
            id="phone-verify-input"
            data-testid="phone-verify-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+15555550100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={submitting}
            style={{ maxWidth: '280px' }}
          />
          <p
            style={{
              fontSize: '12px',
              lineHeight: 1.4,
              color: 'var(--ink-500)',
            }}
          >
            We&apos;ll text a 6-digit code to confirm. Required before owner text routing.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            data-testid="phone-verify-error"
            style={{
              fontSize: '13px',
              color: 'var(--destructive, #b3261e)',
            }}
          >
            {error}
          </p>
        ) : null}

        <div>
          <Button
            type="submit"
            disabled={submitting || phone.trim() === ''}
            data-testid="phone-verify-send"
          >
            {submitting ? 'Sending…' : 'Send code'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      data-testid="phone-verify-confirm"
      onSubmit={handleConfirm}
      style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Label htmlFor="phone-verify-code" className="meta-label" style={{ color: 'var(--ink-500)' }}>
          6-digit code
        </Label>
        <Input
          id="phone-verify-code"
          data-testid="phone-verify-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={submitting}
          style={{
            maxWidth: '160px',
            fontFamily:
              "var(--font-mono-metrics), 'JetBrains Mono', monospace",
            letterSpacing: '0.2em',
          }}
        />
        <p
          style={{
            fontSize: '12px',
            lineHeight: 1.4,
            color: 'var(--ink-500)',
          }}
        >
          Code sent to{' '}
          <span
            style={{
              fontFamily:
                "var(--font-mono-metrics), 'JetBrains Mono', monospace",
              color: 'var(--ink-700)',
            }}
          >
            {phone}
          </span>
          . Codes expire in 10 minutes.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="phone-verify-error"
          style={{
            fontSize: '13px',
            color: 'var(--destructive, #b3261e)',
          }}
        >
          {error}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          type="submit"
          disabled={submitting || code.length !== 6}
          data-testid="phone-verify-confirm-btn"
        >
          {submitting ? 'Verifying…' : 'Verify'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleBackToEntry}
          disabled={submitting}
          data-testid="phone-verify-back"
        >
          Use a different number
        </Button>
      </div>
    </form>
  );
}
