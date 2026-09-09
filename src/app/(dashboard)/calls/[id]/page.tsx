/**
 * /calls/[id] — one Voice Operator call, rendered as a Call Review Studio.
 *
 * Async server component (force-dynamic), RLS-scoped. Fetches the typed detail
 * row and hands all landlord-facing display work to `CallDetailDossier`, which
 * owns the three-zone studio: a left call map (topics, participants, records),
 * the transcript as the central artifact, and a right action trace (next move,
 * what Odesa did, what is left for the operator). Outcome jsonb is parsed
 * defensively there.
 */

import { notFound } from 'next/navigation';

import { CallDetailDossier } from '@/components/calls/call-detail-dossier';
import { createServerClient } from '@/lib/supabase/server';
import { getVoiceCallDetail } from '@/lib/voice/queries';

export const dynamic = 'force-dynamic';

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');
  const detail = await getVoiceCallDetail(supabase, id);

  if (!detail) notFound();

  return (
    <CallDetailDossier
      detail={detail}
      audience={currentRole === 'va' ? 'va' : 'owner'}
    />
  );
}
