'use client';

/**
 * ChatMessage — single-row render for one ChatItem variant.
 *
 * Rendering rules:
 *
 *   user             → right-aligned, navy-50 bubble.
 *   assistant_text   → left-aligned, paper-100 bubble. While streaming
 *                      a hairline blink-cursor renders to signal the
 *                      reply is in flight.
 *   assistant_ack    → centred italic muted line ("Looking at...").
 *   proposal_card    → delegated to <ProposedActionCard /> (rendered
 *                      by the parent panel; this component does NOT
 *                      handle the proposal_card variant).
 *
 * Pure presentation — no fetches, no SSE handling, no server actions.
 */

import type { ChatItem } from './types';

interface ChatMessageProps {
  item: Exclude<ChatItem, { kind: 'proposal_card' }>;
}

export function ChatMessage({ item }: ChatMessageProps) {
  switch (item.kind) {
    case 'user':
      return <UserBubble body={item.body} />;
    case 'assistant_text':
      return <AssistantBubble body={item.body} streaming={item.streaming} />;
    case 'assistant_ack':
      return <AckLine body={item.body} />;
    default: {
      // Exhaustiveness check — the proposal_card branch is handled in
      // the parent. If you add a new ChatItem kind, this errors.
      const _exhaustive: never = item;
      void _exhaustive;
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

function UserBubble({ body }: { body: string }) {
  return (
    <div
      data-testid="chat-message-user"
      data-role="user"
      style={{
        alignSelf: 'flex-end',
        maxWidth: '78%',
        background: 'var(--navy-50, #EAF0FA)',
        color: 'var(--ink-900)',
        borderRadius: '16px 16px 4px 16px',
        padding: '10px 14px',
        fontSize: '14px',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {body}
    </div>
  );
}

function AssistantBubble({
  body,
  streaming,
}: {
  body: string;
  streaming: boolean;
}) {
  return (
    <div
      data-testid="chat-message-assistant"
      data-role="assistant"
      data-streaming={streaming ? 'true' : 'false'}
      style={{
        alignSelf: 'flex-start',
        maxWidth: '78%',
        background: 'var(--paper-100)',
        color: 'var(--ink-900)',
        borderRadius: '16px 16px 16px 4px',
        padding: '10px 14px',
        fontSize: '14px',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {body}
      {streaming ? <Caret /> : null}
    </div>
  );
}

function Caret() {
  // Pure-CSS keyframe blink. Per design memory, no animation library.
  return (
    <span
      data-testid="chat-message-caret"
      aria-hidden
      style={{
        display: 'inline-block',
        width: '6px',
        height: '14px',
        marginLeft: '2px',
        verticalAlign: 'text-bottom',
        background: 'var(--ink-500)',
        animation: 'odesa-caret-blink 900ms steps(2, end) infinite',
      }}
    />
  );
}

function AckLine({ body }: { body: string }) {
  return (
    <p
      data-testid="chat-message-ack"
      style={{
        alignSelf: 'center',
        textAlign: 'center',
        fontStyle: 'italic',
        color: 'var(--ink-500)',
        fontSize: '13px',
        margin: 0,
        maxWidth: '70%',
      }}
    >
      {body}
    </p>
  );
}
