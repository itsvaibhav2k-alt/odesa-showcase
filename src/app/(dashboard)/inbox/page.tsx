/**
 * Inbox — wave 4.
 *
 * The wave-3 surface was an approval queue (3 buckets). Inbox now preserves
 * conversation evidence and drafts, while Owner Queue is the canonical
 * commitment ledger. This server component auth-gates, runs
 * `listConversations()` + `getActivitySummary()` against the
 * cookie-bound supabase client, and feeds the results into the new
 * client shell.
 *
 * The page now mounts the shared `PageHeader` (topbar variant) above
 * the `InboxPageShell`. The header's `meta` slot carries the activity
 * strip (`<n> threads · <n> need review · <n> handled today`) and the
 * `right` slot uses a precise data-current indicator.
 *
 * `dynamic = 'force-dynamic'` keeps the page out of static / ISR caches
 * so every navigation re-runs the loader.
 */

import { redirect } from 'next/navigation';

import { ComposeMessageModal } from '@/components/inbox/compose-message-modal';
import { InboxPageShell } from '@/components/inbox/inbox-page-shell';
import { PageHeader } from '@/components/shared/page-header';
import { listComposeTenants } from '@/lib/inbox/compose';
import {
  getActivitySummary,
  listConversations,
} from '@/lib/inbox/conversation-queries';
import {
  buildSlaMap,
  getBreachedTenantIds,
} from '@/lib/inbox/queue-sla-summary';
import { createServerClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/database';

export const dynamic = 'force-dynamic';

interface InboxPageProps {
  searchParams: Promise<{ conversation?: string | string[] }>;
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: currentRole } = await supabase.rpc('current_user_role');
  const role: UserRole | null = currentRole ?? null;
  const isVa = role === 'va';
  const isOwner = role === 'owner';

  const [conversations, activity, breachedTenants, composeTenants] =
    await Promise.all([
      listConversations(supabase),
      getActivitySummary(supabase),
      getBreachedTenantIds(supabase),
      isOwner ? listComposeTenants() : Promise.resolve([]),
    ]);

  // Pre-compute the per-conversation SLA-breach map once on the server
  // so the queue chip can paint `escalated` without firing a per-row
  // case-context fetch. Refreshed on `router.refresh()` (realtime push).
  const initialSlaMap = buildSlaMap(conversations, breachedTenants);
  const { conversation } = await searchParams;
  const requestedConversation = Array.isArray(conversation)
    ? conversation[0]
    : conversation;
  const initialSelectedConversationId =
    requestedConversation === undefined
      ? undefined
      : conversations.some((item) => item.id === requestedConversation)
        ? requestedConversation
        : null;

  const threadsCount = conversations.length;
  const needYou = activity.pendingReviewCount;
  const handledToday = activity.aiSentToday;

  return (
    <>
      <PageHeader
        eyebrow={isVa ? 'Shift case files' : 'Tenant signal desk'}
        title={isVa ? 'Work inbox' : 'Inbox'}
        metaTestId='inbox-activity-strip'
        meta={
          <>
            <span>
              <span className='num'>{threadsCount}</span>{' '}
              {threadsCount === 1 ? 'thread' : 'threads'}
            </span>
            <Dot />
            <span>
              <span className='num'>{needYou}</span>{' '}
              {isVa
                ? 'waiting on owner'
                : needYou === 1
                  ? 'draft awaiting review'
                  : 'drafts awaiting review'}
            </span>
            <Dot />
            <span>
              <span className='num'>{handledToday}</span> handled today
            </span>
          </>
        }
        right={
          <>
            {isOwner ? (
              <ComposeMessageModal
                tenants={composeTenants}
                triggerLabel='Compose'
              />
            ) : null}
            <FreshnessIndicator />
          </>
        }
      />
      <InboxPageShell
        initialConversations={conversations}
        initialActivity={activity}
        initialSlaMap={initialSlaMap}
        initialSelectedConversationId={initialSelectedConversationId}
        readOnly={!isOwner}
        canUseAssistant={isOwner}
      />
    </>
  );
}

function Dot() {
  return (
    <span
      aria-hidden='true'
      style={{
        display: 'inline-block',
        width: '3px',
        height: '3px',
        borderRadius: '50%',
        background: 'var(--ink-4, #9B8E76)',
        margin: '0 8px',
        transform: 'translateY(-2px)',
      }}
    />
  );
}

function FreshnessIndicator() {
  return (
    <>
      <span
        aria-hidden='true'
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--green-warm, #4D7A56)',
          boxShadow: '0 0 0 3px rgba(77, 122, 86, 0.18)',
        }}
      />
      <span style={{ fontFamily: 'var(--font-mono-operator)' }}>Data current</span>
    </>
  );
}
