/**
 * Onboarding step 6 — Verify personal phone.
 *
 * Server component. Loads the operator's current `phone_e164` +
 * `phone_verified_at` so the form can show their existing number (and
 * skip the request step if they're already verified, though the layout
 * normally bounces verified users to /today before this page renders).
 *
 * The two-state OTP form lives in `./verify-phone-form.tsx`. The
 * underlying server actions are reused as-is from
 * `src/app/(dashboard)/settings/integrations/actions.ts` —
 * `requestPhoneVerification` + `confirmPhoneVerification` are already
 * org+user-scoped (no property scope), so no wrapper is needed.
 *
 * Auth gate mirrors the messaging step: the parent layout already
 * confirms the operator is authenticated and that they need this step;
 * we still re-check user presence here for direct-URL hits.
 */

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';

import { OnboardingProgressIndicator } from '../progress-indicator';
import { VerifyPhoneForm } from './verify-phone-form';

export const dynamic = 'force-dynamic';

export default async function OnboardingVerifyPhonePage() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('phone_e164, phone_verified_at')
    .eq('id', user.id)
    .single();

  const initialPhone = userRow?.phone_e164 ?? null;
  const alreadyVerified = Boolean(userRow?.phone_verified_at);

  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-verify-phone'>
      <OnboardingProgressIndicator step={6} />
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>
          Verify your personal phone
        </h2>
        <p className='text-sm text-muted-foreground'>
          We&apos;ll text a 6-digit code to your personal mobile from your
          new Odesa number. This unlocks owner-mode text routing —
          when you text the assistant, you reach Odesa-as-personal-AI,
          not the tenant flow.
        </p>
      </div>
      <VerifyPhoneForm
        initialPhone={initialPhone}
        alreadyVerified={alreadyVerified}
      />
    </div>
  );
}
