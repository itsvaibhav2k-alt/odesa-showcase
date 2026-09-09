/**
 * Assistant page — `/assistant` (Wave 5).
 *
 * Org-scoped twin of the per-property `/properties/[id]/chat` shell.
 * Resolves the operator's iMessage thread row (`channel='imessage',
 * property_id=null`) so the dashboard surface and the actual iPhone
 * iMessage thread share the same `operator_chats` row — the operator
 * can switch back and forth without forking history.
 *
 * Server Component. Loads:
 *   1. The cookie-bound user via `createServerClient`.
 *   2. The user's organization via the `users` row.
 *   3. The shared imessage chat row via `loadOrCreateChat({channel:
 *      'imessage', propertyId: null})` — same shape used by
 *      `handle-operator-inbound.ts` so the row is reused, not duplicated.
 *   4. The trailing 50 turns via `loadHistory(chatId, 50)` for first-paint.
 *
 * Input handling lives in `<ChatPanel />`, which requires the durable
 * `/api/chat/runs` + agent_runs lifecycle for this canonical global surface.
 */

import { redirect } from 'next/navigation';

import { PageContainer, PageHeader } from '@/components/shared';
import { ChatPanel } from '@/components/operator/chat-panel';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { loadHistory, loadOrCreateChat } from '@/lib/agent/operator/persist';
import type { OperatorChatTurnRow } from '@/lib/agent/operator/types';

export const dynamic = 'force-dynamic';

/** Upper bound on the pre-filled composer prompt read from `?q=`. */
const MAX_INITIAL_INPUT = 2000;

interface AssistantPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function AssistantPage({
  searchParams,
}: AssistantPageProps) {
  const { q: rawQ } = await searchParams;
  const qParam = Array.isArray(rawQ) ? rawQ[0] : rawQ;
  const initialInput = (qParam ?? '').slice(0, MAX_INITIAL_INPUT);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: userRow } = await supabase
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!userRow) redirect('/login');
  // `view_assistant` is owner-reserved. Gate before the admin-backed chat is
  // loaded or created so a direct URL cannot bypass the navigation policy.
  if (userRow.role !== 'owner') redirect('/today');

  // Use the admin client for parity with `handle-operator-inbound.ts`
  // (which has no auth.uid() and writes via admin). Both paths must
  // resolve to the same row so the dashboard view and inbound iMessages
  // share a single thread.
  const admin = createAdminClient();
  const chat = await loadOrCreateChat(admin, {
    organizationId: userRow.organization_id,
    userId: user.id,
    propertyId: null,
    channel: 'imessage',
  });

  let initialHistory: OperatorChatTurnRow[] = [];
  try {
    initialHistory = await loadHistory(admin, chat.id, 50);
  } catch {
    // Decorative — let the panel start empty rather than 500.
    initialHistory = [];
  }

  return (
    <PageContainer width="default" data-testid="assistant-page">
      <PageHeader
        eyebrow="Your assistant"
        title="Ask Odesa"
        description="One durable Odesa thread for portfolio questions, grounded reads, drafts, and Owner Queue proposals."
      />
      <ChatPanel
        chatId={chat.id}
        apiEndpoint="/api/chat/assistant"
        initialHistory={initialHistory}
        initialInput={initialInput}
        forceDurable
      />
    </PageContainer>
  );
}
