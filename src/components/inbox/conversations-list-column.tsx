'use client';

/**
 * Inbox queue column — wave 4.
 *
 * Replaces the wave-3 conversation list with the v4 "tenant signal desk"
 * queue: warm-canvas surface, mono eyebrow on the head, search input
 * below, and rows with deterministic-tone avatars + a single status
 * chip on the right (review / draft / escalated / handled / watching).
 *
 * Status derivation is pure (`deriveQueueStatus` in
 * `src/lib/inbox/queue-status.ts`). Wave 4 ships chip rendering with
 * `workOrderSlaBreached` hard-wired to `false`; Wave 5 will plumb the
 * real SLA signal through provider context. Selection paints an inset
 * terracotta bar via `box-shadow`.
 *
 * The `?filter=owner_review` query param narrows the queue to rows
 * with a pending draft so the cross-link from /today's owner-review
 * rail lands on a focused list.
 *
 * Test-ids preserved from wave 3:
 *   - `inbox-conversations-list`
 *   - `inbox-conversation-search`
 *   - `inbox-conversations-empty`
 *   - `conversation-row-{id}`
 *   - `conversation-pending-dot` (only when chip kind === 'review')
 */

import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { useConversations } from '@/components/inbox/conversations-context';
import type { ConversationListItem } from '@/lib/inbox/conversation-queries';
import {
  deriveQueueStatus,
  type QueueStatus,
} from '@/lib/inbox/queue-status';

// ---------------------------------------------------------------------------
// Avatar tone palette — deterministic by tenant initial.
// ---------------------------------------------------------------------------

const AVATAR_TONES = [
  { bg: '#E8D4C2', fg: '#6B3F26' },
  { bg: '#DDD3BC', fg: '#4A402D' },
  { bg: '#E5C7B5', fg: '#6F3922' },
  { bg: '#D9DFC8', fg: '#3F4A29' },
  { bg: '#D6D1C2', fg: '#494232' },
] as const;

function avatarToneForName(name: string): (typeof AVATAR_TONES)[number] {
  const code =
    name.trim().toUpperCase().charCodeAt(0) || AVATAR_TONES.length;
  return AVATAR_TONES[code % AVATAR_TONES.length] ?? AVATAR_TONES[0]!;
}

// ---------------------------------------------------------------------------
// Chip palette — keyed off `QueueStatus.kind`.
// ---------------------------------------------------------------------------

type ChipStyle = {
  bg: string;
  fg: string;
  border: string;
};

