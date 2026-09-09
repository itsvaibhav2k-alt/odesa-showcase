/**
 * /calls/settings — voice connection + operator knowledge + effective prompt.
 *
 * Async server component (force-dynamic), RLS-scoped. Fetches the org's voice
 * settings and renders the config editor + collapsed effective prompt via
 * `VoiceSettingsPageBody`. Changes are saved to Odesa but do not auto-sync to
 * live calls (labeled honestly in the body).
 */

import { ListPageShell } from '@/components/properties/list/list-page-shell';
import { VoiceSettingsPageBody } from '@/components/calls/voice-settings-page-body';
import { createServerClient } from '@/lib/supabase/server';
import { getVoiceSettings } from '@/lib/voice/settings';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CallsSettingsPage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  if (currentRole === 'va') redirect('/calls');
  const voiceSettings = await getVoiceSettings(supabase);

  return (
    <ListPageShell
      breadcrumb={[
        { label: 'Today', href: '/today' },
        { label: 'Calls', href: '/calls' },
        { label: 'Settings' },
      ]}
      eyebrow="Voice operator"
      title="Voice settings"
      titleMeta={['Connection · knowledge · effective prompt']}
    >
      <VoiceSettingsPageBody voiceSettings={voiceSettings} />
    </ListPageShell>
  );
}
