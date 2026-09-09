/**
 * /calls/test — safe, local test-call scenarios.
 *
 * Async server component (force-dynamic), RLS-scoped. Voice settings are read
 * only to show an honest configuration note; running a
 * scenario contacts no external provider.
 */

import { ListPageShell } from '@/components/properties/list/list-page-shell';
import { TestCallsPageBody } from '@/components/calls/test-calls-page-body';
import { createServerClient } from '@/lib/supabase/server';
import { getVoiceSettings } from '@/lib/voice/settings';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CallsTestPage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  if (currentRole === 'va') redirect('/calls');
  const voiceSettings = await getVoiceSettings(supabase);

  return (
    <ListPageShell
      breadcrumb={[
        { label: 'Today', href: '/today' },
        { label: 'Calls', href: '/calls' },
        { label: 'Test call' },
      ]}
      eyebrow="Voice operator"
      title="Test call"
      titleMeta={['Safe local scenarios · no external providers']}
    >
      <TestCallsPageBody
        retellConnected={Boolean(voiceSettings.retellPhoneNumberE164)}
      />
    </ListPageShell>
  );
}
