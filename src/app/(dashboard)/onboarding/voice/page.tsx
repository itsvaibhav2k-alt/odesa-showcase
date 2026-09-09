/**
 * Voice/Retell opt-in — settings-adjacent step.
 *
 * UX PLACEMENT RATIONALE
 * ----------------------
 * Voice is an optional/advanced feature, not core to getting started.
 * The 6-step onboarding flow (property → unit → tenant → lease →
 * messaging → verify-phone) already satisfies the "operator is live"
 * criterion: number assigned, personal phone verified, layout redirects
 * to /today. Inserting voice as a mandatory 7th step would:
 *   a) require a layout change that gates /today on a new boolean field,
 *   b) block all existing operators until they choose, and
 *   c) depend on a DB column (`organizations.voice_enabled`) that is
 *      pending a T2b migration.
 *
 * Instead, this page is reachable from two entry points:
 *   1. Directly: /onboarding/voice (linked from the /today "set up voice
 *      calls" nudge or from Settings → Phone card CTA).
 *   2. Post-verify redirect: if a future orchestrator decides to chain
 *      it after step 6, the verify-phone form can `router.push` here
 *      instead of /today.
 *
 * BLOCKER — pending T2b migration
 * --------------------------------
 * `organizations.voice_enabled` does NOT exist in the Supabase
 * migrations as of 2026-05-17. The column is forward-declared in
 * `src/types/database.ts` but the actual DB column is owned by T2b
 * (provisioning-adjacent schema). The `setVoiceEnabledAction` gracefully
 * surfaces the DB error when the column is absent, offering an escape
 * hatch so the operator can still reach /today.
 *
 * Server component. Reads the org's current `voice_enabled` value so
 * returning operators see the right initial state.
 */

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';

import { setVoiceEnabledAction } from './actions';
import { VoiceForm } from './voice-form';

export const dynamic = 'force-dynamic';

export default async function OnboardingVoicePage() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!userRow) redirect('/onboarding');

  // Read voice_enabled; tolerate the column being absent (null / undefined).
  const { data: org } = await supabase
    .from('organizations')
    .select('voice_enabled')
    .eq('id', userRow.organization_id)
    .single();

  const initialVoiceEnabled = org?.voice_enabled ?? null;

  return (
    <div className='flex flex-col gap-5' data-testid='onboarding-voice'>
      <div className='flex flex-col gap-1'>
        <h2 className='heading-3 font-serif-display'>
          Enable voice calls?
        </h2>
        <p className='text-sm text-muted-foreground'>
          Let tenants call your Odesa number and speak directly with the
          AI. Voice uses the same playbook as your SMS assistant.
        </p>
      </div>
      <VoiceForm
        initialVoiceEnabled={initialVoiceEnabled}
        setVoiceEnabled={setVoiceEnabledAction}
      />
    </div>
  );
}
