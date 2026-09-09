'use client';

import Link from 'next/link';
import { Phone, MessageSquare, MessageCircle } from 'lucide-react';
import type { ConversationCard } from '@/lib/properties/queries';
import type { ConversationChannel } from '@/types/database';

/**
 * Conversations rail for the unit-detail page.
 *
 * Renders the tenant's last 3 conversations as compact cards. Each card
 * shows timestamp (meta), summary (one line), and a channel icon.
 * Clicking navigates to `/inbox?conversation=<id>` — Agent I owns
 * the receiving end of that query param.
 *
 * Layout: on desktop this is a right rail (sticky, 320px); on mobile
 * it stacks below lease/tenant. The containing page owns the grid
 * decision — this component renders a vertical stack of cards that
 * works at any width.
 */
export interface ConversationsRailProps {
  conversations: ConversationCard[];
}

export function ConversationsRail({ conversations }: ConversationsRailProps) {
  return (
    <section
      data-testid="unit-detail-conversations"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <p className="meta-label" style={{ color: 'var(--ink-500)' }}>
        Recent conversations
      </p>

      {conversations.length === 0 ? (
        <div
          data-testid="unit-detail-conversations-empty"
          style={{
            padding: '20px 22px',
            background: 'var(--paper-0)',
            border: '1px dashed var(--ink-200)',
            borderRadius: 'var(--radius-sm-odesa)',
            fontSize: '13px',
            color: 'var(--ink-500)',
            lineHeight: 1.5,
          }}
        >
          No conversations with this tenant yet. Calls and texts to Odesa will appear here automatically.
        </div>
      ) : (
        <ul
          role="list"
          style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: 0, padding: 0, listStyle: 'none' }}
        >
          {conversations.map((c) => (
            <li key={c.id}>
              <ConversationRow conversation={c} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationCard }) {
  return (
    <Link
      href={`/inbox?conversation=${conversation.id}`}
      data-testid={`unit-detail-conversation-${conversation.id}`}
      data-conversation-channel={conversation.channel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '14px 16px',
        background: 'var(--paper-0)',
        border: '1px solid var(--ink-200)',
        borderRadius: 'var(--radius-sm-odesa)',
        textDecoration: 'none',
        color: 'var(--ink-800)',
        transition: 'border-color 180ms var(--ease-smooth)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--navy-300)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--ink-200)';
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="meta-label tabular-nums"
          style={{ color: 'var(--ink-500)' }}
          data-testid={`unit-detail-conversation-${conversation.id}-timestamp`}
        >
          {formatTimestamp(conversation.timestamp)}
        </span>
        <ChannelIcon
          channel={conversation.channel}
          testId={`unit-detail-conversation-${conversation.id}-icon`}
        />
      </div>
      <p
        style={{
          margin: 0,
          fontSize: '13px',
          lineHeight: 1.5,
          color: 'var(--ink-800)',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
        }}
      >
        {conversation.summary ?? 'No summary yet.'}
      </p>
    </Link>
  );
}

interface ChannelIconProps {
  channel: ConversationChannel;
  testId: string;
}

function ChannelIcon({ channel, testId }: ChannelIconProps) {
  const meta = {
    voice: { Icon: Phone, label: 'Voice call' },
    sms: { Icon: MessageSquare, label: 'SMS' },
    imessage: { Icon: MessageCircle, label: 'Text' },
  }[channel];

  return (
    <span
      data-testid={testId}
      data-channel={channel}
      aria-label={meta.label}
      title={meta.label}
      style={{
        display: 'inline-flex',
        color: 'var(--ink-500)',
      }}
    >
      <meta.Icon size={14} aria-hidden />
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
}