const CHIP_STYLES: Record<QueueStatus['kind'], ChipStyle> = {
  review: {
    bg: 'var(--amber-bg)',
    fg: 'var(--amber-ink)',
    border: 'var(--amber-border)',
  },
  draft: {
    bg: 'var(--neutral-bg)',
    fg: 'var(--neutral-ink)',
    border: 'var(--neutral-border)',
  },
  escalated: {
    bg: 'var(--clay-bg)',
    fg: 'var(--clay-ink)',
    border: 'var(--clay-border)',
  },
  handled: {
    bg: 'var(--green-bg)',
    fg: 'var(--green-ink)',
    border: 'var(--green-border)',
  },
  watching: {
    bg: 'var(--canvas-deep)',
    fg: 'var(--ink-3, #87796A)',
    border: 'var(--hairline-strong)',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxQueueColumn({ readOnly = false }: { readOnly?: boolean }) {
  const {
    conversations,
    activity,
    slaMap,
    selectedConversationId,
    selectConversation,
    searchQuery,
    setSearchQuery,
  } = useConversations();

  const searchParams = useSearchParams();
  const ownerReviewOnly = searchParams?.get('filter') === 'owner_review';

  const scoped = useMemo(() => {
    if (!ownerReviewOnly) return conversations;
    return conversations.filter((c) => c.pendingDraftId !== null);
  }, [conversations, ownerReviewOnly]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((c) => {
      return (
        c.tenantName.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q)
      );
    });
  }, [scoped, searchQuery]);

  const counts = useMemo(() => {
    let needYou = 0;
    let quiet = 0;
    let handled = 0;
    for (const c of conversations) {
      const status = deriveQueueStatus(c, {
        workOrderSlaBreached: slaMap.get(c.id) ?? false,
      });
      if (status.kind === 'review' || status.kind === 'escalated') {
        needYou += 1;
      } else if (status.kind === 'draft') {
        quiet += 1;
      } else {
        handled += 1;
      }
    }
    return { needYou, quiet, handled };
  }, [conversations, slaMap]);

  const handledTotal = activity.aiSentToday;
  const dateLabel = useMemo(() => formatHeadDate(new Date()), []);

  return (
    <aside
      data-testid='inbox-conversations-list'
      className='flex flex-col h-full overflow-hidden'
      style={{
        width: '340px',
        flexShrink: 0,
        background: 'var(--canvas)',
        borderRight: '1px solid var(--hairline-faint)',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    >
      <QueueHead
        dateLabel={dateLabel}
        counts={counts}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        readOnly={readOnly}
      />

      <div className='flex-1 overflow-y-auto'>
        {filtered.length === 0 ? (
          <EmptyState
            hasFilter={Boolean(searchQuery.trim()) || ownerReviewOnly}
          />
        ) : (
          <ul role='list' className='flex flex-col'>
            {filtered.map((conv) => (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                selected={conv.id === selectedConversationId}
                slaBreached={slaMap.get(conv.id) ?? false}
                onSelect={() => selectConversation(conv.id)}
                readOnly={readOnly}
              />
            ))}
          </ul>
        )}
      </div>

      <QueueFoot handledTotal={handledTotal} />
    </aside>
  );
}

// Backwards-compatible alias so any stale imports don't break the build
// while Wave 5/6/7 land. The canonical export is `InboxQueueColumn`.
export const ConversationsListColumn = InboxQueueColumn;

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

interface QueueHeadProps {
  dateLabel: string;
  counts: { needYou: number; quiet: number; handled: number };
  searchQuery: string;
  onSearchChange: (q: string) => void;
  readOnly: boolean;
}

function QueueHead({
  dateLabel,
  counts,
  searchQuery,
  onSearchChange,
  readOnly,
}: QueueHeadProps) {
  return (
    <div
      className='px-5 pt-4 pb-3 sticky top-0 z-10'
      style={{
        background: 'var(--canvas)',
        borderBottom: '1px solid var(--hairline-faint)',
      }}
    >
      <div className='flex items-baseline justify-between gap-2'>
        <span
          className='uppercase tracking-[0.12em] text-[10.5px]'
          style={{
            fontFamily: 'var(--font-mono-operator)',
            color: 'var(--ink-3, #87796A)',
          }}
        >
          {readOnly ? 'Owner handoff · today' : 'Owner review · today'}
        </span>
        <span
          className='text-[10.5px] tracking-[0.06em]'
          style={{
            fontFamily: 'var(--font-mono-operator)',
            color: 'var(--ink-4, #9B8E76)',
          }}
        >
          {dateLabel}
        </span>
      </div>
      <div
        className='mt-1 text-[12px]'
        style={{
          fontFamily: 'var(--font-mono-operator)',
          color: 'var(--ink-3, #87796A)',
        }}
      >
        <span className='num'>{counts.needYou}</span>{' '}
        {readOnly ? 'waiting owner' : 'need review'}
        <Sep />
        <span className='num'>{counts.quiet}</span> quiet
        <Sep />
        <span className='num'>{counts.handled}</span> handled
      </div>

      <div className='mt-3'>
        <input
          type='text'
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder='Search threads…'
          data-testid='inbox-conversation-search'
          className='w-full focus:outline-none transition-colors'
          style={{
            background: 'var(--panel-clean)',
            border: '1px solid var(--hairline-faint)',
            borderRadius: '8px',
            padding: '7px 12px',
            fontSize: '13px',
            color: 'var(--ink, #1B1712)',
            fontFamily: 'inherit',
          }}
        />
      </div>
    </div>
  );
}

function Sep() {
  return (
    <span
      aria-hidden='true'
      style={{
        display: 'inline-block',
        width: '3px',
        height: '3px',
        borderRadius: '50%',
        background: 'var(--hairline-strong)',
        margin: '0 7px',
        transform: 'translateY(-2px)',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface ConversationRowProps {
  conversation: ConversationListItem;
  selected: boolean;
  slaBreached: boolean;
  onSelect: () => void;
  readOnly: boolean;
}

function ConversationRow({
  conversation,
  selected,
  slaBreached,
  onSelect,
  readOnly,
}: ConversationRowProps) {
  const initial =
    conversation.tenantName.trim().charAt(0).toUpperCase() || '?';
  const tone = avatarToneForName(conversation.tenantName);
  const timeAgo = relativeTimestamp(conversation.lastMessageAt);
  // Wave 5 plumbs the real SLA-breached signal via provider context's
  // `slaMap` — driven by the server-side `getBreachedTenantIds` pass.
  const status = deriveQueueStatus(conversation, {
    workOrderSlaBreached: slaBreached,
  });
  const chip = CHIP_STYLES[status.kind];

  return (
    <li>
      <button
        type='button'
        onClick={onSelect}
        data-testid={`conversation-row-${conversation.id}`}
        data-selected={selected ? 'true' : undefined}
        aria-current={selected ? 'true' : undefined}
        className='w-full text-left flex flex-col gap-1 transition-colors'
        style={{
          padding: '11px 18px',
          borderBottom: '1px solid var(--hairline-faint)',
          background: selected ? 'var(--panel-lift)' : 'transparent',
          boxShadow: selected
            ? 'inset 3px 0 0 var(--terracotta)'
            : undefined,
          color: 'var(--ink, #1B1712)',
        }}
      >
        <div className='flex items-center gap-3'>
          <span
            aria-hidden='true'
            className='flex items-center justify-center flex-shrink-0'
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: tone.bg,
              color: tone.fg,
              fontFamily: 'var(--font-sans, system-ui, sans-serif)',
              fontSize: '10.5px',
              fontWeight: 500,
            }}
          >
            {initial}
          </span>
          <span
            className='truncate text-[13px] flex-1 min-w-0'
            style={{ fontWeight: 500, color: 'var(--ink, #1B1712)' }}
          >
            {conversation.tenantName}
          </span>
          <span
            className='num text-[10.5px] flex-shrink-0'
            style={{
              fontFamily: 'var(--font-mono-operator)',
              color: 'var(--ink-3, #87796A)',
            }}
          >
            {timeAgo}
          </span>
        </div>
        <div className='flex items-center gap-2 pl-[36px]'>
          <span
            className='truncate text-[12px] flex-1 min-w-0'
            style={{ color: 'var(--ink-3, #87796A)' }}
          >
            {conversation.lastMessagePreview || (
              <em style={{ color: 'var(--ink-4, #9B8E76)' }}>(no messages)</em>
            )}
          </span>
          <Chip
            chip={chip}
            label={readOnly && status.kind === 'review' ? 'Owner review' : status.label}
            showPulse={status.kind === 'review'}
          />
        </div>
      </button>
    </li>
  );
}

interface ChipProps {
  chip: ChipStyle;
  label: string;
  showPulse: boolean;
}

function Chip({ chip, label, showPulse }: ChipProps) {
  return (
    <span
      className='inline-flex items-center gap-1 uppercase tracking-[0.08em] flex-shrink-0'
      style={{
        background: chip.bg,
        color: chip.fg,
        border: `1px solid ${chip.border}`,
        borderRadius: '4px',
        padding: '2px 6px',
        fontSize: '9px',
        fontFamily: 'var(--font-mono-operator)',
        lineHeight: 1.2,
      }}
    >
      <span
        aria-hidden={showPulse ? undefined : 'true'}
        data-testid={showPulse ? 'conversation-pending-dot' : undefined}
        style={{
          display: 'inline-block',
          width: '4px',
          height: '4px',
          borderRadius: '50%',
          background: 'currentColor',
          opacity: showPulse ? 1 : 0.55,
        }}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty + Foot
// ---------------------------------------------------------------------------

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div
      className='flex items-center justify-center p-8 text-center'
      data-testid='inbox-conversations-empty'
      style={{ minHeight: '160px' }}
    >
      <p
        className='text-[12.5px]'
        style={{
          color: 'var(--ink-3, #87796A)',
          fontFamily: 'var(--font-mono-operator)',
        }}
      >
        {hasFilter
          ? 'No threads match this view.'
          : 'No threads yet. Once tenants text Odesa, they will appear here.'}
      </p>
    </div>
  );
}

function QueueFoot({ handledTotal }: { handledTotal: number }) {
  return (
    <div
      className='flex items-center justify-between px-5 py-3'
      style={{
        borderTop: '1px solid var(--hairline-faint)',
        background: 'var(--canvas)',
        fontFamily: 'var(--font-mono-operator)',
        fontSize: '11px',
        color: 'var(--ink-3, #87796A)',
      }}
    >
      {handledTotal === 0 ? (
        <span>Nothing auto-handled yet today</span>
      ) : (
        <span>
          Odesa handled <span className='num'>{handledTotal}</span> quietly
        </span>
      )}
      <span
        aria-hidden='true'
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--ink-4, #9B8E76)',
        }}
      >
        <span style={{ fontSize: '12px', lineHeight: 1 }}>⌕</span>
        <span
          style={{
            border: '1px solid var(--hairline-faint)',
            borderRadius: '3px',
            padding: '0 4px',
            fontSize: '10px',
            background: 'var(--panel-clean)',
          }}
        >
          /
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatHeadDate(d: Date): string {
  // e.g. "May 28" — mono small caps in the head, matches v4 mockup.
  const month = MONTH_ABBR[d.getMonth()];
  return `${month} ${d.getDate()}`;
}
