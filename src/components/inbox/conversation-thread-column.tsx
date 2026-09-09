'use client';

/**
 * CaseFileColumn — case-file pane body (Wave 5).
 *
 * Composes the case header + meta strip + Odesa line + hero area
 * (draft / handled block) + timeline + manual override into the
 * single scroll-aware pane that occupies the right column of /inbox.
 *
 * Replaces the wave-4 chat-bubble `ConversationThreadColumn`. The
 * file name stays the same so existing imports in `inbox-page-shell`
 * keep resolving while waves land; the canonical export is
 * `CaseFileColumn`.
 *
 * Test-id preservation (see test-id-map.md, wave 5 rows):
 *   - `inbox-thread-empty`            → empty state root
 *   - `inbox-thread-{conversationId}` → CaseFileColumn root
 *   - `inbox-thread-header`           → CaseHeader root
 *   - `inbox-thread-scroll`           → scroll container wrapping hero + timeline
 *   - `inbox-thread-body`             → CaseTimeline root
 *   - `inbox-compose-row` / -textarea / -send → ManualOverride form
 */

import { useEffect, useMemo, useRef } from 'react';

import { AskOdesaBar } from '@/components/inbox/ask-odesa-bar';
import { CaseHeader } from '@/components/inbox/case-header';
import { CaseMetaStrip } from '@/components/inbox/case-meta-strip';
import { CaseTimeline } from '@/components/inbox/case-timeline';
import DraftHeroCard from '@/components/inbox/draft-hero-card';
import { HandledStatusBlock } from '@/components/inbox/handled-status-block';
import { ManualOverride } from '@/components/inbox/manual-override';
import { OdesaLine } from '@/components/inbox/odesa-line';
import { useConversations } from '@/components/inbox/conversations-context';
import type { ConversationDetail } from '@/lib/inbox/conversation-queries';
import type { OdesaLineStatus } from '@/lib/inbox/odesa-line';
import { deriveQueueStatus, type QueueStatus } from '@/lib/inbox/queue-status';

