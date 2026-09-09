/**
 * /calls/scripts — call-handling playbooks (locked safety boundaries + editable
 * owner guidance).
 *
 * Async server component (force-dynamic), RLS-scoped. Only the per-script
 * override map is needed here; the default behavior + safety boundaries are
 * pure code (`CALL_SCRIPTS`), not data.
 */

import { ListPageShell } from '@/components/properties/list/list-page-shell';
import { CallScriptsPageBody } from '@/components/calls/call-scripts-page-body';
import { createServerClient } from '@/lib/supabase/server';
import { getVoiceSettings } from '@/lib/voice/settings';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function CallsScriptsPage() {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  if (currentRole === 'va') redirect('/calls');
  const voiceSettings = await getVoiceSettings(supabase);

  return (
    <ListPageShell
      breadcrumb={[
        { label: 'Today', href: '/today' },
        { label: 'Calls', href: '/calls' },
        { label: 'Scripts' },
      ]}
      eyebrow="Voice operator"
      title="Call scripts"
      titleMeta={['Playbooks · boundaries · your guidance']}
    >
      <CallScriptsPageBody overrides={voiceSettings.scriptOverrides} />
    </ListPageShell>
  );
}
