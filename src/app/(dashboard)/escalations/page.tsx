import { redirect } from 'next/navigation';

import { TodayPageShell } from '@/components/today/today-page-shell';
import { VaEscalationsDesk } from '@/components/today/va-escalations-desk';
import { getDraftDetail } from '@/lib/inbox/draft-queries';
import { createServerClient } from '@/lib/supabase/server';
import { getUrgentItems } from '@/lib/today/queries';
import { urgentItemToQueueItem } from '@/lib/today/queue-adapter';
import { adaptQueueItemForVa } from '@/lib/today/va-presentation';

export const dynamic = 'force-dynamic';

interface EscalationsPageProps {
  searchParams: Promise<{ proposal?: string | string[] }>;
}

export default async function EscalationsPage({
  searchParams,
}: EscalationsPageProps) {
  const supabase = await createServerClient();
  const { data: currentRole } = await supabase.rpc('current_user_role');

  if (currentRole !== 'va') {
    redirect('/owner-queue');
  }

  const { proposal } = await searchParams;
  const proposalParam = Array.isArray(proposal) ? proposal[0] : proposal;
  const requestedProposalId = proposalParam?.trim().slice(0, 128) || null;
  const [urgentItems, referencedProposal] = await Promise.all([
    getUrgentItems(25),
    requestedProposalId
      ? getDraftDetail(supabase, 'proposal', requestedProposalId)
      : Promise.resolve(null),
  ]);
  const escalations = urgentItems.map((item) =>
    adaptQueueItemForVa(urgentItemToQueueItem(item), item.kind),
  );

  return (
    <TodayPageShell>
      <VaEscalationsDesk
        items={escalations}
        referencedProposal={referencedProposal}
        referencedProposalRequested={proposalParam !== undefined}
      />
    </TodayPageShell>
  );
}