export function CaseFileColumn({
  readOnly = false,
  canUseAssistant = false,
}: {
  readOnly?: boolean;
  canUseAssistant?: boolean;
}) {
  const {
    selectedConversationId,
    selectedDetail,
    isLoadingDetail,
    conversations,
    slaMap,
  } = useConversations();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageCount = selectedDetail?.messages.length ?? 0;

  // Auto-scroll to the bottom of the timeline on conversation switch
  // or when a new message arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [selectedConversationId, messageCount]);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const status = useMemo<QueueStatus>(() => {
    if (!conversation) {
      // Until the list catches up, default to a quiet `handled` chip —
      // matches the queue's fallback shape.
      return { kind: 'handled', label: 'Odesa handled' };
    }
    const slaBreached = slaMap.get(conversation.id) ?? false;
    return deriveQueueStatus(conversation, {
      workOrderSlaBreached: slaBreached,
    });
  }, [conversation, slaMap]);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (!selectedConversationId) {
    return (
      <section
        data-testid='inbox-thread-empty'
        className='flex-1 flex items-center justify-center px-10 text-center'
        style={{ color: 'var(--ink-3, #87796A)' }}
      >
        <div className='max-w-md flex flex-col gap-3'>
          <div
            className='uppercase tracking-[0.12em] text-[10.5px]'
            style={{
              fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
              color: 'var(--ink-4, #9F9075)',
            }}
          >
            Case file
          </div>
          <h2
            className='italic'
            style={{
              fontFamily: 'var(--font-serif-display, Georgia, serif)',
              fontSize: '20px',
              color: 'var(--ink, #1B1712)',
            }}
          >
            Select a conversation
          </h2>
          <p className='text-[13px]' style={{ color: 'var(--ink-3, #87796A)' }}>
            Pick a thread to open the case file.
          </p>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Active case file
  // ---------------------------------------------------------------------------

  if (isLoadingDetail && !selectedDetail) {
    return (
      <main
        data-testid={`inbox-thread-${selectedConversationId}`}
        className='flex-1 min-w-0 h-full flex items-center justify-center'
      >
        <p
          className='text-[12px]'
          style={{
            fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
            color: 'var(--ink-3, #87796A)',
            letterSpacing: '0.08em',
          }}
        >
          LOADING…
        </p>
      </main>
    );
  }

  if (!selectedDetail) {
    return (
      <main
        data-testid={`inbox-thread-${selectedConversationId}`}
        className='flex-1 min-w-0 h-full flex items-center justify-center'
      >
        <p
          className='text-[12px]'
          style={{
            fontFamily: 'var(--font-mono-operator, ui-monospace, monospace)',
            color: 'var(--ink-3, #87796A)',
            letterSpacing: '0.08em',
          }}
        >
          NO CASE FILE
        </p>
      </main>
    );
  }

  const tenantSinceYear = parseTenantSinceYear(selectedDetail.tenant.badge);

  return (
    <main
      data-testid={`inbox-thread-${selectedConversationId}`}
      className='flex-1 min-w-0 h-full flex flex-col overflow-hidden'
    >
      <CaseHeader
        detail={selectedDetail}
        readOnly={readOnly}
        status={
          readOnly && status.kind === 'review'
            ? { ...status, label: 'Owner review' }
            : status
        }
      />
      <CaseMetaStrip
        caseContext={selectedDetail.caseContext}
        status={status.kind}
        unitLabel={selectedDetail.tenant.unitLabel}
        propertyName={selectedDetail.tenant.propertyName}
        tenantSinceYear={tenantSinceYear}
      />
      <OdesaLine
        detail={selectedDetail}
        status={toOdesaStatus(status.kind)}
        audience={readOnly ? 'va' : 'owner'}
      />
      <div
        ref={scrollRef}
        data-testid='inbox-thread-scroll'
        className='flex-1 overflow-y-auto'
      >
        <HeroArea
          detail={selectedDetail}
          status={status.kind}
        />
        <CaseTimeline
          messages={selectedDetail.messages}
          hasPendingDraft={Boolean(selectedDetail.pendingDraft)}
        />
        {canUseAssistant ? (
          <AskOdesaBar />
        ) : (
          <VaOwnerBoundary />
        )}
      </div>
      {canUseAssistant ? <ManualOverride /> : null}
    </main>
  );
}

// Backwards-compatible alias so any in-flight imports of the wave-4
// name keep resolving while waves land.
export const ConversationThreadColumn = CaseFileColumn;

// ---------------------------------------------------------------------------
// HeroArea — picks DraftHeroCard, HandledStatusBlock, or nothing.
// ---------------------------------------------------------------------------

interface HeroAreaProps {
  detail: ConversationDetail;
  status: QueueStatus['kind'];
}

function HeroArea({ detail, status }: HeroAreaProps) {
  if (detail.pendingDraft) {
    const draftMessage = detail.messages.find(
      (m) => m.id === detail.pendingDraft?.id,
    );
    const draftedAt = draftMessage?.createdAt ?? new Date().toISOString();
    return (
      <DraftHeroCard
        messageId={detail.pendingDraft.id}
        draft={{
          id: detail.pendingDraft.id,
          body: detail.pendingDraft.body,
          reasoning: detail.pendingDraft.reasoning,
        }}
        recipient={{
          name: detail.tenant.name,
          channel: 'SMS',
        }}
        draftedAt={draftedAt}
        readOnly
      />
    );
  }
  if (status === 'handled') {
    return <HandledStatusBlock />;
  }
  return null;
}

function VaOwnerBoundary() {
  return (
    <div
      data-testid='inbox-owner-boundary'
      style={{
        margin: '12px 36px 20px',
        padding: '11px 14px',
        border: '1px solid var(--hairline-faint, #EAE0CA)',
        borderRadius: '8px',
        background: 'var(--panel-lift, #FBF6E8)',
        fontFamily: 'var(--font-sans-operator, system-ui, sans-serif)',
        fontSize: '12.5px',
        lineHeight: 1.5,
        color: 'var(--ink-2, #56493A)',
      }}
    >
      Review the case file and prepare context for handoff. Tenant-facing
      commitments and draft decisions return through the owner.
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `tenant.badge` from the data layer is a pre-formatted string like
 * `TENANT SINCE 2024`. Extract the year so the meta strip can render
 * a clean `2024` value with tabular numerals.
 */
function parseTenantSinceYear(badge: string | null | undefined): number | null {
  if (!badge) return null;
  const match = badge.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

/**
 * Narrow the queue chip kind to the Odesa-line status taxonomy.
 * `watching` falls back to `draft` for synthesis purposes — the
 * default branch ("Watching this thread.") is what the operator sees.
 */
function toOdesaStatus(kind: QueueStatus['kind']): OdesaLineStatus {
  if (kind === 'watching') return 'draft';
  return kind;
}
