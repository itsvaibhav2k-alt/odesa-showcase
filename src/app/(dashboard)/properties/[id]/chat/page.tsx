/**
 * Operator chat page — `/properties/[id]/chat` (Phase 3).
 *
 * Server Component shell. Loads:
 *   1. The property header (name + address) via the existing
 *      `getProperty` helper (RLS-scoped via SSR client).
 *   2. The current open web-channel `operator_chats` row via
 *      `loadOrCreateChat({channel:'web'})` so we can render the last 20
 *      turns immediately on first paint.
 *   3. `loadHistory(chatId, 20)` for the prior turns.
 *
 * Live streaming + input handling lives in the client `<ChatPanel />`.
 */

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { PageContainer, PageHeader } from '@/components/shared';
import { buttonVariants } from '@/components/ui/button-variants';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { getProperty } from '@/lib/properties/queries';
import {
  loadHistory,
  loadOrCreateChat,
} from '@/lib/agent/operator/persist';
import type { OperatorChatTurnRow } from '@/lib/agent/operator/types';
import { ChatPanel } from '@/components/operator/chat-panel';

export const dynamic = 'force-dynamic';

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export default async function PropertyChatPage({ params }: ChatPageProps) {
  const { id } = await params;

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
  if (userRow.role !== 'owner') redirect(`/properties/${id}`);

  const property = await getProperty(id);
  if (!property) notFound();

  // Resolve / create the web chat row up-front so the panel can render
  // history immediately. We use the admin client for parity with the
  // dispatcher (POST handler also calls loadOrCreateChat through admin
  // — guarantees the page and the SSE route resolve to the same row).
  const admin = createAdminClient();
  const chat = await loadOrCreateChat(admin, {
    organizationId: userRow.organization_id,
    userId: user.id,
    propertyId: id,
    channel: 'web',
  });

  let initialHistory: OperatorChatTurnRow[] = [];
  try {
    initialHistory = await loadHistory(admin, chat.id, 20);
  } catch {
    // Decorative — let the panel start empty rather than 500.
    initialHistory = [];
  }

  const address = formatAddress(property);

  const backLink = (
    <Link
      href={`/properties/${property.id}`}
      data-testid="property-chat-back"
      className={buttonVariants({ variant: 'ghost', size: 'sm' })}
    >
      <ChevronLeft size={14} aria-hidden />
      {property.name}
    </Link>
  );

  return (
    <PageContainer
      width="wide"
      data-testid="property-chat-page"
      data-property-id={property.id}
    >
      <PageHeader
        eyebrow="Operator chat"
        title={
          <span data-testid="property-chat-heading">
            What needs your attention at {property.name}?
          </span>
        }
        description={address}
        actions={backLink}
      />

      <ChatPanel
        chatId={chat.id}
        apiEndpoint={`/api/chat/property/${property.id}`}
        propertyId={property.id}
        propertyName={property.name}
        initialHistory={initialHistory}
      />
    </PageContainer>
  );
}

function formatAddress(property: {
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
}): string {
  const cityState = [property.addressCity, property.addressState]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(', ');
  const cityStateZip = [cityState, property.addressZip]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join(' ');
  const parts = [property.addressStreet, cityStateZip].filter(
    (x): x is string => !!x && x.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : 'Address not set';
}
