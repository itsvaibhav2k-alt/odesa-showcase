/**
 * Onboarding step 5 — Messaging.
 *
 * Server component. Loads the operator's current state (assigned
 * number, assistant name, verified personal phone) and hands it to
 * the client form. The form invokes the three server actions defined
 * in `./actions.ts` and re-uses the same auth context the rest of
 * onboarding uses.
 *
 * Step is reachable only after the lease step. Once a number is
 * assigned, the layout funnels the operator to step 6
 * (`/onboarding/verify-phone`) — and after that step completes, on to
 * `/today`. So a refresh of this page after finishing the assignment
 * forwards to verify-phone via the layout.
 */

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';

import {
  assignNumberAction,
  sendTestSmsAction,
  setAssistantNameAction,
} from './actions';
import { DEFAULT_ASSISTANT_NAME } from './constants';
import { MessagingForm } from './messaging-form';
import { OnboardingProgressIndicator } from '../progress-indicator';

export const dynamic = 'force-dynamic';

export default async function OnboardingMessagingPage() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Resolve the operator's org + their personal verified phone status.
  const { data: userRow } = await supabase
    .from('users')
    .select('organization_id, phone_e164, phone_verified_at')
    .eq('id', user.id)
    .single();

  if (!userRow) {
    redirect('/onboarding/property');
  }

  // Confirm at least one lease exists — otherwise redirect back to the
  // lease step. Belt-and-braces for direct URL hits.
  const { count: leaseCount } = await supabase
    .from('leases')
    .select('id', { count: 'exact', head: true });
  if ((leaseCount ?? 0) === 0) {
    redirect('/onboarding');
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('odesa_phone_number, assistant_name')
    .eq('id', userRow.organization_id)
    .single();

  const initialAssignedNumber = org?.odesa_phone_number ?? null;
  const initialAssistantName = org?.assistant_name ?? DEFAULT_ASSISTANT_NAME;
  const hasVerifiedPhone = Boolean(
    userRow.phone_e164 && userRow.phone_verified_at,
  );

  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-messaging'>
      <OnboardingProgressIndicator step={5} />
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>
          Get your messaging line up
        </h2>
        <p className='text-sm text-muted-foreground'>
          Three quick steps: claim a number, name the assistant,
          send yourself a test text to confirm the loop.
        </p>
      </div>
      <MessagingForm
        initialAssignedNumber={initialAssignedNumber}
        initialAssistantName={initialAssistantName}
        hasVerifiedPhone={hasVerifiedPhone}
        canFinish={Boolean(initialAssignedNumber)}
        assignNumber={assignNumberAction}
        setAssistantName={setAssistantNameAction}
        sendTestSms={sendTestSmsAction}
      />
    </div>
  );
}
